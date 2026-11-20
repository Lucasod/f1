import { StripeService, StripeServiceError, createStripeService } from './stripe.service';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock Stripe class
class MockStripe {
  customers = {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  accounts = {
    create: vi.fn(),
    retrieve: vi.fn(),
    createLoginLink: vi.fn(),
  };
  accountLinks = {
    create: vi.fn(),
  };
  checkout = {
    sessions: {
      create: vi.fn(),
    },
  };
  errors = {
    StripeResourceNotFoundError: class StripeResourceNotFoundError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'StripeResourceNotFoundError';
      }
    },
  };
}

let mockStripeInstance: MockStripe;

vi.mock('stripe', () => {
  class MockStripeInternal {
    customers = {
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    accounts = {
      create: vi.fn(),
      retrieve: vi.fn(),
      createLoginLink: vi.fn(),
    };
    accountLinks = {
      create: vi.fn(),
    };
    checkout = {
      sessions: {
        create: vi.fn(),
      },
    };
    errors = {
      StripeResourceNotFoundError: class StripeResourceNotFoundError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'StripeResourceNotFoundError';
        }
      },
    };
  }
  const MockStripeConstructor = vi.fn().mockImplementation(function(this: any) {
    const instance = new MockStripeInternal();
    mockStripeInstance = instance;
    return instance;
  });
  return {
    default: MockStripeConstructor,
    errors: {
      StripeResourceNotFoundError: class StripeResourceNotFoundError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'StripeResourceNotFoundError';
        }
      },
    },
  };
});

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeInstance = new MockStripe();
    service = new StripeService(mockStripeInstance as any);
  });

  describe('getOrCreateCustomer', () => {
    it('should return existing customer when valid customerId provided', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue({
        id: 'cus_existing123',
        email: 'buyer@example.com',
        deleted: false,
      });

      const result = await service.getOrCreateCustomer('person_123', 'buyer@example.com', 'cus_existing123');

      expect(result).toEqual({ customerId: 'cus_existing123', isNew: false });
      expect(mockStripeInstance.customers.retrieve).toHaveBeenCalledWith('cus_existing123');
      expect(mockStripeInstance.customers.create).not.toHaveBeenCalled();
    });

    it('should update email if changed on existing customer', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue({
        id: 'cus_existing123',
        email: 'old@example.com',
        deleted: false,
      });
      mockStripeInstance.customers.update.mockResolvedValue({});

      const result = await service.getOrCreateCustomer('person_123', 'new@example.com', 'cus_existing123');

      expect(result).toEqual({ customerId: 'cus_existing123', isNew: false });
      expect(mockStripeInstance.customers.update).toHaveBeenCalledWith('cus_existing123', { email: 'new@example.com' });
    });

    it('should create new customer when existing customer not found', async () => {
      mockStripeInstance.customers.retrieve.mockRejectedValue(
        new mockStripeInstance.errors.StripeResourceNotFoundError('Not found')
      );
      mockStripeInstance.customers.create.mockResolvedValue({
        id: 'cus_new456',
        email: 'buyer@example.com',
      });

      const result = await service.getOrCreateCustomer('person_123', 'buyer@example.com', 'cus_existing123');

      expect(result).toEqual({ customerId: 'cus_new456', isNew: true });
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith(
        {
          email: 'buyer@example.com',
          metadata: { personId: 'person_123', source: 'marketplace_checkout' },
        },
        { idempotencyKey: 'customer-create-person_123' }
      );
    });

    it('should create new customer when no existing customerId provided', async () => {
      mockStripeInstance.customers.create.mockResolvedValue({
        id: 'cus_new789',
        email: 'buyer@example.com',
      });

      const result = await service.getOrCreateCustomer('person_123', 'buyer@example.com');

      expect(result).toEqual({ customerId: 'cus_new789', isNew: true });
      expect(mockStripeInstance.customers.retrieve).not.toHaveBeenCalled();
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith(
        {
          email: 'buyer@example.com',
          metadata: { personId: 'person_123', source: 'marketplace_checkout' },
        },
        { idempotencyKey: 'customer-create-person_123' }
      );
    });

    it('should create new customer when existing customer is deleted', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue({
        id: 'cus_deleted',
        email: 'buyer@example.com',
        deleted: true,
      });
      mockStripeInstance.customers.create.mockResolvedValue({
        id: 'cus_new999',
        email: 'buyer@example.com',
      });

      const result = await service.getOrCreateCustomer('person_123', 'buyer@example.com', 'cus_deleted');

      expect(result).toEqual({ customerId: 'cus_new999', isNew: true });
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith(
        {
          email: 'buyer@example.com',
          metadata: { personId: 'person_123', source: 'marketplace_checkout' },
        },
        { idempotencyKey: 'customer-create-person_123' }
      );
    });

    it('should throw StripeServiceError on retrieve failure (non-404)', async () => {
      mockStripeInstance.customers.retrieve.mockRejectedValue(
        Object.assign(new Error('API error'), { statusCode: 500, code: 'api_error' })
      );

      await expect(
        service.getOrCreateCustomer('person_123', 'buyer@example.com', 'cus_existing123')
      ).rejects.toBeInstanceOf(StripeServiceError);

      await expect(
        service.getOrCreateCustomer('person_123', 'buyer@example.com', 'cus_existing123')
      ).rejects.toMatchObject({
        operation: 'getOrCreateCustomer.retrieve',
        httpStatus: 500,
        stripeCode: 'api_error',
      });
    });

    it('should throw StripeServiceError on create failure', async () => {
      const error = new Error('Creation failed');
      (error as any).statusCode = 400;
      (error as any).code = 'invalid_request';
      mockStripeInstance.customers.create.mockRejectedValue(error);

      await expect(
        service.getOrCreateCustomer('person_123', 'buyer@example.com')
      ).rejects.toMatchObject({
        operation: 'getOrCreateCustomer.create',
        httpStatus: 400,
        stripeCode: 'invalid_request',
      });
    });

    it('should serialize concurrent calls for same personId via in-memory lock', async () => {
      let createCallCount = 0;
      mockStripeInstance.customers.create.mockImplementation(async () => {
        const currentCount = ++createCallCount;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { id: `cus_${currentCount}`, email: 'buyer@example.com' };
      });

      // Start multiple concurrent calls for the same personId
      const promises = [
        service.getOrCreateCustomer('person_concurrent', 'buyer@example.com'),
        service.getOrCreateCustomer('person_concurrent', 'buyer@example.com'),
        service.getOrCreateCustomer('person_concurrent', 'buyer@example.com'),
      ];

      const results = await Promise.all(promises);

      // All calls should return the same customer (first one created)
      expect(results[0].customerId).toBe(results[1].customerId);
      expect(results[1].customerId).toBe(results[2].customerId);
      expect(results[0].isNew).toBe(true);
      expect(results[1].isNew).toBe(true);
      expect(results[2].isNew).toBe(true);

      // Stripe create should only be called once due to lock
      expect(createCallCount).toBe(1);
      expect(mockStripeInstance.customers.create).toHaveBeenCalledTimes(1);
    });

    it('should allow concurrent calls for different personIds', async () => {
      let createCallCount = 0;
      mockStripeInstance.customers.create.mockImplementation(async () => {
        const currentCount = ++createCallCount;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { id: `cus_${currentCount}`, email: 'buyer@example.com' };
      });

      const promises = [
        service.getOrCreateCustomer('person_a', 'buyer@example.com'),
        service.getOrCreateCustomer('person_b', 'buyer@example.com'),
        service.getOrCreateCustomer('person_c', 'buyer@example.com'),
      ];

      const results = await Promise.all(promises);

      // Each personId should get a different customer
      expect(results[0].customerId).not.toBe(results[1].customerId);
      expect(results[1].customerId).not.toBe(results[2].customerId);
      expect(results[0].customerId).not.toBe(results[2].customerId);

      // Stripe create should be called 3 times (once per personId)
      expect(createCallCount).toBe(3);
      expect(mockStripeInstance.customers.create).toHaveBeenCalledTimes(3);
    });

    it('should use correct idempotency key per personId', async () => {
      mockStripeInstance.customers.create.mockResolvedValue({
        id: 'cus_test',
        email: 'buyer@example.com',
      });

      await service.getOrCreateCustomer('person_abc', 'buyer@example.com');

      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'customer-create-person_abc' }
      );
    });
  });

  describe('createConnectAccount', () => {
    it('should create connected account and return onboarding URL', async () => {
      mockStripeInstance.accounts.create.mockResolvedValue({
        id: 'acct_vendor123',
        email: 'vendor@example.com',
      });
      mockStripeInstance.accountLinks.create.mockResolvedValue({
        url: 'https://connect.stripe.com/onboard/acct_vendor123',
      });

      const result = await service.createConnectAccount(
        'person_456',
        'vendor@example.com',
        'individual',
        'https://app.example.com/return',
        'https://app.example.com/refresh'
      );

      expect(result).toEqual({
        accountId: 'acct_vendor123',
        onboardingUrl: 'https://connect.stripe.com/onboard/acct_vendor123',
      });
      expect(mockStripeInstance.accounts.create).toHaveBeenCalledWith(
        {
          type: 'express',
          email: 'vendor@example.com',
          business_type: 'individual',
          capabilities: { transfers: { requested: true } },
          metadata: { personId: 'person_456', source: 'marketplace_vendor_onboarding' },
          settings: { payouts: { schedule: { interval: 'daily' } } },
        },
        undefined // idempotencyKey not provided
      );
      expect(mockStripeInstance.accountLinks.create).toHaveBeenCalledWith({
        account: 'acct_vendor123',
        return_url: 'https://app.example.com/return',
        refresh_url: 'https://app.example.com/refresh',
        type: 'account_onboarding',
      });
    });

    it('should throw StripeServiceError on account creation failure', async () => {
      const error = new Error('Account creation failed');
      (error as any).statusCode = 400;
      (error as any).code = 'invalid_request';
      mockStripeInstance.accounts.create.mockRejectedValue(error);

      await expect(
        service.createConnectAccount('person_456', 'vendor@example.com', 'individual', 'return', 'refresh')
      ).rejects.toMatchObject({
        operation: 'createConnectAccount',
        httpStatus: 400,
        stripeCode: 'invalid_request',
      });
    });

    it('should throw StripeServiceError on account link creation failure', async () => {
      mockStripeInstance.accounts.create.mockResolvedValue({ id: 'acct_vendor123' });
      const error = new Error('Link creation failed');
      (error as any).statusCode = 500;
      (error as any).code = 'api_error';
      mockStripeInstance.accountLinks.create.mockRejectedValue(error);

      await expect(
        service.createConnectAccount('person_456', 'vendor@example.com', 'individual', 'return', 'refresh')
      ).rejects.toMatchObject({
        operation: 'createConnectAccount',
        httpStatus: 500,
        stripeCode: 'api_error',
      });
    });
  });

  it('creates an onboarding link for an existing account without creating an account', async () => {
    mockStripeInstance.accountLinks.create.mockResolvedValue({ url: 'https://connect.stripe.com/existing' });
    await expect(service.createConnectOnboardingLink('acct_existing', 'https://app.example.com/return', 'https://app.example.com/refresh')).resolves.toBe('https://connect.stripe.com/existing');
    expect(mockStripeInstance.accounts.create).not.toHaveBeenCalled();
    expect(mockStripeInstance.accountLinks.create).toHaveBeenCalledWith({ account: 'acct_existing', return_url: 'https://app.example.com/return', refresh_url: 'https://app.example.com/refresh', type: 'account_onboarding' });
  });

  describe('getConnectAccountStatus', () => {
    it('should return account status with capabilities', async () => {
      mockStripeInstance.accounts.retrieve.mockResolvedValue({
        id: 'acct_vendor123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        capabilities: { transfers: 'active' },
        requirements: {
          currently_due: [],
          eventually_due: [],
          past_due: [],
        },
      });

      const result = await service.getConnectAccountStatus('acct_vendor123');

      expect(result).toEqual({
        accountId: 'acct_vendor123',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        capabilities: { transfers: 'active' },
        requirements: {
          currently_due: [],
          eventually_due: [],
          past_due: [],
        },
      });
    });

    it('should handle missing capabilities and requirements', async () => {
      mockStripeInstance.accounts.retrieve.mockResolvedValue({
        id: 'acct_vendor123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      });

      const result = await service.getConnectAccountStatus('acct_vendor123');

      expect(result.capabilities).toBeNull();
      expect(result.requirements).toBeNull();
    });

    it('should throw StripeServiceError on retrieval failure', async () => {
      const error = new Error('Not found');
      (error as any).statusCode = 404;
      (error as any).code = 'resource_not_found';
      mockStripeInstance.accounts.retrieve.mockRejectedValue(error);

      await expect(
        service.getConnectAccountStatus('acct_invalid')
      ).rejects.toMatchObject({
        operation: 'getConnectAccountStatus',
        httpStatus: 404,
        stripeCode: 'resource_not_found',
      });
    });
  });

  describe('createConnectLoginLink', () => {
    it('should return login link URL', async () => {
      mockStripeInstance.accounts.createLoginLink.mockResolvedValue({
        url: 'https://dashboard.stripe.com/login/acct_vendor123',
      });

      const result = await service.createConnectLoginLink('acct_vendor123');

      expect(result).toBe('https://dashboard.stripe.com/login/acct_vendor123');
    });

    it('should throw StripeServiceError on failure', async () => {
      const error = new Error('Failed');
      (error as any).statusCode = 403;
      (error as any).code = 'permission_denied';
      mockStripeInstance.accounts.createLoginLink.mockRejectedValue(error);

      await expect(
        service.createConnectLoginLink('acct_vendor123')
      ).rejects.toMatchObject({
        operation: 'createConnectLoginLink',
        httpStatus: 403,
        stripeCode: 'permission_denied',
      });
    });
  });

  describe('createCheckoutSessionWithCustomer', () => {
    it('should create checkout session with customer attached', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_session123',
        url: 'https://checkout.stripe.com/session/cs_test_session123',
      });

      const order = {
        id: 'order_123',
        vendorGroups: [
          {
            items: [
              { productId: 'prod_1', productName: 'Product 1', quantity: 2, unitPrice: 50 },
            ],
          },
        ],
      };
      const payment = { id: 'payment_123' };

      const result = await service.createCheckoutSessionWithCustomer(
        order,
        payment,
        'cus_customer123',
        'https://app.example.com',
        'pmc_config123'
      );

      expect(result).toEqual({
        id: 'cs_test_session123',
        url: 'https://checkout.stripe.com/session/cs_test_session123',
      });
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_customer123',
          mode: 'payment',
          payment_method_configuration: 'pmc_config123',
        })
      );
    });

    it('should send payment_method_types: [pix] when paymentMethodConfiguration is not set', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_session123',
        url: 'https://checkout.stripe.com/session/cs_test_session123',
      });

      const order = {
        id: 'order_123',
        vendorGroups: [
          {
            items: [
              { productId: 'prod_1', productName: 'Product 1', quantity: 2, unitPrice: 50 },
            ],
          },
        ],
      };
      const payment = { id: 'payment_123' };

      const result = await service.createCheckoutSessionWithCustomer(
        order,
        payment,
        'cus_customer123',
        'https://app.example.com'
      );

      expect(result).toEqual({
        id: 'cs_test_session123',
        url: 'https://checkout.stripe.com/session/cs_test_session123',
      });
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_customer123',
          mode: 'payment',
          payment_method_types: ['pix'],
        })
      );
    });

    it('should throw StripeServiceError when URL is missing', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_session123',
        url: null,
      });

      const order = {
        id: 'order_123',
        vendorGroups: [
          {
            items: [
              { productId: 'prod_1', productName: 'Product 1', quantity: 2, unitPrice: 50 },
            ],
          },
        ],
      };
      const payment = { id: 'payment_123' };

      await expect(
        service.createCheckoutSessionWithCustomer(order, payment, 'cus_123', 'https://app.example.com')
      ).rejects.toMatchObject({
        operation: 'createCheckoutSessionWithCustomer',
        stripeCode: 'checkout_url_missing',
        httpStatus: 500,
      });
    });

    it('should throw StripeServiceError on session creation failure', async () => {
      const error = new Error('Session failed');
      (error as any).statusCode = 400;
      (error as any).code = 'invalid_request';
      mockStripeInstance.checkout.sessions.create.mockRejectedValue(error);

      const order = {
        id: 'order_123',
        vendorGroups: [
          {
            items: [
              { productId: 'prod_1', productName: 'Product 1', quantity: 2, unitPrice: 50 },
            ],
          },
        ],
      };
      const payment = { id: 'payment_123' };

      await expect(
        service.createCheckoutSessionWithCustomer(order, payment, 'cus_123', 'https://app.example.com')
      ).rejects.toMatchObject({
        operation: 'createCheckoutSessionWithCustomer',
        httpStatus: 400,
        stripeCode: 'invalid_request',
      });
    });
  });
});

describe('createStripeService', () => {
  const originalEnv = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 't3st';
    vi.clearAllMocks();
    mockStripeInstance = new MockStripe();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.STRIPE_SECRET_KEY = originalEnv;
    } else {
      delete process.env.STRIPE_SECRET_KEY;
    }
  });

  it('should create a StripeService instance', () => {
    const service = createStripeService();
    expect(service).toBeInstanceOf(StripeService);
  });
});