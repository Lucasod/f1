import { describe, expect, it, vi } from 'vitest';
import { InMemoryReviewRepository, Review } from './review.domain';
import { ReviewService } from './review.service';
import { OrderStatus } from '../order/order.domain';

function fixture(products = ['p', 'p', 'other']) {
  const items = products.map((productId, index) => ({ id: `item-${index}`, productId, isDelivered: true }));
  const order = { id: 'order', personId: 'owner', status: OrderStatus.DELIVERED, vendorGroups: [{ items }] };
  const orders = { findById: vi.fn().mockResolvedValue(order), findByPersonId: vi.fn().mockImplementation(async id => id === 'owner' ? [order] : []) };
  const repo = new InMemoryReviewRepository();
  const service = new ReviewService(repo, orders as any, { findById: vi.fn().mockResolvedValue({}) } as any, {} as any);
  return { service, repo, orders, items };
}

describe('legacy review eligibility', () => {
  it('rejects a legacy order/product review for either item-reference path without exposing it to non-owners', async () => {
    const { service, repo } = fixture();
    await repo.save(Review.create({ orderId: 'order', productId: 'p', consumerId: 'owner', rating: 4 }));
    for (const reference of [{ orderId: 'order', orderItemId: 'item-0' }, { orderItemId: 'item-1' }]) {
      await expect(service.createReview({ ...reference, productId: 'p', consumerId: 'owner', rating: 5 })).rejects.toThrow('REVIEW_ALREADY_EXISTS');
      await expect(service.createReview({ ...reference, productId: 'p', consumerId: 'stranger', rating: 5 })).rejects.toThrow('REVIEW_PURCHASE_NOT_ELIGIBLE');
    }
    await expect(service.createReview({ orderItemId: 'item-2', productId: 'other', consumerId: 'owner', rating: 5 })).resolves.toBeDefined();
  });

  it('requires an explicit item for repeated products and permits distinct identified items', async () => {
    const { service } = fixture();
    const base = { productId: 'p', consumerId: 'owner', orderId: 'order', rating: 5 };
    await expect(service.createReview(base)).rejects.toThrow('REVIEW_CONFLICT');
    await expect(service.createReview({ ...base, orderItemId: 'item-0' })).resolves.toBeDefined();
    await expect(service.createReview({ ...base, orderItemId: 'item-1' })).resolves.toBeDefined();
    await expect(service.createReview({ ...base, orderItemId: 'item-0' })).rejects.toThrow('REVIEW_ALREADY_EXISTS');
    await expect(service.createReview({ ...base, orderItemId: 'item-2' })).rejects.toThrow('REVIEW_PURCHASE_NOT_ELIGIBLE');
  });

  it('propagates insertion conflicts after concurrent eligibility checks', async () => {
    const { service, repo } = fixture(['p']);
    const save = vi.spyOn(repo, 'save');
    const input = { productId: 'p', consumerId: 'owner', orderId: 'order', rating: 5 };
    const results = await Promise.allSettled([service.createReview(input), service.createReview(input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual(['REVIEW_ALREADY_EXISTS']);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the legacy lookup fails', async () => {
    const { service, repo } = fixture(['p']);
    vi.spyOn(repo, 'findByOrderId').mockRejectedValue(new Error('lookup failed'));
    const save = vi.spyOn(repo, 'save');
    await expect(service.createReview({ productId: 'p', consumerId: 'owner', orderId: 'order', rating: 5 })).rejects.toThrow('lookup failed');
    expect(save).not.toHaveBeenCalled();
  });
});
