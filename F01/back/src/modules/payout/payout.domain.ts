export enum PayoutStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export const VALID_PAYOUT_STATUSES: PayoutStatus[] = Object.values(PayoutStatus);

export enum PayoutError {
  PAYOUT_NOT_FOUND = 'PAYOUT_NOT_FOUND',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  INVALID_PERSON_ID = 'INVALID_PERSON_ID',
  PAYOUT_NOT_APPROVABLE = 'PAYOUT_NOT_APPROVABLE',
  PAYOUT_NOT_PROCESSABLE = 'PAYOUT_NOT_PROCESSABLE',
  PAYOUT_PROVIDER_UNAVAILABLE = 'PAYOUT_PROVIDER_UNAVAILABLE',
  PAYOUT_NOT_CANCELLABLE = 'PAYOUT_NOT_CANCELLABLE',
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
}

const VALID_PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  [PayoutStatus.PENDING]: [PayoutStatus.APPROVED, PayoutStatus.CANCELLED],
  [PayoutStatus.APPROVED]: [PayoutStatus.PROCESSING, PayoutStatus.CANCELLED],
  [PayoutStatus.PROCESSING]: [PayoutStatus.COMPLETED, PayoutStatus.FAILED],
  [PayoutStatus.COMPLETED]: [],
  [PayoutStatus.FAILED]: [],
  [PayoutStatus.CANCELLED]: [],
};

export interface PayoutData {
  id: string;
  vendorId: string;
  personId: string;
  amount: number;
  status: PayoutStatus;
  requestedAt: Date;
  processedAt?: Date;
  failureReason?: string;
  reference?: string;
  bankAccount?: string;
  createdAt: Date;
  updatedAt: Date;
  eventId?: string;
  originalEventId?: string;
  eventType?: string;
  eventSource?: string;
  eventTimestamp?: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class Payout {
  public readonly id: string;
  public readonly vendorId: string;
  public readonly personId: string;
  public readonly amount: number;
  public status: PayoutStatus;
  public requestedAt: Date;
  public processedAt?: Date;
  public failureReason?: string;
  public reference?: string;
  public bankAccount?: string;
  public readonly createdAt: Date;
  public updatedAt: Date;

  // New fields for MP-29 immutable event tracking
  public readonly eventId: string;
  public originalEventId?: string;
  public eventType?: string;
  public eventSource?: string;
  public eventTimestamp?: Date;

  private constructor(data: PayoutData) {
    this.id = data.id;
    this.vendorId = data.vendorId;
    this.personId = data.personId;
    this.amount = data.amount;
    this.status = data.status;
    this.requestedAt = data.requestedAt;
    this.processedAt = data.processedAt;
    this.failureReason = data.failureReason;
    this.reference = data.reference;
    this.bankAccount = data.bankAccount;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.eventId = data.eventId ?? generateId();
    this.originalEventId = data.originalEventId;
    this.eventType = data.eventType;
    this.eventSource = data.eventSource;
    this.eventTimestamp = data.eventTimestamp;
  }

  static create(data: {
    vendorId: string;
    personId: string;
    amount: number;
    bankAccount?: string;
    reference?: string;
  }): Payout {
    if (typeof data.vendorId !== 'string' || data.vendorId.trim().length === 0) {
      throw new Error(PayoutError.VENDOR_NOT_FOUND);
    }
    if (typeof data.personId !== 'string' || data.personId.trim().length === 0) {
      throw new Error(PayoutError.INVALID_PERSON_ID);
    }
    if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error(PayoutError.INVALID_AMOUNT);
    }

    const now = new Date();
    const eventId = generateId();
    return new Payout({
      id: generateId(),
      vendorId: data.vendorId.trim(),
      personId: data.personId.trim(),
      amount: data.amount,
      status: PayoutStatus.PENDING,
      requestedAt: now,
      bankAccount:
        typeof data.bankAccount === 'string' && data.bankAccount.trim().length > 0
          ? data.bankAccount.trim()
          : undefined,
      reference:
        typeof data.reference === 'string' && data.reference.trim().length > 0
          ? data.reference.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
      eventId: eventId,
      originalEventId: undefined,
      eventType: 'payout_requested',
      eventSource: 'internal',
      eventTimestamp: now,
    });
  }

  static reconstruct(data: PayoutData): Payout {
    return new Payout(data);
  }

  private static eventTypeForStatus(status: PayoutStatus): string {
    switch (status) {
      case PayoutStatus.PENDING:
        return 'payout_requested';
      case PayoutStatus.APPROVED:
        return 'payout_approved';
      case PayoutStatus.PROCESSING:
        return 'payout_processing';
      case PayoutStatus.COMPLETED:
        return 'payout_completed';
      case PayoutStatus.FAILED:
        return 'payout_failed';
      case PayoutStatus.CANCELLED:
        return 'payout_cancelled';
      default:
        return 'payout_unknown';
    }
  }

  transitionTo(newStatus: PayoutStatus): Payout {
    if (this.status === newStatus) {
      return new Payout({
        id: this.id,
        vendorId: this.vendorId,
        personId: this.personId,
        amount: this.amount,
        status: newStatus,
        requestedAt: this.requestedAt,
        processedAt: newStatus === PayoutStatus.COMPLETED ? new Date() : this.processedAt,
        failureReason: this.failureReason,
        reference: this.reference,
        bankAccount: this.bankAccount,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        eventId: generateId(),
        originalEventId: this.eventId,
        eventType: Payout.eventTypeForStatus(newStatus),
        eventSource: 'internal',
        eventTimestamp: new Date(),
      });
    }
    const allowed = VALID_PAYOUT_TRANSITIONS[this.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(PayoutError.INVALID_STATUS_TRANSITION);
    }
    return new Payout({
      id: this.id,
      vendorId: this.vendorId,
      personId: this.personId,
      amount: this.amount,
      status: newStatus,
      requestedAt: this.requestedAt,
      processedAt: newStatus === PayoutStatus.COMPLETED ? new Date() : this.processedAt,
      failureReason: this.failureReason,
      reference: this.reference,
      bankAccount: this.bankAccount,
      createdAt: this.createdAt,
      updatedAt: new Date(),
      eventId: generateId(),
      originalEventId: this.eventId,
      eventType: Payout.eventTypeForStatus(newStatus),
      eventSource: 'internal',
      eventTimestamp: new Date(),
    });
  }

  canTransitionTo(status: PayoutStatus): boolean {
    return VALID_PAYOUT_TRANSITIONS[this.status].includes(status);
  }

  approve(): void {
    const newPayout = this.transitionTo(PayoutStatus.APPROVED);
    this.status = newPayout.status;
    this.updatedAt = newPayout.updatedAt;
    this.originalEventId = newPayout.originalEventId;
    this.eventType = newPayout.eventType;
    this.eventSource = newPayout.eventSource;
    this.eventTimestamp = newPayout.eventTimestamp;
  }

  startProcessing(): void {
    const newPayout = this.transitionTo(PayoutStatus.PROCESSING);
    this.status = newPayout.status;
    this.updatedAt = newPayout.updatedAt;
    this.originalEventId = newPayout.originalEventId;
    this.eventType = newPayout.eventType;
    this.eventSource = newPayout.eventSource;
    this.eventTimestamp = newPayout.eventTimestamp;
  }

  complete(): void {
    const newPayout = this.transitionTo(PayoutStatus.COMPLETED);
    this.status = newPayout.status;
    this.updatedAt = newPayout.updatedAt;
    this.processedAt = newPayout.processedAt;
    this.originalEventId = newPayout.originalEventId;
    this.eventType = newPayout.eventType;
    this.eventSource = newPayout.eventSource;
    this.eventTimestamp = newPayout.eventTimestamp;
  }

  fail(reason: string): void {
    const newPayout = this.transitionTo(PayoutStatus.FAILED);
    this.status = newPayout.status;
    this.updatedAt = newPayout.updatedAt;
    this.failureReason = typeof reason === 'string' ? reason.trim() : reason;
    this.originalEventId = newPayout.originalEventId;
    this.eventType = newPayout.eventType;
    this.eventSource = newPayout.eventSource;
    this.eventTimestamp = newPayout.eventTimestamp;
  }

  cancel(): void {
    const newPayout = this.transitionTo(PayoutStatus.CANCELLED);
    this.status = newPayout.status;
    this.updatedAt = newPayout.updatedAt;
    this.originalEventId = newPayout.originalEventId;
    this.eventType = newPayout.eventType;
    this.eventSource = newPayout.eventSource;
    this.eventTimestamp = newPayout.eventTimestamp;
  }

  toJSON(): PayoutData {
    return {
      id: this.id,
      vendorId: this.vendorId,
      personId: this.personId,
      amount: this.amount,
      status: this.status,
      requestedAt: this.requestedAt,
      processedAt: this.processedAt,
      failureReason: this.failureReason,
      reference: this.reference,
      bankAccount: this.bankAccount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      eventId: this.eventId,
      originalEventId: this.originalEventId,
      eventType: this.eventType,
      eventSource: this.eventSource,
      eventTimestamp: this.eventTimestamp,
    };
  }
}

export interface PayoutRepository {
  save(payout: Payout): Promise<Payout>;
  findById(id: string): Promise<Payout | null>;
  findByVendorId(vendorId: string): Promise<Payout[]>;
  findByPersonId(personId: string): Promise<Payout[]>;
  findAll(): Promise<Payout[]>;
  update(payout: Payout): Promise<Payout>;
}

export class InMemoryPayoutRepository implements PayoutRepository {
  private readonly payouts = new Map<string, Payout>();
  private readonly vendorIndex = new Map<string, Set<string>>();
  private readonly personIndex = new Map<string, Set<string>>();

  async save(payout: Payout): Promise<Payout> {
    this.payouts.set(payout.id, payout);
    if (!this.vendorIndex.has(payout.vendorId)) {
      this.vendorIndex.set(payout.vendorId, new Set());
    }
    this.vendorIndex.get(payout.vendorId)!.add(payout.id);
    if (!this.personIndex.has(payout.personId)) {
      this.personIndex.set(payout.personId, new Set());
    }
    this.personIndex.get(payout.personId)!.add(payout.id);
    return payout;
  }

  async findById(id: string): Promise<Payout | null> {
    return this.payouts.get(id) ?? null;
  }

  async findByVendorId(vendorId: string): Promise<Payout[]> {
    const ids = this.vendorIndex.get(vendorId);
    if (!ids) return [];
    return [...ids]
      .map(id => this.payouts.get(id))
      .filter((p): p is Payout => Boolean(p));
  }

  async findByPersonId(personId: string): Promise<Payout[]> {
    const ids = this.personIndex.get(personId);
    if (!ids) return [];
    return [...ids]
      .map(id => this.payouts.get(id))
      .filter((p): p is Payout => Boolean(p));
  }

  async findAll(): Promise<Payout[]> {
    return [...this.payouts.values()];
  }

  async update(payout: Payout): Promise<Payout> {
    if (!this.payouts.has(payout.id)) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    this.payouts.set(payout.id, payout);
    // ensure indexes
    if (!this.vendorIndex.has(payout.vendorId)) {
      this.vendorIndex.set(payout.vendorId, new Set());
    }
    this.vendorIndex.get(payout.vendorId)!.add(payout.id);
    if (!this.personIndex.has(payout.personId)) {
      this.personIndex.set(payout.personId, new Set());
    }
    this.personIndex.get(payout.personId)!.add(payout.id);
    return payout;
  }

  clear(): void {
    this.payouts.clear();
    this.vendorIndex.clear();
    this.personIndex.clear();
  }
}
