export enum MovementType {
  CONSUMER_PAYMENT = 'consumer_payment',
  COMMISSION = 'commission',
  VENDOR_TRANSFER = 'vendor_transfer',
  VENDOR_PAYOUT = 'vendor_payout',
  REFUND = 'refund',
  TRANSFER_REVERSAL = 'transfer_reversal',
}

export interface FinancialMovementData {
  movementId: string;
  movementType: MovementType;
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

export interface FinancialMovement {
  readonly movementId: string;
  readonly movementType: MovementType;
  readonly amount: number;
  readonly currency: string;
  readonly relatedEntityType: 'payment' | 'transfer' | 'payout' | 'invoice';
  readonly relatedEntityId: string;
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly ovgId?: string;
  readonly vendorId?: string;
  readonly effectiveAt: Date;
  readonly recordedAt: Date;
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, unknown>;
}

function generateMovementId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class FinancialMovementRecord {
  public readonly data: FinancialMovementData;

  private constructor(data: FinancialMovementData) {
    this.data = data;
  }

  static create(data: {
    movementType: MovementType;
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
  }): FinancialMovementRecord {
    const movementId = generateMovementId();
    const now = new Date();

    const movementData: FinancialMovementData = {
      movementId,
      movementType: data.movementType,
      amount: data.amount,
      currency: data.currency,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      effectiveAt: data.effectiveAt,
      recordedAt: data.recordedAt ?? now,
      idempotencyKey: data.idempotencyKey,
      metadata: data.metadata,
    };

    return new FinancialMovementRecord(movementData);
  }

  static fromExistingMovement(data: Partial<FinancialMovementData>): FinancialMovementRecord {
    const movementId = data.movementId ?? generateMovementId();
    const now = new Date();

    const movementData: FinancialMovementData = {
      movementId,
      movementType: data.movementType!,
      amount: data.amount!,
      currency: data.currency!,
      relatedEntityType: data.relatedEntityType!,
      relatedEntityId: data.relatedEntityId!,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      effectiveAt: data.effectiveAt!,
      recordedAt: data.recordedAt ?? now,
      idempotencyKey: data.idempotencyKey,
      metadata: data.metadata,
    };

    return new FinancialMovementRecord(movementData);
  }

  toJSON(): FinancialMovementData {
    return { ...this.data };
  }
}

export interface FinancialMovementRepository {
  save(movement: FinancialMovementRecord): Promise<FinancialMovementRecord>;
  findById(movementId: string): Promise<FinancialMovementRecord | null>;
  findByOrderId(orderId: string): Promise<FinancialMovementRecord[]>;
  findByVendorId(vendorId: string): Promise<FinancialMovementRecord[]>;
  findByMovementType(movementType: MovementType): Promise<FinancialMovementRecord[]>;
  findByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<FinancialMovementRecord[]>;
  findByPeriod(start: Date, end: Date): Promise<FinancialMovementRecord[]>;
  findAll(): Promise<FinancialMovementRecord[]>;
}

export class InMemoryFinancialMovementRepository implements FinancialMovementRepository {
  private readonly items = new Map<string, FinancialMovementRecord>();
  private readonly orderIndex = new Map<string, Set<string>>();
  private readonly vendorIndex = new Map<string, Set<string>>();
  private readonly movementTypeIndex = new Map<MovementType, Set<string>>();
  private readonly entityIndex = new Map<string, Set<string>>(); // entityType:entityId -> movement IDs
  private readonly periodIndex: Map<string, FinancialMovementRecord[]> = new Map();

  async save(movement: FinancialMovementRecord): Promise<FinancialMovementRecord> {
    const id = movement.data.movementId;
    this.items.set(id, movement);

    // Order index
    if (movement.data.orderId) {
      if (!this.orderIndex.has(movement.data.orderId)) {
        this.orderIndex.set(movement.data.orderId, new Set());
      }
      this.orderIndex.get(movement.data.orderId)!.add(id);
    }

    // Vendor index
    if (movement.data.vendorId) {
      if (!this.vendorIndex.has(movement.data.vendorId)) {
        this.vendorIndex.set(movement.data.vendorId, new Set());
      }
      this.vendorIndex.get(movement.data.vendorId)!.add(id);
    }

    // Movement type index
    if (!this.movementTypeIndex.has(movement.data.movementType)) {
      this.movementTypeIndex.set(movement.data.movementType, new Set());
    }
    this.movementTypeIndex.get(movement.data.movementType)!.add(id);

    // Entity index: "payment:pe123" or "transfer:tr456"
    const entityKey = `${movement.data.relatedEntityType}:${movement.data.relatedEntityId}`;
    if (!this.entityIndex.has(entityKey)) {
      this.entityIndex.set(entityKey, new Set());
    }
    this.entityIndex.get(entityKey)!.add(id);

    // Period index (day-level)
    const periodKey = `${movement.data.effectiveAt.getFullYear()}-${String(movement.data.effectiveAt.getMonth() + 1).padStart(2, '0')}-${String(movement.data.effectiveAt.getDate()).padStart(2, '0')}`;
    if (!this.periodIndex.has(periodKey)) {
      this.periodIndex.set(periodKey, []);
    }
    this.periodIndex.get(periodKey)!.push(movement);

    return movement;
  }

  async findById(movementId: string): Promise<FinancialMovementRecord | null> {
    return this.items.get(movementId) ?? null;
  }

  async findByOrderId(orderId: string): Promise<FinancialMovementRecord[]> {
    const ids = this.orderIndex.get(orderId) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialMovementRecord[];
  }

  async findByVendorId(vendorId: string): Promise<FinancialMovementRecord[]> {
    const ids = this.vendorIndex.get(vendorId) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialMovementRecord[];
  }

  async findByMovementType(movementType: MovementType): Promise<FinancialMovementRecord[]> {
    const ids = this.movementTypeIndex.get(movementType) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialMovementRecord[];
  }

  async findByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<FinancialMovementRecord[]> {
    const key = `${entityType}:${entityId}`;
    const ids = this.entityIndex.get(key) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialMovementRecord[];
  }

  async findByPeriod(start: Date, end: Date): Promise<FinancialMovementRecord[]> {
    const results: FinancialMovementRecord[] = [];
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(23, 59, 59, 999);

    // Iterate day by day
    const current = new Date(startDay);
    while (current <= endDay) {
      const periodKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const dayMovements = this.periodIndex.get(periodKey) || [];
      results.push(...dayMovements);
      current.setDate(current.getDate() + 1);
    }

    return results;
  }

  async findAll(): Promise<FinancialMovementRecord[]> {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
    this.orderIndex.clear();
    this.vendorIndex.clear();
    this.movementTypeIndex.clear();
    this.entityIndex.clear();
    this.periodIndex.clear();
  }
}