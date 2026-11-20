import { Collection, Db, MongoServerError, ObjectId } from 'mongodb';
import { Review, ReviewData, ReviewError, ReviewRepository, ReviewUpdateCondition } from './review.domain';

type ReviewDocument = ReviewData & { _id?: ObjectId };

export class MongoReviewRepository implements ReviewRepository {
  private readonly collection: Collection<ReviewDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ReviewDocument>('reviews');
  }

  async save(review: Review): Promise<Review> {
    try {
      await this.collection.insertOne({ ...review.toJSON(), revision: review.revision });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
      }
      throw error;
    }
    return review;
  }

  async findById(id: string): Promise<Review | null> {
    const document = await this.collection.findOne({ id });
    return document ? Review.reconstruct(this.toReviewData(document)) : null;
  }

  async findByOrderItemId(orderItemId: string): Promise<Review | null> {
    const document = await this.collection.findOne({ orderItemId });
    return document ? Review.reconstruct(this.toReviewData(document)) : null;
  }

  async findByOrderId(orderId: string): Promise<Review[]> {
    const documents = await this.collection.find({ orderId }).sort({ createdAt: -1 }).toArray();
    return documents.map(document => Review.reconstruct(this.toReviewData(document)));
  }

  async findByProductId(productId: string): Promise<Review[]> {
    const documents = await this.collection.find({ productId }).sort({ createdAt: -1 }).toArray();
    return documents.map(document => Review.reconstruct(this.toReviewData(document)));
  }

  async findAll(): Promise<Review[]> {
    const documents = await this.collection.find({}).sort({ createdAt: -1 }).toArray();
    return documents.map(document => Review.reconstruct(this.toReviewData(document)));
  }

  async update(review: Review, condition?: ReviewUpdateCondition): Promise<Review> {
    const revisionFilter = review.revision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: review.revision };
    const result = await this.collection.replaceOne(
      { id: review.id, ...revisionFilter, ...condition },
      { ...review.toJSON(), revision: review.revision + 1 },
    );
    if (result.matchedCount === 0) {
      throw new Error(ReviewError.REVIEW_CONFLICT);
    }
    return review.snapshot(review.revision + 1);
  }

  private toReviewData(document: ReviewDocument): ReviewData {
    const { _id: _ignored, ...data } = document;
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }
}
