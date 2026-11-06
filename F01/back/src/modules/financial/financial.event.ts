export enum EventType {
  PAYMENT_AUTHORIZED = 'payment_authorized',
  PAYMENT_CAPTURED = 'payment_captured',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_REFUNDED = 'payment_refunded',
  TRANSFER_INITIATED = 'transfer_initiated',
  TRANSFER_COMPLETED = 'transfer_completed',
  TRANSFER_FAILED = 'transfer_failed',
  TRANSFER_REVERSED = 'transfer_reversed',
  PAYOUT_REQUESTED = 'payout_requested',
  PAYOUT_APPROVED = 'payout_approved',
  PAYOUT_PROCESSING = 'payout_processing',
  PAYOUT_COMPLETED = 'payout_completed',
  PAYOUT_FAILED = 'payout_failed',
  PAYOUT_CANCELLED = 'payout_cancelled',
  ORDER_CREATED = 'order_created',
  ORDER_STATUS_CHANGED = 'order_status_changed',
}

export interface FinancialEventData {
  eventId: string;
  eventType: EventType;
  eventSource: 'internal' | 'external';
  eventTimestamp: Date;
  orderId?: string;
  paymentId?: string;
  ovgId?: string;
  vendorId?: string;
  metadata?: Record<string, unknown>;
  relatedEntityType?: 'payment' | 'transfer' | 'payout' | 'invoice';
  relatedEntityId?: string;
}

export interface FinancialEvent {
  readonly eventId: string;
  readonly eventType: EventType;
  readonly eventSource: 'internal' | 'external';
  readonly eventTimestamp: Date;
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly ovgId?: string;
  readonly vendorId?: string;
  readonly metadata?: Record<string, unknown>;
}

function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class FinancialEventRecord {
  public readonly data: FinancialEventData;

  private constructor(data: FinancialEventData) {
    this.data = data;
  }

  static create(data: {
    eventType: EventType;
    eventSource: 'internal' | 'external';
    eventTimestamp: Date;
    orderId?: string;
    paymentId?: string;
    ovgId?: string;
    vendorId?: string;
    metadata?: Record<string, unknown>;
  }): FinancialEventRecord {
    const eventId = generateEventId();
    const now = new Date();

    const eventData: FinancialEventData = {
      eventId,
      eventType: data.eventType,
      eventSource: data.eventSource,
      eventTimestamp: data.eventTimestamp,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      metadata: data.metadata,
    };

    return new FinancialEventRecord(eventData);
  }

  static fromExistingEvent(data: Partial<FinancialEventData>): FinancialEventRecord {
    const eventId = data.eventId ?? generateEventId();
    const now = new Date();

    const eventData: FinancialEventData = {
      eventId,
      eventType: data.eventType!,
      eventSource: data.eventSource ?? 'internal',
      eventTimestamp: data.eventTimestamp!,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      metadata: data.metadata,
    };

    return new FinancialEventRecord(eventData);
  }

  toJSON(): FinancialEventData {
    return { ...this.data };
  }
}

export interface FinancialEventRepository {
  save(event: FinancialEventRecord): Promise<FinancialEventRecord>;
  findById(eventId: string): Promise<FinancialEventRecord | null>;
  findByType(eventType: EventType): Promise<FinancialEventRecord[]>;
  findByOrderId(orderId: string): Promise<FinancialEventRecord[]>;
  findByVendorId(vendorId: string): Promise<FinancialEventRecord[]>;
  findByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<FinancialEventRecord[]>;
  findAll(): Promise<FinancialEventRecord[]>;
}

export class InMemoryFinancialEventRepository implements FinancialEventRepository {
  private readonly items = new Map<string, FinancialEventRecord>();
  private readonly typeIndex = new Map<EventType, Set<string>>();
  private readonly orderIndex = new Map<string, Set<string>>();
  private readonly vendorIndex = new Map<string, Set<string>>();
  private readonly entityIndex = new Map<string, Set<string>>();

  async save(event: FinancialEventRecord): Promise<FinancialEventRecord> {
    const id = event.data.eventId;
    this.items.set(id, event);

    // Type index
    if (!this.typeIndex.has(event.data.eventType)) {
      this.typeIndex.set(event.data.eventType, new Set());
    }
    this.typeIndex.get(event.data.eventType)!.add(id);

    // Order index
    if (event.data.orderId) {
      if (!this.orderIndex.has(event.data.orderId)) {
        this.orderIndex.set(event.data.orderId, new Set());
      }
      this.orderIndex.get(event.data.orderId)!.add(id);
    }

    // Vendor index
    if (event.data.vendorId) {
      if (!this.vendorIndex.has(event.data.vendorId)) {
        this.vendorIndex.set(event.data.vendorId, new Set());
      }
      this.vendorIndex.get(event.data.vendorId)!.add(id);
    }

    // Entity index: "payment:pe123" or "transfer:tr456"
    const entityKey = `${event.data.relatedEntityType}:${event.data.relatedEntityId}`;
    // We don't store relatedEntityType/Id in the event by default since events
    // use the existing eventId/originalEventId chains from Payment/Transfer/Payout

    return event;
  }

  async findById(eventId: string): Promise<FinancialEventRecord | null> {
    return this.items.get(eventId) ?? null;
  }

  async findByType(eventType: EventType): Promise<FinancialEventRecord[]> {
    const ids = this.typeIndex.get(eventType) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialEventRecord[];
  }

  async findByOrderId(orderId: string): Promise<FinancialEventRecord[]> {
    const ids = this.orderIndex.get(orderId) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialEventRecord[];
  }

  async findByVendorId(vendorId: string): Promise<FinancialEventRecord[]> {
    const ids = this.vendorIndex.get(vendorId) || new Set();
    return [...ids].map(id => this.items.get(id)).filter(Boolean) as FinancialEventRecord[];
  }

  async findByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<FinancialEventRecord[]> {
    // Events are linked through the existing eventId/originalEventId chains
    // This method searches across all events for ones related to a given entity
    const results: FinancialEventRecord[] = [];
    for (const event of this.items.values()) {
      // Check if the event's orderId or paymentId matches
      if (event.data.orderId === entityId || event.data.paymentId === entityId) {
        results.push(event);
      }
    }
    return results;
  }

  async findAll(): Promise<FinancialEventRecord[]> {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
    this.typeIndex.clear();
    this.orderIndex.clear();
    this.vendorIndex.clear();
    this.entityIndex.clear();
  }
}