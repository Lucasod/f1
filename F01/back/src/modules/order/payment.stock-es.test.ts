import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, PaymentError } from './payment.service';
import { Payment, PaymentStatus, InMemoryPaymentRepository, Order, OrderStatus, OrderError, FinancialStatus, InMemoryOrderRepository } from './order.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { Product, InMemoryProductRepository } from '../product/product.domain';
import { config } from '../../config';

describe('Payment stock Elasticsearch sync (CR002)', () => {
  let paymentRepo: InMemoryPaymentRepository;
  let orderRepo: InMemoryOrderRepository;
  let personRepo: InMemoryPersonRepository;
  let productRepo: InMemoryProductRepository;
  let paymentService: PaymentService;
  let searchIndex: { indexProduct: ReturnType<typeof vi.fn> };

  let testPerson: Person;
  let testOrder: Order;

  beforeEach(async () => {
    paymentRepo = new InMemoryPaymentRepository();
    orderRepo = new InMemoryOrderRepository();
    personRepo = new InMemoryPersonRepository();
    productRepo = new InMemoryProductRepository();
    searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    testPerson = Person.create({
      name: 'Test Consumer',
      mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
      contactInfos: [{ type: 'email', value: 'consumer@test.com', isPrimary: true }],
      addresses: []
    });
    testPerson.addRole(PersonRole.CONSUMER);
    await personRepo.save(testPerson);

    testOrder = Order.create({
      personId: testPerson.id,
      vendorGroups: [{
        vendorId: 'vendor-1',
        items: [{ productId: 'product-1', productName: 'Test Product', vendorId: 'vendor-1', quantity: 2, unitPrice: 50 }],
        commissionPct: config.commissionPct
      }],
      shippingAddress: { id: 'addr-1', street: 'Test Street', number: '123', neighborhood: 'TN', city: 'TC', state: 'TS', isPrimary: true }
    });
    await orderRepo.save(testOrder);

    const product = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'Test Product', description: 'desc', price: 50, quantity: 8 });
    product.id = 'product-1';
    await productRepo.save(product);

    paymentService = new PaymentService(paymentRepo, orderRepo, productRepo, undefined, undefined, undefined, searchIndex as any);
  });

  it('indexes product after successful incrementStock on failPayment', async () => {
    const payment = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
    await paymentService.failPayment(payment.id);

    expect(searchIndex.indexProduct).toHaveBeenCalled();
    const calledProduct = searchIndex.indexProduct.mock.calls[0][0];
    expect(calledProduct.id).toBe('product-1');
    expect(calledProduct.quantity).toBe(10);
  });

  it('does not fail failPayment when ES indexing fails', async () => {
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const payment = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

    const result = await paymentService.failPayment(payment.id);

    expect(result.status).toBe('failed');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
