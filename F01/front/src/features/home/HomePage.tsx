export function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Welcome to FS-01 Marketplace
        </h2>
        <p className="text-gray-600 mb-8">
          Your marketplace for buying and selling products.
        </p>
        
        <div className="space-x-4 justify-center">
          <a
            href="/products"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Browse Products
          </a>
        </div>
      </div>
    </div>
  );
}