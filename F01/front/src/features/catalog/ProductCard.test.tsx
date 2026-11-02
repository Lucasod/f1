import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from './ProductCard';
import { Product } from '@/shared/api/product';

const mockProduct: Product = {
  id: 'prod-1',
  vendorId: 'vendor-1',
  categoryId: 'cat-1',
  name: 'Test Product',
  description: 'A test product description',
  price: 29.99,
  quantity: 10,
  status: 'active',
  images: ['products/vendor-1/prod-1/main.jpg'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const renderProductCard = (product: Product = mockProduct) => {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>
  );
};

describe('ProductCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders product name', () => {
    renderProductCard();
    expect(screen.getByText('Test Product')).toBeInTheDocument();
  });

  it('renders product price formatted as currency', () => {
    renderProductCard();
    expect(screen.getByText('R$ 29,99')).toBeInTheDocument();
  });

  it('renders product image with correct src and alt', () => {
    renderProductCard();
    const img = screen.getByAltText('Test Product');
    expect(img).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/main.jpg');
  });

  it('shows in-stock badge when quantity > 0 and status is active', () => {
    renderProductCard();
    expect(screen.getByText('In Stock')).toBeInTheDocument();
    expect(screen.getByText('In Stock')).toHaveClass('bg-green-100');
    expect(screen.getByText('In Stock')).toHaveClass('text-green-800');
  });

  it('shows out-of-stock badge when quantity is 0', () => {
    const outOfStockProduct = { ...mockProduct, quantity: 0, status: 'out_of_stock' as const };
    renderProductCard(outOfStockProduct);
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    expect(screen.getByText('Out of Stock')).toHaveClass('bg-red-100');
    expect(screen.getByText('Out of Stock')).toHaveClass('text-red-800');
  });

  it('shows inactive badge when status is inactive', () => {
    const inactiveProduct = { ...mockProduct, status: 'inactive' as const };
    renderProductCard(inactiveProduct);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toHaveClass('bg-gray-100');
    expect(screen.getByText('Inactive')).toHaveClass('text-gray-800');
  });

  it('shows discontinued badge when status is discontinued', () => {
    const discontinuedProduct = { ...mockProduct, status: 'discontinued' as const };
    renderProductCard(discontinuedProduct);
    expect(screen.getByText('Discontinued')).toBeInTheDocument();
    expect(screen.getByText('Discontinued')).toHaveClass('bg-gray-100');
    expect(screen.getByText('Discontinued')).toHaveClass('text-gray-800');
  });

  it('has link to product detail page', () => {
    renderProductCard();
    const link = screen.getByRole('link', { name: /test product/i });
    expect(link).toHaveAttribute('href', '/products/prod-1');
  });

  it('has accessible article element with product name in heading', () => {
    renderProductCard();
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
  });

  it('uses placeholder image when no images array', () => {
    const productNoImages = { ...mockProduct, images: [] };
    renderProductCard(productNoImages);
    const img = screen.getByAltText('Test Product');
    expect(img).toHaveAttribute('src', '/placeholder-product.svg');
  });

  it('uses first image when multiple images exist', () => {
    const productMultipleImages = { 
      ...mockProduct, 
      images: ['products/vendor-1/prod-1/main.jpg', 'products/vendor-1/prod-1/secondary.jpg'] 
    };
    renderProductCard(productMultipleImages);
    const img = screen.getByAltText('Test Product');
    expect(img).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/main.jpg');
  });
});