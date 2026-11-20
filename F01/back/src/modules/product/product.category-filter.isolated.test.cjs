const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load the actual route without configuration, sockets, storage, or services.
function loadListHandler(service) {
  let handler;
  const router = {
    get(route, ...handlers) { if (route === '/' && !handler) handler = handlers.at(-1); },
    post() {}, patch() {}, delete() {}, use() {},
  };
  const fakeMulter = () => ({ fields: () => () => {} });
  fakeMulter.default = fakeMulter;
  const modules = {
    express: { Router: () => router },
    multer: fakeMulter,
    '../auth/auth.middleware': { authMiddleware: () => () => {}, requireRole: () => () => {} },
    '../person/person.domain': { PersonRole: { ADMIN: 'admin', VENDOR: 'vendor' } },
    '../vendor/vendor.domain': {},
    './product.domain': {},
    '../../config': { config: {} },
    fs: {}, path: {},
  };
  const source = fs.readFileSync(path.join(__dirname, 'product.routes.ts'), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
    return modules[name];
  } });
  exports.createProductRoutes({ productService: service, authService: {}, personRepo: {}, vendorRepo: {}, storageAdapter: {} });
  return handler;
}

async function request(handler, query) {
  let body;
  let error;
  await handler({ query }, { json(value) { body = value; } }, value => { error = value; });
  if (error) throw error;
  return JSON.parse(JSON.stringify(body));
}

test('parent filter includes multilevel descendants, excludes unrelated, preserves status order and pagination', async () => {
  const categories = [
    { id: 'parent', parentId: null }, { id: 'child', parentId: 'parent' },
    { id: 'grandchild', parentId: 'child' }, { id: 'other', parentId: null },
  ];
  const products = [
    { id: 'grandchild-product', categoryId: 'grandchild', status: 'active' },
    { id: 'unrelated', categoryId: 'other', status: 'active' },
    { id: 'child-product', categoryId: 'child', status: 'active' },
    { id: 'hidden', categoryId: 'child', status: 'inactive' },
    { id: 'parent-product', categoryId: 'parent', status: 'active' },
  ];
  const service = {
    async listProducts(filters) { assert.equal(filters.status, 'active'); assert.equal(filters.sortBy, 'name'); return products.filter(p => p.status === filters.status); },
    async listCategories() { return categories; },
  };
  const handler = loadListHandler(service);
  const first = await request(handler, { categoryId: 'parent', status: 'active', sortBy: 'name', page: '1', limit: '2' });
  assert.equal(first.total, 3);
  assert.deepEqual(first.products.map(p => p.id), ['grandchild-product', 'child-product']);
  const result = await request(handler, { categoryId: 'parent', status: 'active', sortBy: 'name', page: '2', limit: '2' });
  assert.equal(result.total, 3);
  assert.deepEqual(result.products.map(p => p.id), ['parent-product']);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 2);
});

test('without category filter does not query categories and retains existing order', async () => {
  const service = {
    async listProducts() { return [{ id: 'a', categoryId: 'x' }, { id: 'b', categoryId: 'y' }]; },
    async listCategories() { throw new Error('unexpected category lookup'); },
  };
  const result = await request(loadListHandler(service), {});
  assert.equal(result.total, 2);
  assert.deepEqual(result.products.map(p => p.id), ['a', 'b']);
});

test('category lookup failure propagates rather than returning incomplete results', async () => {
  const service = {
    async listProducts() { return []; },
    async listCategories() { throw new Error('category lookup failed'); },
  };
  await assert.rejects(request(loadListHandler(service), { categoryId: 'parent' }), /category lookup failed/);
});
