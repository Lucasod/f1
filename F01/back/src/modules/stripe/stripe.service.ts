import Stripe from 'stripe';
import { config } from '../../config';

export interface StripeCustomerResult {
  customerId: string;
  isNew: boolean;
}

export interface ConnectOnboardingResult {
  accountId: string;
  onboardingUrl: string;
}

export interface ConnectAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: {
    transfers: 'active' | 'inactive' | 'pending';
  } | null;
  requirements: {
    currently_due: string[];
    eventually_due: string[];
    past_due: string[];
  } | null;
}

// Brand property for reliable StripeServiceError identification across module boundaries
const StripeServiceErrorBrand = '__stripeServiceErrorBrand__';

export class StripeServiceError extends Error {
  public readonly [StripeServiceErrorBrand] = true;

  constructor(
    message: string,
    public readonly operation: string,
    public readonly httpStatus?: number,
    public readonly stripeCode?: string
  ) {
    super(message);
    this.name = 'StripeServiceError';
  }

  static isStripeServiceError(error: unknown): error is StripeServiceError {
    return error && typeof error === 'object' && StripeServiceErrorBrand in error;
  }
}

// Check if error is a Stripe "resource not found" error
function isStripeResourceNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  return err.name === 'StripeResourceNotFoundError' || err.type === 'StripeResourceNotFoundError';
}

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new StripeServiceError(
      'STRIPE_SECRET_KEY_NOT_CONFIGURED',
      'getStripeClient',
      500,
      'configuration_error'
    );
  }
  return new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  });
}

export class StripeService {
  private readonly stripe: Stripe;
  // In-flight promise map for idempotent customer creation per personId
  private readonly customerCreationLocks: Map<string, Promise<StripeCustomerResult>> = new Map();

  constructor(stripeClient?: Stripe) {
    this.stripe = stripeClient ?? getStripeClient();
  }

  /**
   * Creates or retrieves a Stripe Customer for a buyer.
   * Idempotent: reuses existing customer if customerId is provided and valid.
   * Concurrent calls for the same personId are serialized via an in-memory lock
   * and use a Stripe idempotency key to prevent duplicate customer creation.
   */
  async getOrCreateCustomer(
    personId: string,
    email: string,
    existingCustomerId?: string
  ): Promise<StripeCustomerResult> {
    // If we have an existing customer ID, try to retrieve it
    if (existingCustomerId && existingCustomerId.trim().length > 0) {
      try {
        const customer = await this.stripe.customers.retrieve(existingCustomerId.trim());
        if (!customer.deleted) {
          // Update email if it changed
          if (customer.email !== email) {
            await this.stripe.customers.update(existingCustomerId.trim(), { email });
          }
          return { customerId: existingCustomerId.trim(), isNew: false };
        }
      } catch (error) {
        // Customer not found or invalid, will create new one
        if (isStripeResourceNotFoundError(error)) {
          // Fall through to create new
        } else {
          throw new StripeServiceError(
            `Failed to retrieve Stripe customer: ${error instanceof Error ? error.message : 'unknown'}`,
            'getOrCreateCustomer.retrieve',
            (error as any).statusCode,
            (error as any).code
          );
        }
      }
    }

    // No existing customer or it was deleted - create new with idempotency guard
    // Check if there's already an in-flight creation for this personId
    const existingPromise = this.customerCreationLocks.get(personId);
    if (existingPromise) {
      // Return the in-flight promise to serialize concurrent calls
      return existingPromise;
    }

    // Create new customer with idempotency key and lock
    const creationPromise = this.createCustomerWithIdempotency(personId, email);
    this.customerCreationLocks.set(personId, creationPromise);

    try {
      return await creationPromise;
    } finally {
      // Clean up the lock after completion (success or failure)
      this.customerCreationLocks.delete(personId);
    }
  }

  /**
   * Creates a new Stripe Customer with idempotency key.
   * Separated for testability and clarity.
   */
  private async createCustomerWithIdempotency(
    personId: string,
    email: string
  ): Promise<StripeCustomerResult> {
    const idempotencyKey = `customer-create-${personId}`;
    try {
      const customer = await this.stripe.customers.create(
        {
          email,
          metadata: {
            personId,
            source: 'marketplace_checkout',
          },
        },
        { idempotencyKey }
      );
      return { customerId: customer.id, isNew: true };
    } catch (error) {
      throw new StripeServiceError(
        `Failed to create Stripe customer: ${error instanceof Error ? error.message : 'unknown'}`,
        'getOrCreateCustomer.create',
        (error as any).statusCode,
        (error as any).code
      );
    }
  }

  /**
   * Initiates Stripe Connect Express onboarding for a vendor.
   * Returns the account ID and the onboarding URL.
   * Supports idempotency key to prevent duplicate account creation on retry.
   */
  async createConnectAccount(
    personId: string,
    email: string,
    businessType: 'individual' | 'company' = 'individual',
    returnUrl: string,
    refreshUrl: string,
    idempotencyKey?: string
  ): Promise<ConnectOnboardingResult> {
    try {
      // Create the connected account with optional idempotency key
      const account = await this.stripe.accounts.create(
        {
          type: 'express',
          email,
          business_type: businessType,
          capabilities: {
            transfers: { requested: true },
          },
          metadata: {
            personId,
            source: 'marketplace_vendor_onboarding',
          },
          settings: {
            payouts: {
              schedule: {
                interval: 'daily',
              },
            },
          },
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );

      // Create account link for onboarding
      const accountLink = await this.stripe.accountLinks.create({
        account: account.id,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: 'account_onboarding',
      });

      return {
        accountId: account.id,
        onboardingUrl: accountLink.url,
      };
    } catch (error) {
      throw new StripeServiceError(
        `Failed to create Connect account: ${error instanceof Error ? error.message : 'unknown'}`,
        'createConnectAccount',
        (error as any).statusCode,
        (error as any).code
      );
    }
  }

  /**
   * Retrieves the onboarding status and capabilities of a connected account.
   */
  async getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId, {
        expand: ['capabilities'],
      });

      return {
        accountId: account.id,
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        detailsSubmitted: account.details_submitted ?? false,
        capabilities: account.capabilities
          ? {
              transfers: account.capabilities.transfers as 'active' | 'inactive' | 'pending',
            }
          : null,
        requirements: account.requirements
          ? {
              currently_due: account.requirements.currently_due ?? [],
              eventually_due: account.requirements.eventually_due ?? [],
              past_due: account.requirements.past_due ?? [],
            }
          : null,
      };
    } catch (error) {
      throw new StripeServiceError(
        `Failed to retrieve Connect account status: ${error instanceof Error ? error.message : 'unknown'}`,
        'getConnectAccountStatus',
        (error as any).statusCode,
        (error as any).code
      );
    }
  }

  /**
   * Creates a login link for an existing connected account (for dashboard access).
   */
  async createConnectLoginLink(accountId: string): Promise<string> {
    try {
      const loginLink = await this.stripe.accounts.createLoginLink(accountId);
      return loginLink.url;
    } catch (error) {
      throw new StripeServiceError(
        `Failed to create Connect login link: ${error instanceof Error ? error.message : 'unknown'}`,
        'createConnectLoginLink',
        (error as any).statusCode,
        (error as any).code
      );
    }
  }

  /**
   * Creates a Checkout Session with the Stripe Customer attached.
   * This ensures the payment is linked to the customer for future reuse.
   */
  async createCheckoutSessionWithCustomer(
    order: any,
    payment: any,
    customerId: string,
    frontendUrl: string,
    paymentMethodConfiguration?: string
  ): Promise<{ id: string; url: string }> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        ...(paymentMethodConfiguration && {
          payment_method_configuration: paymentMethodConfiguration,
        }),
        line_items: order.vendorGroups.flatMap((group: any) =>
          group.items.map((item: any) => ({
            quantity: item.quantity,
            price_data: {
              currency: 'brl',
              unit_amount: Math.round(item.unitPrice * 100),
              product_data: { name: item.productName },
            },
          }))
        ),
        phone_number_collection: { enabled: true },
        metadata: { orderId: order.id, paymentId: payment.id },
        success_url: `${frontendUrl}/orders?checkout=success`,
        cancel_url: `${frontendUrl}/checkout?checkout=cancelled`,
      });

      if (!session.url) {
        throw new StripeServiceError(
          'STRIPE_CHECKOUT_URL_MISSING',
          'createCheckoutSessionWithCustomer',
          500,
          'checkout_url_missing'
        );
      }

      return { id: session.id, url: session.url };
    } catch (error) {
      if (StripeServiceError.isStripeServiceError(error)) {
        throw error;
      }
      throw new StripeServiceError(
        `Failed to create checkout session: ${error instanceof Error ? error.message : 'unknown'}`,
        'createCheckoutSessionWithCustomer',
        (error as any).statusCode,
        (error as any).code
      );
    }
  }
}

export function createStripeService(): StripeService {
  return new StripeService();
}