import { Link } from 'react-router-dom';
import { Button, Card } from '@/components/ui';

export function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <Card variant="elevated" padding="lg" className="text-center max-w-3xl mx-auto">
        <div className="text-4xl mb-4" aria-hidden="true">🛍️</div>
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Discover products from independent sellers
        </h2>
        <p className="text-gray-600 mb-8 text-lg">
          Browse a growing selection of products from trusted marketplace sellers.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" asChild>
            <Link to="/products" className="w-full">
              Browse Products
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/register" className="w-full">
              Create Account
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}