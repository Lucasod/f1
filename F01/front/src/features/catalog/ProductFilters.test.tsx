import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductFilters } from './ProductFilters';

interface ProductFiltersProps {
  categories: { id: string; name: string }[];
  selectedCategory: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'stock_status';
  onSortChange: (sortBy: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'stock_status') => void;
}

const mockCategories = [
  { id: 'cat-1', name: 'Electronics' },
  { id: 'cat-2', name: 'Clothing' },
  { id: 'cat-3', name: 'Books' },
];

const defaultProps: ProductFiltersProps = {
  categories: mockCategories,
  selectedCategory: null,
  onCategoryChange: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  sortBy: 'newest',
  onSortChange: vi.fn(),
};

const renderFilters = (props: Partial<ProductFiltersProps> = {}) => {
  return render(<ProductFilters {...defaultProps} {...props} />);
};

describe('ProductFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    renderFilters();
    const searchInput = screen.getByPlaceholderText(/search products/i);
    expect(searchInput).toBeInTheDocument();
  });

  it('calls onSearchChange when search input changes', () => {
    renderFilters();
    const searchInput = screen.getByPlaceholderText(/search products/i);
    fireEvent.change(searchInput, { target: { value: 'laptop' } });
    expect(defaultProps.onSearchChange).toHaveBeenCalledWith('laptop');
  });

  it('displays current search query in input', () => {
    renderFilters({ searchQuery: 'phone' });
    const searchInput = screen.getByPlaceholderText(/search products/i);
    expect(searchInput).toHaveValue('phone');
  });

  it('renders category filter dropdown', () => {
    renderFilters();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });

  it('shows "All Categories" as default option', () => {
    renderFilters();
    expect(screen.getByText('All Categories')).toBeInTheDocument();
  });

  it('lists all categories in dropdown', () => {
    renderFilters();
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Clothing')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('shows selected category as selected option', () => {
    renderFilters({ selectedCategory: 'cat-2' });
    expect(screen.getByLabelText(/category/i)).toHaveValue('cat-2');
  });

  it('calls onCategoryChange when category selection changes', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'cat-1' } });
    expect(defaultProps.onCategoryChange).toHaveBeenCalledWith('cat-1');
  });

  it('calls onCategoryChange with null when "All Categories" selected', () => {
    renderFilters({ selectedCategory: 'cat-1' });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: '' } });
    expect(defaultProps.onCategoryChange).toHaveBeenCalledWith(null);
  });

  it('renders sort dropdown', () => {
    renderFilters();
    const sortSelect = screen.getByLabelText(/sort by/i);
    expect(sortSelect).toBeInTheDocument();
  });

  it('shows all sort options', () => {
    renderFilters();
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByText('Name A-Z')).toBeInTheDocument();
    expect(screen.getByText('Price: Low to High')).toBeInTheDocument();
    expect(screen.getByText('Price: High to Low')).toBeInTheDocument();
    expect(screen.getByText('In-Stock First')).toBeInTheDocument();
  });

  it('shows selected stock_status sort option', () => {
    renderFilters({ sortBy: 'stock_status' });
    const sortSelect = screen.getByLabelText(/sort by/i);
    expect(sortSelect).toHaveValue('stock_status');
  });

  it('calls onSortChange when sort selection changes to stock_status', () => {
    renderFilters();
    const sortSelect = screen.getByLabelText(/sort by/i);
    fireEvent.change(sortSelect, { target: { value: 'stock_status' } });
    expect(defaultProps.onSortChange).toHaveBeenCalledWith('stock_status');
  });

  it('shows selected sort option', () => {
    renderFilters({ sortBy: 'price_asc' });
    const sortSelect = screen.getByLabelText(/sort by/i);
    expect(sortSelect).toHaveValue('price_asc');
  });

  it('calls onSortChange when sort selection changes', () => {
    renderFilters();
    const sortSelect = screen.getByLabelText(/sort by/i);
    fireEvent.change(sortSelect, { target: { value: 'price_desc' } });
    expect(defaultProps.onSortChange).toHaveBeenCalledWith('price_desc');
  });

  it('has accessible form markup with labels', () => {
    renderFilters();
    expect(screen.getByLabelText(/search products/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sort by/i)).toBeInTheDocument();
  });

  it('displays filters in responsive grid layout', () => {
    renderFilters();
    const container = screen.getByTestId('product-filters');
    expect(container).toHaveClass('grid');
    expect(container).toHaveClass('gap-4');
  });
});