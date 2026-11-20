const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function loadSource(file, dependencies = {}) {
  const source = readFileSync(path.join(__dirname, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Error, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Blocked unlisted import');
  } }, { timeout: 1000 });
  return exports;
}

test('list and summary serialize every group without array index as vendor id', async () => {
  const roles = { CONSUMER: 'CONSUMER', VENDOR: 'VENDOR', ADMIN: 'ADMIN' };
  const domain = loadSource('order.domain.ts');
  const middleware = loadSource('../auth/auth.middleware.ts', { '../person/person.domain': { PersonRole: roles } });
  const routes = [];
  const router = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (route, ...handlers) => routes.push({ method, route, handlers })]));
  const { createOrderRoutes } = loadSource('order.routes.ts', {
    express: { Router: () => router }, '../person/person.domain': { PersonRole: roles },
    '../auth/auth.middleware': middleware, './order.domain': domain,
  });
  const group = vendorId => ({ vendorId, items: [], subtotal: 5 });
  const orders = ['one', 'two'].map(id => ({ id, vendorGroups: [group('a'), group('b')], totalAmount: 10 }));
  let principal;
  createOrderRoutes({
    authService: { verifyToken: () => principal }, personRepo: {},
    vendorRepo: { findByPersonId: async () => ({ id: 'a' }) },
    orderService: {
      listOrders: async () => ({ orders, total: 2, page: 1, limit: 20 }),
      getConsumerSummary: async () => ({ recentOrders: orders }),
    },
  });
  async function request(route, role) {
    principal = { sub: 'person', roles: [role], type: 'access' };
    const req = { headers: { authorization: ['Bearer', 'synthetic-placeholder'].join(' ') }, query: {} };
    let body;
    const res = { status() { return this; }, json(value) { body = JSON.parse(JSON.stringify(value)); return this; } };
    for (const handler of routes.find(r => r.method === 'get' && r.route === route).handlers) {
      let next = false;
      await handler(req, res, error => { if (error) throw error; next = true; });
      if (!next) break;
    }
    return body;
  }
  const consumer = await request('/orders', roles.CONSUMER);
  const summary = await request('/orders/summary', roles.CONSUMER);
  const vendor = await request('/orders', roles.VENDOR);
  for (const order of [...consumer.orders, ...summary.summary.recentOrders]) {
    assert.deepEqual(order.vendorGroups.map(group => group.vendorId), ['a', 'b']);
  }
  for (const order of vendor.orders) assert.deepEqual(order.vendorGroups.map(group => group.vendorId), ['a']);
});
