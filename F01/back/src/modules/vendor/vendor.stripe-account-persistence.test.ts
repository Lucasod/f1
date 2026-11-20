import { describe, expect, it, vi } from 'vitest';
import { MongoVendorRepository } from './vendor.mongo.repository';
import { Vendor } from './vendor.domain';

describe('Stripe connected account persistence', () => {
  it.each(['save', 'update'] as const)('stores the connected account on %s', async operation => {
    const collection = { findOne: vi.fn().mockResolvedValue(null), updateOne: vi.fn().mockResolvedValue({}) };
    const repo = new MongoVendorRepository({ collection: () => collection } as never);
    const vendor = Vendor.create({ personId: 'person', storeName: 'Store', slug: 'store', commissionPct: 10 });
    vendor.setStripeAccountId('acct_test_vendor');
    await repo[operation](vendor);
    expect(collection.updateOne.mock.calls[0][1].$set.stripeAccountId).toBe('acct_test_vendor');
  });
  it('restores the connected account when loading a vendor', async () => {
    const collection = { findOne: vi.fn().mockResolvedValue({ _id: 'vendor', personId: 'person', storeName: 'Store', slug: 'store', status: 'active', commissionPct: 10, stripeAccountId: 'acct_test_vendor', createdAt: new Date(), updatedAt: new Date() }) };
    const repo = new MongoVendorRepository({ collection: () => collection } as never);
    expect((await repo.findById('vendor'))?.stripeAccountId).toBe('acct_test_vendor');
  });
});
