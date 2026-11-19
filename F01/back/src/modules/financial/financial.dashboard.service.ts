import {
  FinancialAllocation,
  FinancialAllocationType,
  FinancialAllocationRepository,
} from './financial.domain';
import {
  FinancialMovementRecord,
  FinancialMovement,
  MovementType,
} from './financial.movement';
import { Vendor, VendorRepository } from '../vendor/vendor.domain';
import { Order, OrderStatus, OrderRepository } from '../order/order.domain';
import {
  Payment,
  PaymentStatus,
  PaymentRepository,
} from '../order/order.domain';
import { Transfer, TransferStatus } from '../transfer/transfer.domain';
import { Payout, PayoutStatus, PayoutRepository } from '../payout/payout.domain';

export interface FinancialHistoryEntry {
  id: string;
  eventType: string;
  movementType: MovementType;
  amount: number;
  currency: string;
  effectiveAt: Date;
  recordedAt: Date;
  relatedEntityId: string;
  relatedEntityType: 'payment' | 'transfer' | 'payout' | 'invoice';
  orderId?: string;
  vendorId: string;
}

export interface FinancialDashboard {
  grossSales: number;
  grossSalesLabel: string;
  netExpectedAmount: number;
  receivedInStripe: number;
  pendingDistribution: number;
  bankPayout: number;
  history: FinancialHistoryEntry[];
}

export class VendorFinancialDashboardService {
  private readonly vendorRepo: VendorRepository;
  private readonly orderRepo: OrderRepository;
  private readonly paymentRepo: PaymentRepository;
  private readonly movementRepo:
    | import('./financial.movement').FinancialMovementRepository
    | undefined;
  private readonly allocationRepo: FinancialAllocationRepository;
  private readonly payoutRepo: PayoutRepository;

  constructor(
    vendorRepo: VendorRepository,
    orderRepo: OrderRepository,
    paymentRepo: PaymentRepository,
    movementRepo:
      | import('./financial.movement').FinancialMovementRepository
      | undefined,
    allocationRepo: FinancialAllocationRepository,
    payoutRepo: PayoutRepository
  ) {
    this.vendorRepo = vendorRepo;
    this.orderRepo = orderRepo;
    this.paymentRepo = paymentRepo;
    this.movementRepo = movementRepo;
    this.allocationRepo = allocationRepo;
    this.payoutRepo = payoutRepo;
  }

  async getVendorDashboard(
    vendorId: string,
    periodStart?: Date,
    periodEnd?: Date
  ): Promise<FinancialDashboard> {
    // --- Resolve period ---
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : undefined;

    // --- Fetch vendor ---
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(`Vendor ${vendorId} not found`);
    }
    const commissionPct = vendor.commissionPct;

    // --- Fetch supporting data ---
    const allocations = await this.allocationRepo.findByVendorId(vendorId);
    const movements = this.movementRepo
      ? await this.movementRepo.findByVendorId(vendorId)
      : [];
    const payouts = await this.payoutRepo.findByVendorId(vendorId);
    const allOrders = await this.orderRepo.findAll();

    // Orders that belong to this vendor (have a vendorGroup with this vendorId)
    const vendorOrders = allOrders.filter((o) =>
      o.vendorGroups.some((vg) => vg.vendorId === vendorId)
    );

    // --- Gross sales: sum of vendor group subtotals for eligible orders ---
    // Eligible: order status !== CANCELLED AND has captured payment
    let grossSales = 0;
    for (const order of vendorOrders) {
      if (order.status === OrderStatus.CANCELLED) continue;

      // Check if order has any payment with status CAPTURED
      const orderPayments = await this.paymentRepo.findByOrderId(order.id);
      const hasCapturedPayment = orderPayments.some(
        (p) => p.status === PaymentStatus.CAPTURED
      );
      if (!hasCapturedPayment) continue;

      // Sum vendor group subtotals for this vendor in this order
      const vendorVgs = order.vendorGroups.filter((vg) => vg.vendorId === vendorId);
      for (const vg of vendorVgs) {
        grossSales += vg.subtotal;
      }
    }

    // --- Net expected amount ---
    const netExpectedAmount = grossSales * (1 - commissionPct / 100);

    // --- Received in Stripe: COMPLETED transfers for this vendor ---
    // Sum of COMPLETED transfer amounts for this vendor's order groups, created in period
    let receivedInStripe = 0;

    // Find vendor transfer movements (VENDOR_TRANSFER type)
    const vendorTransferMovements = this.movementRepo
      ? movements.filter(
          (m) => m.data.movementType === MovementType.VENDOR_TRANSFER
        )
      : [];

    for (const move of vendorTransferMovements) {
      const effectiveAt = move.data.effectiveAt;
      if (start && effectiveAt < start) continue;
      if (end && effectiveAt > end) continue;
      // Only count COMPLETED transfers as received in Stripe.
      // MovementType.VENDOR_TRANSFER is the movement type, not transfer status;
      // the transfer completion status is carried in metadata.status.
      if (move.data.metadata?.status !== 'completed') continue;
      receivedInStripe += move.data.amount;
    }

    // --- Pending distribution: vendor net amounts for non-COMPLETED transfers ---
    // Non-COMPLETED = transfers that are not COMPLETED (pending, processing, failed, reversed)
    let pendingDistribution = 0;
    for (const move of vendorTransferMovements) {
      const effectiveAt = move.data.effectiveAt;
      if (start && effectiveAt < start) continue;
      if (end && effectiveAt > end) continue;
      // Only count non-COMPLETED transfers as pending distribution.
      if (move.data.metadata?.status === 'completed') continue;
      pendingDistribution += move.data.amount;
    }

    // --- Bank payout: COMPLETED payouts for this vendor ---
    let bankPayout = 0;
    for (const payout of payouts) {
      if (payout.status !== PayoutStatus.COMPLETED) continue;
      if (start && payout.requestedAt < start) continue;
      if (end && payout.requestedAt > end) continue;
      bankPayout += payout.amount;
    }

    // --- Build history ---
    const history = await this.buildHistory(
      vendorId,
      start,
      end,
      vendorOrders,
      movements,
      allocations,
      payouts
    );

    return {
      grossSales,
      grossSalesLabel: 'pre-commission',
      netExpectedAmount,
      receivedInStripe,
      pendingDistribution,
      bankPayout,
      history,
    };
  }

  private async buildHistory(
    vendorId: string,
    start?: Date,
    end?: Date,
    vendorOrders?: Order[],
    movements?: FinancialMovementRecord[],
    allocations?: FinancialAllocation[],
    payouts?: Payout[]
  ): Promise<FinancialHistoryEntry[]> {
    const entries: FinancialHistoryEntry[] = [];
    const seenIds = new Set<string>();
    const theVendorOrders = vendorOrders || [];
    const theMovements = movements || [];
    const theAllocations = allocations || [];
    const thePayouts = payouts || [];
    let recordedAt: Date = new Date();

    // 1. Payments from vendor's orders
    const allOrderPayments: Payment[] = [];
    for (const order of theVendorOrders) {
      const vendorIds = new Set(order.vendorGroups.map(group => group.vendorId));
      if (vendorIds.size !== 1 || !vendorIds.has(vendorId)) continue;
      const payments = await this.paymentRepo.findByOrderId(order.id);
      allOrderPayments.push(...payments);
    }

    for (const payment of allOrderPayments) {
      if (seenIds.has(payment.id)) continue;
      seenIds.add(payment.id);

      const effectiveAt =
        payment.authorizedAt || payment.capturedAt || payment.createdAt;
      const recordedAt = payment.createdAt;

      if (start && effectiveAt && new Date(effectiveAt) < new Date(start))
        continue;
      if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

      entries.push({
        id: payment.id,
        eventType: payment.eventType || 'payment',
        movementType: MovementType.CONSUMER_PAYMENT,
        amount: payment.amount,
        currency: 'BRL',
        effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
        recordedAt,
        relatedEntityId: payment.id,
        relatedEntityType: 'payment',
        orderId: payment.orderId,
        vendorId,
      });
    }

    // 2. Financial allocations for this vendor
    const seenAllocIds = new Set<string>();
    for (const allocation of theAllocations) {
      if (seenAllocIds.has(allocation.id)) continue;
      seenAllocIds.add(allocation.id);

      const effectiveAt = allocation.createdAt;
      const recordedAt = allocation.createdAt;

      if (start && effectiveAt && new Date(effectiveAt) < new Date(start)) continue;
      if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

      let movementType: MovementType;
      if (allocation.type === FinancialAllocationType.CAPTURE) {
        movementType = MovementType.CONSUMER_PAYMENT;
      } else if (allocation.type === FinancialAllocationType.REFUND) {
        movementType = MovementType.REFUND;
      } else {
        movementType = MovementType.CONSUMER_PAYMENT;
      }

      entries.push({
        id: allocation.id,
        eventType: allocation.type,
        movementType,
        amount: allocation.gross,
        currency: 'BRL',
        effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
        recordedAt,
        relatedEntityId: allocation.id,
        relatedEntityType: 'payment',
        orderId: allocation.orderId,
        vendorId,
      });
    }

    // 3. Transfers for this vendor's order groups
    const seenTransferIds = new Set<string>();
    for (const order of theVendorOrders) {
      const orderVendorIds = new Set(order.vendorGroups.map(group => group.vendorId));
      if (orderVendorIds.size !== 1 || !orderVendorIds.has(vendorId)) continue;
      const orderMovements = await this.movementRepo!.findByOrderId(order.id);
      for (const move of orderMovements) {
        if (move.data.vendorId !== vendorId) continue;
        if (seenTransferIds.has(move.data.movementId)) continue;
        seenTransferIds.add(move.data.movementId);

        const effectiveAt = move.data.effectiveAt;
        if (start && effectiveAt && new Date(effectiveAt) < new Date(start))
          continue;
        if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

        // Determine movement type from the movement's movementType string
        let mt = move.data.movementType;
        // Map string-based movement types to MovementType enum values
        const typeMap: Record<string, MovementType> = {
          'vendor_transfer': MovementType.VENDOR_TRANSFER,
          'transfer_reversal': MovementType.TRANSFER_REVERSAL,
          'consumer_payment': MovementType.CONSUMER_PAYMENT,
          'commission': MovementType.COMMISSION,
          'vendor_payout': MovementType.VENDOR_PAYOUT,
          'refund': MovementType.REFUND,
        };
        const movementType = typeMap[mt] || MovementType.VENDOR_TRANSFER;

        entries.push({
          id: move.data.movementId,
          eventType: move.data.movementType,
          movementType,
          amount: move.data.amount,
          currency: 'BRL',
          effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
          recordedAt,
          relatedEntityId: move.data.relatedEntityId,
          relatedEntityType: 'transfer',
          orderId: move.data.orderId,
          vendorId,
        });
      }
    }

    // 4. Payouts for this vendor
    const allPayouts = await this.payoutRepo.findByVendorId(vendorId);
    const seenPayoutIds = new Set<string>();
    for (const payout of allPayouts) {
      if (seenPayoutIds.has(payout.id)) continue;
      seenPayoutIds.add(payout.id);

      const effectiveAt = payout.requestedAt;
      const recordedAt = payout.createdAt || payout.requestedAt;

      if (start && effectiveAt && new Date(effectiveAt) < new Date(start)) continue;
      if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

      entries.push({
        id: payout.id,
        eventType: payout.eventType || 'payout_requested',
        movementType: MovementType.VENDOR_PAYOUT,
        amount: payout.amount,
        currency: 'BRL',
        effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
        recordedAt,
        relatedEntityId: payout.id,
        relatedEntityType: 'payout',
        orderId: payout.reference,
        vendorId,
      });
    }

    // 5. Failed transfers (movement type contains 'failed' but not reversal)
    for (const move of theMovements) {
      const mt = move.data.movementType;
      const isFailed =
        typeof mt === 'string' &&
        mt !== MovementType.TRANSFER_REVERSAL &&
        mt.includes('failed');
      if (isFailed) {
        const effectiveAt = move.data.effectiveAt;
        const recordedAt = move.data.recordedAt;

        if (start && effectiveAt && new Date(effectiveAt) < new Date(start)) continue;
        if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

        entries.push({
          id: move.data.movementId,
          eventType: move.data.movementType,
          movementType: 'transfer_failed' as MovementType,
          amount: move.data.amount,
          currency: 'BRL',
          effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
          recordedAt,
          relatedEntityId: move.data.relatedEntityId,
          relatedEntityType: 'transfer',
          orderId: move.data.orderId,
          vendorId,
        });
      }
    }

    // 6. Reversals (movement type contains 'reversal')
    for (const move of theMovements) {
      const mt = move.data.movementType;
      const isReversal =
        typeof mt === 'string' &&
        mt.includes('reversal');
      if (isReversal) {
        const effectiveAt = move.data.effectiveAt;
        const recordedAt = move.data.recordedAt;

        if (start && effectiveAt && new Date(effectiveAt) < new Date(start)) continue;
        if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

        entries.push({
          id: move.data.movementId,
          eventType: move.data.movementType,
          movementType: 'transfer_reversal' as MovementType,
          amount: move.data.amount,
          currency: 'BRL',
          effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
          recordedAt,
          relatedEntityId: move.data.relatedEntityId,
          relatedEntityType: 'transfer',
          orderId: move.data.orderId,
          vendorId,
        });
      }
    }

    // 7. Refund adjustments (payments with refund event type)
    for (const payment of allOrderPayments) {
      if (
        payment.eventType === 'payment_refunded' ||
        payment.eventType === 'payment_refund'
      ) {
        if (seenIds.has(payment.id)) continue;
        seenIds.add(payment.id);

        const effectiveAt = payment.refundedAt || payment.createdAt;
        const recordedAt = payment.createdAt;

        if (start && effectiveAt && new Date(effectiveAt) < new Date(start)) continue;
        if (end && effectiveAt && new Date(effectiveAt) > new Date(end)) continue;

        entries.push({
          id: payment.id,
          eventType: payment.eventType || 'refund',
          movementType: MovementType.REFUND,
          amount: payment.amount,
          currency: 'BRL',
          effectiveAt: effectiveAt ? new Date(effectiveAt) : recordedAt,
          recordedAt,
          relatedEntityId: payment.id,
          relatedEntityType: 'payment',
          orderId: payment.orderId,
          vendorId,
        });
      }
    }

    // Sort by effectiveAt descending, then recordedAt descending
    entries.sort((a, b) => {
      const ae = a.effectiveAt.getTime();
      const be = b.effectiveAt.getTime();
      if (ae !== be) return be - ae; // newest first
      return b.recordedAt.getTime() - a.recordedAt.getTime();
    });

    return entries;
  }
}