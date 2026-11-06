const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

// Explicit source allowlist: no bootstrap, Vitest setup, dotenv or real adapters.
// VM sources receive no process, network, filesystem or unrestricted require.
function loadSource(filename, dependencies = {}) {
  assert.ok(['order.domain.ts', 'payment.service.ts', 'payment.routes.ts'].includes(filename));
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, filename), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Blocked unlisted import in consumer confirmation regression');
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {
      throw new Error('Blocked logging in consumer confirmation regression');
    }])),
  }, { timeout: 1000 });
  return exports;
}

test('consumer cannot authorize or capture own payment without verified provider confirmation', async () => {
  const domain = loadSource('order.domain.ts');
  class BlockedAdapter {
    constructor() { throw new Error('External adapters are forbidden in this regression'); }
  }
  const serviceModule = loadSource('payment.service.ts', {
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
    amount: 100, provider: 'stripe', status: PaymentStatus.PENDING,
    createdAt: now, updatedAt: now,
  };
  const writes = [];
  let repositoryReads = 0;
  const orderRepo = {
    async findById(id) {
      repositoryReads++;
      return id === orderSnapshot.id ? Order.reconstruct(structuredClone(orderSnapshot)) : null;
    },
    async update(order) {
      orderSnapshot = structuredClone(order.toJSON());
      writes.push(`order:${orderSnapshot.status}`);
      return Order.reconstruct(structuredClone(orderSnapshot));
    },
  };
  const paymentRepo = {
    async findById(id) {
      repositoryReads++;
      return id === paymentSnapshot.id ? Payment.reconstruct(structuredClone(paymentSnapshot)) : null;
    },
    async update(payment) {
      paymentSnapshot = structuredClone(payment.toJSON());
      writes.push(`payment:${paymentSnapshot.status}`);
      return Payment.reconstruct(structuredClone(paymentSnapshot));
    },
  };
  const paymentService = new serviceModule.PaymentService(paymentRepo, orderRepo);
  const roles = { CONSUMER: 'CONSUMER', VENDOR: 'VENDOR', ADMIN: 'ADMIN' };
  const registered = [];
  const router = Object.fromEntries(['get', 'post'].map(method => [method, (route, ...handlers) => {
    registered.push({ method, route, handlers });
  }]));
  let authenticatedRequests = 0;
  let principal = { sub: 'synthetic-consumer', roles: [roles.CONSUMER] };
  const { createPaymentRoutes } = loadSource('payment.routes.ts', {
    express: { Router: () => router },
    './order.domain': domain,
    './payment.service': serviceModule,
    '../person/person.domain': { PersonRole: roles },
    '../auth/auth.middleware': {
      // Trusted identity seam only; authorization decisions remain in real handlers.
      authMiddleware: () => (req, res, next) => {
        authenticatedRequests++;
        req.user = principal;
        next();
      },
      requireRole: (...allowed) => (req, res, next) => {
        assert.ok(req.user.roles.some(role => allowed.includes(role)));
        next();
      },
    },
  });
  createPaymentRoutes({ authService: {}, paymentService, orderRepo,
    vendorRepo: { async findByPersonId() { throw new Error('Unexpected vendor lookup'); } } });

  const responses = [];
  async function post(route, body, paymentId = paymentSnapshot.id) {
    const entry = registered.find(value => value.method === 'post' && value.route === route);
    assert.ok(entry, 'Real payment route must be registered');
    const req = { params: { id: paymentId }, body };
    let status = 200;
    let response;
    const res = {
      status(value) { status = value; return this; },
      json(value) { response = JSON.parse(JSON.stringify(value)); return this; },
    };
    for (const handler of entry.handlers) {
      let advanced = false;
      await handler(req, res, error => {
        if (error) throw error;
        advanced = true;
      });
      if (!advanced) break;
    }
    assert.ok(response, 'Handler must produce a response rather than silently stop');
    responses.push({ status, response });
    return status >= 200 && status < 300;
  }

  // No webhook, signature, provider adapter or trusted confirmation is supplied.
  // Both requests execute before the security assertion to observe the entire path.
  const authorizeAccepted = await post('/:id/authorize', {
    providerTransactionId: 'synthetic-unverified-provider-reference',
  });
  const captureAccepted = await post('/:id/capture', {});
  assert.equal(authenticatedRequests, 2, 'Both requests must use the owning consumer identity');
  assert.deepEqual({
    authorizeAccepted, captureAccepted,
    paymentStatus: paymentSnapshot.status,
    providerReference: paymentSnapshot.providerTransactionId,
    orderStatus: orderSnapshot.status,
    financialStatus: orderSnapshot.financialStatus,
    writes,
  }, {
    authorizeAccepted: false, captureAccepted: false,
    paymentStatus: PaymentStatus.PENDING,
    providerReference: undefined,
    orderStatus: OrderStatus.PENDING_PAYMENT,
    financialStatus: FinancialStatus.PENDING,
    writes: [],
  }, 'Consumer requests without verified provider confirmation must not authorize, capture or mark paid');

  // No authenticated role or client-supplied verification flag grants provider trust.
  for (const role of [roles.CONSUMER, roles.VENDOR, roles.ADMIN]) {
    principal = { sub: `synthetic-${role.toLowerCase()}`, roles: [role] };
    for (const route of ['/:id/authorize', '/:id/capture']) {
      for (const body of [undefined, {
        providerTransactionId: 'synthetic-unverified-provider-reference',
        verified: true, payment_status: 'paid',
      }]) {
        await post(route, body, 'synthetic-missing-payment');
      }
    }
  }
  for (const result of responses) {
    assert.equal(result.status, 403, 'Public confirmation endpoints must fail closed for every role');
    assert.deepEqual(result.response, {
      error: 'PROVIDER_CONFIRMATION_REQUIRED',
      message: 'Payment authorization and capture require verified provider confirmation',
    }, 'Denial must not return a payment or imply provider success');
  }
  assert.equal(authenticatedRequests, 14, 'All denial scenarios must execute the authentication seam');
  assert.equal(repositoryReads, 0, 'Public denial must precede payment/order lookup');
  assert.deepEqual(writes, [], 'No public request may persist financial state');
  assert.equal(paymentSnapshot.status, PaymentStatus.PENDING);
  assert.equal(paymentSnapshot.providerTransactionId, undefined);
  assert.equal(orderSnapshot.status, OrderStatus.PENDING_PAYMENT);
  assert.equal(orderSnapshot.financialStatus, FinancialStatus.PENDING);
});
