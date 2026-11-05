import Stripe from 'stripe';
import { Transfer, TransferStatus } from './transfer.domain';
import { MongoTransferRepository } from './transfer.mongo.repository';
import { Order, OrderVendorGroup, OrderVendorGroupStatus, OrderStatus, OrderError } from '../order/order.domain';
import { FinancialService } from '../financial/financial.service';
import { FinancialAllocation, FinancialAllocationType } from '../financial/financial.domain';

const STRIPE_TRANSFER_AMOUNT_PRECISION = 2;

export class TransferService {
  private readonly transferRepo: MongoTransferRepository;
  private readonly financialService: FinancialService;
  private readonly stripe: Stripe;

  constructor(
    transferRepo: MongoTransferRepository,
    financialService: FinancialService,
    stripeKey: string
  ) {
    this.transferRepo = transferRepo;
    this.financialService = financialService;
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2024-09-30',
    });
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
    const stripeTransfer = await this.stripe.transfers.create({
      amount: Math.round(transferAmount * 100), // Stripe expects amount in cents
      currency: 'brl',
      destination: '', // Will be set from vendor's connected account - placeholder for now
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

    return { transfer: stripeTransfer, entity: transferEntity };
  }

  async completeTransfer(stripeTransferId: string): Promise<Transfer> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null as any;
    }
    if (entity.status !== TransferStatus.COMPLETED) {
      entity.complete();
      await this.transferRepo.save(entity);
    }
    return entity;
  }

  async failTransfer(stripeTransferId: string): Promise<Transfer> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null as any;
    }
    if (entity.status !== TransferStatus.FAILED) {
      entity.fail();
      await this.transferRepo.save(entity);
    }
    return entity;
  }

  async reverseTransfer(stripeTransferId: string): Promise<Transfer> {
    let entity = await this.transferRepo.findByStripeTransferId(stripeTransferId);
    if (!entity) {
      return null as any;
    }
    if (entity.status !== TransferStatus.REVERSED) {
      entity.reverse();
      await this.transferRepo.save(entity);
    }
    return entity;
  }
}