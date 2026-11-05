import {
  Order,
  OrderVendorGroup,
  OrderItem,
  OrderStatus,
  OrderVendorGroupStatus,
  FinancialStatus,
  Payment,
  PaymentStatus,
  OrderError,
  OrderRepository,
  PaymentRepository
} from '../order/order.domain';
import { CartRepository, Cart, CartItem } from '../cart/cart.domain';
import { ProductRepository } from '../product/product.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { PersonRepository } from '../person/person.domain';
import { CartService } from '../cart/cart.service';
import { config } from '../../config';
import { CheckoutPaymentProvider } from './stripe-checkout.provider';

export interface CheckoutPreviewResponse {
  vendorGroups: CheckoutPreviewVendorGroup[];
  totalAmount: number;
}

export interface CheckoutPreviewVendorGroup {
  id: string;
  vendorName: string;
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  items: CheckoutPreviewItem[];
}

export interface CheckoutPreviewItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export class CheckoutService {
  private readonly orderRepo: OrderRepository;
  private readonly paymentRepo: PaymentRepository;
  private readonly cartRepo: CartRepository;
  private readonly productRepo: ProductRepository;
  private readonly vendorRepo: VendorRepository;
  private readonly personRepo: PersonRepository;
  private readonly cartService: CartService;
  private readonly config: typeof import('../../config').config;
  private readonly paymentProvider: CheckoutPaymentProvider;

  constructor(
    orderRepo: OrderRepository,
    paymentRepo: PaymentRepository,
    cartRepo: CartRepository,
    productRepo: ProductRepository,
    vendorRepo: VendorRepository,
    personRepo: PersonRepository,
    cartService: CartService,
    config: typeof import('../../config').config,
    paymentProvider: CheckoutPaymentProvider
  ) {
    this.orderRepo = orderRepo;
    this.paymentRepo = paymentRepo;
    this.cartRepo = cartRepo;
    this.productRepo = productRepo;
    this.vendorRepo = vendorRepo;
    this.personRepo = personRepo;
    this.cartService = cartService;
    this.config = config;
    this.paymentProvider = paymentProvider;
  }

  async checkout(consumerId: string, shippingAddressId: string, couponCodes?: string[]): Promise<{ order: Order; checkoutUrl: string }> {
    // Get cart
    const cart = await this.cartRepo.findById(consumerId);
    if (!cart || cart.isEmpty) {
      throw new Error(OrderError.CART_EMPTY);
    }

    // Get person
    const person = await this.personRepo.findById(consumerId);
    if (!person) {
      throw new Error(OrderError.PERSON_ID_REQUIRED);
    }

    // Find shipping address by ID
    const shippingAddress = person.addresses.find(addr => addr.id === shippingAddressId);
    if (!shippingAddress) {
      throw new Error(OrderError.INVALID_SHIPPING_ADDRESS);
    }

    // Validate and prepare vendor groups
    const vendorGroupsData = await this.prepareVendorGroups(cart);

    // Compensation state declared before try
    const decremented: { productId: string; amount: number }[] = [];
    let orderSaved = false;
    let paymentSaved = false;
    let savedOrder: Order | null = null;
    let savedPayment: Payment | null = null;
    let checkoutSessionId: string | null = null;
    let stockRestored = false;

    const compensateStock = async () => {
      if (stockRestored || decremented.length === 0) {
        return;
      }
      stockRestored = true;
      const failures: string[] = [];
      for (const entry of decremented) {
        try {
          await this.productRepo.incrementStock(entry.productId, entry.amount);
        } catch (restoreError) {
          failures.push(entry.productId);
          console.error('Stock rollback failed for product', entry.productId, restoreError);
        }
      }
      if (failures.length > 0) {
        throw new Error(`${OrderError.STOCK_ROLLBACK_FAILED}: ${failures.join(',')}`);
      }
    };

    const compensateRecords = async () => {
      if (paymentSaved && savedPayment) {
        try {
          await this.paymentRepo.delete(savedPayment.id);
        } catch (deleteError) {
          console.error('Payment compensation failed', deleteError);
        }
      }
      if (orderSaved && savedOrder) {
        try {
          await this.orderRepo.delete(savedOrder.id);
        } catch (deleteError) {
          console.error('Order compensation failed', deleteError);
        }
      }
    };

    try {
      await this.decrementStock(cart, decremented);

      // Create order
      const order = Order.create({
        personId: consumerId,
        vendorGroups: vendorGroupsData,
        shippingAddress: {
          id: shippingAddress.id,
          street: shippingAddress.street,
          number: shippingAddress.number,
          neighborhood: shippingAddress.neighborhood,
          city: shippingAddress.city,
          state: shippingAddress.state,
          isPrimary: shippingAddress.isPrimary || false
        }
      });

      // Create payment
      const payment = Payment.create({
        orderId: order.id,
        personId: consumerId,
        amount: order.totalAmount,
        provider: 'stripe'
      });

      // Save order and payment
      await this.orderRepo.save(order);
      orderSaved = true;
      savedOrder = order;

      await this.paymentRepo.save(payment);
      paymentSaved = true;
      savedPayment = payment;

      const session = await this.paymentProvider.createSession(order, payment);
      checkoutSessionId = session.id;
      payment.providerTransactionId = session.id;
      await this.paymentRepo.update(payment);

      return {
        order,
        checkoutUrl: session.url
      };
    } catch (error) {
      if (checkoutSessionId && this.paymentProvider.expireSession) {
        try {
          await this.paymentProvider.expireSession(checkoutSessionId);
        } catch (expireError) {
          console.error('Stripe Checkout session cleanup failed', expireError);
        }
      }
      await compensateRecords();
      try {
        await compensateStock();
      } catch (compensationError) {
        throw new Error(OrderError.STOCK_ROLLBACK_FAILED, { cause: compensationError });
      }
      throw error;
    }
  }

  async previewCheckout(consumerId: string, couponCodes?: string[]): Promise<CheckoutPreviewResponse> {
    // Get cart
    const cart = await this.cartRepo.findById(consumerId);
    if (!cart || cart.isEmpty) {
      throw new Error(OrderError.CART_EMPTY);
    }

    // Get person
    const person = await this.personRepo.findById(consumerId);
    if (!person) {
      throw new Error(OrderError.PERSON_ID_REQUIRED);
    }

    // Validate and prepare vendor groups for preview
    const vendorGroupsData = await this.prepareVendorGroups(cart);

    // Build preview response
    const previewVendorGroups: CheckoutPreviewVendorGroup[] = vendorGroupsData.map(vg => ({
      id: vg.vendorId,
      vendorName: '', // Will be filled below
      subtotal: vg.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      commissionPct: vg.commissionPct,
      commissionAmount: 0, // Will be calculated
      vendorNet: 0, // Will be calculated
      items: vg.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.unitPrice * item.quantity
      }))
    }));

    // Fill vendor names and calculate amounts
    for (const vg of previewVendorGroups) {
      const vendor = await this.vendorRepo.findById(vg.id);
      if (vendor) {
        vg.vendorName = vendor.storeName;
      }
      vg.commissionAmount = vg.subtotal * (vg.commissionPct / 100);
      vg.vendorNet = vg.subtotal - vg.commissionAmount;
    }

    const totalAmount = previewVendorGroups.reduce((sum, vg) => sum + vg.subtotal, 0);

    return {
      vendorGroups: previewVendorGroups,
      totalAmount
    };
  }

  private async decrementStock(cart: Cart, decremented: { productId: string; amount: number }[]): Promise<void> {
    const aggregated = new Map<string, number>();
    for (const item of cart.items) {
      aggregated.set(item.productId, (aggregated.get(item.productId) || 0) + item.quantity);
    }

    for (const [productId, amount] of aggregated) {
      const ok = await this.productRepo.decrementStock(productId, amount);
      if (!ok) {
        throw new Error(OrderError.INSUFFICIENT_STOCK);
      }
      decremented.push({ productId, amount });
    }
  }

  private async prepareVendorGroups(cart: Cart): Promise<{
    vendorId: string;
    items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number }[];
    commissionPct: number;
  }[]> {
    // Group cart items by vendorId
    const itemsByVendor = new Map<string, typeof cart.items>();

    const aggregateByProduct = new Map<string, number>();
    for (const ci of cart.items) {
      aggregateByProduct.set(ci.productId, (aggregateByProduct.get(ci.productId) || 0) + ci.quantity);
    }

    for (const cartItem of cart.items) {
      // Get product
      const product = await this.productRepo.findById(cartItem.productId);
      if (!product) {
        throw new Error(OrderError.PRODUCT_NOT_FOUND);
      }

      // Validate aggregate stock
      const totalQuantity = aggregateByProduct.get(cartItem.productId) || cartItem.quantity;
      if (product.quantity < totalQuantity) {
        throw new Error(OrderError.INSUFFICIENT_STOCK);
      }

      // Get vendor
      const vendor = await this.vendorRepo.findById(cartItem.vendorId);
      if (!vendor) {
        throw new Error(OrderError.VENDOR_NOT_FOUND);
      }

      // Group by vendor
      const existingItems = itemsByVendor.get(cartItem.vendorId) || [];
      existingItems.push(cartItem);
      itemsByVendor.set(cartItem.vendorId, existingItems);
    }

    // Build vendor groups data
    const vendorGroupsData: {
      vendorId: string;
      items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number }[];
      commissionPct: number;
    }[] = [];

    for (const [vendorId, items] of itemsByVendor.entries()) {
      const vendor = await this.vendorRepo.findById(vendorId);
      if (!vendor) {
        throw new Error(OrderError.VENDOR_NOT_FOUND);
      }

      vendorGroupsData.push({
        vendorId,
        items: items.map((item: CartItem) => ({
          productId: item.productId,
          productName: '', // Will be filled with product name
          vendorId: item.vendorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        })),
        commissionPct: vendor.commissionPct
      });
    }

    // Fill product names
    for (const vg of vendorGroupsData) {
      for (const item of vg.items) {
        const product = await this.productRepo.findById(item.productId);
        if (product) {
          item.productName = product.name;
        }
      }
    }

    return vendorGroupsData;
  }
}
