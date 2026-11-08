import Stripe from 'stripe';
import { Order, Payment } from '../order/order.domain';

export function createStripeClientFromEnvironment(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY_NOT_CONFIGURED');
  }
  return new Stripe(secretKey);
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

export interface CheckoutPaymentProvider {
  createSession(order: Order, payment: Payment): Promise<CheckoutSessionResult>;
  expireSession?(sessionId: string): Promise<void>;
}

export class StripeCheckoutProvider implements CheckoutPaymentProvider {
  constructor(
    private readonly stripe: Pick<Stripe, 'checkout'>,
    private readonly frontendUrl: string,
    private readonly paymentMethodConfiguration?: string
  ) {}

  async createSession(order: Order, payment: Payment): Promise<CheckoutSessionResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      ...(this.paymentMethodConfiguration && {
        payment_method_configuration: this.paymentMethodConfiguration,
      }),
      line_items: order.vendorGroups.flatMap(group => group.items.map(item => ({
        quantity: item.quantity,
        price_data: {
          currency: 'brl',
          unit_amount: Math.round(item.unitPrice * 100),
          product_data: { name: item.productName },
        },
      }))),
      phone_number_collection: { enabled: true },
      metadata: { orderId: order.id, paymentId: payment.id },
      success_url: `${this.frontendUrl}/orders?checkout=success`,
      cancel_url: `${this.frontendUrl}/checkout?checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error('STRIPE_CHECKOUT_URL_MISSING');
    }

    return { id: session.id, url: session.url };
  }

  async expireSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }
}

export class MockCheckoutProvider implements CheckoutPaymentProvider {
  async createSession(order: Order, payment: Payment): Promise<CheckoutSessionResult> {
    const id = `cs_test_${order.id}_${payment.id}`;
    return { id, url: `https://checkout.stripe.test/mock/${id}` };
  }
  async expireSession(sessionId: string): Promise<void> { /* no-op */ }
}
