import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedRequest, authMiddleware, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import multer, { FileFilterCallback } from 'multer';
import { ReviewError, ReviewStatus } from './review.domain';
import { ReviewService } from './review.service';

export interface ReviewRoutesConfig {
  authService: AuthService;
  reviewService: ReviewService;
}

export function createReviewRoutes({ authService, reviewService }: ReviewRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);
  const requireAdmin = requireRole(PersonRole.ADMIN);
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback: FileFilterCallback) => {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        callback(null, true);
      } else {
        callback(new Error(ReviewError.INVALID_REVIEW_IMAGE));
      }
    },
  });
  const parseReviewImage: RequestHandler = (req, res, next) => {
    imageUpload.single('image')(req, res, error => {
      if (!error) {
        next();
      } else if (error instanceof Error) {
        res.status(400).json({ error: ReviewError.INVALID_REVIEW_IMAGE, message: error.message });
      } else {
        next(error);
      }
    });
  };

  router.get('/products/:productId/reviews', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePagination(req);
      const result = await reviewService.listProductReviews(
        readPathParameter(req.params.productId),
        page,
        limit,
      );
      return res.json({
        ...result,
        items: result.items.map(review => reviewService.toReviewWithUrls(review)),
      });
    } catch (error) {
      return handleReviewError(error, res, next);
    }
  }) as RequestHandler);

  router.post('/products/:productId/reviews', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error(ReviewError.INVALID_REVIEW);
      }
      const review = await reviewService.createReview({
        productId: readPathParameter(req.params.productId),
        consumerId: req.user.sub,
        orderId: req.body.orderId,
        orderItemId: req.body.orderItemId,
        rating: req.body.rating,
        comment: req.body.comment,
      });
      return res.status(201).json({ review: reviewService.toReviewWithUrls(review) });
    } catch (error) {
      return handleReviewError(error, res, next);
    }
  }) as RequestHandler);

  // CD-017: verified purchase ownership middleware for review creation
  // Ensures only authenticated consumers may create reviews; full eligibility
  // (delivered order item) is validated in createReview service method.

  // Ownership middleware for image upload: ensures the consumer uploading
// an image is the same consumer who created the review (CD-017).
const checkReviewImageOwnership = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const review = await reviewService.findReviewById(readPathParameter(req.params.reviewId));
  if (!review) {
    return next(new Error(ReviewError.REVIEW_NOT_FOUND));
  }
  if (review.consumerId !== req.user.sub) {
    return res.status(403).json({ error: ReviewError.REVIEW_OWNERSHIP_VIOLATION, message: 'Only the review owner may upload images' });
  }
  next();
};

router.post('/reviews/:reviewId/images', authMw as RequestHandler, requireConsumer as RequestHandler, checkReviewImageOwnership as RequestHandler, parseReviewImage, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new Error(ReviewError.REVIEW_IMAGE_REQUIRED);
      }
      const review = await reviewService.addReviewImage(
        (req as AuthenticatedRequest).user.sub,
        readPathParameter(req.params.reviewId),
        req.file.buffer,
        req.file.mimetype,
      );
      return res.status(201).json({ review: reviewService.toReviewWithUrls(review) });
    } catch (error) {
      return handleReviewError(error, res, next);
    }
  }) as RequestHandler);

  router.get('/admin/reviews', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePagination(req);
      const result = await reviewService.listAdminReviews(page, limit);
      return res.json({
        ...result,
        items: result.items.map(review => reviewService.toReviewWithUrls(review)),
      });
    } catch (error) {
      return handleReviewError(error, res, next);
    }
  }) as RequestHandler);

  router.patch('/admin/reviews/:reviewId/moderate', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.body?.status;
      if (!isReviewStatus(status)) {
        throw new Error(ReviewError.INVALID_REVIEW_STATUS);
      }
      const review = await reviewService.moderateReview(
        readPathParameter(req.params.reviewId),
        status,
      );
      return res.json({ review: reviewService.toReviewWithUrls(review) });
    } catch (error) {
      return handleReviewError(error, res, next);
    }
  }) as RequestHandler);

  return router;
}

function readPathParameter(value: string | string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(ReviewError.INVALID_REVIEW);
  }
  return value;
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === ReviewStatus.PUBLISHED
    || value === ReviewStatus.HIDDEN
    || value === ReviewStatus.REJECTED;
}

function parsePagination(req: Request): { page: number; limit: number } {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(page) || !Number.isInteger(limit)) {
    throw new Error(ReviewError.INVALID_PAGINATION);
  }
  return { page, limit };
}

function handleReviewError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof Error) {
    switch (error.message) {
      case ReviewError.INVALID_REVIEW:
      case ReviewError.INVALID_RATING:
      case ReviewError.INVALID_REVIEW_STATUS:
      case ReviewError.INVALID_PAGINATION:
      case ReviewError.REVIEW_IMAGE_REQUIRED:
      case ReviewError.INVALID_REVIEW_IMAGE:
      case ReviewError.REVIEW_IMAGE_LIMIT_REACHED:
        return res.status(400).json({ error: error.message, message: error.message });
      case ReviewError.REVIEW_ALREADY_EXISTS:
        return res.status(409).json({ error: error.message, message: 'This order item already has a review' });
      case ReviewError.REVIEW_CONFLICT:
        return res.status(409).json({ error: error.message, message: error.message });
      case ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE:
        return res.status(403).json({ error: error.message, message: 'A delivered order item for this product is required' });
      case ReviewError.REVIEW_OWNERSHIP_VIOLATION:
        return res.status(403).json({ error: error.message, message: 'Only the review owner may upload images' });
      case ReviewError.PRODUCT_NOT_FOUND:
      case ReviewError.REVIEW_NOT_FOUND:
        return res.status(404).json({ error: error.message, message: error.message });
    }
  }
  return next(error);
}
