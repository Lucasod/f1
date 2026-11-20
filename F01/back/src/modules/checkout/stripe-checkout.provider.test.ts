import { describe, expect, it, vi } from 'vitest';
import { Order, Payment } from '../order/order.domain';
import { StripeCheckoutProvider } from './stripe-checkout.provider';

describe('StripeCheckoutProvider', () => {
  it('creates a BRL Checkout Session using order items and returns its hosted URL', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session' });
    const provider = new StripeCheckoutProvider(
      { checkout: { sessions: { create } } } as never,
      'http://localhost:5173',
      'pmc_test_default'
    );
    const order = {
      id: 'order-1',
      totalAmount: 125.5,
      vendorGroups: [{ items: [
        { productName: 'Produto A', quantity: 2, unitPrice: 50 },
        { productName: 'Produto B', quantity: 1, unitPrice: 25.5 },
      ] }],
    } as unknown as Order;
    const payment = { id: 'payment-1' } as Payment;

    const result = await provider.createSession(order, payment);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      payment_method_configuration: 'pmc_test_default',
      line_items: [
        { quantity: 2, price_data: { currency: 'brl', unit_amount: 5000, product_data: { name: 'Produto A' } } },
        { quantity: 1, price_data: { currency: 'brl', unit_amount: 2550, product_data: { name: 'Produto B' } } },
      ],
      metadata: { orderId: 'order-1', paymentId: 'payment-1' },
      success_url: 'http://localhost:5173/orders?checkout=success',
      cancel_url: 'http://localhost:5173/checkout?checkout=cancelled',
    }));
    expect(result).toEqual({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session' });
  });

  it('creates session without payment_method_configuration when constructor omits it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.test/session1' });
    const provider = new StripeCheckoutProvider(
      { checkout: { sessions: { create } } } as never,
      'http://localhost:5173'
    );
    const order = { id: 'order-1', vendorGroups: [{ items: [{ productName: 'P', quantity: 1, unitPrice: 10 }] }] } as unknown as Order;
    const payment = { id: 'payment-1' } as Payment;

    await provider.createSession(order, payment);

    const arg = create.mock.calls[0][0];
    expect(arg).not.toHaveProperty('payment_method_configuration');
  });

  it('creates session without payment_method_configuration when constructor passes empty string', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_2', url: 'https://checkout.stripe.test/session2' });
    const provider = new StripeCheckoutProvider(
      { checkout: { sessions: { create } } } as never,
      'http://localhost:5173',
      ''
    );
    const order = { id: 'order-1', vendorGroups: [{ items: [{ productName: 'P', quantity: 1, unitPrice: 10 }] }] } as unknown as Order;
    const payment = { id: 'payment-1' } as Payment;

    await provider.createSession(order, payment);

    const arg = create.mock.calls[0][0];
    expect(arg).not.toHaveProperty('payment_method_configuration');
  });

  it('propagates errors from stripe checkout sessions create', async () => {
    const create = vi.fn().mockRejectedValue(new Error('stripe boom'));
    const provider = new StripeCheckoutProvider(
      { checkout: { sessions: { create } } } as never,
      'http://localhost:5173'
    );
    const order = { id: 'order-1', vendorGroups: [{ items: [{ productName: 'P', quantity: 1, unitPrice: 10 }] }] } as unknown as Order;
    const payment = { id: 'payment-1' } as Payment;

    await expect(provider.createSession(order, payment)).rejects.toThrow('stripe boom');
  });

  it('expireSession calls stripe checkout sessions expire', async () => {
    const expire = vi.fn().mockResolvedValue(undefined);
    const provider = new StripeCheckoutProvider(
      { checkout: { sessions: { create: vi.fn(), expire } } } as never,
      'http://localhost:5173'
    );

    await provider.expireSession('cs_test_123');

    expect(expire).toHaveBeenCalledWith('cs_test_123');
  });
});
