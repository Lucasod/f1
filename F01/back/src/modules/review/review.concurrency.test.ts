import { describe, expect, it, vi } from 'vitest';
import { InMemoryReviewRepository, Review, ReviewStatus } from './review.domain';
import { MongoReviewRepository } from './review.mongo.repository';
import { ReviewService } from './review.service';
import { MongoServerError } from 'mongodb';

const makeReview = () => Review.create({ productId: 'p', consumerId: 'c', orderId: 'o', rating: 5 });

describe('review concurrent writers', () => {
  it('accepts distinct order items but admits only one concurrent save per item', async () => {
    const repo = new InMemoryReviewRepository();
    const makeItemReview = (orderItemId: string) => Review.create({ productId: 'p', consumerId: 'c', orderId: 'o', orderItemId, rating: 5 });
    const results = await Promise.allSettled([repo.save(makeItemReview('item-1')), repo.save(makeItemReview('item-1')), repo.save(makeItemReview('item-2'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual(['REVIEW_ALREADY_EXISTS']);
  });

  it('maps Mongo duplicate-key insertion conflicts to the same review error', async () => {
    const insertOne = vi.fn().mockRejectedValue(new MongoServerError({ message: 'duplicate', code: 11000 }));
    const repo = new MongoReviewRepository({ collection: () => ({ insertOne }) } as any);
    await expect(repo.save(Review.create({ productId: 'p', consumerId: 'c', orderId: 'o', orderItemId: 'item-1', rating: 5 }))).rejects.toThrow('REVIEW_ALREADY_EXISTS');
  });
  it('isolates snapshots and rejects a stale image or moderation write', async () => {
    const repo = new InMemoryReviewRepository();
    const initial = makeReview();
    await repo.save(initial);
    const first = (await repo.findById(initial.id))!;
    const second = (await repo.findById(initial.id))!;
    first.addImage('/first');
    expect(second.images).toEqual([]);
    await repo.update(first);
    second.moderate(ReviewStatus.HIDDEN);
    await expect(repo.update(second)).rejects.toThrow('REVIEW_CONFLICT');
    expect((await repo.findById(initial.id))!.images).toEqual(['/first']);
    expect((await repo.findById(initial.id))!.status).toBe(ReviewStatus.PUBLISHED);
  });

  it('uses a legacy-compatible CAS and upload ownership and status predicates', async () => {
    const replaceOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const repo = new MongoReviewRepository({ collection: () => ({ replaceOne }) } as any);
    const review = makeReview();
    await expect(repo.update(review, { consumerId: 'c', status: ReviewStatus.PUBLISHED })).rejects.toThrow('REVIEW_CONFLICT');
    expect(replaceOne).toHaveBeenCalledWith(expect.objectContaining({
      id: review.id, consumerId: 'c', status: ReviewStatus.PUBLISHED,
      $or: [{ revision: 0 }, { revision: { $exists: false } }],
    }), expect.objectContaining({ revision: 1 }));
  });

  it('increments a legacy snapshot and matches the exact revision afterwards', async () => {
    const legacy = makeReview();
    const findOne = vi.fn().mockResolvedValue(legacy.toJSON());
    const replaceOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const repo = new MongoReviewRepository({ collection: () => ({ findOne, replaceOne }) } as any);
    const first = (await repo.findById(legacy.id))!;
    const updated = await repo.update(first);
    expect(updated.revision).toBe(1);
    expect(updated.toJSON()).not.toHaveProperty('revision');
    await repo.update(updated);
    expect(replaceOne).toHaveBeenNthCalledWith(2, { id: legacy.id, revision: 1 }, expect.objectContaining({ revision: 2 }));
  });

  it('protects the fifth image when two uploads share the same snapshot', async () => {
    const repo = new InMemoryReviewRepository();
    const review = makeReview();
    for (let i = 0; i < 4; i++) review.addImage(`/existing-${i}`);
    await repo.save(review);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let saves = 0;
    const storage = {
      validateFile: vi.fn().mockResolvedValue({ valid: true }),
      save: vi.fn(async () => { const number = ++saves; if (number === 2) release(); await gate; return { url: `/new-${number}` }; }),
      delete: vi.fn(),
    };
    const service = new ReviewService(repo, {} as any, {} as any, storage as any);
    const outcomes = await Promise.allSettled([
      service.addReviewImage('c', review.id, Buffer.from('x'), 'image/png'),
      service.addReviewImage('c', review.id, Buffer.from('x'), 'image/png'),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => (outcome as PromiseRejectedResult).reason.message)).toEqual(['REVIEW_CONFLICT']);
    expect((await repo.findById(review.id))!.images).toHaveLength(5);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('rejects an upload whose snapshot was moderated before persistence', async () => {
    const repo = new InMemoryReviewRepository();
    const review = makeReview();
    await repo.save(review);
    const storage = {
      validateFile: vi.fn().mockResolvedValue({ valid: true }),
      save: vi.fn(async () => {
        const moderated = (await repo.findById(review.id))!;
        moderated.moderate(ReviewStatus.HIDDEN);
        await repo.update(moderated);
        return { url: '/image' };
      }),
      delete: vi.fn(),
    };
    const service = new ReviewService(repo, {} as any, {} as any, storage as any);
    await expect(service.addReviewImage('c', review.id, Buffer.from('x'), 'image/png')).rejects.toThrow('REVIEW_CONFLICT');
    const stored = (await repo.findById(review.id))!;
    expect(stored.status).toBe(ReviewStatus.HIDDEN);
    expect(stored.images).toEqual([]);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
