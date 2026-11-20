// ATENÇÃO: Este script executa operações REAIS na Stripe (criação de PaymentIntent,
// Charge e Transfer em modo de teste) e grava no MongoDB. NÃO executar em produção.
// Nunca commitar este arquivo. Mantido untracked e ignorado pelo .gitignore.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import Stripe from 'stripe';
import { config } from 'dotenv';
import { Order, OrderStatus, PaymentStatus } from '../src/modules/order/order.domain';
import { PaymentService } from '../src/modules/order/payment.service';
import { MongoOrderRepository } from '../src/modules/order/order.mongo.repository';
import { MongoPaymentRepository } from '../src/modules/order/payment.mongo.repository';
import { Vendor, VendorStatus } from '../src/modules/vendor/vendor.domain';
import { MongoVendorRepository } from '../src/modules/vendor/vendor.mongo.repository';
import { MongoTransferRepository } from '../src/modules/transfer/transfer.mongo.repository';
import { TransferService } from '../src/modules/transfer/transfer.service';
import { TransferStatus } from '../src/modules/transfer/transfer.domain';
import { MongoFinancialMovementRepository } from '../src/modules/financial/financial.mongo.movement';
import { MongoFinancialEventRepository } from '../src/modules/financial/financial.mongo.event';
import { MongoFinancialAllocationRepository } from '../src/modules/financial/financial.mongo.repository';
import { FinancialService } from '../src/modules/financial/financial.service';
import { createStripeWebhookHandler } from '../src/modules/checkout/stripe-webhook.handler';
import express from 'express';
import request from 'supertest';

config();
// Run only against Stripe test mode. Each run uses a new MongoDB database for evidence.
const runId = randomUUID().replaceAll('-', '');
const dbName = 'f01_a01_' + runId;
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() || '';
  assert.match(key.slice(0, 8), /^(sk|rk)_test_/);
  const stripe = new Stripe(key);
  const destination = 'acct_1Udbt2Fp9v2i1Gnj';
  assert.equal((await stripe.accounts.retrieve()).id, 'acct_1UXkRjFp9vAqWJqm');
  assert.equal((await stripe.accounts.retrieve(destination)).capabilities?.transfers, 'active');
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  const orderRepo = new MongoOrderRepository(db);
  const paymentRepo = new MongoPaymentRepository(db);
  const vendorRepo = new MongoVendorRepository(db);
  const movement = new MongoFinancialMovementRepository(db);
  const events = new MongoFinancialEventRepository(db);
  const fin = new FinancialService(new MongoFinancialAllocationRepository(db));
  const order = Order.create({
    personId: 'a01-buyer', vendorGroups: [{ vendorId: 'a01-vendor', commissionPct: 10,
      items: [{ productId: 'a01-item', productName: 'Stripe test', vendorId: 'a01-vendor', quantity: 1, unitPrice: 10 }] }],
    shippingAddress: { id: 'address', street: 'Fixture', number: '1', neighborhood: 'Fixture', city: 'Fixture', state: 'SP', isPrimary: true },
  });
  await orderRepo.save(order);
  const group = order.vendorGroups[0].id;
  const build = (repo: MongoTransferRepository) => new TransferService(repo, fin, key, orderRepo, movement, events, vendorRepo);
  const repo = new MongoTransferRepository(db);
  const worker = build(repo);
  const paymentService = new PaymentService(paymentRepo, orderRepo, undefined, undefined, fin, repo, undefined, movement, events, vendorRepo, db, worker);
  const payment = await paymentService.createPayment(order.id, order.personId, order.totalAmount);
  const pi = await stripe.paymentIntents.create({
    amount: 1000, currency: 'brl', payment_method: 'pm_card_visa', confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, transfer_group: order.id,
  }, { idempotencyKey: runId });
  assert.equal(pi.livemode, false);
  assert.equal(pi.status, 'succeeded');
  assert.equal(pi.transfer_data, null);
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  assert.ok(chargeId);
  const charge = await stripe.charges.retrieve(chargeId);
  assert.equal(charge.paid, true);
  assert.equal(charge.transfer ?? null, null);
  const signingSecret = randomUUID();
  process.env.STRIPE_WEBHOOK_SECRET = signingSecret;
  const payload = JSON.stringify({
    id: 'evt_' + runId, type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', payment_intent: pi.id, amount_total: 1000, currency: 'brl', metadata: { paymentId: payment.id } } },
  });
  const send = (payments: PaymentService, transfers: TransferService) => {
    const app = express();
    app.post('/', express.raw({ type: 'application/json' }), createStripeWebhookHandler(stripe, payments, { removeItemQuantity: async () => {} } as any, transfers));
    return request(app).post('/').set('Content-Type', 'application/json').set('stripe-signature', stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret })).send(payload);
  };
  assert.equal((await send(paymentService, worker)).status, 200);
  assert.equal((await repo.findLastByOrderVendorGroupId(group))?.status, TransferStatus.FAILED);
  await vendorRepo.save(Vendor.reconstruct({
    id: 'a01-vendor', personId: 'a01-seller', storeName: 'Fixture', slug: 'a01-vendor',
    status: VendorStatus.ACTIVE, commissionPct: 10, stripeAccountId: destination,
  }));
  const recovering = build(new MongoTransferRepository(db));
  const real = (recovering as any).stripe.transfers.create.bind((recovering as any).stripe.transfers);
  let accepted: Stripe.Transfer | undefined;
  (recovering as any).stripe.transfers.create = async (...args: any[]) => {
    accepted = await real(...args);
    throw new Error('Simulated response loss after Stripe accepted');
  };
  assert.deepEqual(await recovering.recoverFailedTransfers(), { recovered: 0, failed: 1 });
  assert.ok(accepted);
  const afterLoss = await repo.findLastByOrderVendorGroupId(group);
  assert.equal(afterLoss?.stripeTransferId, undefined);
  assert.equal(afterLoss?.retryAttempt, 2);
  assert.equal(afterLoss?.providerTransactionId, chargeId);
  const fresh = build(new MongoTransferRepository(db));
  const concurrent = build(new MongoTransferRepository(db));
  const results = await Promise.all([fresh.recoverFailedTransfers(), concurrent.recoverFailedTransfers()]);
  assert.equal(results.reduce((count, result) => count + result.recovered, 0), 1);
  const stored = await repo.findLastByOrderVendorGroupId(group);
  assert.equal(stored?.status, TransferStatus.COMPLETED);
  assert.equal(stored?.retryAttempt, 3);
  assert.equal(stored?.stripeTransferId, accepted.id);
  assert.equal((await paymentRepo.findById(payment.id))?.status, PaymentStatus.CAPTURED);
  assert.equal((await paymentRepo.findById(payment.id))?.providerTransactionId, pi.id);
  assert.equal((await orderRepo.findById(order.id))?.status, OrderStatus.PAID);
  const replayPayment = new PaymentService(paymentRepo, orderRepo, undefined, undefined, fin, repo, undefined, movement, events, vendorRepo, db, fresh);
  assert.equal((await send(replayPayment, fresh)).status, 200);
  const replay = await fresh.createTransferWithDetails(order.id, group, 10, 10, pi.id);
  assert.equal(replay.transfer.id, accepted.id);
  const transfers = await stripe.transfers.list({ transfer_group: order.id });
  assert.equal(transfers.data.length, 1);
  const transfer = transfers.data[0];
  assert.equal(transfer.source_transaction, chargeId);
  assert.equal(transfer.destination, destination);
  assert.equal(transfer.amount, 900);
  assert.equal(transfer.currency, 'brl');
  const ledger = await movement.findByEntity('transfer', stored!.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].data.amount, 9);
  assert.equal(await db.collection('financial_events').countDocuments({ orderId: order.id, eventType: 'transfer_completed' }), 1);
  assert.equal(await db.collection('transfers').countDocuments({ orderId: order.id }), 1);
  console.log(JSON.stringify({ dbName, orderId: order.id, paymentId: payment.id, intent: pi.id, charge: chargeId, transfer: transfer.id, gross: charge.amount, net: transfer.amount, retainedBeforeFees: charge.amount - transfer.amount, retryAttempt: stored?.retryAttempt, workersRecovered: results.map(r => r.recovered), ledgerRows: ledger.length, stripeTransfers: transfers.data.length }));
}
main().catch((err) => {
  console.error(JSON.stringify({ name: err.name, code: err.code, assertion: err.operator, setupDb: dbName, stackLocation: String(err.stack).split('\n').find(s => s.includes('verify-connect-recovery.ts'))?.trim() }));
  process.exitCode = 1;
}).finally(() => client.close());
