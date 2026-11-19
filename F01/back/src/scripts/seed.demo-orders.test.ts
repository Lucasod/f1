import { describe, expect, it, vi } from 'vitest';
import { runSeed } from './seed';
import { seedDemoOrders, validateDemoOrdersEnvironment, validateDemoDatabase } from './seed.demo-orders';
import { InMemoryPersonRepository } from '../modules/person/person.domain';
import { InMemoryVendorRepository } from '../modules/vendor/vendor.domain';
import { InMemoryCategoryRepository, InMemoryProductRepository } from '../modules/product/product.domain';
import { InMemoryOrderRepository, InMemoryPaymentRepository, OrderStatus, PaymentStatus } from '../modules/order/order.domain';

describe('demo vendor order seed', () => {
  it('rejects environments other than explicitly selected local development or test', () => {
    expect(() => validateDemoOrdersEnvironment({ NODE_ENV: 'production' })).toThrow();
    expect(() => validateDemoOrdersEnvironment({})).toThrow();
    expect(() => validateDemoOrdersEnvironment({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateDemoDatabase('mongodb://localhost:27017', 'fs01_marketplace')).toThrow();
    expect(() => validateDemoDatabase('mongodb://remote:27017', 'fs01_demo_seed')).toThrow();
    expect(() => validateDemoDatabase('mongodb://localhost:27017', 'fs01_demo_seed')).not.toThrow();
    expect(() => validateDemoDatabase('mongodb://mongo:27017', 'fs01_demo_seed')).not.toThrow();
  });

  it('creates isolated, repeatable simulated purchases across existing vendors', async () => {
    const repositories = { personRepo: new InMemoryPersonRepository(), vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository(), productRepo: new InMemoryProductRepository(), orderRepo: new InMemoryOrderRepository(), paymentRepo: new InMemoryPaymentRepository() };
    await runSeed(repositories);
    const saveOrder = repositories.orderRepo.save.bind(repositories.orderRepo);
    vi.spyOn(repositories.orderRepo, 'save').mockImplementation(async order => {
      if (order.status === OrderStatus.PAID && !await repositories.orderRepo.findById(order.id)) throw new Error('INVALID_STATUS_TRANSITION');
      return saveOrder(order);
    });
    await seedDemoOrders(repositories, { NODE_ENV: 'test' });
    await seedDemoOrders(repositories, { NODE_ENV: 'test' });
    const orders = await repositories.orderRepo.findAll();
    expect(orders).toHaveLength(6);
    const vendors = await Promise.all(['tech-store', 'fashion-hub', 'book-world'].map(slug => repositories.vendorRepo.findBySlug(slug)));
    for (const vendor of vendors) {
      const sales = orders.filter(order => order.vendorGroups[0].vendorId === vendor!.id);
      expect(sales).toHaveLength(2);
      expect(sales.every(order => order.personId !== vendor!.personId)).toBe(true);
      expect(sales.map(order => order.status).sort()).toEqual([OrderStatus.PAID, OrderStatus.PENDING_PAYMENT].sort());
      const paid = sales.find(order => order.status === OrderStatus.PAID)!;
      const payments = await repositories.paymentRepo.findByOrderId(paid.id);
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ status: PaymentStatus.CAPTURED, provider: 'simulated_seed' });
    }
    const paid = orders.find(order => order.status === OrderStatus.PAID)!;
    const captured = (await repositories.paymentRepo.findByOrderId(paid.id))[0];
    paid.status = OrderStatus.PENDING_PAYMENT;
    await repositories.orderRepo.update(paid);
    captured.status = PaymentStatus.FAILED;
    await repositories.paymentRepo.update(captured);
    await expect(seedDemoOrders(repositories, { NODE_ENV: 'test' })).rejects.toThrow('DEMO_SEED_ID_CONFLICT');
    expect((await repositories.orderRepo.findById(paid.id))?.status).toBe(OrderStatus.PENDING_PAYMENT);
    captured.status = PaymentStatus.CAPTURED;
    await repositories.paymentRepo.update(captured);
    await seedDemoOrders(repositories, { NODE_ENV: 'test' });
    expect((await repositories.orderRepo.findById(paid.id))?.status).toBe(OrderStatus.PAID);
    const changed = orders.find(order => order.status === OrderStatus.PENDING_PAYMENT)!;
    changed.transitionTo(OrderStatus.CANCELLED);
    await repositories.orderRepo.update(changed);
    await seedDemoOrders(repositories, { NODE_ENV: 'test' });
    expect((await repositories.orderRepo.findById(changed.id))?.status).toBe(OrderStatus.CANCELLED);
  });
});
