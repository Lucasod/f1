import { PersonRepository } from '../modules/person/person.domain';
import { VendorRepository } from '../modules/vendor/vendor.domain';
import { CategoryRepository, ProductRepository } from '../modules/product/product.domain';

/**
 * Interface defining the repositories required for seeding.
 * Allows dependency injection for testing and flexibility.
 */
export interface SeedRepositories {
  personRepo: PersonRepository;
  vendorRepo: VendorRepository;
  categoryRepo: CategoryRepository;
  productRepo: ProductRepository;
  searchIndex?: any;
}
