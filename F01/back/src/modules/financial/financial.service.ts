import {
  FinancialAllocation,
  FinancialAllocationType,
  FinancialAllocationRepository,
} from './financial.domain';

export class FinancialService {
  constructor(private readonly repo: FinancialAllocationRepository) {}

  async createAllocation(
    orderId: string,
    vendorId: string,
    type: FinancialAllocationType,
    gross: number,
    fees: number,
    net: number,
    referenceId: string,
    adjustments: number = 0,
  ): Promise<FinancialAllocation> {
    const existing = await this.repo.findByReferenceId(referenceId);
    if (existing) return existing;

    const allocation = FinancialAllocation.create({
      orderId,
      vendorId,
      type,
      gross,
      fees,
      adjustments,
      net,
      referenceId,
    });
    return this.repo.save(allocation);
  }

  async listByOrder(orderId: string): Promise<FinancialAllocation[]> {
    return this.repo.findByOrderId(orderId);
  }

  async listByVendor(vendorId: string): Promise<FinancialAllocation[]> {
    return this.repo.findByVendorId(vendorId);
  }

  async findAll(): Promise<FinancialAllocation[]> {
    return this.repo.findAll();
  }
}
