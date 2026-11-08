/// <reference types="vite/client" />
import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckoutPage } from './CheckoutPage';
import { apiClient } from '@/shared/api/client';
import { checkoutApi } from '@/shared/api/checkout';

// Vite owns the cross-project test bridge; frontend tsc must not compile backend
// sources under its different target/noUnused settings. No production code uses it.
const backendModules = import.meta.glob([
  '../../../../back/src/modules/coupon/coupon.mongo.repository.ts',
  '../../../../back/src/modules/coupon/coupon.service.ts',
  '../../../../back/src/modules/coupon/coupon.routes.ts',
  '../../../../back/src/modules/checkout/checkout.service.ts',
  '../../../../back/src/modules/checkout/checkout.routes.ts',
  '../../../../back/src/modules/checkout/checkout-attempt.mongo.repository.ts',
], { eager: true });
const { MongoCouponRepository } = backendModules['../../../../back/src/modules/coupon/coupon.mongo.repository.ts'] as any;
const { CouponService } = backendModules['../../../../back/src/modules/coupon/coupon.service.ts'] as any;
const { createCouponRoutes } = backendModules['../../../../back/src/modules/coupon/coupon.routes.ts'] as any;
const { CheckoutService } = backendModules['../../../../back/src/modules/checkout/checkout.service.ts'] as any;
const { createCheckoutRoutes } = backendModules['../../../../back/src/modules/checkout/checkout.routes.ts'] as any;
const { MongoCheckoutAttemptRepository } = backendModules['../../../../back/src/modules/checkout/checkout-attempt.mongo.repository.ts'] as any;

// Resolve existing backend test dependencies, without adding frontend packages.
const requireBackend = createRequire(new URL('../../../../back/package.json', import.meta.url).pathname.replace(/^\/@fs/, ''));
const express = requireBackend('express');
const request = requireBackend('supertest');
vi.mock('../../../../back/src/config', () => ({ config: {} }));
vi.mock('../../../../back/src/modules/auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, _res: any, next: any) => { req.user = { sub: req.header('x-person') || 'buyer', roles: [req.header('x-person') ? 'VENDOR' : 'CONSUMER'] }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
const state = vi.hoisted(() => ({ user: { id: 'buyer' }, cartError: null as Error | null, cart: { id: 'buyer', version: 1, items: [{ productId: 'p', vendorId: 'vendor', quantity: 1, unitPrice: 20 }] } }));
vi.mock('@/app/providers/AuthProvider', () => ({ useAuth: () => ({ user: state.user, isAuthenticated: true, isLoading: false }) }));
vi.mock('@/features/cart/useCart', () => ({ useCart: () => ({ data: { cart: state.cart }, isLoading: false, error: state.cartError, refetch: vi.fn() }) }));
vi.mock('@/shared/api/person', () => ({ personApi: { getMe: async () => ({ person: { addresses: [{ id: 'address', street: 'Street', number: '1', city: 'City', state: 'SP', neighborhood: '' }] } }) } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); state.cart.version = 1; state.cartError = null; state.user = { id: 'buyer' }; });

async function mount(catalogPrice = 20) {
  const docs = new Map<string, any>();
  const db = { collection: (name: string) => ({
    insertOne: async (doc: any) => {
      const key = JSON.stringify([name, doc._id]);
      if (docs.has(key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      docs.set(key, structuredClone(doc));
    },
    findOne: async (filter: any) => structuredClone([...docs.entries()].find(([k, d]) => JSON.parse(k)[0] === name && Object.entries(filter).every(([key, v]) => d[key] === v))?.[1] ?? null),
    updateOne: async (filter: any, update: any) => {
      const doc = [...docs.entries()].find(([k, d]) => JSON.parse(k)[0] === name && Object.entries(filter).every(([key, v]) => d[key] === v))?.[1];
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, structuredClone(update.$set)); doc.version += update.$inc.version;
      return { matchedCount: 1 };
    },
    find: ({ vendorId }: any) => ({ toArray: async () => structuredClone([...docs.entries()].filter(([k, d]) => JSON.parse(k)[0] === name && d.vendorId === vendorId).map(([, d]) => d)) }),
  }) };
  const vendors = { findById: async () => ({ id: 'vendor', personId: 'seller', storeName: 'Store', status: 'active', commissionPct: 10 }), findByPersonId: async () => ({ id: 'vendor', personId: 'seller' }) };
  const product = { id: 'p', vendorId: 'vendor', name: 'Product', status: 'active', price: catalogPrice, quantity: 10, categoryId: 'root' };
  const products = { findById: async () => structuredClone(product) };
  const categories = { findAll: async () => [{ id: 'root', parentId: null }] };
  const makeCoupons = () => new CouponService(new MongoCouponRepository(db as any), vendors as any, products as any, categories as any, () => new Date('2026-11-08T12:00:00Z'));
  const coupons = makeCoupons();
  const finance = { save: vi.fn(), createSession: vi.fn() };
  const makeApp = () => {
    const checkout = new CheckoutService(finance, finance, { findById: async () => ({ ...state.cart, isEmpty: false }) }, products, vendors, { findById: async () => ({ roles: ['CONSUMER'], addresses: [{ id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' }] }) }, {}, { commissionPct: 10 }, finance, categories, undefined, makeCoupons(), new MongoCheckoutAttemptRepository(db));
    const app = express(); app.use(express.json());
    app.use('/coupons', createCouponRoutes({ authService: {}, couponService: coupons }));
    app.use('/api/v1/checkout', createCheckoutRoutes({ authService: {}, personRepo: {}, checkoutService: checkout }));
    return app;
  };
  let app = makeApp();
  const created = await request(app).post('/coupons').set('x-person', 'seller').send({ code: 'SAVE', discountType: 'percentBps', value: 1000, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' });
  expect(created.status).toBe(201);
  vi.spyOn(apiClient, 'get').mockImplementation(async url => {
    const res = await request(app).get(url);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  });
  const post = vi.spyOn(apiClient, 'post').mockImplementation(async (url, body) => {
    const res = await request(app).post(url).send(body);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <MemoryRouter><QueryClientProvider client={client}><CheckoutPage /></QueryClientProvider></MemoryRouter>;
  const rendered = render(tree());
  await screen.findByRole('heading', { name: 'Store' });
  fireEvent.click(await screen.findByRole('radio', { name: /Street/ }));
  fireEvent.click(screen.getByRole('radio', { name: /Stripe/ }));
  await waitFor(() => expect(screen.getByTestId('checkout-submit-button')).toBeEnabled());
  return { rendered, tree, finance, post, product, docs, reconstruct: () => { app = makeApp(); } };
}
async function apply() {
  fireEvent.change(screen.getByLabelText('Coupon vendor'), { target: { value: 'vendor' } });
  fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'SAVE' } });
  fireEvent.click(screen.getByTestId('coupon-apply-button'));
}

describe('persisted quote UI via real client and in-process HTTP', () => {
  it.each(['source error', 'identity'] as const)('hides accepted content on %s without reviving it on recovery', async change => {
    const s = await mount(); await apply(); fireEvent.click(await screen.findByRole('button', { name: 'Prepare acceptance' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept quote' })); await screen.findByText('Quote accepted');
    if (change === 'source error') state.cartError = new Error('Refetch failed'); else state.user = { id: 'other' };
    s.rendered.rerender(s.tree()); expect(screen.queryByText('Quote accepted')).not.toBeInTheDocument();
    state.cartError = null; state.user = { id: 'buyer' }; s.rendered.rerender(s.tree());
    await waitFor(() => expect(screen.getByTestId('coupon-apply-button')).toBeEnabled());
    expect(screen.queryByText('Quote accepted')).not.toBeInTheDocument();
    expect(s.post.mock.calls.filter(([url]) => url.endsWith('/accept'))).toHaveLength(1);
  });
  it('prepares, explicitly accepts, reconstructs and reloads using the same request identity through the real HTTP client', async () => {
    const s = await mount(); await apply();
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare acceptance' }));
    const accept = await screen.findByRole('button', { name: 'Accept quote' });
    expect(screen.queryByText('Quote accepted')).not.toBeInTheDocument();
    fireEvent.click(accept); await screen.findByText('Quote accepted');
    const records = [...s.docs.values()].filter(d => d.state === 'ACCEPTED'); expect(records).toHaveLength(1);
    const accepted = structuredClone(records[0]); s.reconstruct();
    fireEvent.click(screen.getByRole('button', { name: 'Reload acceptance' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload acceptance' })).toBeEnabled());
    expect(screen.getByText('Quote accepted')).toBeInTheDocument();
    s.rendered.unmount(); render(s.tree());
    fireEvent.click(await screen.findByRole('radio', { name: /Street/ })); await apply();
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare acceptance' }));
    await screen.findByText('Quote accepted');
    const requests = s.post.mock.calls.filter(([url]) => url.endsWith('/attempts'));
    expect((requests[0][1] as any).requestId).toBe((requests[1][1] as any).requestId);
    expect([...s.docs.values()].filter(d => d.state === 'ACCEPTED')).toEqual([accepted]);
    expect(screen.getByText('Payment is not available yet')).toBeInTheDocument();
    expect(s.finance.save).not.toHaveBeenCalled(); expect(s.finance.createSession).not.toHaveBeenCalled();
  });

  it('displays changed server terms and requires a second accept click instead of automatically retrying', async () => {
    const s = await mount(); await apply(); fireEvent.click(await screen.findByRole('button', { name: 'Prepare acceptance' }));
    await screen.findByRole('button', { name: 'Accept quote' }); s.product.price = 30;
    fireEvent.click(screen.getByRole('button', { name: 'Accept quote' }));
    await screen.findByText('Quote changed. Review the new proposal and explicitly accept again.');
    expect(screen.queryByText('Quote accepted')).not.toBeInTheDocument();
    expect(screen.getByText(/Proposal total:.*27,00/)).toBeInTheDocument();
    expect(s.post.mock.calls.filter(([url]) => url.endsWith('/accept'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Accept quote' })); await screen.findByText('Quote accepted');
    expect(s.finance.save).not.toHaveBeenCalled();
  });

  it('recovers a lost prepare response with the same nonce and hides a delayed acceptance after cart invalidation', async () => {
    const s = await mount(); await apply();
    const original = checkoutApi.prepareAttempt.bind(checkoutApi);
    vi.spyOn(checkoutApi, 'prepareAttempt').mockImplementationOnce(async input => { await original(input); throw new Error('response lost'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare acceptance' }));
    await screen.findByText('Acceptance unavailable. Retry with the same request identity.');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare acceptance' })); await screen.findByRole('button', { name: 'Accept quote' });
    const requests = s.post.mock.calls.filter(([url]) => url.endsWith('/attempts'));
    expect((requests[0][1] as any).requestId).toBe((requests[1][1] as any).requestId);
    const acceptOriginal = checkoutApi.acceptAttempt.bind(checkoutApi); let release!: () => void;
    vi.spyOn(checkoutApi, 'acceptAttempt').mockImplementation(async input => { const result = await acceptOriginal(input); await new Promise<void>(resolve => { release = resolve; }); return result; });
    fireEvent.click(screen.getByRole('button', { name: 'Accept quote' })); await waitFor(() => expect(release).toBeTypeOf('function'));
    state.cart = { ...state.cart, version: 2 }; s.rendered.rerender(s.tree()); release();
    await waitFor(() => expect(screen.queryByText('Quote accepted')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Accept quote' })).not.toBeInTheDocument();
    expect(s.finance.save).not.toHaveBeenCalled();
  });
  it('offers explicit preparation only after a confirmed coupon quote', async () => {
    const s = await mount();
    expect(screen.queryByRole('button', { name: 'Prepare acceptance' })).not.toBeInTheDocument();
    await apply();
    await screen.findByRole('button', { name: 'Remove coupon SAVE from Store' });
    expect(screen.getByRole('button', { name: 'Prepare acceptance' })).toBeEnabled();
    expect(s.post).not.toHaveBeenCalled();
  });
  it.each([30, 10])('restores cart-priced checkout after removing a quote with catalogue price %s', async (catalogPrice) => {
    const s = await mount(catalogPrice);
    expect(screen.getAllByText(/20,00/).length).toBeGreaterThan(0);
    await apply();
    await screen.findByText('Discounted checkout is not available. This is a quote only.');
    expect(screen.getByTestId('checkout-submit-button')).toBeDisabled();
    expect(screen.getAllByText(catalogPrice === 30 ? /27,00/ : /9,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove coupon SAVE from Store' }));
    await waitFor(() => expect(screen.getByTestId('checkout-submit-button')).toBeEnabled());
    expect(screen.getAllByText(/20,00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(catalogPrice === 30 ? /27,00/ : /9,00/)).not.toBeInTheDocument();
    expect(s.post).not.toHaveBeenCalled();
    expect(s.finance.save).not.toHaveBeenCalled();
    expect(s.finance.createSession).not.toHaveBeenCalled();
  });

  it('confirms an actual quote, disables purchase, shows net without double subtraction and restores plain checkout on removal', async () => {
    const s = await mount(); await apply();
    await screen.findByText('Discounted checkout is not available. This is a quote only.');
    expect(screen.getByTestId('checkout-submit-button')).toBeDisabled();
    expect(screen.getAllByText(/18,00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/16,00/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove coupon SAVE from Store' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove coupon SAVE from Store' }));
    await waitFor(() => expect(screen.getByTestId('checkout-submit-button')).toBeEnabled());
    expect(screen.queryByText('Discounted checkout is not available. This is a quote only.')).not.toBeInTheDocument();
    expect(s.post).not.toHaveBeenCalled(); expect(s.finance.save).not.toHaveBeenCalled(); expect(s.finance.createSession).not.toHaveBeenCalled();
  });
  it('invalidates the selection on cart change and ignores an older in-flight response', async () => {
    const s = await mount();
    const original = checkoutApi.preview.bind(checkoutApi);
    let release!: () => void;
    vi.spyOn(checkoutApi, 'preview').mockImplementation(async (codes, selections) => {
      const result = await original(codes, selections);
      if (selections?.length) await new Promise<void>(resolve => { release = resolve; });
      return result;
    });
    await apply(); await waitFor(() => expect(release).toBeTypeOf('function'));
    state.cart = { ...state.cart, version: 2 };
    s.rendered.rerender(s.tree()); release();
    await waitFor(() => expect(screen.getByTestId('coupon-apply-button')).toBeEnabled());
    expect(screen.queryByRole('button', { name: /Remove coupon/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Discounted checkout is not available. This is a quote only.')).not.toBeInTheDocument();
  });
  it('invalidates a confirmed quote after a validation error or cart revision', async () => {
    const s = await mount(); await apply();
    await screen.findByRole('button', { name: 'Remove coupon SAVE from Store' });
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'UNKNOWN' } });
    fireEvent.click(screen.getByTestId('coupon-apply-button'));
    await screen.findByText('Coupon quote unavailable');
    expect(screen.queryByRole('button', { name: /Remove coupon/ })).not.toBeInTheDocument();
    await apply(); await screen.findByRole('button', { name: 'Remove coupon SAVE from Store' });
    state.cart = { ...state.cart, version: 3 };
    s.rendered.rerender(s.tree());
    expect(screen.queryByRole('button', { name: /Remove coupon/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('checkout-submit-button')).toBeEnabled());
    expect(s.post).not.toHaveBeenCalled();
  });
});
