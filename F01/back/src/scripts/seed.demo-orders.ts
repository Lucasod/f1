import { Order, OrderRepository, OrderStatus, Payment, PaymentRepository, PaymentStatus } from '../modules/order/order.domain.js';
import { PersonRepository } from '../modules/person/person.domain.js';
import { VendorRepository } from '../modules/vendor/vendor.domain.js';
import { ProductRepository } from '../modules/product/product.domain.js';

type DemoRepositories = {
  personRepo: PersonRepository;
  vendorRepo: VendorRepository;
  productRepo: ProductRepository;
  orderRepo: OrderRepository;
  paymentRepo: PaymentRepository;
};

export function validateDemoOrdersEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    throw new Error('DEMO_ORDERS_REQUIRES_NON_PRODUCTION');
  }
}

export function validateDemoDatabase(uri: string, databaseName: string): void {
  let target: URL;
  try { target = new URL(uri); } catch { throw new Error('DEMO_SEED_LOCAL_DATABASE_REQUIRED'); }
  if (target.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', 'mongo'].includes(target.hostname) || databaseName !== 'fs01_demo_seed') {
    throw new Error('DEMO_SEED_LOCAL_DATABASE_REQUIRED');
  }
}

export async function seedDemoOrders(repositories: DemoRepositories, environment: NodeJS.ProcessEnv): Promise<void> {
  validateDemoOrdersEnvironment(environment);
  const slugs = ['tech-store', 'fashion-hub', 'book-world'];
  const vendors = await Promise.all(slugs.map(slug => repositories.vendorRepo.findBySlug(slug)));
  const consumer = await repositories.personRepo.findByEmail('consumer@example.com');
  const products = await repositories.productRepo.findAll();
  if (!consumer || vendors.some(vendor => !vendor)) throw new Error('DEMO_SEED_ACCOUNTS_MISSING');

  const plans = [];
  for (let index = 0; index < vendors.length; index++) {
    const vendor = vendors[index]!;
    const otherVendor = vendors[(index + 1) % vendors.length]!;
    const otherBuyer = await repositories.personRepo.findById(otherVendor.personId);
    const product = products.find(item => item.vendorId === vendor.id && item.status === 'active');
    if (!otherBuyer || !product || !consumer.addresses[0] || !otherBuyer.addresses[0]) throw new Error('DEMO_SEED_PREREQUISITES_MISSING');
    for (const [kind, buyer] of [['pending', consumer], ['paid', otherBuyer]] as const) {
      const orderId = `SIMULADO-${vendor.slug}-${kind}`;
      const paymentId = `SIMULADO-payment-${vendor.slug}-${kind}`;
      const existing = await repositories.orderRepo.findById(orderId);
      const payment = await repositories.paymentRepo.findById(paymentId);
      if ((existing && (existing.attemptId !== orderId || existing.personId !== buyer.id || existing.vendorGroups.length !== 1 || existing.vendorGroups[0].vendorId !== vendor.id)) ||
          (payment && (!existing || payment.orderId !== orderId || payment.personId !== buyer.id || payment.provider !== 'simulated_seed' || payment.status !== PaymentStatus.CAPTURED || payment.amount !== existing.totalAmount)) ||
          (existing && kind === 'paid' && !payment && ![OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(existing.status))) {
        throw new Error('DEMO_SEED_ID_CONFLICT');
      }
      plans.push({ vendor, buyer, product, kind, orderId, paymentId, existing, payment });
    }
  }

  for (const plan of plans) {
    let order = plan.existing;
    if (!order) {
      const address = plan.buyer.addresses[0];
      const draft = Order.create({ personId: plan.buyer.id, attemptId: plan.orderId, shippingAddress: { ...address, isPrimary: address.isPrimary ?? false }, vendorGroups: [{ vendorId: plan.vendor.id, commissionPct: plan.vendor.commissionPct, items: [{ productId: plan.product.id, productName: plan.product.name, vendorId: plan.vendor.id, quantity: 1, unitPrice: plan.product.price }] }] });
      const data = draft.toJSON();
      order = Order.reconstruct({ ...data, id: plan.orderId, vendorGroups: data.vendorGroups.map(group => ({ ...group, orderId: plan.orderId })) });
      await repositories.orderRepo.save(order);
    }
    if (!plan.payment && plan.kind === 'paid') {
      const payment = Payment.create({ orderId: order.id, personId: order.personId, amount: order.totalAmount, provider: 'simulated_seed' });
      payment.authorize(`SIMULADO-${plan.vendor.slug}`);
      payment.capture();
      await repositories.paymentRepo.save(Payment.reconstruct({ ...payment.toJSON(), id: plan.paymentId }));
    }
    if (plan.kind === 'paid' && order.status === OrderStatus.PENDING_PAYMENT) {
      order.transitionTo(OrderStatus.PAID);
      await repositories.orderRepo.update(order);
    }
  }
}
