const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, 'order.domain.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const domain = {};
runInNewContext(compiled, {
  exports: domain,
  require() { throw new Error('Unexpected dependency in isolated order test'); },
}, { timeout: 1000 });

const mongoSource = readFileSync(path.join(__dirname, 'order.mongo.repository.ts'), 'utf8');
const mongoExports = {};
runInNewContext(ts.transpileModule(mongoSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: mongoExports,
  require(name) {
    if (name === './order.domain') return domain;
    throw new Error('Unexpected dependency in isolated Mongo repository test');
  },
}, { timeout: 1000 });

function makeOrder(status = domain.OrderStatus.PENDING_PAYMENT) {
  return domain.Order.reconstruct({
    id: 'synthetic-order', personId: 'synthetic-consumer', status,
    vendorGroups: [], shippingAddress: { id: 'a', street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'ST', isPrimary: true },
    totalAmount: 100, financialStatus: domain.FinancialStatus.PENDING,
    createdAt: new Date(0), updatedAt: new Date(0),
  });
}

function fakeCollection(initialStatus, advanceBeforeUpdate) {
  let doc = initialStatus === null ? null : { _id: 'synthetic-order', status: initialStatus };
  const calls = [];
  return {
    calls,
    get doc() { return doc; },
    async updateOne(filter, update, options) {
      calls.push({ filter, options });
      if (advanceBeforeUpdate) doc.status = advanceBeforeUpdate;
      const allowed = doc && doc._id === filter._id && (!filter.status ||
        (filter.status.$nin ? !filter.status.$nin.includes(doc.status) : doc.status === filter.status));
      if (allowed) {
        Object.assign(doc, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        if (doc) throw Object.assign(new Error('duplicate key'), { code: 11000 });
        doc = { _id: filter._id, ...update.$setOnInsert, ...update.$set };
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async findOne() { return doc; },
    async insertOne(value) {
      if (doc) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      doc = value;
      return { acknowledged: true };
    },
  };
}

function mongoRepo(collection) {
  return new mongoExports.MongoOrderRepository({ collection: () => collection });
}

for (const currentStatus of ['PROCESSING', 'CANCELLED']) {
  test(`stale pending order cannot overwrite ${currentStatus}`, async () => {
    const { Order, OrderStatus, InMemoryOrderRepository } = domain;
    const repo = new InMemoryOrderRepository();
    const original = Order.create({
      personId: 'synthetic-consumer',
      vendorGroups: [{
        vendorId: 'synthetic-vendor',
        items: [{ productId: 'synthetic-product', productName: 'Product', vendorId: 'synthetic-vendor', quantity: 1, unitPrice: 100 }],
        commissionPct: 10,
      }],
      shippingAddress: { id: 'address', street: 'Street', number: '1', neighborhood: 'Area', city: 'City', state: 'ST', isPrimary: true },
    });
    await repo.save(original);
    const stale = Order.reconstruct({ ...original.toJSON() });
    const advanced = Order.reconstruct({ ...original.toJSON(), status: OrderStatus[currentStatus] });
    await repo.update(advanced);

    try {
      await repo.update(stale);
    } catch (error) {
      assert.equal(error.message, 'INVALID_STATUS_TRANSITION');
    }
    assert.equal((await repo.findById(original.id)).status, OrderStatus[currentStatus]);
  });
}

test('failed payment may return to pending in memory', async () => {
  const repo = new domain.InMemoryOrderRepository();
  await repo.save(makeOrder(domain.OrderStatus.FAILED_PAYMENT));
  await repo.update(makeOrder());
  assert.equal((await repo.findById('synthetic-order')).status, domain.OrderStatus.PENDING_PAYMENT);
});

for (const status of ['PROCESSING', 'CANCELLED']) {
  test(`Mongo conditional write rejects an advance to ${status} at update time`, async () => {
    const collection = fakeCollection(domain.OrderStatus.PENDING_PAYMENT, domain.OrderStatus[status]);
    await assert.rejects(mongoRepo(collection).update(makeOrder()), error => error.message === 'INVALID_STATUS_TRANSITION');
    assert.equal(collection.doc.status, domain.OrderStatus[status]);
    assert.equal(collection.calls[0].options.upsert, false);
    assert.ok(collection.calls[0].filter.status.$nin.includes(domain.OrderStatus[status]));
  });
}

test('Mongo permits failed payment to return to pending', async () => {
  const collection = fakeCollection(domain.OrderStatus.FAILED_PAYMENT);
  await mongoRepo(collection).update(makeOrder());
  assert.equal(collection.doc.status, domain.OrderStatus.PENDING_PAYMENT);
});

test('Mongo saves a new pending order and preserves the PAID guard', async () => {
  const empty = fakeCollection(null);
  await mongoRepo(empty).save(makeOrder());
  assert.equal(empty.doc.status, domain.OrderStatus.PENDING_PAYMENT);
  const advanced = fakeCollection(domain.OrderStatus.PROCESSING);
  await assert.rejects(mongoRepo(advanced).update(makeOrder(domain.OrderStatus.PAID)), error => error.message === 'INVALID_STATUS_TRANSITION');
  assert.equal(advanced.doc.status, domain.OrderStatus.PROCESSING);
});

test('concurrent insert yields a conflict without overwriting the inserted order', async () => {
  const collection = fakeCollection(null);
  collection.insertOne = async () => {
    await collection.updateOne({ _id: 'synthetic-order' }, {
      $set: { status: domain.OrderStatus.PROCESSING }, $setOnInsert: {},
    }, { upsert: true });
    throw Object.assign(new Error('duplicate key'), { code: 11000 });
  };
  await assert.rejects(mongoRepo(collection).save(makeOrder()), error => error.message === 'INVALID_STATUS_TRANSITION');
  assert.equal(collection.doc.status, domain.OrderStatus.PROCESSING);
});

test('unrelated insert errors propagate', async () => {
  const collection = fakeCollection(null);
  const failure = new Error('synthetic failure');
  collection.insertOne = async () => { throw failure; };
  await assert.rejects(mongoRepo(collection).save(makeOrder()), error => error === failure);
});
