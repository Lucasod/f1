export enum TransferStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed'
}

export interface TransferData {
  id: string;
  orderId: string;
  orderVendorGroupId: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  providerTransactionId?: string;
  stripeTransferId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class Transfer {
  public readonly id: string;
  public readonly orderId: string;
  public readonly orderVendorGroupId: string;
  public amount: number;
  public currency: string;
  public status: TransferStatus;
  public providerTransactionId?: string;
  public stripeTransferId?: string;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: TransferData) {
    this.id = data.id;
    this.orderId = data.orderId;
    this.orderVendorGroupId = data.orderVendorGroupId;
    this.amount = data.amount;
    this.currency = data.currency;
    this.status = data.status;
    this.providerTransactionId = data.providerTransactionId;
    this.stripeTransferId = data.stripeTransferId;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: {
    orderId: string;
    orderVendorGroupId: string;
    amount: number;
    currency: string;
  }): Transfer {
    const now = new Date();
    return new Transfer({
      id: `${data.orderId}-transfer-${data.orderVendorGroupId}`,
      orderId: data.orderId,
      orderVendorGroupId: data.orderVendorGroupId,
      amount: data.amount,
      currency: data.currency,
      status: TransferStatus.PENDING,
      createdAt: now,
      updatedAt: now
    });
  }

  complete(): void {
    this.status = TransferStatus.COMPLETED;
    this.updatedAt = new Date();
  }

  fail(): void {
    this.status = TransferStatus.FAILED;
    this.updatedAt = new Date();
  }

  reverse(): void {
    this.status = TransferStatus.REVERSED;
    this.updatedAt = new Date();
  }

  toJSON(): TransferData {
    return {
      id: this.id,
      orderId: this.orderId,
      orderVendorGroupId: this.orderVendorGroupId,
      amount: this.amount,
      currency: this.currency,
      status: this.status,
      providerTransactionId: this.providerTransactionId,
      stripeTransferId: this.stripeTransferId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static reconstruct(data: TransferData): Transfer {
    return new Transfer(data);
  }
}