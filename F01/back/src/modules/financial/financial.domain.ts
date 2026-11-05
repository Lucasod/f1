export enum FinancialAllocationType {
  CAPTURE = 'capture',
  REFUND = 'refund',
}

export enum FinancialError {
  ALLOCATION_NOT_FOUND = 'ALLOCATION_NOT_FOUND',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_REFERENCE = 'INVALID_REFERENCE',
  DUPLICATE_REFERENCE = 'DUPLICATE_REFERENCE',
}

export interface FinancialAllocationData {
  id: string;
  orderId: string;
  vendorId: string;
  type: FinancialAllocationType;
  gross: number;
  fees: number;
  adjustments: number;
  net: number;
  referenceId: string;
  createdAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class FinancialAllocation {
  public readonly id: string;
  public readonly orderId: string;
  public readonly vendorId: string;
  public readonly type: FinancialAllocationType;
  public readonly gross: number;
  public readonly fees: number;
  public readonly adjustments: number;
  public readonly net: number;
  public readonly referenceId: string;
  public readonly createdAt: Date;

  private constructor(data: FinancialAllocationData) {
    this.id = data.id;
    this.orderId = data.orderId;
    this.vendorId = data.vendorId;
    this.type = data.type;
    this.gross = data.gross;
    this.fees = data.fees;
    this.adjustments = data.adjustments;
    this.net = data.net;
    this.referenceId = data.referenceId;
    this.createdAt = data.createdAt;
  }

  static create(data: {
    orderId: string;
    vendorId: string;
    type: FinancialAllocationType;
    gross: number;
    fees: number;
    adjustments?: number;
    net: number;
    referenceId: string;
  }): FinancialAllocation {
    if (typeof data.orderId !== 'string' || data.orderId.trim().length === 0) {
      throw new Error(FinancialError.INVALID_REFERENCE);
    }
    if (typeof data.vendorId !== 'string' || data.vendorId.trim().length === 0) {
      throw new Error(FinancialError.INVALID_REFERENCE);
    }
    if (!Object.values(FinancialAllocationType).includes(data.type)) {
      throw new Error(FinancialError.INVALID_REFERENCE);
    }
    if (typeof data.referenceId !== 'string' || data.referenceId.trim().length === 0) {
      throw new Error(FinancialError.INVALID_REFERENCE);
    }
    const adjustments = data.adjustments ?? 0;
    const now = new Date();
    return new FinancialAllocation({
      id: generateId(),
      orderId: data.orderId.trim(),
      vendorId: data.vendorId.trim(),
      type: data.type,
      gross: data.gross,
      fees: data.fees,
      adjustments,
      net: data.net,
      referenceId: data.referenceId.trim(),
      createdAt: now,
    });
  }

  static reconstruct(data: FinancialAllocationData): FinancialAllocation {
    return new FinancialAllocation(data);
  }

  toJSON(): FinancialAllocationData {
    return {
      id: this.id,
      orderId: this.orderId,
      vendorId: this.vendorId,
      type: this.type,
      gross: this.gross,
      fees: this.fees,
      adjustments: this.adjustments,
      net: this.net,
      referenceId: this.referenceId,
      createdAt: this.createdAt,
    };
  }
}

export interface FinancialAllocationRepository {
  save(allocation: FinancialAllocation): Promise<FinancialAllocation>;
  findById(id: string): Promise<FinancialAllocation | null>;
  findByOrderId(orderId: string): Promise<FinancialAllocation[]>;
  findByVendorId(vendorId: string): Promise<FinancialAllocation[]>;
  findByReferenceId(referenceId: string): Promise<FinancialAllocation | null>;
  findAll(): Promise<FinancialAllocation[]>;
}

export class InMemoryFinancialAllocationRepository implements FinancialAllocationRepository {
  private readonly items = new Map<string, FinancialAllocation>();
  private readonly refIndex = new Map<string, string>();

  async save(allocation: FinancialAllocation): Promise<FinancialAllocation> {
    this.items.set(allocation.id, allocation);
    this.refIndex.set(allocation.referenceId, allocation.id);
    return allocation;
  }

  async findById(id: string): Promise<FinancialAllocation | null> {
    return this.items.get(id) ?? null;
  }

  async findByOrderId(orderId: string): Promise<FinancialAllocation[]> {
    return [...this.items.values()].filter(a => a.orderId === orderId);
  }

  async findByVendorId(vendorId: string): Promise<FinancialAllocation[]> {
    return [...this.items.values()].filter(a => a.vendorId === vendorId);
  }

  async findByReferenceId(referenceId: string): Promise<FinancialAllocation | null> {
    const id = this.refIndex.get(referenceId);
    if (!id) return null;
    return this.items.get(id) ?? null;
  }

  async findAll(): Promise<FinancialAllocation[]> {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
    this.refIndex.clear();
  }
}
