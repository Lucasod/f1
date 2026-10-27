import { Link } from 'react-router-dom';
import { Product } from '@/shared/api/product';

interface ProductCardProps {
  product: Product;
}

function getStatusBadge(status: Product['status'], quantity: number) {
  if (quantity === 0 || status === 'out_of_stock') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        Out of Stock
      </span>
    );
  }
  
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          In Stock
        </span>
      );
    case 'inactive':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Inactive
        </span>
      );
    case 'discontinued':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Discontinued
        </span>
      );
    default:
      return null;
  }
}

function getImageUrl(images: string[]): string {
  if (images.length === 0) {
    return '/placeholder-product.svg';
  }
  return `/api/v1/uploads/${images[0]}`;
}

export function ProductCard({ product }: ProductCardProps) {
  const imageUrl = getImageUrl(product.images);
  const statusBadge = getStatusBadge(product.status, product.quantity);

  return (
    <article className="group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-200">
      <Link to={`/products/${product.id}`} className="block focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg">
        <div className="aspect-square bg-gray-100 relative overflow-hidden">
          <img
            src={imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
          <div className="absolute top-2 right-2">
            {statusBadge}
          </div>
        </div>
        
        <div className="p-4">
          <h3 className="font-semibold text-gray-900 truncate" role="heading">
            {product.name}
          </h3>
          <p className="mt-1 text-lg font-bold text-gray-900">
            ${product.price.toFixed(2)}
          </p>
        </div>
      </Link>
    </article>
  );
}