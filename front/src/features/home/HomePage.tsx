import { useAuth } from '../../app/providers/AuthProvider';
import { Link, useNavigate } from 'react-router-dom';

export function HomePage() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900">FS-01 Marketplace</h1>
          <nav className="flex items-center space-x-4">
            {isAuthenticated ? (
              <>
                <span className="text-gray-700">
                  Welcome, {user?.name} ({user?.roles.join(', ')})
                </span>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-blue-600 hover:underline">
                  Login
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Register
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Welcome to FS-01 Marketplace
          </h2>
          <p className="text-gray-600 mb-8">
            Your marketplace for buying and selling products.
          </p>
          
          {isAuthenticated ? (
            <div className="space-x-4 justify-center">
              {user?.roles.includes('VENDOR') && (
                <Link
                  to="/vendor/dashboard"
                  className="inline-block px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Vendor Dashboard
                </Link>
              )}
              {user?.roles.includes('ADMIN') && (
                <Link
                  to="/admin/dashboard"
                  className="inline-block px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  Admin Dashboard
                </Link>
              )}
              <Link
                to="/products"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Browse Products
              </Link>
            </div>
          ) : (
            <div className="space-x-4 justify-center">
              <Link
                to="/register"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Get Started
              </Link>
              <Link
                to="/login"
                className="inline-block px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Login
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}