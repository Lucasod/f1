const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

// Only load explicitly allowed sources; no app startup, database or network.
function loadSource(relativePath, dependencies = {}) {
  const source = readFileSync(path.join(__dirname, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Blocked unlisted import');
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {
      throw new Error('Unexpected logging');
    }])),
  }, { timeout: 1000 });
  return exports;
}

function fixture(real = false) {
  const roles = { CONSUMER: 'CONSUMER', VENDOR: 'VENDOR', ADMIN: 'ADMIN' };
  const domain = loadSource('order.domain.ts');
  const { OrderService } = loadSource('order.service.ts', { './order.domain': domain, '../../config': { config: {} } });
  const middleware = loadSource('../auth/auth.middleware.ts', { '../person/person.domain': { PersonRole: roles } });
  const registered = [];
  const router = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (route, ...handlers) => {
    registered.push({ method, route, handlers });
  }]));
  const { createOrderRoutes } = loadSource('order.routes.ts', {
    express: { Router: () => router }, '../person/person.domain': { PersonRole: roles },
    '../auth/auth.middleware': middleware, './order.domain': domain,
  });
  const group = (vendorId, subtotal) => ({
    id: `group-${vendorId}`, orderId: 'order-1', vendorId, subtotal,
    commissionPct: 10, commissionAmount: subtotal / 10, vendorNet: subtotal * 0.9,
    transferId: `transfer-${vendorId}`,
    items: [{ id: `item-${vendorId}`, vendorId, productId: `product-${vendorId}`,
      productName: `product-${vendorId}`, quantity: 1, unitPrice: subtotal, totalPrice: subtotal }],
  });
  let stored = {
    id: 'order-1', personId: 'consumer', vendorGroups: [group('vendor-a', 100), group('vendor-b', 700)],
    totalAmount: 800, status: 'processing', financialStatus: 'partially_refunded',
    markItemsDeliveredByIds(ids, personId) {
      for (const item of this.vendorGroups.flatMap(vg => vg.items)) {
        if (ids.includes(item.id)) item.deliveredBy = personId;
      }
    },
  };
  if (real) {
    const now = new Date('2024-01-01T00:00:00Z');
    stored = domain.Order.reconstruct({
      ...stored, status: domain.OrderStatus.SHIPPED, financialStatus: domain.FinancialStatus.PAID,
      createdAt: now, updatedAt: now, shippingAddress: {},
      vendorGroups: stored.vendorGroups.map((vg, index) => ({
        ...vg, status: domain.OrderVendorGroupStatus.SHIPPED, createdAt: now, updatedAt: now,
        items: vg.items.map(item => index === 1 ? { ...item, deliveredAt: now, deliveredBy: 'vendor-b-person' } : item),
      })),
    });
  }
  let writes = 0;
  const orderRepo = { findById: async () => stored, update: async order => { writes++; return order; } };
  const vendorRepo = { findByPersonId: async () => ({ id: 'vendor-a' }) };
  let principal;
  createOrderRoutes({
    orderService: new OrderService(orderRepo, {}, {}, vendorRepo, {}), personRepo: {}, vendorRepo,
    authService: { verifyToken: () => principal },
  });
  const route = registered.find(entry => entry.method === 'patch' && entry.route === '/orders/:orderId/items/delivery');
  assert.ok(route);
  async function request(actor, body) {
    principal = { ...actor, type: 'access' };
    const req = { headers: { authorization: ['Bearer', 'synthetic-placeholder'].join(' ') }, params: { orderId: 'order-1' }, body };
    let status = 200;
    let response;
    const res = { status(value) { status = value; return this; }, json(value) { response = JSON.parse(JSON.stringify(value)); return this; } };
    for (const handler of route.handlers) {
      let advanced = false;
      await handler(req, res, error => { if (error) throw error; advanced = true; });
      if (!advanced) break;
    }
    return { status, body: response };
  }
  return { roles, stored, request, writes: () => writes };
}

test('vendor delivery response excludes other vendor data and total', async () => {
  const f = fixture();
  const beforeB = JSON.stringify(f.stored.vendorGroups[1]);
  const result = await f.request({ sub: 'vendor-person', roles: [f.roles.VENDOR] }, { itemIds: ['item-vendor-a'] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.order.vendorGroups.map(group => group.vendorId), ['vendor-a']);
  assert.equal(result.body.order.totalAmount, 100);
  assert.equal('status' in result.body.order, false);
  assert.equal('financialStatus' in result.body.order, false);
  assert.equal(result.body.order.vendorGroups[0].items[0].deliveredBy, 'vendor-person');
  assert.equal(JSON.stringify(f.stored.vendorGroups[1]), beforeB);
  assert.equal(f.stored.totalAmount, 800);
});

test('vendor cannot deliver another vendor item', async () => {
  const f = fixture();
  const before = JSON.stringify(f.stored);
  const result = await f.request({ sub: 'vendor-person', roles: [f.roles.VENDOR] }, { itemIds: ['item-vendor-b'] });
  assert.equal(result.status, 404);
  assert.equal(JSON.stringify(f.stored), before);
  assert.equal(f.writes(), 0);
});

test('vendor mixed item selection delivers only owned items', async () => {
  const f = fixture();
  const beforeB = JSON.stringify(f.stored.vendorGroups[1]);
  const result = await f.request({ sub: 'vendor-person', roles: [f.roles.VENDOR] },
    { itemIds: ['item-vendor-a', 'item-vendor-b'] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.order.vendorGroups.map(group => group.vendorId), ['vendor-a']);
  assert.equal(JSON.stringify(f.stored.vendorGroups[1]), beforeB);
});

test('real order delivery does not change an already delivered foreign group', async () => {
  const f = fixture(true);
  const beforeB = JSON.stringify(f.stored.vendorGroups[1]);
  const result = await f.request({ sub: 'vendor-person', roles: [f.roles.VENDOR] }, { itemIds: ['item-vendor-a'] });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(f.stored.vendorGroups[1]), beforeB);
  assert.equal(f.stored.vendorGroups[0].items[0].deliveredBy, 'vendor-person');
});

test('fake Mongo load and save preserve both vendors delivery metadata', async () => {
  const domain = loadSource('order.domain.ts');
  const { MongoOrderRepository } = loadSource('order.mongo.repository.ts', { './order.domain': domain });
  const original = fixture(true).stored.toJSON();
  let document = { ...original, _id: original.id };
  const collection = {
    findOne: async () => document,
    updateOne: async (_filter, update) => {
      document = { ...document, ...update.$set };
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const repository = new MongoOrderRepository({ collection: () => collection });
  const loaded = await repository.findById(original.id);
  assert.equal(loaded.vendorGroups[1].items[0].deliveredBy, 'vendor-b-person');
  assert.equal(loaded.vendorGroups[1].items[0].deliveredAt.toISOString(), '2024-01-01T00:00:00.000Z');
  loaded.markItemsDeliveredByIds(['item-vendor-a'], 'vendor-person');
  await repository.save(loaded);
  const reloaded = await repository.findById(original.id);
  assert.equal(reloaded.vendorGroups[0].items[0].deliveredBy, 'vendor-person');
  assert.ok(reloaded.vendorGroups[0].items[0].deliveredAt);
  assert.equal(reloaded.vendorGroups[1].items[0].deliveredBy, 'vendor-b-person');
  assert.equal(reloaded.vendorGroups[1].items[0].deliveredAt.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(reloaded.vendorGroups[1]), JSON.stringify(original.vendorGroups[1]));
});

test('non-owner consumer cannot deliver items', async () => {
  const f = fixture();
  const result = await f.request({ sub: 'other-consumer', roles: [f.roles.CONSUMER] }, { all: true });
  assert.equal(result.status, 403);
  assert.equal(f.writes(), 0);
});

test('consumer owner and admin retain whole-order delivery responses', async () => {
  for (const actor of [{ sub: 'consumer', roles: ['CONSUMER'] }, { sub: 'admin', roles: ['ADMIN'] }]) {
    const f = fixture();
    const result = await f.request(actor, { itemIds: ['item-vendor-b'] });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.order.vendorGroups.map(group => group.vendorId), ['vendor-a', 'vendor-b']);
    assert.equal(result.body.order.totalAmount, 800);
    assert.equal(result.body.order.status, 'processing');
    assert.equal(result.body.order.financialStatus, 'partially_refunded');
    assert.equal(f.stored.vendorGroups[1].items[0].deliveredBy, actor.sub);
  }
});
