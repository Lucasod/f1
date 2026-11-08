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

export const PENDING_ORDER_ADDRESS_CONFLICT = 'PENDING_ORDER_ADDRESS_CONFLICT';

export interface CouponTarget {
  inclusionCategories: string[]; // category IDs to include (descendants included)
  exclusionCategories: string[]; // category IDs to exclude (descendants excluded)
}

export interface CheckoutPreviewResponse {
  vendorGroups: CheckoutPreviewVendorGroup[];
  totalAmount: number;
  discountAmount: number;
}

/**
 * Maps coupon codes to their target categories for inclusion/exclusion rules.
 * In a production system, this would be stored in a database or config file.
 */
export const couponTargets: Record<string, CouponTarget> = {};

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
  private categoryRepo;
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
    paymentProvider: CheckoutPaymentProvider,
    categoryRepo?: import('../product/product.domain').CategoryRepository
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
    this.categoryRepo = categoryRepo;
  }

  /**
   * Get all descendant category IDs (including the category itself) for a given category.
   * Categories form a parent-child hierarchy where descendants include all children, grandchildren, etc.
   */
  private getDescendantCategories(categoryId: string, allCategories: Map<string, string>): Set<string> {
    const descendants = new Set<string>();
    const visit = (catId: string) => {
      descendants.add(catId);
      // Find children of this category
      for (const [childId, parentId] of allCategories.entries()) {
        if (parentId === catId) {
          visit(childId);
        }
      }
    };
    visit(categoryId);
    return descendants;
  }

  /**
   * Check if a product is eligible for a coupon based on inclusion/exclusion rules.
   * - A product matches inclusion if its category (or any ancestor) is in the inclusion list
   * - A product is excluded if its category (or any ancestor) is in the exclusion list
   * - Exclusions override inclusions
   */
  private isProductEligibleForCoupon(
    productCategoryId: string,
    inclusionCategories: Set<string>,
    exclusionCategories: Set<string>,
    allCategories: Map<string, string | null>
  ): boolean {
    // Get all ancestors of the product's category (including itself)
    const ancestors: Set<string> = new Set();
    let current: string | null = productCategoryId;
    while (current !== null) {
      ancestors.add(current);
      // Find parent of current category
      const parentId = allCategories.get(current);
      if (parentId) {
        current = parentId;
      } else {
        current = null;
      }
    }

    // Check exclusions first: if any ancestor is in exclusion list, product is excluded
    for (const ancestor of ancestors) {
      if (exclusionCategories.has(ancestor)) {
        return false;
      }
    }

    // Check inclusions: product is eligible if any ancestor is in inclusion list
    // If inclusion list is empty, all products are eligible (no filtering)
    if (inclusionCategories.size === 0) {
      return true;
    }

    for (const ancestor of ancestors) {
      if (inclusionCategories.has(ancestor)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all product category IDs that are eligible for a coupon based on inclusion/exclusion rules.
   * Returns a set of category IDs that match the coupon's targeting rules.
   */
  private getEligibleCategoriesForCoupon(
    productCategories: string[],
    coupon: CouponTarget,
    allCategories: Map<string, string>
  ): Set<string> {
    const eligible = new Set<string>();
    const inclusionCategories = new Set(coupon.inclusionCategories);
    const exclusionCategories = new Set(coupon.exclusionCategories);

    for (const catId of productCategories) {
      const descendants = this.getDescendantCategories(catId, allCategories);
      for (const descId of descendants) {
        if (this.isProductEligibleForCoupon(descId, inclusionCategories, exclusionCategories, allCategories)) {
          eligible.add(descId);
        }
      }
    }

    return eligible;
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

    // Reuse existing unpaid order for the same cart instead of creating a duplicate
    const cartSignature = cart.items
      .map(i => `${i.productId}:${i.quantity}`)
      .sort()
      .join('|');

    const existingOrders = await this.orderRepo.findByPersonId(consumerId);
    const matchingOrders = existingOrders.filter(existing => {
      if (existing.personId !== consumerId || existing.status !== OrderStatus.PENDING_PAYMENT) return false;
      const existingSignature = existing.vendorGroups
        .flatMap(vg => vg.items)
        .map(i => `${i.productId}:${i.quantity}`)
        .sort()
        .join('|');
      return existingSignature === cartSignature;
    });

    const addressFields = ['id', 'street', 'number', 'neighborhood', 'city', 'state'] as const;
    if (matchingOrders.some(existing => addressFields.some(field =>
      typeof existing.shippingAddress?.[field] !== 'string' ||
      typeof shippingAddress[field] !== 'string' ||
      (field !== 'neighborhood' && existing.shippingAddress[field].trim().length === 0) ||
      existing.shippingAddress[field] !== shippingAddress[field]
    ))) {
      throw new Error(PENDING_ORDER_ADDRESS_CONFLICT);
    }

    for (const existing of matchingOrders) {
      const payments = await this.paymentRepo.findByOrderId(existing.id);
      const existingPayment = payments[0] || Payment.create({
        orderId: existing.id,
        personId: consumerId,
        amount: existing.totalAmount,
        provider: 'stripe'
      });
      if (!payments[0]) {
        await this.paymentRepo.save(existingPayment);
      }

      const session = await this.paymentProvider.createSession(existing, existingPayment);
      existingPayment.providerTransactionId = session.id;
      await this.paymentRepo.update(existingPayment);

      return {
        order: existing,
        checkoutUrl: session.url
      };
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

    // Build category parent map from category repository for coupon targeting
    // Map: categoryId -> parent categoryId (null for root categories)
    const categoryParentMap = new Map<string, string | null>();
    if (this.categoryRepo) {
      const allCategories = await this.categoryRepo.findAll();
      for (const cat of allCategories) {
        categoryParentMap.set(cat.id, cat.parentId);
      }
    }

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

    // Fill vendor names and calculate base amounts
    for (const vg of previewVendorGroups) {
      const vendor = await this.vendorRepo.findById(vg.id);
      if (vendor) {
        vg.vendorName = vendor.storeName;
      }
      vg.commissionAmount = vg.subtotal * (vg.commissionPct / 100);
      vg.vendorNet = vg.subtotal - vg.commissionAmount;
    }

    // Apply coupon discounts if coupon codes are provided
    let discountAmount = 0;
    const applicableCouponsByVendor = new Map<string, string>(); // vendorId -> selected coupon code

    if (couponCodes && couponCodes.length > 0 && this.categoryRepo) {
      // For each vendor group, determine eligible coupons
      for (const vg of previewVendorGroups) {
        let eligibleCouponCodes: string[] = [];

        for (const code of couponCodes) {
          const target = couponTargets[code];
          if (!target) continue; // Unknown coupon code, skip

          // Check if any product in this vendor group is eligible for this coupon
          let anyProductEligible = false;

          for (const item of vg.items) {
            const product = await this.productRepo.findById(item.productId);
            if (!product) continue;

            // Check inclusion/exclusion rules using category hierarchy
            const eligible = this.isProductEligibleForCoupon(
              product.categoryId,
              new Set(target.inclusionCategories),
              new Set(target.exclusionCategories),
              categoryParentMap
            );

            if (eligible) {
              anyProductEligible = true;
              break;
            }
          }

          if (anyProductEligible) {
            // Only add first eligible coupon (no stacking per vendor)
            if (eligibleCouponCodes.length === 0) {
              eligibleCouponCodes.push(code);
            }
          }
        }

        // Apply the first eligible coupon (consumer selects per vendor, no automatic priority)
        if (eligibleCouponCodes.length > 0) {
          const selectedCouponCode = eligibleCouponCodes[0];
          const target = couponTargets[selectedCouponCode];
          
          // Calculate discount: proportion of eligible items' subtotal
          // For simplicity, apply discount to the full vendor subtotal proportionally
          // based on which items are eligible
          let eligibleSubtotal = 0;
          let totalEligibleItems = 0;
          
          for (const item of vg.items) {
            const product = await this.productRepo.findById(item.productId);
            if (!product) continue;
            
            const isEligible = this.isProductEligibleForCoupon(
              product.categoryId,
              new Set(target.inclusionCategories),
              new Set(target.exclusionCategories),
              categoryParentMap
            );
            
            if (isEligible) {
              eligibleSubtotal += item.unitPrice * item.quantity;
              totalEligibleItems++;
            }
          }
          
          // Apply percentage discount to eligible portion of subtotal
          // Default 10% discount if no specific discount defined for the coupon
          const discountPct = 10; // Default discount percentage
          const discount = eligibleSubtotal * (discountPct / 100);
          
          vg.subtotal -= discount;
          vg.vendorNet -= discount;
          discountAmount += discount;
          
          // Track which coupon applies to which vendor (no stacking)
          applicableCouponsByVendor.set(vg.id, selectedCouponCode);
        }
      }
    }

    const totalAmount = previewVendorGroups.reduce((sum, vg) => sum + vg.subtotal, 0);

    return {
      vendorGroups: previewVendorGroups,
      totalAmount,
      discountAmount
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
