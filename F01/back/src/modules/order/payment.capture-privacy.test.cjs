const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

// No application bootstrap, Vitest setup, dotenv, environment access or real adapters.
// Unknown imports and all logging fail closed; only these two sources execute.
function loadSource(filename, dependencies = {}) {
  const source = readFileSync(path.join(__dirname, filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Blocked import in isolated capture regression');
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {
      throw new Error('Blocked logging in isolated capture regression');
    }])),
  }, { timeout: 1000 });
  return exports;
}

function createHarness({ rejectCapture = false, rejectOrderOnce = false } = {}) {
  const domain = loadSource('order.domain.ts');
  class BlockedAdapter {
    constructor() { throw new Error('Blocked external adapter in isolated capture regression'); }
  }
  const { PaymentService } = loadSource('payment.service.ts', {
    './order.domain': domain,
    '../financial/financial.domain': {},
    '../transfer/transfer.domain': {},
    '../transfer/transfer.mongo.repository': { MongoTransferRepository: BlockedAdapter },
    stripe: BlockedAdapter,
  });
  const { Order, Payment, OrderStatus, FinancialStatus, PaymentStatus } = domain;
  const now = new Date('2026-01-01T00:00:00.000Z');
  let orderSnapshot = {
    id: 'synthetic-order', personId: 'synthetic-consumer',
    status: OrderStatus.PENDING_PAYMENT, financialStatus: FinancialStatus.PENDING,
    vendorGroups: [{
      id: 'synthetic-group', orderId: 'synthetic-order', vendorId: 'synthetic-vendor',
      status: domain.OrderVendorGroupStatus.PENDING,
      items: [{ id: 'synthetic-item', productId: 'synthetic-product',
        productName: 'Synthetic product', vendorId: 'synthetic-vendor',
        quantity: 1, unitPrice: 100, totalPrice: 100 }],
      subtotal: 100, commissionPct: 10, commissionAmount: 10, vendorNet: 90,
      createdAt: now, updatedAt: now,
    }],
    shippingAddress: { id: 'synthetic-address', street: 'Synthetic street', number: '1',
      neighborhood: 'Synthetic neighborhood', city: 'Synthetic city', state: 'SP', isPrimary: true },
    totalAmount: 100, createdAt: now, updatedAt: now,
  };
  let paymentSnapshot = {
    id: 'synthetic-payment', orderId: orderSnapshot.id, personId: orderSnapshot.personId,
    amount: 100, provider: 'mock', status: PaymentStatus.PENDING,
    createdAt: now, updatedAt: now,
  };
  const writes = [];
  const captureFailure = new Error('Synthetic capture persistence rejection');
  const orderFailure = new Error('Synthetic order persistence rejection');
  const orderRepo = {
    async findById(id) {
      return id === orderSnapshot.id ? Order.reconstruct(structuredClone(orderSnapshot)) : null;
    },
    async update(order) {
      writes.push(`order:${order.status}`);
      assert.equal(paymentSnapshot.status, PaymentStatus.CAPTURED,
        'Order must not be updated before capture is persisted');
      if (rejectOrderOnce) {
        rejectOrderOnce = false;
        throw orderFailure;
      }
      orderSnapshot = structuredClone(order.toJSON());
      return Order.reconstruct(structuredClone(orderSnapshot));
    },
  };
  const paymentRepo = {
    async findById(id) {
      return id === paymentSnapshot.id ? Payment.reconstruct(structuredClone(paymentSnapshot)) : null;
    },
    async update(payment) {
      writes.push(`payment:${payment.status}`);
      // Reject BEFORE applying: mutation of a loaded entity is not a durable write.
      if (rejectCapture && payment.status === PaymentStatus.CAPTURED) throw captureFailure;
      paymentSnapshot = structuredClone(payment.toJSON());
      return Payment.reconstruct(structuredClone(paymentSnapshot));
    },
  };
  const service = new PaymentService(paymentRepo, orderRepo);
  return {
    domain, service, orderRepo, paymentRepo, writes, captureFailure, orderFailure,
    paymentId: paymentSnapshot.id, orderId: orderSnapshot.id,
    allowCapture() { rejectCapture = false; },
    setOrderStatus(status) { orderSnapshot.status = status; },
  };
}

test('CD-063: rejected capture persistence leaves the persisted order pending payment', async () => {
  const { domain, service, orderRepo, paymentRepo, writes, captureFailure, paymentId, orderId } =
    createHarness({ rejectCapture: true });
  const { OrderStatus, FinancialStatus, PaymentStatus } = domain;
  assert.equal((await orderRepo.findById(orderId)).status, OrderStatus.PENDING_PAYMENT);
  assert.notEqual(await paymentRepo.findById(paymentId), await paymentRepo.findById(paymentId));
  assert.notEqual(await orderRepo.findById(orderId), await orderRepo.findById(orderId));

  await assert.rejects(
    service.completeCheckoutPayment(paymentId, 'synthetic-provider-reference', 10000),
    error => error === captureFailure,
    'Capture persistence failure must propagate rather than report completion',
  );
  assert.ok(writes.includes(`payment:${PaymentStatus.AUTHORIZED}`), 'Authorization must be persisted');
  assert.ok(writes.includes(`payment:${PaymentStatus.CAPTURED}`), 'Capture persistence must be attempted');
  const persistedPayment = await paymentRepo.findById(paymentId);
  const persistedOrder = await orderRepo.findById(orderId);
  assert.equal(persistedPayment.status, PaymentStatus.AUTHORIZED,
    'Rejected capture must not leak mutable CAPTURED state into storage');
  assert.equal(persistedPayment.providerTransactionId, 'synthetic-provider-reference');
  assert.equal(persistedPayment.capturedAt, undefined);
  assert.equal(persistedOrder.status, OrderStatus.PENDING_PAYMENT,
    'CD-063: authorization without persisted capture must not mark the order PAID');
  assert.equal(persistedOrder.financialStatus, FinancialStatus.PENDING,
    'A rejected capture must not mark the persisted financial status PAID');
});

test('authorization alone stays pending; rejected capture can retry and complete only once', async () => {
  const h = createHarness({ rejectCapture: true });
  const { OrderStatus, FinancialStatus, PaymentStatus } = h.domain;
  await h.service.authorizePayment(h.paymentId, 'synthetic-provider-reference');
  await h.service.authorizePayment(h.paymentId, 'synthetic-provider-reference');
  assert.equal((await h.orderRepo.findById(h.orderId)).status, OrderStatus.PENDING_PAYMENT);
  assert.equal((await h.orderRepo.findById(h.orderId)).financialStatus, FinancialStatus.PENDING);
  assert.deepEqual(h.writes, [`payment:${PaymentStatus.AUTHORIZED}`]);
  await assert.rejects(h.service.capturePayment(h.paymentId), error => error === h.captureFailure);
  h.allowCapture();
  const captured = await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
  assert.equal(captured.status, PaymentStatus.CAPTURED);
  assert.equal((await h.orderRepo.findById(h.orderId)).status, OrderStatus.PAID);
  assert.equal((await h.orderRepo.findById(h.orderId)).financialStatus, FinancialStatus.PAID);
  const writes = [...h.writes];
  const duplicate = await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
  await h.service.capturePayment(h.paymentId);
  assert.equal(duplicate.id, captured.id);
  assert.equal(duplicate.capturedAt.getTime(), captured.capturedAt.getTime());
  assert.equal(duplicate.providerTransactionId, 'synthetic-provider-reference');
  assert.deepEqual(h.writes, writes, 'Duplicate capture must not persist payment or order again');
  assert.equal(await h.service.isPaymentFinalized(h.paymentId), true);
});

test('completion retries repair a failed order write after durable capture without recapturing', async () => {
  const h = createHarness({ rejectOrderOnce: true });
  const { OrderStatus, PaymentStatus } = h.domain;
  await assert.rejects(
    h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000),
    error => error === h.orderFailure,
  );
  const captured = await h.paymentRepo.findById(h.paymentId);
  assert.equal(captured.status, PaymentStatus.CAPTURED);
  assert.equal((await h.orderRepo.findById(h.orderId)).status, OrderStatus.PENDING_PAYMENT);
  assert.equal(await h.service.isPaymentFinalized(h.paymentId), false,
    'Webhook finalization guard must allow pending order repair');
  const retried = await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
  assert.equal((await h.orderRepo.findById(h.orderId)).status, OrderStatus.PAID);
  assert.equal(retried.capturedAt.getTime(), captured.capturedAt.getTime());
  assert.equal(h.writes.filter(value => value === `payment:${PaymentStatus.CAPTURED}`).length, 1);
  assert.equal(await h.service.isPaymentFinalized(h.paymentId), true);
  const writes = [...h.writes];
  await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
  assert.deepEqual(h.writes, writes);
});

test('direct capture retry also repairs a failed order write', async () => {
  const h = createHarness({ rejectOrderOnce: true });
  await h.service.authorizePayment(h.paymentId, 'synthetic-provider-reference');
  await assert.rejects(h.service.capturePayment(h.paymentId), error => error === h.orderFailure);
  await h.service.capturePayment(h.paymentId);
  assert.equal((await h.orderRepo.findById(h.orderId)).status, h.domain.OrderStatus.PAID);
  assert.equal(h.writes.filter(value => value === `payment:${h.domain.PaymentStatus.CAPTURED}`).length, 1);
});

test('capture rejects an unauthorized payment or cancelled order without persisting capture', async () => {
  const h = createHarness();
  await assert.rejects(h.service.capturePayment(h.paymentId),
    error => error.message === 'PAYMENT_NOT_CAPTURABLE');
  assert.deepEqual(h.writes, []);
  await h.service.authorizePayment(h.paymentId, 'synthetic-provider-reference');
  h.setOrderStatus(h.domain.OrderStatus.CANCELLED);
  await assert.rejects(h.service.capturePayment(h.paymentId), error => error.message === 'ORDER_NOT_PAYABLE');
  assert.equal((await h.paymentRepo.findById(h.paymentId)).status, h.domain.PaymentStatus.AUTHORIZED);
});

test('duplicate captured completion never regresses an advanced or terminal order', async () => {
  const h = createHarness();
  await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
  const writes = [...h.writes];
  for (const status of ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED_PAYMENT']) {
    h.setOrderStatus(h.domain.OrderStatus[status]);
    await h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', 10000);
    await h.service.capturePayment(h.paymentId);
    assert.equal((await h.orderRepo.findById(h.orderId)).status, h.domain.OrderStatus[status]);
  }
  assert.deepEqual(h.writes, writes);
});

test('checkout amount validation remains enforced before any persistence', async () => {
  const h = createHarness();
  for (const amount of [9999, 10000.5, NaN]) {
    await assert.rejects(
      h.service.completeCheckoutPayment(h.paymentId, 'synthetic-provider-reference', amount),
      error => error.message === 'PAYMENT_AMOUNT_MISMATCH',
    );
  }
  assert.deepEqual(h.writes, []);
  assert.equal(await h.service.isPaymentFinalized(h.paymentId), false);
  assert.equal(await h.service.isPaymentFinalized('synthetic-missing-payment'), false);
});
