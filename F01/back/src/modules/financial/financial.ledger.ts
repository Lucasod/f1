import { InMemoryFinancialMovementRepository } from './financial.movement';
import { InMemoryFinancialEventRepository } from './financial.event';
import { FinancialMovementRecord, FinancialMovement, MovementType } from './financial.movement';
import { FinancialEventRecord, EventType } from './financial.event';

export enum LedgerMovementType {
  CONSUMER_PAYMENT = 'consumer_payment',
  COMMISSION = 'commission',
  VENDOR_TRANSFER = 'vendor_transfer',
  VENDOR_PAYOUT = 'vendor_payout',
  REFUND = 'refund',
  TRANSFER_REVERSAL = 'transfer_reversal',
}

export interface LedgerMovement {
  movementId: string;
  movementType: LedgerMovementType;
  amount: number;
  currency: string;
  relatedEntityType: 'payment' | 'transfer' | 'payout' | 'invoice';
  relatedEntityId: string;
  orderId?: string;
  paymentId?: string;
  ovgId?: string;
  vendorId?: string;
  effectiveAt: Date;
  recordedAt: Date;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerEvent {
  eventId: string;
  eventType: string;
  eventSource: 'internal' | 'external';
  eventTimestamp: Date;
  orderId?: string;
  paymentId?: string;
  ovgId?: string;
  vendorId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationDiscrepancy {
  movementId: string;
  expectedAmount: number;
  actualAmount: number;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ReconciliationReport {
  discrepancies: ReconciliationDiscrepancy[];
  totalInternal: number;
  totalStripe: number;
  netDifference: number;
  periodStart: Date;
  periodEnd: Date;
  checkedAt: Date;
}

export class FinancialLedger {
  constructor(
    private readonly movementRepo: InMemoryFinancialMovementRepository,
    private readonly eventRepo: InMemoryFinancialEventRepository
  ) {}

  // --- Movement Query Functions ---

  async getMovementsByVendor(vendorId: string): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findByVendorId(vendorId);
    return this.mapMovements(movements);
  }

  async getMovementsByOrder(orderId: string): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findByOrderId(orderId);
    return this.mapMovements(movements);
  }

  async getMovementsByType(movementType: LedgerMovementType): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findByMovementType(
      movementType as unknown as MovementType
    );
    return this.mapMovements(movements);
  }

  async getMovementsByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findByEntity(entityType, entityId);
    return this.mapMovements(movements);
  }

  async getMovementsByPeriod(start: Date, end: Date): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findByPeriod(start, end);
    return this.mapMovements(movements);
  }

  async getAllMovements(): Promise<LedgerMovement[]> {
    const movements = await this.movementRepo.findAll();
    return this.mapMovements(movements);
  }

  private mapMovements(movements: FinancialMovementRecord[]): LedgerMovement[] {
    return movements.map(m => ({
      movementId: m.data.movementId,
      movementType: m.data.movementType as unknown as LedgerMovementType,
      amount: m.data.amount,
      currency: m.data.currency,
      relatedEntityType: m.data.relatedEntityType,
      relatedEntityId: m.data.relatedEntityId,
      orderId: m.data.orderId,
      paymentId: m.data.paymentId,
      ovgId: m.data.ovgId,
      vendorId: m.data.vendorId,
      effectiveAt: m.data.effectiveAt,
      recordedAt: m.data.recordedAt,
      idempotencyKey: m.data.idempotencyKey,
      metadata: m.data.metadata,
    }) as LedgerMovement);
  }

  // --- Event Query Functions ---

  async getEventsByType(eventType: string): Promise<LedgerEvent[]> {
    const events = await this.eventRepo.findByType(eventType as EventType);
    const result: LedgerEvent[] = [];
    for (const e of events) {
      result.push({
        eventId: e.data.eventId,
        eventType: e.data.eventType as unknown as string,
        eventSource: e.data.eventSource,
        eventTimestamp: e.data.eventTimestamp,
        orderId: e.data.orderId,
        paymentId: e.data.paymentId,
        ovgId: e.data.ovgId,
        vendorId: e.data.vendorId,
        metadata: e.data.metadata,
      } as LedgerEvent);
    }
    return result;
  }

  async getEventsByOrder(orderId: string): Promise<LedgerEvent[]> {
    const events = await this.eventRepo.findByOrderId(orderId);
    const result: LedgerEvent[] = [];
    for (const e of events) {
      result.push({
        eventId: e.data.eventId,
        eventType: e.data.eventType as unknown as string,
        eventSource: e.data.eventSource,
        eventTimestamp: e.data.eventTimestamp,
        orderId: e.data.orderId,
        paymentId: e.data.paymentId,
        ovgId: e.data.ovgId,
        vendorId: e.data.vendorId,
        metadata: e.data.metadata,
      } as LedgerEvent);
    }
    return result;
  }

  async getEventsByVendor(vendorId: string): Promise<LedgerEvent[]> {
    const events = await this.eventRepo.findByVendorId(vendorId);
    const result: LedgerEvent[] = [];
    for (const e of events) {
      result.push({
        eventId: e.data.eventId,
        eventType: e.data.eventType as unknown as string,
        eventSource: e.data.eventSource,
        eventTimestamp: e.data.eventTimestamp,
        orderId: e.data.orderId,
        paymentId: e.data.paymentId,
        ovgId: e.data.ovgId,
        vendorId: e.data.vendorId,
        metadata: e.data.metadata,
      } as LedgerEvent);
    }
    return result;
  }

  async getEventsByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<LedgerEvent[]> {
    const events = await this.eventRepo.findByEntity(entityType, entityId);
    const result: LedgerEvent[] = [];
    for (const e of events) {
      result.push({
        eventId: e.data.eventId,
        eventType: e.data.eventType as unknown as string,
        eventSource: e.data.eventSource,
        eventTimestamp: e.data.eventTimestamp,
        orderId: e.data.orderId,
        paymentId: e.data.paymentId,
        ovgId: e.data.ovgId,
        vendorId: e.data.vendorId,
        metadata: e.data.metadata,
      } as LedgerEvent);
    }
    return result;
  }

  async getAllEvents(): Promise<LedgerEvent[]> {
    const events = await this.eventRepo.findAll();
    const result: LedgerEvent[] = [];
    for (const e of events) {
      result.push({
        eventId: e.data.eventId,
        eventType: e.data.eventType as unknown as string,
        eventSource: e.data.eventSource,
        eventTimestamp: e.data.eventTimestamp,
        orderId: e.data.orderId,
        paymentId: e.data.paymentId,
        ovgId: e.data.ovgId,
        vendorId: e.data.vendorId,
        metadata: e.data.metadata,
      } as LedgerEvent);
    }
    return result;
  }

  // --- Reconciliation Functions ---

  async reconcileWithStripe(
    periodStart: Date,
    periodEnd: Date,
    stripeKey: string
  ): Promise<ReconciliationReport> {
    const internalMovements = await this.getMovementsByPeriod(periodStart, periodEnd);

    const discrepancies: ReconciliationDiscrepancy[] = [];

    // Filter consumer payments from internal movements
    const internalConsumerPayments = internalMovements.filter(
      m => m.movementType === LedgerMovementType.CONSUMER_PAYMENT
    );

    // Use dynamic import for Stripe SDK
    let stripe: any;
    let stripeCharges: any[] = [];
    let stripeTransfers: any[] = [];
    let stripePayouts: any[] = [];
    let stripeRefunds: any[] = [];

    try {
      stripe = await import('stripe');
    } catch (e) {
      console.error('Failed to import Stripe module:', e);
      return {
        discrepancies,
        totalInternal: internalMovements.reduce(
          (sum: number, m: { amount: number }) => sum + m.amount, 0
        ),
        totalStripe: 0,
        netDifference: internalMovements.reduce(
          (sum: number, m: { amount: number }) => sum + m.amount, 0
        ),
        periodStart,
        periodEnd,
        checkedAt: new Date(),
      };
    }

    try {
      const stripeChargesList = await stripe.charges.list({
        created: Math.floor(periodStart.getTime() / 1000),
        limit: 100,
      });
      stripeCharges = (stripeChargesList as any).data || [];
    } catch (e) {
      console.error('Failed to fetch Stripe charges:', e);
      stripeCharges = [];
    }

    try {
      const stripeTransfersList = await stripe.transfers.list({
        created: Math.floor(periodStart.getTime() / 1000),
        limit: 100,
      });
      stripeTransfers = (stripeTransfersList as any).data || [];
    } catch (e) {
      console.error('Failed to fetch Stripe transfers:', e);
      stripeTransfers = [];
    }

    try {
      const stripePayoutsList = await stripe.payouts.list({
        created: Math.floor(periodStart.getTime() / 1000),
        limit: 100,
      });
      stripePayouts = (stripePayoutsList as any).data || [];
    } catch (e) {
      console.error('Failed to fetch Stripe payouts:', e);
      stripePayouts = [];
    }

    try {
      const stripeRefundsList = await stripe.refunds.list({
        created: Math.floor(periodStart.getTime() / 1000),
        limit: 100,
      });
      stripeRefunds = (stripeRefundsList as any).data || [];
    } catch (e) {
      console.error('Failed to fetch Stripe refunds:', e);
      stripeRefunds = [];
    }

    // Reconcile consumer payments (Stripe charges vs internal ledger)
    for (const charge of stripeCharges) {
      const matchingInternal = internalConsumerPayments.find(
        m => m.relatedEntityId === charge.id || (m.metadata && (m.metadata as any).stripeChargeId === charge.id)
      );

      if (!matchingInternal) {
        discrepancies.push({
          movementId: 'stripe-charge-' + charge.id,
          expectedAmount: charge.amount / 100,
          actualAmount: 0,
          description: `Stripe charge ${charge.id} not found in internal ledger`,
          severity: 'high',
        });
      }
    }

    // Reconcile vendor transfers (Stripe transfers vs internal ledger)
    for (const transfer of stripeTransfers) {
      const matchingInternal = internalMovements.find(
        m => m.relatedEntityId === transfer.id || (m.metadata && (m.metadata as any).stripeTransferId === transfer.id)
      );

      if (!matchingInternal) {
        discrepancies.push({
          movementId: 'stripe-transfer-' + transfer.id,
          expectedAmount: transfer.amount / 100,
          actualAmount: 0,
          description: `Stripe transfer ${transfer.id} not found in internal ledger`,
          severity: 'high',
        });
      }
    }

    // Reconcile vendor payouts (Stripe payouts vs internal ledger)
    for (const payout of stripePayouts) {
      const matchingInternal = internalMovements.find(
        m => m.relatedEntityId === payout.id || (m.metadata && (m.metadata as any).stripePayoutId === payout.id)
      );

      if (!matchingInternal) {
        discrepancies.push({
          movementId: 'stripe-payout-' + payout.id,
          expectedAmount: payout.amount / 100,
          actualAmount: 0,
          description: `Stripe payout ${payout.id} not found in internal ledger`,
          severity: 'high',
        });
      }
    }

    // Reconcile refunds
    for (const refund of stripeRefunds) {
      const matchingInternal = internalMovements.find(
        m => m.relatedEntityId === refund.id || (m.metadata && (m.metadata as any).stripeRefundId === refund.id)
      );

      if (!matchingInternal) {
        discrepancies.push({
          movementId: 'stripe-refund-' + refund.id,
          expectedAmount: refund.amount / 100,
          actualAmount: 0,
          description: `Stripe refund ${refund.id} not found in internal ledger`,
          severity: 'high',
        });
      }
    }

    const totalInternal = internalMovements.reduce(
      (sum: number, m: { amount: number }) => sum + m.amount, 0
    );

    const totalStripe = (
      (stripeCharges.reduce((sum: number, c: { amount: number }) => sum + c.amount / 100, 0)) +
      (stripeTransfers.reduce((sum: number, t: { amount: number }) => sum + t.amount / 100, 0)) +
      (stripePayouts.reduce((sum: number, p: { amount: number }) => sum + p.amount / 100, 0)) +
      (stripeRefunds.reduce((sum: number, r: { amount: number }) => sum + r.amount / 100, 0))
    );

    return {
      discrepancies,
      totalInternal,
      totalStripe,
      netDifference: totalInternal - totalStripe,
      periodStart,
      periodEnd,
      checkedAt: new Date(),
    };
  }
}