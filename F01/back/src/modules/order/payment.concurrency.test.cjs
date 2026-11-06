const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

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
      throw new Error('Blocked import in isolated concurrency regression');
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {
      throw new Error('Blocked logging in isolated concurrency regression');
    }])),
  }, { timeout: 1000 });
  return exports;
}

test('CR002: stale order loaded before concurrent advanced transition must not overwrite state when markCapturedOrderPaid runs', async () => {
  const domain = loadSource('order.domain.ts');
  const { Order, Payment, OrderStatus, FinancialStatus, PaymentStatus } = domain;
  const { PaymentService } = loadSource('payment.service.ts', {
    './order.domain': domain,
    '../financial/financial.domain': {},
    '../transfer/transfer.domain': {},
    '../transfer/transfer.mongo.repository': { MongoTransferRepository: class { constructor() { throw new Error('blocked'); } } },
    stripe: class { constructor() { throw new Error('blocked'); } },
  });

  const now = new Date('2026-01-01T00:00:00.000Z');
  // A stale snapshot captured before the concurrent transition: still PENDING_PAYMENT.
  const staleSnapshot = {
    id: 'synthetic-order', personId: 'synthetic-consumer',
    status: OrderStatus.PENDING_PAYMENT, financialStatus: FinancialStatus.PENDING,
    vendorGroups: [], shippingAddress: { id: 'a', street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'SP', isPrimary: true },
    totalAmount: 100, createdAt: now, updatedAt: now,
  };
  // Persisted (current) snapshot after concurrent transition to an advanced state.
  const currentSnapshot = structuredClone(staleSnapshot);
  currentSnapshot.status = OrderStatus.PROCESSING;
  currentSnapshot.financialStatus = FinancialStatus.PAID;
  currentSnapshot.updatedAt = new Date(now.getTime() + 1000);

  const writes = [];
  // Fake snapshot repository: reconstructs entities on reads. findById returns the STALE
  // snapshot (simulating a read that happened before the concurrent transition), while
  // update persists to the current snapshot.
  const orderRepo = {
    async findById(id) {
      // Stale read: returns the pre-transition snapshot regardless of persisted state.
      return id === 'synthetic-order' ? Order.reconstruct(structuredClone(staleSnapshot)) : null;
    },
    async update(order) {
      writes.push(`order:${order.status}`);
      // Reproduce MongoDB conditional update: PAID transition only allowed from PENDING_PAYMENT.
      if (order.status === OrderStatus.PAID && currentSnapshot.status !== OrderStatus.PENDING_PAYMENT) {
        throw new Error('INVALID_STATUS_TRANSITION');
      }
      // Persist into current snapshot.
      Object.assign(currentSnapshot, structuredClone(order.toJSON()));
      return Order.reconstruct(structuredClone(currentSnapshot));
    },
  };
  const paymentSnapshot = {
    id: 'synthetic-payment', orderId: 'synthetic-order', personId: 'synthetic-consumer',
    amount: 100, provider: 'mock', status: PaymentStatus.CAPTURED,
    providerTransactionId: 'synthetic-provider-reference', capturedAt: now,
    createdAt: now, updatedAt: now,
  };
  const paymentRepo = {
    async findById(id) {
      return id === 'synthetic-payment' ? Payment.reconstruct(structuredClone(paymentSnapshot)) : null;
    },
    async update(p) {
      Object.assign(paymentSnapshot, structuredClone(p.toJSON()));
      return Payment.reconstruct(structuredClone(paymentSnapshot));
    },
  };

  const service = new PaymentService(paymentRepo, orderRepo);

  // capture is already persisted; markCapturedOrderPaid runs using the stale read.
  await service.capturePayment('synthetic-payment');

  // The concurrent advanced state must survive; a stale write must not regress it.
  assert.equal(currentSnapshot.status, OrderStatus.PROCESSING,
    'CR002: stale order write must not overwrite an advanced/terminal order state');
});
