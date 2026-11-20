import { describe, expect, it, vi } from 'vitest';
import { MongoTransferRepository } from './transfer.mongo.repository';

describe('Mongo transfer identity', () => {
  const doc = { _id: 'transfer-1', orderId: 'order-1', orderVendorGroupId: 'group-1', amount: 10, currency: 'brl', status: 'processing', stripeTransferId: 'tr_test_1', createdAt: new Date(), updatedAt: new Date() };
  it('preserves the persisted id across each lookup', async () => {
    const collection = { findOne: vi.fn().mockResolvedValue(doc), find: vi.fn(() => ({ sort: () => ({ toArray: async () => [doc] }) })) };
    const repo = new MongoTransferRepository({ collection: () => collection } as never);
    const results = [await repo.findById('transfer-1'), await repo.findByStripeTransferId('tr_test_1'), await repo.findByProviderTransactionId('pi_test_1'), await repo.findLastByOrderVendorGroupId('group-1'), ...(await repo.findByOrderId('order-1')), ...(await repo.findByOrderVendorGroupId('group-1'))];
    expect(results.map(transfer => transfer?.id)).toEqual(Array(6).fill('transfer-1'));
  });
});
