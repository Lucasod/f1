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
import { ElasticsearchProductIndex } from '../search/elasticsearch-product-index';
import { VendorRepository } from '../vendor/vendor.domain';
import { PersonRepository, PersonRole } from '../person/person.domain';
import { CartService } from '../cart/cart.service';
import { config } from '../../config';
import { CheckoutPaymentProvider } from './stripe-checkout.provider';
import { StripeService, StripeCustomerResult, createStripeService } from '../stripe/stripe.service';
import { CouponService } from '../coupon/coupon.service';
import { CouponSelection, CouponTerms, CouponError, priceToMinor, safeMinor, sumMinor } from '../coupon/coupon.domain';
import { allocateMinorDiscount } from './coupon-allocation';
import { AcceptedSnapshotV1, AttemptError, CheckoutAttempt, CheckoutAttemptRepository, attemptIdentity, snapshotHash } from './checkout-attempt';

export const PENDING_ORDER_ADDRESS_CONFLICT = 'PENDING_ORDER_ADDRESS_CONFLICT';

export interface CheckoutPreviewResponse {
  vendorGroups: CheckoutPreviewVendorGroup[];
  totalAmount: number;
  discountAmount: number;
  currency?: 'BRL';
  calculationVersion?: 'coupon-quote-v1';
  purchasable?: boolean;
  grossMinor?: number;
  eligibleMinor?: number;
  discountMinor?: number;
  netMinor?: number;
}

export interface CheckoutPreviewVendorGroup {
  coupon?: CouponTerms;
  grossMinor?: number;
  eligibleMinor?: number;
  discountMinor?: number;
  netMinor?: number;
  id: string;
  vendorName: string;
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  items: CheckoutPreviewItem[];
}

export interface CheckoutPreviewItem {
  grossMinor?: number;
  eligibleMinor?: number;
  discountMinor?: number;
  netMinor?: number;
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
  private readonly searchIndex?: ElasticsearchProductIndex;
  private readonly stripeService: StripeService;

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
    categoryRepo?: import('../product/product.domain').CategoryRepository,
    searchIndex?: ElasticsearchProductIndex,
    private readonly coupons?: CouponService,
    private readonly attempts?: CheckoutAttemptRepository,
    stripeService?: StripeService
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
    this.searchIndex = searchIndex;
    this.stripeService = stripeService ?? createStripeService();
  }

  async checkout(consumerId: string, shippingAddressId: string, couponCodes?: string[]): Promise<{ order: Order; checkoutUrl: string }> {
    if (couponCodes?.length && !this.coupons) throw new CouponError('COUPONS_UNAVAILABLE', 503);
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

    // A stale or directly constructed cart must not bypass own-store purchase denial.
    for (const item of cart.items) {
      const product = await this.productRepo.findById(item.productId);
      if (!product) throw new Error(OrderError.PRODUCT_NOT_FOUND);
      const vendor = await this.vendorRepo.findById(product.vendorId);
      if (!vendor) throw new Error(OrderError.VENDOR_NOT_FOUND);
      if (vendor.personId === consumerId) throw new CouponError('SELF_PURCHASE_FORBIDDEN', 403);
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

      const session = await this.createCheckoutSessionWithCustomer(existing, existingPayment, consumerId);
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
          if (this.searchIndex) {
            try {
              const product = await this.productRepo.findById(entry.productId);
              if (product) {
                await this.searchIndex.indexProduct(product);
              }
            } catch (indexError) {
              console.warn('Elasticsearch product indexing failed');
            }
          }
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

      const session = await this.createCheckoutSessionWithCustomer(order, payment, consumerId);
      checkoutSessionId = session.id;
      payment.providerTransactionId = session.id;
      payment.checkoutUrl = session.url;
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

  async previewCheckout(consumerId: string, couponCodes?: string[], selections: CouponSelection[] = []): Promise<CheckoutPreviewResponse> {
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

    return this.quoteCart(consumerId, cart, couponCodes, selections);
  }

  private async quoteCart(consumerId: string, cart: Cart, couponCodes?: string[], selections: CouponSelection[] = [], acceptance = false): Promise<CheckoutPreviewResponse> {
    const hasCoupons = !!couponCodes?.length || selections.length > 0;
    if (hasCoupons && !this.coupons) throw new CouponError('COUPONS_UNAVAILABLE', 503);
    const groups = new Map<string, { vendor: Awaited<ReturnType<VendorRepository['findById']>>; lines: { productId: string; productName: string; categoryId: string; quantity: number; unitPrice: number; grossMinor: number }[] }>();
    // Coupon quotes use catalogue prices; normal previews retain the cart price
    // used by the existing purchase flow. Product identity/stock remain current.
    const quantities = new Map<string, number>();
    for (const item of cart.items) quantities.set(item.productId, safeMinor((quantities.get(item.productId) ?? 0) + safeMinor(item.quantity)));
    for (const [productId, quantity] of quantities) {
      if (!quantity) throw new CouponError('INVALID_MONEY');
      const product = await this.productRepo.findById(productId);
      if (!product) throw new Error(OrderError.PRODUCT_NOT_FOUND);
      if (acceptance && product.status !== 'active') throw new AttemptError('PRODUCT_NOT_AVAILABLE', 409);
      if (cart.items.some(item => item.productId === productId && item.vendorId !== product.vendorId)) throw new Error(OrderError.VENDOR_NOT_FOUND);
      if (product.quantity < quantity) throw new Error(OrderError.INSUFFICIENT_STOCK);
      const vendor = await this.vendorRepo.findById(product.vendorId);
      if (!vendor) throw new Error(OrderError.VENDOR_NOT_FOUND);
      if (acceptance && vendor.status !== 'active') throw new AttemptError('VENDOR_NOT_AVAILABLE', 409);
      if (vendor.personId === consumerId) throw new CouponError('SELF_PURCHASE_FORBIDDEN', 403);
      const group = groups.get(vendor.id) ?? { vendor, lines: [] };
      const catalogUnitMinor = priceToMinor(product.price);
      const unitMinor = hasCoupons ? catalogUnitMinor : priceToMinor(cart.items.find(item => item.productId === productId)!.unitPrice);
      group.lines.push({ productId, productName: product.name, categoryId: product.categoryId, quantity, unitPrice: unitMinor / 100, grossMinor: safeMinor(unitMinor * quantity) });
      groups.set(vendor.id, group);
    }
    const chosen = hasCoupons ? await this.coupons!.resolve([...groups.keys()], couponCodes, selections) : new Map<string, CouponTerms>();
    const hierarchy = hasCoupons ? await this.coupons!.hierarchy() : new Map<string, string | null>();
    const vendorGroups: CheckoutPreviewVendorGroup[] = [];
    for (const [vendorId, group] of groups) {
      const terms = chosen.get(vendorId);
      const eligible = group.lines.map(line => terms && this.coupons!.eligible(terms, line.productId, line.categoryId, hierarchy) ? line.grossMinor : 0);
      const eligibleMinor = sumMinor(eligible);
      if (terms && (!eligibleMinor || eligibleMinor < (terms.minimumEligibleMinor ?? 0))) throw new CouponError('COUPON_MINIMUM_NOT_MET');
      const discountMinor = !terms ? 0 : terms.discountType === 'fixedMinorBRL' ? Math.min(terms.value, eligibleMinor) : safeMinor(Number((BigInt(eligibleMinor) * BigInt(terms.value) + 5000n) / 10000n));
      const allocated = allocateMinorDiscount(discountMinor, group.lines.map((line, i) => ({ key: JSON.stringify([vendorId, line.productId]), weight: eligible[i] })));
      const grossMinor = sumMinor(group.lines.map(l => l.grossMinor));
      const netMinor = grossMinor - discountMinor;
      const commissionPct = acceptance ? this.config.commissionPct : group.vendor!.commissionPct;
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) throw new CouponError('INVALID_MONEY');
      const commissionMinor = safeMinor(Number((BigInt(netMinor) * BigInt(Math.round(commissionPct * 100)) + 5000n) / 10000n));
      vendorGroups.push({ id: vendorId, vendorName: group.vendor!.storeName, grossMinor, eligibleMinor, discountMinor, netMinor, ...(terms ? { coupon: terms } : {}), subtotal: netMinor / 100, commissionPct, commissionAmount: commissionMinor / 100, vendorNet: (netMinor - commissionMinor) / 100,
        items: group.lines.map((line, i) => ({ productId: line.productId, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, totalPrice: line.grossMinor / 100, grossMinor: line.grossMinor, eligibleMinor: eligible[i], discountMinor: allocated[i], netMinor: line.grossMinor - allocated[i] })) });
    }
    const grossMinor = sumMinor(vendorGroups.map(g => g.grossMinor!));
    const eligibleMinor = sumMinor(vendorGroups.map(g => g.eligibleMinor!));
    const discountMinor = sumMinor(vendorGroups.map(g => g.discountMinor!));
    const netMinor = grossMinor - discountMinor;
    return { currency: 'BRL', calculationVersion: 'coupon-quote-v1', purchasable: !hasCoupons, grossMinor, eligibleMinor, discountMinor, netMinor, vendorGroups, totalAmount: netMinor / 100, discountAmount: discountMinor / 100 };
  }

  private attemptRepo(): CheckoutAttemptRepository {
    if (!this.attempts) throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
    return this.attempts;
  }

  private extractPersistedCheckoutUrl(payment: any, order: any): string | undefined {
    const candidates = [
      payment?.checkoutUrl,
      payment?.sessionUrl,
      payment?.url,
      payment?.checkoutSessionUrl,
      order?.checkoutUrl,
      order?.sessionUrl,
      order?.url,
      order?.checkoutSessionUrl,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
    return undefined;
  }

  private extractUrlFromProviderResult(result: any): string | undefined {
    if (typeof result === 'string') return result.trim() || undefined;
    if (!result || typeof result !== 'object') return undefined;
    const candidates = [
      result.url,
      result.checkoutUrl,
      result.sessionUrl,
      result.checkoutSessionUrl,
      result?.session?.url,
      result?.session?.checkoutUrl,
      result?.checkoutSession?.url,
      result?.data?.url,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
    return undefined;
  }

  private isMockPaymentProvider(provider: any, payment: any): boolean {
    if (!provider) return false;
    if (provider?.constructor?.name === 'MockCheckoutProvider') return true;
    if (provider?.isMock === true) return true;
    // A provider explicitly marked as mock via its name.
    if (typeof provider?.name === 'string' && /mock/i.test(provider.name)) return true;
    // Fall back to payment.provider label only when no other signal exists and the
    // provider transaction id follows the mock id format.
    if (payment?.provider === 'mock' && typeof payment?.providerTransactionId === 'string' &&
        /^cs_test_/.test(payment.providerTransactionId) && !provider?.constructor?.name?.includes('Stripe')) {
      // Only treat as mock if provider does not expose Stripe-like retrieval.
      if (typeof provider?.getSession !== 'function' && typeof provider?.retrieveSession !== 'function') return true;
    }
    return false;
  }

  async getAttempt(owner: string, id: string): Promise<CheckoutAttempt> {
    const attempt = await this.attemptRepo().find(owner, id);
    if (!attempt) throw new AttemptError('ATTEMPT_NOT_FOUND', 404);
    return attempt;
  }

  private async acceptanceSnapshot(owner: string, input: CheckoutAttempt['input']): Promise<AcceptedSnapshotV1> {
    const person = await this.personRepo.findById(owner);
    if (!person || person.roles.includes(PersonRole.ADMIN)) throw new AttemptError('FORBIDDEN', 403);
    const address = person.addresses.find(a => a.id === input.shippingAddressId);
    if (!address) throw new AttemptError('INVALID_SHIPPING_ADDRESS', 404);
    const delivery = { id: address.id, street: address.street, number: address.number, neighborhood: address.neighborhood, city: address.city, state: address.state };
    for (const [key, value] of Object.entries(delivery)) if (typeof value !== 'string' || (key !== 'neighborhood' && !value.trim())) throw new AttemptError('INVALID_SHIPPING_ADDRESS', 409);
    const cart = await this.cartRepo.findById(owner);
    if (!cart || cart.isEmpty) throw new AttemptError('CART_EMPTY', 409);
    if (!cart.id || !Number.isSafeInteger(cart.version) || cart.version < 1) throw new AttemptError('CART_UNAVAILABLE', 409);
    const pct = this.config.commissionPct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100 || Math.abs(pct * 100 - Math.round(pct * 100)) > 0.000001) throw new AttemptError('INVALID_COMMISSION', 503);
    const quote = await this.quoteCart(owner, cart, undefined, input.selections, true);
    const money = (m: CheckoutPreviewResponse | CheckoutPreviewVendorGroup | CheckoutPreviewItem) => ({ grossMinor: safeMinor(m.grossMinor!), eligibleMinor: safeMinor(m.eligibleMinor!), discountMinor: safeMinor(m.discountMinor!), netMinor: safeMinor(m.netMinor!) });
    const groups = quote.vendorGroups.map(g => ({ ...money(g), vendorId: g.id, vendorName: g.vendorName,
      ...(g.coupon ? { coupon: structuredClone(g.coupon) } : {}), commissionMinor: priceToMinor(g.commissionAmount), vendorNetMinor: priceToMinor(g.vendorNet),
      items: g.items.map(i => ({ ...money(i), key: JSON.stringify([g.id, i.productId]), productId: i.productId, productName: i.productName, unitMinor: priceToMinor(i.unitPrice), quantity: i.quantity })).sort((a, b) => a.key.localeCompare(b.key)),
    })).sort((a, b) => a.vendorId.localeCompare(b.vendorId));
    const fingerprint = snapshotHash(groups.map(g => [g.vendorId, g.items.map(i => [i.productId, i.quantity])]));
    return structuredClone({ schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: owner,
      cart: { id: cart.id, version: cart.version, generation: cart.generation ?? null, fingerprint }, address: delivery,
      selections: input.selections, ...money(quote), groups, commissionBps: Math.round(pct * 100), commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0 });
  }

  async prepareAttempt(owner: string, requestId: string, shippingAddressId: string, selections: CouponSelection[]): Promise<CheckoutAttempt> {
    const id = attemptIdentity(owner, requestId);
    if (!selections.length) throw new AttemptError('COUPON_SELECTION_REQUIRED', 400);
    const input = { shippingAddressId, selections: [...selections].sort((a, b) => a.vendorId.localeCompare(b.vendorId)) };
    const requestFingerprint = snapshotHash(input);
    const existing = await this.attemptRepo().find(owner, id);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new AttemptError('REQUEST_CONFLICT', 409);
      return existing;
    }
    const snapshot = await this.acceptanceSnapshot(owner, input);
    return this.attemptRepo().createOrRead({ id, owner, input, requestFingerprint, state: 'PROPOSED', version: 1, proposedSnapshot: snapshot, proposedHash: snapshotHash(snapshot) });
  }

  async acceptAttempt(owner: string, id: string, version: number, hash: string): Promise<CheckoutAttempt> {
    const current = await this.getAttempt(owner, id);
    if (current.state === 'ACCEPTED') {
      if (hash === current.acceptedHash && (version === current.version || version === current.version - 1)) return current;
      throw new AttemptError('ATTEMPT_CONFLICT', 409);
    }
    if (current.version !== version || current.proposedHash !== hash) throw new AttemptError('ATTEMPT_CONFLICT', 409, current);
    let snapshot: AcceptedSnapshotV1;
    try { snapshot = await this.acceptanceSnapshot(owner, current.input); }
    catch (error) {
      if (error instanceof CouponError || error instanceof AttemptError || (error instanceof Error && Object.values(OrderError).includes(error.message as OrderError))) {
        if (error instanceof AttemptError && error.status === 503) throw error;
        const superseded = await this.attemptRepo().replaceProposal(current, null, error.message);
        throw new AttemptError('QUOTE_CHANGED', 409, superseded);
      }
      throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
    }
    if (snapshotHash(snapshot) !== hash || current.state !== 'PROPOSED') {
      const proposal = await this.attemptRepo().replaceProposal(current, snapshot);
      throw new AttemptError('QUOTE_CHANGED', 409, proposal);
    }
    return this.attemptRepo().acceptIfCurrent(current);
  }

async checkoutFromAcceptedAttempt(owner: string, attemptId: string): Promise<{ order: Order; payment: Payment; checkoutUrl: string }> {
    const attempt = await this.getAttempt(owner, attemptId);
    if (attempt.state !== 'ACCEPTED' || !attempt.acceptedSnapshot) {
      throw new AttemptError('ATTEMPT_NOT_ACCEPTED', 409, attempt);
    }
    const snapshot = attempt.acceptedSnapshot;
    if (!snapshot || !Number.isFinite(snapshot.netMinor) || snapshot.netMinor <= 0) {
      throw new AttemptError('ZERO_TOTAL_NOT_SUPPORTED', 503, attempt);
    }

    // Idempotency: reuse existing order/payment for this attempt if present.
    const existingOrders = await this.orderRepo.findByPersonId(owner);
    const existingOrder = existingOrders.find(o => o.attemptId === attemptId);
    if (existingOrder) {
      const payments = await this.paymentRepo.findByOrderId(existingOrder.id);
      const payment = payments[0] ?? await this.paymentRepo.insertForAttempt({ attemptId: attemptId, orderId: existingOrder.id, personId: owner, amount: existingOrder.totalAmount });
      let checkoutUrl = this.extractPersistedCheckoutUrl(payment, existingOrder);
      if (!checkoutUrl) {
        // Try to retrieve the session URL from the provider when supported.
        const provider = this.paymentProvider as any;
        const sessionId = payment.providerTransactionId;
        if (sessionId) {
          const methodNames = ['getSession', 'getCheckoutUrl', 'retrieveSession', 'getSessionUrl', 'getCheckoutSession', 'fetchSession'];
          for (const name of methodNames) {
            if (typeof provider?.[name] === 'function') {
              try {
                const result = await provider[name](sessionId, existingOrder, payment);
                const url = this.extractUrlFromProviderResult(result);
                if (url) { checkoutUrl = url; break; }
              } catch {
                // Ignore provider retrieval failures and fall through.
              }
            }
          }
        }
      }
      if (!payment.providerTransactionId) {
        const session = await this.createCheckoutSessionWithCustomer(existingOrder, payment, owner);
        payment.providerTransactionId = session.id;
        payment.checkoutUrl = session.url;
        await this.paymentRepo.update(payment);
        checkoutUrl = session.url;
      } else if (!checkoutUrl) {
        // Only reconstruct the mock-provider URL when the provider is actually the mock.
        if (this.isMockPaymentProvider(this.paymentProvider, payment)) {
          checkoutUrl = `https://checkout.stripe.test/mock/${payment.providerTransactionId}`;
        }
      }
      if (!checkoutUrl) {
        throw new Error('CHECKOUT_URL_UNAVAILABLE');
      }
      // Persist the resolved URL on the payment record when possible.
      if (!payment.checkoutUrl) {
        payment.checkoutUrl = checkoutUrl;
        try { await this.paymentRepo.update(payment); } catch { /* ignore */ }
      }
      return { order: existingOrder, payment, checkoutUrl };
    }

    // Build order from accepted snapshot (no re-quoting).
    // Net allocation per accepted item: a=floor(netMinor/quantity),
    // r=netMinor mod quantity. r units carry a+1 (minor) and the
    // remaining units carry a (minor), so Stripe line items sum exactly
    // to the accepted net amount. Zero-count segments are omitted.
    // Segment totalPrice is derived from the integer allocated minor
    // (allocatedMinor / 100), not from float unitPrice * quantity, to
    // avoid cent-level drift. unitPrice stays the rounded major price.
    // Validate accepted snapshot items before segment construction (CR-003).
    const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : null;
    if (groups === null) {
      throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
    }
    if (typeof snapshot?.commissionBps !== 'number' || !Number.isFinite(snapshot.commissionBps) || snapshot.commissionBps < 0 || snapshot.commissionBps > 10000) {
      throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
    }
    for (const g of groups) {
      const items = Array.isArray(g?.items) ? g.items : null;
      if (items === null) {
        throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
      }
      if (!g || typeof g !== 'object' || typeof g.vendorId !== 'string' || g.vendorId.trim().length === 0) {
        throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
      }
      for (const i of items) {
        if (!i || typeof i !== 'object') {
          throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
        }
        if (typeof i.productId !== 'string' || i.productId.trim().length === 0 || typeof i.productName !== 'string' || i.productName.trim().length === 0) {
          throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
        }
        if (!Number.isInteger(i.quantity) || i.quantity < 1) {
          throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
        }
        if (typeof i.netMinor !== 'number' || !Number.isFinite(i.netMinor) || i.netMinor < 0) {
          throw new AttemptError('INVALID_SNAPSHOT_ITEM', 409, attempt);
        }
      }
    }

    const groupAllocatedMinors: number[][] = [];
    const vendorGroupsData = groups.map(g => {
      const items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number }[] = [];
      const allocated: number[] = [];
      for (const i of g.items) {
        const quantity = i.quantity;
        const netMinor = i.netMinor;
        const a = Math.floor(netMinor / quantity);
        const r = netMinor % quantity;
        // Remainder (extra minor) first, matching the repo's "first gets extra" convention.
        if (r > 0) {
          items.push({
            productId: i.productId,
            productName: i.productName,
            vendorId: g.vendorId,
            quantity: r,
            unitPrice: (a + 1) / 100,
          });
          allocated.push((a + 1) * r);
        }
        const baseQuantity = quantity - r;
        if (baseQuantity > 0) {
          items.push({
            productId: i.productId,
            productName: i.productName,
            vendorId: g.vendorId,
            quantity: baseQuantity,
            unitPrice: a / 100,
          });
          allocated.push(a * baseQuantity);
        }
      }
      groupAllocatedMinors.push(allocated);
      return {
        vendorId: g.vendorId,
        items,
        commissionPct: snapshot.commissionBps / 100,
        subtotal: 0,
        commissionAmount: 0,
        vendorNet: 0,
      };
    });

    const order = Order.create({
      personId: owner,
      vendorGroups: vendorGroupsData,
      shippingAddress: {
        id: snapshot.address.id,
        street: snapshot.address.street,
        number: snapshot.address.number,
        neighborhood: snapshot.address.neighborhood,
        city: snapshot.address.city,
        state: snapshot.address.state,
        isPrimary: false,
      },
      attemptId,
      acceptedHash: attempt.acceptedHash,
    });

    // Override per-segment totalPrice to the exact allocated minor (integer / 100)
    // and per-vendor-group subtotal/commission/vendorNet to the snapshot values,
    // eliminating float drift from unitPrice * quantity.
    order.vendorGroups.forEach((vg, gi) => {
      const snapGroup = snapshot.groups.find(sg => sg.vendorId === vg.vendorId) ?? snapshot.groups[gi];
      const minors = groupAllocatedMinors[gi] ?? [];
      vg.items.forEach((item, idx) => {
        const allocatedMinor = minors[idx];
        if (typeof allocatedMinor === 'number') {
          (item as any).totalPrice = allocatedMinor / 100;
        }
      });
      if (snapGroup) {
        vg.subtotal = snapGroup.netMinor / 100;
        vg.commissionAmount = snapGroup.commissionMinor / 100;
        vg.vendorNet = snapGroup.vendorNetMinor / 100;
      }
    });

    // Also set subtotal/commission/vendorNet on vendorGroupsData for persistence
    vendorGroupsData.forEach((vg, gi) => {
      const snapGroup = snapshot.groups.find(sg => sg.vendorId === vg.vendorId) ?? snapshot.groups[gi];
      if (snapGroup) {
        vg.subtotal = snapGroup.netMinor / 100;
        vg.commissionAmount = snapGroup.commissionMinor / 100;
        vg.vendorNet = snapGroup.vendorNetMinor / 100;
      }
    });

    // Ensure totalAmount matches accepted snapshot netMinor (minor -> major).
    order.totalAmount = snapshot.netMinor / 100;

    // Also set totalPrice on vendorGroupsData items for persistence consistency
    vendorGroupsData.forEach((vg, gi) => {
      const snapGroup = snapshot.groups.find(sg => sg.vendorId === vg.vendorId) ?? snapshot.groups[gi];
      const minors = groupAllocatedMinors[gi] ?? [];
      vg.items.forEach((item, idx) => {
        const allocatedMinor = minors[idx];
        if (typeof allocatedMinor === 'number') {
          (item as any).totalPrice = allocatedMinor / 100;
        }
      });
    });

    // Persist order using insertForAttempt (create-only, idempotent with fixed attemptId)
    const persistedOrder = await this.orderRepo.insertForAttempt({
      attemptId: attemptId,
      personId: owner,
      vendorGroups: vendorGroupsData,
      shippingAddress: {
        id: snapshot.address.id,
        street: snapshot.address.street,
        number: snapshot.address.number,
        neighborhood: snapshot.address.neighborhood,
        city: snapshot.address.city,
        state: snapshot.address.state,
        isPrimary: false,
      },
      totalAmount: order.totalAmount,
      financialStatus: FinancialStatus.PENDING,
    });

    // Persist payment using insertForAttempt (create-only, idempotent with fixed attemptId)
    const payment = Payment.create({
      orderId: persistedOrder.id,
      personId: owner,
      amount: persistedOrder.totalAmount,
       provider: 'stripe',
    });
    const persistedPayment = await this.paymentRepo.insertForAttempt({ attemptId: attemptId, orderId: persistedOrder.id, personId: owner, amount: persistedOrder.totalAmount });

    // Persist the acceptedHash on the order document for audit/recovery
    persistedOrder.acceptedHash = attempt.acceptedHash;
    try { await this.orderRepo.update(persistedOrder); } catch { /* ignore update failure on already-persisted */ }

    // Persist session request before calling provider (SESSION_REQUESTED marker via payment providerTransactionId placeholder).
    const session = await this.createCheckoutSessionWithCustomer(persistedOrder, persistedPayment, owner);
    persistedPayment.providerTransactionId = session.id;
    persistedPayment.checkoutUrl = session.url;
    await this.paymentRepo.update(persistedPayment);

    return { order: persistedOrder, payment: persistedPayment, checkoutUrl: session.url };
  }

  /**
   * Creates a Stripe Checkout Session with the customer attached.
   * Gets or creates the Stripe Customer for the person, saves the customer ID,
   * and creates the checkout session using StripeService.
   */
  private async createCheckoutSessionWithCustomer(
    order: Order,
    payment: Payment,
    personId: string
  ): Promise<{ id: string; url: string }> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error('PERSON_NOT_FOUND');
    }

    const email = person.primaryEmail || person.email;
    if (!email) {
      throw new Error('PERSON_EMAIL_REQUIRED');
    }

    // When the configured payment provider is a mock (development without real
    // Stripe), create the session directly through it instead of calling the
    // real Stripe API. The real Stripe path requires customer_write permission
    // on the secret key, which a dev/restricted key may not have, and would
    // otherwise surface an uncaught StripeServiceError as a 500.
    if (this.isMockPaymentProvider(this.paymentProvider, payment)) {
      const session = await this.paymentProvider.createSession(order, payment);
      return { id: session.id, url: session.url };
    }

    // Get or create Stripe Customer
    const customerResult: StripeCustomerResult = await this.stripeService.getOrCreateCustomer(
      personId,
      email,
      person.stripeCustomerId
    );

    // Save customer ID on person if new or changed
    if (customerResult.isNew || (person.stripeCustomerId !== customerResult.customerId)) {
      person.setStripeCustomerId(customerResult.customerId);
      await this.personRepo.update(person);
    }

    // Create checkout session with customer
    return this.stripeService.createCheckoutSessionWithCustomer(
      order,
      payment,
      customerResult.customerId,
      this.config.frontendUrl,
      this.config.stripePaymentMethodConfiguration || undefined
    );
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
      if (this.searchIndex) {
        try {
          const product = await this.productRepo.findById(productId);
          if (product) {
            await this.searchIndex.indexProduct(product);
          }
        } catch (error) {
          console.warn('Elasticsearch product indexing failed');
        }
      }
    }
  }

private async prepareVendorGroups(cart: Cart): Promise<{
    vendorId: string;
    items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number; subtotal?: number; commissionAmount?: number; vendorNet?: number }[];
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
      items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number; subtotal?: number; commissionAmount?: number; vendorNet?: number }[];
      commissionPct: number;
      subtotal?: number;
      commissionAmount?: number;
      vendorNet?: number;
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
