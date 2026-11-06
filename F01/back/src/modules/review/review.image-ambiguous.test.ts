import { expect, it, vi } from 'vitest';
import { ReviewService } from './review.service';

it('does not delete a review image when persistence may have committed', async () => {
  const review = { id: 'r1', productId: 'p1', consumerId: 'c1', status: 'published', images: [], addImage: vi.fn() };
  const reviewRepo = { findById: vi.fn().mockResolvedValue(review), update: vi.fn().mockRejectedValue(new Error('unknown outcome')) };
  const storage = {
    validateFile: vi.fn().mockResolvedValue({ valid: true }),
    save: vi.fn().mockResolvedValue({ url: '/image' }),
    delete: vi.fn(),
  };
  const service = new ReviewService(reviewRepo as any, {} as any, {} as any, storage as any);
  await expect(service.addReviewImage('c1', 'r1', Buffer.from('image'), 'image/jpeg')).rejects.toThrow('unknown outcome');
  expect(storage.delete).not.toHaveBeenCalled();
});
