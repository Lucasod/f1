export enum WalletTransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum WalletError {
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  DUPLICATE_REFERENCE = 'DUPLICATE_REFERENCE',
  INVALID_OWNER = 'INVALID_OWNER',
}

export interface WalletData {
  id: string;
  ownerId: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransactionData {
  id: string;
  walletId: string;
  ownerId: string;
  type: WalletTransactionType;
  amount: number;
  referenceId: string;
  reason: string;
  orderId?: string;
  createdAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class Wallet {
  public readonly id: string;
  public readonly ownerId: string;
  public balance: number;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: WalletData) {
    this.id = data.id;
    this.ownerId = data.ownerId;
    this.balance = data.balance;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(ownerId: string): Wallet {
    if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
      throw new Error(WalletError.INVALID_OWNER);
    }
    const now = new Date();
    return new Wallet({
      id: generateId(),
      ownerId: ownerId.trim(),
      balance: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(data: WalletData): Wallet {
    return new Wallet(data);
  }

  credit(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(WalletError.INVALID_AMOUNT);
    }
    this.balance = round2(this.balance + amount);
    this.updatedAt = new Date();
  }

  debit(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(WalletError.INVALID_AMOUNT);
    }
    if (this.balance < amount) {
      throw new Error(WalletError.INSUFFICIENT_BALANCE);
    }
    this.balance = round2(this.balance - amount);
    this.updatedAt = new Date();
  }

  toJSON(): WalletData {
    return {
      id: this.id,
      ownerId: this.ownerId,
      balance: this.balance,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class WalletTransaction {
  public readonly id: string;
  public readonly walletId: string;
  public readonly ownerId: string;
  public readonly type: WalletTransactionType;
  public readonly amount: number;
  public readonly referenceId: string;
  public readonly reason: string;
  public readonly orderId?: string;
  public readonly createdAt: Date;

  private constructor(data: WalletTransactionData) {
    this.id = data.id;
    this.walletId = data.walletId;
    this.ownerId = data.ownerId;
    this.type = data.type;
    this.amount = data.amount;
    this.referenceId = data.referenceId;
    this.reason = data.reason;
    this.orderId = data.orderId;
    this.createdAt = data.createdAt;
  }

  static create(data: {
    walletId: string;
    ownerId: string;
    type: WalletTransactionType;
    amount: number;
    referenceId: string;
    reason: string;
    orderId?: string;
  }): WalletTransaction {
    if (typeof data.walletId !== 'string' || data.walletId.trim().length === 0) {
      throw new Error(WalletError.WALLET_NOT_FOUND);
    }
    if (typeof data.ownerId !== 'string' || data.ownerId.trim().length === 0) {
      throw new Error(WalletError.INVALID_OWNER);
    }
    if (!Object.values(WalletTransactionType).includes(data.type)) {
      throw new Error(WalletError.INVALID_AMOUNT);
    }
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error(WalletError.INVALID_AMOUNT);
    }
    if (typeof data.referenceId !== 'string' || data.referenceId.trim().length === 0) {
      throw new Error(WalletError.DUPLICATE_REFERENCE);
    }
    const now = new Date();
    return new WalletTransaction({
      id: generateId(),
      walletId: data.walletId.trim(),
      ownerId: data.ownerId.trim(),
      type: data.type,
      amount: data.amount,
      referenceId: data.referenceId.trim(),
      reason: data.reason,
      orderId: data.orderId,
      createdAt: now,
    });
  }

  static reconstruct(data: WalletTransactionData): WalletTransaction {
    return new WalletTransaction(data);
  }

  toJSON(): WalletTransactionData {
    return {
      id: this.id,
      walletId: this.walletId,
      ownerId: this.ownerId,
      type: this.type,
      amount: this.amount,
      referenceId: this.referenceId,
      reason: this.reason,
      orderId: this.orderId,
      createdAt: this.createdAt,
    };
  }
}

export interface WalletRepository {
  save(wallet: Wallet): Promise<Wallet>;
  findById(id: string): Promise<Wallet | null>;
  findByOwnerId(ownerId: string): Promise<Wallet | null>;
  update(wallet: Wallet): Promise<Wallet>;
  findAll(): Promise<Wallet[]>;
}

export interface WalletTransactionRepository {
  save(tx: WalletTransaction): Promise<WalletTransaction>;
  findById(id: string): Promise<WalletTransaction | null>;
  findByWalletId(walletId: string): Promise<WalletTransaction[]>;
  findByReferenceId(referenceId: string): Promise<WalletTransaction | null>;
  findAll(): Promise<WalletTransaction[]>;
}

export class InMemoryWalletRepository implements WalletRepository {
  private readonly wallets = new Map<string, Wallet>();
  private readonly ownerIndex = new Map<string, string>();

  async save(wallet: Wallet): Promise<Wallet> {
    this.wallets.set(wallet.id, wallet);
    this.ownerIndex.set(wallet.ownerId, wallet.id);
    return wallet;
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByOwnerId(ownerId: string): Promise<Wallet | null> {
    const id = this.ownerIndex.get(ownerId);
    if (!id) return null;
    return this.wallets.get(id) ?? null;
  }

  async update(wallet: Wallet): Promise<Wallet> {
    if (!this.wallets.has(wallet.id)) {
      throw new Error(WalletError.WALLET_NOT_FOUND);
    }
    this.wallets.set(wallet.id, wallet);
    this.ownerIndex.set(wallet.ownerId, wallet.id);
    return wallet;
  }

  async findAll(): Promise<Wallet[]> {
    return [...this.wallets.values()];
  }

  clear(): void {
    this.wallets.clear();
    this.ownerIndex.clear();
  }
}

export class InMemoryWalletTransactionRepository implements WalletTransactionRepository {
  private readonly txs = new Map<string, WalletTransaction>();
  private readonly walletIndex = new Map<string, Set<string>>();
  private readonly referenceIndex = new Map<string, string>();

  async save(tx: WalletTransaction): Promise<WalletTransaction> {
    this.txs.set(tx.id, tx);
    if (!this.walletIndex.has(tx.walletId)) this.walletIndex.set(tx.walletId, new Set());
    this.walletIndex.get(tx.walletId)!.add(tx.id);
    this.referenceIndex.set(tx.referenceId, tx.id);
    return tx;
  }

  async findById(id: string): Promise<WalletTransaction | null> {
    return this.txs.get(id) ?? null;
  }

  async findByWalletId(walletId: string): Promise<WalletTransaction[]> {
    const ids = this.walletIndex.get(walletId);
    if (!ids) return [];
    return [...ids].map(id => this.txs.get(id)).filter((t): t is WalletTransaction => Boolean(t));
  }

  async findByReferenceId(referenceId: string): Promise<WalletTransaction | null> {
    const id = this.referenceIndex.get(referenceId);
    if (!id) return null;
    return this.txs.get(id) ?? null;
  }

  async findAll(): Promise<WalletTransaction[]> {
    return [...this.txs.values()];
  }

  clear(): void {
    this.txs.clear();
    this.walletIndex.clear();
    this.referenceIndex.clear();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
