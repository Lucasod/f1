import { InMemoryPersonRepository } from '../modules/person/person.domain';
import { InMemoryVendorRepository } from '../modules/vendor/vendor.domain';
import { InMemoryProductRepository, InMemoryCategoryRepository } from '../modules/product/product.domain';

/**
 * Interface defining the repositories required for seeding.
 * Allows dependency injection for testing and flexibility.
 */
export interface SeedRepositories {
  personRepo: InMemoryPersonRepository;
  vendorRepo: InMemoryVendorRepository;
  categoryRepo: InMemoryCategoryRepository;
  productRepo: InMemoryProductRepository;
}