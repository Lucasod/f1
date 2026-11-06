import { describe, it, expect } from 'vitest';
import {
  Order,
  OrderStatus,
  OrderError,
  InMemoryOrderRepository
} from './order.domain';

/**
 * P2-CR002 — payment/order atomic persistence (isolated, in-memory only).
 *
 * No Mongo, no provider, no shared DB, no network. Uses only the project's
 * own InMemoryOrderRepository, which mirrors the conditional-write behavior
 * of MongoOrderRepository.save() (order.mongo.repository.ts:117-162).
 *
 * Invariant under test:
 *   A stale PENDING_PAYMENT snapshot must not replace PROCESSING or CANCELLED.
 *
 * Historical gap: stale PENDING_PAYMENT snapshots overwrote PROCESSING and
 * CANCELLED. These cases now assert that the narrow guard rejects them. This
 * does not establish general optimistic concurrency for other updates.
 */

describe('P2-CR002 — stale concurrent order write (repository contract)', () => {
  async function seedOrder(repo: InMemoryOrderRepository): Promise<Order> {
    const order = Order.create({
      personId: 'person-1',
      vendorGroups: [{
        vendorId: 'vendor-1',
        items: [{ productId: 'product-1', productName: 'P', vendorId: 'vendor-1', quantity: 1, unitPrice: 100 }],
        commissionPct: 10
      }],
      shippingAddress: { id: 'a1', street: 'S', number: '1', neighborhood: 'N', city: 'C', state: 'ST', isPrimary: true }
    });
    await repo.save(order);
    return order;
  }

  function staleSnapshot(order: Order, status: OrderStatus): Order {
    return Order.reconstruct({
      ...order.toJSON(),
      status,
      updatedAt: new Date(Date.now() - 5000)
    });
  }

  it('rejects a stale PENDING_PAYMENT snapshot for a PROCESSING order', async () => {
    const repo = new InMemoryOrderRepository();
    const order = await seedOrder(repo);

    const advanced = Order.reconstruct({ ...order.toJSON(), status: OrderStatus.PROCESSING });
    await repo.update(advanced);
    expect((await repo.findById(order.id))!.status).toBe(OrderStatus.PROCESSING);

    await expect(repo.update(staleSnapshot(order, OrderStatus.PENDING_PAYMENT)))
      .rejects.toThrow(OrderError.INVALID_STATUS_TRANSITION);
    const persisted = await repo.findById(order.id);
    expect(persisted!.status).toBe(OrderStatus.PROCESSING);
  });

  it('rejects a stale PENDING_PAYMENT snapshot for a CANCELLED order', async () => {
    const repo = new InMemoryOrderRepository();
    const order = await seedOrder(repo);

    const terminal = Order.reconstruct({ ...order.toJSON(), status: OrderStatus.CANCELLED });
    await repo.update(terminal);
    expect((await repo.findById(order.id))!.status).toBe(OrderStatus.CANCELLED);

    await expect(repo.update(staleSnapshot(order, OrderStatus.PENDING_PAYMENT)))
      .rejects.toThrow(OrderError.INVALID_STATUS_TRANSITION);
    const persisted = await repo.findById(order.id);
    expect(persisted!.status).toBe(OrderStatus.CANCELLED);
  });

  it('preserves the PAID transition guard', async () => {
    const repo = new InMemoryOrderRepository();
    const order = await seedOrder(repo);

    const advanced = Order.reconstruct({ ...order.toJSON(), status: OrderStatus.PROCESSING });
    await repo.update(advanced);

    // The PAID transition IS guarded: writing a stale PAID object when the
    // persisted row is PROCESSING throws INVALID_STATUS_TRANSITION.
    await expect(repo.update(staleSnapshot(order, OrderStatus.PAID)))
      .rejects.toThrow(OrderError.INVALID_STATUS_TRANSITION);
    expect((await repo.findById(order.id))!.status).toBe(OrderStatus.PROCESSING);
  });
});
