import { Input, Select } from '@/components/ui';

interface ProductFiltersProps {
  categories: { id: string; name: string }[];
  selectedCategory: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'stock_status';
  onSortChange: (sortBy: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'stock_status') => void;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'stock_status', label: 'In-Stock First' },
];

export function ProductFilters({
  categories,
  selectedCategory,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
}: ProductFiltersProps) {
  return (
    <div data-testid="product-filters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="lg:col-span-2">
        <Input
          id="search"
          type="search"
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search products"
          label="Search"
        />
      </div>

      <div>
        <Select
          id="category"
          label="Category"
          value={selectedCategory || ''}
          onChange={(e) => onCategoryChange(e.target.value || null)}
          options={[
            { value: '', label: 'All Categories' },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          aria-label="Category"
        />
      </div>

      <div>
        <Select
          id="sort"
          label="Sort by"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as typeof sortBy)}
          options={SORT_OPTIONS}
          aria-label="Sort by"
        />
      </div>
    </div>
  );
}