const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

// No Vitest setup, application entry point, dotenv, real auth, or database imports.
// Execute only explicitly selected sources; deny every unlisted runtime import.
function loadSource(relativePath, dependencies = {}) {
  const source = readFileSync(path.join(__dirname, relativePath), 'utf8');
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
      throw new Error('Blocked unlisted import in isolated privacy regression');
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {
      throw new Error('Unexpected logging in isolated privacy regression');
    }])),
  }, { timeout: 1000 });
  return exports;
}

test('vendor A order detail excludes vendor B private group data', async () => {
  const roles = { CONSUMER: 'CONSUMER', VENDOR: 'VENDOR', ADMIN: 'ADMIN' };
  const domain = loadSource('order.domain.ts');
  const { OrderService } = loadSource('order.service.ts', {
    './order.domain': domain,
    '../../config': { config: {} },
  });
  const middleware = loadSource('../auth/auth.middleware.ts', {
    '../person/person.domain': { PersonRole: roles },
  });
  const registered = [];
  const router = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (route, ...handlers) => {
    registered.push({ method, route, handlers });
  }]));
  const { createOrderRoutes } = loadSource('order.routes.ts', {
    express: { Router: () => router },
    '../person/person.domain': { PersonRole: roles },
    '../auth/auth.middleware': middleware,
    './order.domain': domain,
  });

  const makeGroup = (vendorId, subtotal, commissionPct) => ({
    id: `group-${vendorId}`, orderId: 'fake-mixed-order', vendorId,
    status: domain.OrderVendorGroupStatus.PENDING,
    items: [{ id: `item-${vendorId}`, productId: `product-${vendorId}`,
      productName: `Fake product ${vendorId}`, vendorId, quantity: 1,
      unitPrice: subtotal, totalPrice: subtotal }],
    subtotal, commissionPct, commissionAmount: subtotal * commissionPct / 100,
    vendorNet: subtotal * (1 - commissionPct / 100),
  });
  const storedOrder = {
    id: 'fake-mixed-order', personId: 'fake-consumer',
    status: domain.OrderStatus.PENDING_PAYMENT,
    financialStatus: domain.FinancialStatus.PENDING,
    vendorGroups: [makeGroup('fake-vendor-a', 100, 10), makeGroup('fake-vendor-b', 700, 23)],
    totalAmount: 800,
  };
  const before = JSON.stringify(storedOrder);
  const lookups = [];
  const orderRepo = { findById: async id => {
    lookups.push(id);
    return id === storedOrder.id ? storedOrder : null;
  } };
  const vendorRepo = { findByPersonId: async personId => {
    assert.equal(personId, 'fake-vendor-a-person');
    return { id: 'fake-vendor-a' };
  } };
  const orderService = new OrderService(orderRepo, {}, {}, vendorRepo, {});
  let verified = false;
  let principal = { sub: 'fake-vendor-a-person', roles: [roles.VENDOR], type: 'access' };
  createOrderRoutes({
    orderService, personRepo: {}, vendorRepo,
    authService: { verifyToken: () => {
      verified = true;
      return principal;
    } },
  });
  const detail = registered.find(entry => entry.method === 'get' && entry.route === '/orders/:orderId');
  assert.ok(detail, 'Real detail route must be registered');
  const req = {
    headers: { authorization: ['Bearer', 'synthetic-auth-placeholder'].join(' ') },
    params: { orderId: storedOrder.id },
  };
  let status = 200;
  let body;
  const res = {
    status(value) { status = value; return this; },
    json(value) { body = JSON.parse(JSON.stringify(value)); return this; },
  };
  // Invoke the real registered middleware/handler chain without opening a socket.
  for (const handler of detail.handlers) {
    let advanced = false;
    await handler(req, res, error => {
      if (error) throw error;
      advanced = true;
    });
    if (!advanced) break;
  }
  assert.equal(verified, true, 'Authentication seam must resolve the fake vendor principal');
  assert.equal(status, 200, 'An owning vendor must be able to retrieve its mixed order');
  assert.deepEqual(lookups, [storedOrder.id], 'Real service must load the in-memory order');
  assert.equal(JSON.stringify(storedOrder), before, 'Projection must not alter the stored aggregate');
  assert.ok(body.order.vendorGroups.some(group => group.vendorId === 'fake-vendor-a'),
    'Vendor A must retain visibility of its own group');
  assert.deepEqual(body.order.vendorGroups.map(group => group.vendorId), ['fake-vendor-a'],
    'Vendor A response must exclude vendor B group, items, commission and net');
  assert.equal(body.order.totalAmount, 100, 'Vendor detail total must exclude vendor B amounts');

  // Same isolated detail scenario: consumer ownership and admin precedence stay intact.
  for (const actor of [
    { sub: 'fake-consumer', roles: [roles.CONSUMER] },
    { sub: 'fake-consumer', roles: [roles.CONSUMER, roles.VENDOR] },
    { sub: 'fake-admin', roles: [roles.ADMIN, roles.VENDOR] },
  ]) {
    principal = { ...actor, type: 'access' };
    delete req.user;
    body = undefined;
    status = 200;
    for (const handler of detail.handlers) {
      let advanced = false;
      await handler(req, res, error => {
        if (error) throw error;
        advanced = true;
      });
      if (!advanced) break;
    }
    assert.equal(status, 200);
    assert.deepEqual(body.order.vendorGroups.map(group => group.vendorId),
      ['fake-vendor-a', 'fake-vendor-b'], 'Consumer/admin detail must retain both groups');
    assert.equal(body.order.totalAmount, 800, 'Consumer/admin detail must retain the full order total');
  }
  assert.equal(JSON.stringify(storedOrder), before, 'All detail projections must leave storage unchanged');
});
