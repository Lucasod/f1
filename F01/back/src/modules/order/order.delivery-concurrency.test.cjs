const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = readFileSync(join(__dirname, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, Error, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Unexpected import');
  } });
  return exports;
}

function fixture(status, failure) {
  const domain = load('order.domain.ts');
  const { MongoOrderRepository } = load('order.mongo.repository.ts', { './order.domain': domain });
  const now = new Date('2024-01-01T00:00:00Z');
  const groups = ['a', 'b'].map(vendorId => ({
    id: `group-${vendorId}`, orderId: 'order-1', vendorId, status: status === 'paid' ? 'pending' : 'shipped',
    items: [{ id: `item-${vendorId}`, vendorId, productId: vendorId, productName: vendorId,
      quantity: 1, unitPrice: 10, totalPrice: 10 }],
    subtotal: 10, commissionPct: 0, commissionAmount: 0, vendorNet: 10,
    createdAt: now, updatedAt: now,
  }));
  let document = { _id: 'order-1', personId: 'consumer', status, vendorGroups: groups,
    shippingAddress: { id: 'address', street: 's', number: '1', neighborhood: 'n', city: 'c', state: 's', isPrimary: true },
    totalAmount: 20, financialStatus: 'paid', createdAt: now, updatedAt: now };
  const collection = {
    findOne: async () => structuredClone(document),
    updateOne: async (filter, update) => {
      if (failure) throw failure;
      if (typeof filter.status === 'string' && filter.status !== document.status) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      document = { ...document, ...structuredClone(update.$set) };
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { repository: new MongoOrderRepository({ collection: () => collection }) };
}

test('pending payment transition to paid persists successfully', async () => {
  const { repository } = fixture('pending_payment');
  const order = await repository.findById('order-1');
  order.transitionTo('paid');
  const result = await repository.update(order);
  assert.equal(result.status, 'paid');
  assert.equal((await repository.findById('order-1')).status, 'paid');
});

test('ambiguous write failure is propagated rather than reported as success', async () => {
  const failure = new Error('simulated uncertain write outcome');
  const { repository } = fixture('pending_payment', failure);
  const order = await repository.findById('order-1');
  order.transitionTo('paid');
  await assert.rejects(repository.update(order), error => error === failure);
});

test('paid delivery success must reflect persisted item delivery', async () => {
  const { repository } = fixture('paid');
  const order = await repository.findById('order-1');
  order.markItemsDeliveredByIds(['item-a'], 'actor-a');
  let result;
  try {
    result = await repository.update(order);
  } catch (error) {
    assert.equal(error.message, 'INVALID_STATUS_TRANSITION');
  }
  const persisted = await repository.findById('order-1');
  if (result) {
    assert.equal(result.vendorGroups[0].items[0].deliveredBy, persisted.vendorGroups[0].items[0].deliveredBy);
    assert.equal(persisted.vendorGroups[0].items[0].deliveredBy, 'actor-a');
  } else {
    assert.equal(persisted.vendorGroups[0].items[0].deliveredBy, undefined);
  }
});

test('stale whole-order writer must not erase another vendor delivery', async () => {
  const { repository } = fixture('shipped');
  const first = await repository.findById('order-1');
  const stale = await repository.findById('order-1');
  first.markItemsDeliveredByIds(['item-a'], 'actor-a');
  stale.markItemsDeliveredByIds(['item-b'], 'actor-b');
  await repository.update(first);
  try { await repository.update(stale); } catch { /* A conflict is acceptable. */ }
  const persisted = await repository.findById('order-1');
  assert.equal(persisted.vendorGroups[0].items[0].deliveredBy, 'actor-a');
});

test('delivery on an already paid order is persisted, not rejected', async () => {
  const { repository } = fixture('paid');
  const order = await repository.findById('order-1');
  order.markItemsDeliveredByIds(['item-a'], 'actor-a');
  const result = await repository.update(order);
  const persisted = await repository.findById('order-1');
  assert.equal(result.vendorGroups[0].items[0].deliveredBy, 'actor-a');
  assert.equal(persisted.vendorGroups[0].items[0].deliveredBy, 'actor-a');
});

test('stale refund order write must preserve a concurrent delivery', async () => {
  const { repository } = fixture('shipped');
  const delivery = await repository.findById('order-1');
  const refund = await repository.findById('order-1');
  delivery.markItemsDeliveredByIds(['item-a'], 'actor-a');
  refund.refund(true);
  await repository.update(delivery);
  await repository.update(refund);
  const persisted = await repository.findById('order-1');
  assert.equal(persisted.vendorGroups[0].items[0].deliveredBy, 'actor-a');
  assert.equal(persisted.financialStatus, 'fully_refunded');
});

test('refund retry repairs the order after a conflicting order write', async () => {
  const domain = load('order.domain.ts');
  const { PaymentService } = load('payment.service.ts', {
    './order.domain': domain,
    '../financial/financial.domain': {},
    '../transfer/transfer.domain': {},
    '../transfer/transfer.mongo.repository': {},
    stripe: {},
  });
  const payment = { status: 'captured', orderId: 'order-1', refund: () => ({ status: 'refunded' }) };
  let persistedFinancialStatus = 'paid';
  let attempts = 0;
  const service = new PaymentService(
    { findById: async () => payment, update: async () => payment },
    {
      findById: async () => ({ refund() { this.financialStatus = 'fully_refunded'; } }),
      update: async order => {
        attempts++;
        if (attempts === 1) throw new Error('ORDER_CONFLICT');
        persistedFinancialStatus = order.financialStatus;
        return order;
      },
    },
  );
  await assert.rejects(service.refundPayment('payment-1'), { message: 'ORDER_CONFLICT' });
  await service.refundPayment('payment-1');
  assert.equal(persistedFinancialStatus, 'fully_refunded');
});
