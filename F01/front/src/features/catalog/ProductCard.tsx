import { Link } from 'react-router-dom';
import { Product } from '@/shared/api/product';
import { Badge } from '@/components/ui';
import { Card } from '@/components/ui';

interface ProductCardProps {
  product: Product;
}

function getStatusVariant(status: Product['status'], quantity: number): 'success' | 'error' | 'neutral' {
  if (quantity === 0 || status === 'out_of_stock') {
    return 'error';
  }
  
  switch (status) {
    case 'active':
      return 'success';
    case 'inactive':
    case 'discontinued':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function getStatusLabel(status: Product['status'], quantity: number): string {
  if (quantity === 0 || status === 'out_of_stock') {
    return 'Out of Stock';
  }
  
  switch (status) {
    case 'active':
      return 'In Stock';
    case 'inactive':
      return 'Inactive';
    case 'discontinued':
      return 'Discontinued';
    default:
      return 'Unknown';
  }
}

function getImageUrl(images: string[]): string {
  if (images.length === 0) {
    return '/placeholder-product.svg';
  }
  return `/api/v1/uploads/${images[0]}`;
}

const PLACEHOLDER_IMAGE = '/placeholder-product.svg';

export function ProductCard({ product }: ProductCardProps) {
  const imageUrl = getImageUrl(product.images);
  const statusVariant = getStatusVariant(product.status, product.quantity);
  const statusLabel = getStatusLabel(product.status, product.quantity);

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const target = event.target as HTMLImageElement;
    if (target.src !== PLACEHOLDER_IMAGE) {
      target.src = PLACEHOLDER_IMAGE;
    }
  };

  return (
    <Card variant="bordered" padding="none" className="group overflow-hidden hover:shadow-md transition-shadow duration-200" role="article">
      <Link
        to={`/products/${product.id}`}
        className="block focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-xl"
        aria-label={`View ${product.name} details`}
      >
        <div className="aspect-square bg-gray-100 relative overflow-hidden">
          <img
            src={imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={handleImageError}
          />
          <div className="absolute top-2 right-2">
            <Badge variant={statusVariant} size="sm" dot>
              {statusLabel}
            </Badge>
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
    </Card>
  );
}