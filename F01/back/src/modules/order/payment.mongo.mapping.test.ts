import type { Db } from 'mongodb';
import { expect, it, vi } from 'vitest';
import { Payment } from './order.domain';
import { MongoPaymentRepository } from './payment.mongo.repository';

it('preserves the commission snapshot across Mongo payment writes and reads', async () => {
  const payment = Payment.create({ orderId: 'order-1', personId: 'person-1', amount: 100 });
  payment.commissionSnapshot = [{
    ovgId: 'group-1',
    vendorId: 'vendor-1',
    subtotal: 100,
    commissionPct: 10,
    commissionAmount: 10,
    vendorNet: 90,
  }];
  const updateOne = vi.fn();
  const findOne = vi.fn();
  const db = { collection: () => ({ updateOne, findOne }) } as unknown as Db;
  const repository = new MongoPaymentRepository(db);

  await repository.save(payment);
  const [filter, update] = updateOne.mock.calls[0];
  findOne.mockResolvedValue({ ...filter, ...update.$setOnInsert, ...update.$set });

  expect((await repository.findById(payment.id))?.commissionSnapshot).toEqual(payment.commissionSnapshot);
});

it('returns the same persisted payment ID and provider when replaying an attempt', async () => {
  const findOne = vi.fn().mockResolvedValue(null);
  const insertOne = vi.fn();
  const db = { collection: () => ({ findOne, insertOne }) } as unknown as Db;
  const repository = new MongoPaymentRepository(db);
  const input = { attemptId: 'attempt-1', orderId: 'order-1', personId: 'person-1', amount: 100, provider: 'stripe' };

  const initial = await repository.insertForAttempt(input);
  findOne.mockResolvedValue(insertOne.mock.calls[0][0]);
  const replay = await repository.insertForAttempt(input);

  expect(replay.id).toBe(initial.id);
  expect(replay.provider).toBe('stripe');
  expect(insertOne).toHaveBeenCalledTimes(1);
});
