import Stripe from 'stripe';
import { Transfer, TransferStatus } from './transfer.domain';
import { MongoTransferRepository } from './transfer.mongo.repository';
import { Order, OrderVendorGroup, OrderVendorGroupStatus, OrderStatus, OrderError, OrderRepository } from '../order/order.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { FinancialService } from '../financial/financial.service';
import { FinancialAllocation, FinancialAllocationType } from '../financial/financial.domain';

import {
  FinancialMovementRecord,
  MovementType,
  FinancialMovementRepository,
} from '../financial/financial.movement';
import {
  FinancialEventRecord,
  EventType,
  FinancialEventRepository,
} from '../financial/financial.event';

const STRIPE_TRANSFER_AMOUNT_PRECISION = 2;

export class TransferService {
  private readonly transferRepo: MongoTransferRepository;
  private readonly orderRepo: OrderRepository;
  private readonly financialService: FinancialService;
  private readonly stripe: Stripe;
  private readonly movementRepo?: FinancialMovementRepository;
  private readonly eventRepo?: FinancialEventRepository;
  private readonly vendorRepo?: VendorRepository;

  constructor(
    transferRepo: MongoTransferRepository,
    financialService: FinancialService,
    stripeKey: string,
    orderRepo: OrderRepository,
    movementRepo?: FinancialMovementRepository,
    eventRepo?: FinancialEventRepository,
    vendorRepo?: VendorRepository,
  ) {
    this.transferRepo = transferRepo;
    this.orderRepo = orderRepo;
    this.financialService = financialService;
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2026-10-28.endive',
    });
    this.movementRepo = movementRepo;
    this.eventRepo = eventRepo;
    this.vendorRepo = vendorRepo;
  }

  /**
   * Create a Stripe Transfer for a vendor from an OrderVendorGroup.
   * 
   * Idempotency key: order_id:ovg_id:attempt
   * - On first call: creates Stripe transfer, persists to MongoDB, sets transferId on OVG
   * - On subsequent calls: returns existing transfer (idempotent)
   * 
   * @param orderId The order ID
   * @param orderVendorGroupId The order vendor group ID
   * @param ovgTotal The OVG subtotal (before commission)
   * @param commissionPct The commission percentage
   * @param chargeId The Stripe charge ID (for source_transaction)
   * @param attempt The attempt number (for idempotency key suffix)
   * @returns The Stripe Transfer object and persisted Transfer entity
   */
  async createTransferWithDetails(
    orderId: string,
    orderVendorGroupId: string,
    ovgTotal: number,
    commissionPct: number,
    chargeId: string,
    attempt: number = 1
  ): Promise<{ transfer: Stripe.Transfer; entity: Transfer }> {
    const idempotencyKey = `${orderId}:${orderVendorGroupId}:${attempt}`;

    // Check if transfer already exists (idempotency)
    const existingTransfer = await this.transferRepo.findLastByOrderVendorGroupId(orderVendorGroupId);
    if (existingTransfer && existingTransfer.status === TransferStatus.COMPLETED) {
      // Return existing completed transfer
      try {
        const stripeTransfer = await this.stripe.transfers.retrieve(existingTransfer.stripeTransferId!);
        return { transfer: stripeTransfer, entity: existingTransfer };
      } catch {
        // Stripe object no longer available, fall through to recreate
      }
    }

    // Calculate vendor net amount: ovgTotal × (1 - commission_pct/100)
    const vendorNet = ovgTotal * (1 - commissionPct / 100);
    const transferAmount = Math.round(vendorNet * 100) / 100; // 2 decimal precision

    // Create the Transfer entity (initially PENDING, will be updated after Stripe creation)
    const transferEntity = Transfer.create({
      orderId,
      orderVendorGroupId,
      amount: transferAmount,
      currency: 'brl'
    });

    // Persist the entity to MongoDB first (for idempotency and tracking)
    await this.transferRepo.save(transferEntity);

    // Create Stripe Transfer with idempotency key
    // source_transaction = charge_id for synchronous payments
    // transfer_group = order_id for correlation
    // destination = vendor's Stripe connected account ID for attribution
    const vendorId = await this.resolveVendorId(orderId, orderVendorGroupId);
    let destinationAccountId = '';
    if (vendorId && this.vendorRepo) {
      const vendor = await this.vendorRepo.findById(vendorId);
      if (vendor && vendor.stripeAccountId) {
        destinationAccountId = vendor.stripeAccountId;
      }
    }
    const stripeTransfer = await this.stripe.transfers.create({
      amount: Math.round(transferAmount * 100), // Stripe expects amount in cents
      currency: 'brl',
      destination: destinationAccountId,
      source_transaction: chargeId,
      transfer_group: orderId,
    }, {
      idempotencyKey: idempotencyKey,
    });

    // Update the entity with Stripe transfer ID and provider transaction ID
    transferEntity.stripeTransferId = stripeTransfer.id;
    transferEntity.providerTransactionId = chargeId;
    transferEntity.status = TransferStatus.PROCESSING;

    // Persist updated entity
    await this.transferRepo.save(transferEntity);

    await this.recordTransferLedger(
      transferEntity,
      MovementType.VENDOR_TRANSFER,
      EventType.TRANSFER_INITIATED
    );

    return { transfer: stripeTransfer, entity: transferEntity };
  }

  async completeTransfer(stripeTransferId: string): Promise<Transfer | null> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null;
    }
    if (entity.status !== TransferStatus.COMPLETED) {
      entity.complete();
      await this.transferRepo.save(entity);
      await this.recordTransferLedger(
        entity,
        MovementType.VENDOR_TRANSFER,
        EventType.TRANSFER_COMPLETED
      );
    }
    return entity;
  }

  async failTransfer(stripeTransferId: string): Promise<Transfer | null> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null;
    }
    if (entity.status !== TransferStatus.FAILED) {
      entity.fail();
      await this.transferRepo.save(entity);
      await this.recordTransferLedger(
        entity,
        MovementType.VENDOR_TRANSFER,
        EventType.TRANSFER_FAILED
      );
    }
    return entity;
  }

  async reverseTransfer(stripeTransferId: string): Promise<Transfer | null> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null;
    }
    if (entity.status !== TransferStatus.REVERSED) {
      entity.reverse();
      await this.transferRepo.save(entity);
      await this.recordTransferLedger(
        entity,
        MovementType.TRANSFER_REVERSAL,
        EventType.TRANSFER_REVERSED
      );
    }
    return entity;
  }

  /**
   * Resolves the vendorId for a transfer by looking up the order's vendor group
   * that matches orderVendorGroupId. Returns undefined when the order or vendor
   * group cannot be found.
   */
  private async resolveVendorId(
    orderId: string,
    orderVendorGroupId: string,
  ): Promise<string | undefined> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      return undefined;
    }
    const vendorGroup = order.vendorGroups.find(
      vg => vg.id === orderVendorGroupId,
    );
    return vendorGroup?.vendorId;
  }

  /**
   * Records a financial movement and event for a transfer state transition.
   * Best-effort: skipped when no movement/event repository is wired.
   */
  private async recordTransferLedger(
    transfer: Transfer,
    movementType: MovementType,
    eventType: EventType,
  ): Promise<void> {
    const now = new Date();
    const vendorId = await this.resolveVendorId(
      transfer.orderId,
      transfer.orderVendorGroupId,
    );

    if (this.movementRepo) {
      const movement = FinancialMovementRecord.create({
        movementType,
        amount: transfer.amount,
        currency: transfer.currency,
        relatedEntityType: 'transfer',
        relatedEntityId: transfer.id,
        orderId: transfer.orderId,
        vendorId,
        effectiveAt: now,
        recordedAt: now,
        idempotencyKey: `transfer:${transfer.id}:${movementType}`,
      });
      await this.movementRepo.save(movement);
    }

    if (this.eventRepo) {
      const event = FinancialEventRecord.create({
        eventType,
        eventSource: 'internal',
        eventTimestamp: now,
        orderId: transfer.orderId,
        vendorId,
      });
      await this.eventRepo.save(event);
    }
  }
}