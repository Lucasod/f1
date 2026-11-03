export enum InvoiceStatus {
  PENDING = 'pending',
  GENERATED = 'generated',
  SENT = 'sent',
}

export const VALID_INVOICE_STATUSES: InvoiceStatus[] = Object.values(InvoiceStatus);

export enum InvoiceError {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_ALREADY_EXISTS = 'INVOICE_ALREADY_EXISTS',
  INVALID_INVOICE = 'INVALID_INVOICE',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_NOT_ELIGIBLE = 'ORDER_NOT_ELIGIBLE',
}

export interface InvoiceData {
  id: string;
  orderId: string;
  vendorId: string;
  emissionAt: Date;
  pdfUrl: string;
  pdfPath: string;
  status: InvoiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class Invoice {
  public readonly id: string;
  public readonly orderId: string;
  public readonly vendorId: string;
  public emissionAt: Date;
  public pdfUrl: string;
  public pdfPath: string;
  public status: InvoiceStatus;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: InvoiceData) {
    this.id = data.id;
    this.orderId = data.orderId;
    this.vendorId = data.vendorId;
    this.emissionAt = data.emissionAt;
    this.pdfUrl = data.pdfUrl;
    this.pdfPath = data.pdfPath;
    this.status = data.status;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: {
    orderId: string;
    vendorId: string;
    emissionAt?: Date;
    pdfUrl?: string;
    pdfPath?: string;
    status?: InvoiceStatus;
  }): Invoice {
    if (typeof data.orderId !== 'string' || data.orderId.trim().length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    if (typeof data.vendorId !== 'string' || data.vendorId.trim().length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    if (data.status !== undefined && !Object.values(InvoiceStatus).includes(data.status)) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }

    const now = new Date();
    const emissionAt = data.emissionAt instanceof Date ? data.emissionAt : (data.emissionAt ? new Date(data.emissionAt as any) : now);

    return new Invoice({
      id: generateId(),
      orderId: data.orderId.trim(),
      vendorId: data.vendorId.trim(),
      emissionAt,
      pdfUrl: typeof data.pdfUrl === 'string' ? data.pdfUrl : '',
      pdfPath: typeof data.pdfPath === 'string' ? data.pdfPath : '',
      status: data.status ?? InvoiceStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(data: InvoiceData): Invoice {
    return new Invoice(data);
  }

  markSent(): void {
    this.status = InvoiceStatus.SENT;
    this.updatedAt = new Date();
  }

  markGenerated(pdfUrl: string, pdfPath: string): void {
    if (typeof pdfUrl !== 'string' || pdfUrl.trim().length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    if (typeof pdfPath !== 'string' || pdfPath.trim().length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    if (this.status !== InvoiceStatus.PENDING) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    this.pdfUrl = pdfUrl;
    this.pdfPath = pdfPath;
    this.status = InvoiceStatus.GENERATED;
    this.updatedAt = new Date();
  }

  toJSON(): InvoiceData {
    return {
      id: this.id,
      orderId: this.orderId,
      vendorId: this.vendorId,
      emissionAt: this.emissionAt,
      pdfUrl: this.pdfUrl,
      pdfPath: this.pdfPath,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  findByOrderId(orderId: string): Promise<Invoice | null>;
  findAll(): Promise<Invoice[]>;
  update(invoice: Invoice): Promise<Invoice>;
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly invoices = new Map<string, Invoice>();
  private readonly orderIndex = new Map<string, string>();

  async save(invoice: Invoice): Promise<Invoice> {
    this.invoices.set(invoice.id, invoice);
    this.orderIndex.set(invoice.orderId, invoice.id);
    return invoice;
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.invoices.get(id) ?? null;
  }

  async findByOrderId(orderId: string): Promise<Invoice | null> {
    const id = this.orderIndex.get(orderId);
    if (!id) return null;
    return this.invoices.get(id) ?? null;
  }

  async findAll(): Promise<Invoice[]> {
    return [...this.invoices.values()];
  }

  async update(invoice: Invoice): Promise<Invoice> {
    if (!this.invoices.has(invoice.id)) {
      throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    }
    this.invoices.set(invoice.id, invoice);
    this.orderIndex.set(invoice.orderId, invoice.id);
    return invoice;
  }

  clear(): void {
    this.invoices.clear();
    this.orderIndex.clear();
  }
}
