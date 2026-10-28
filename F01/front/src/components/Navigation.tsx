import { useAuth } from '@/app/providers/AuthProvider';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui';

export function Navigation() {
  const { user, isAuthenticated, isLoading, hasRole, logout } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <nav className="bg-white shadow-sm" role="navigation" aria-label="Main navigation">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="animate-pulse flex items-center justify-between" role="status" aria-live="polite">
            <div className="h-6 w-32 bg-gray-200 rounded" aria-hidden="true" />
            <div className="flex items-center space-x-4">
              <div className="h-8 w-24 bg-gray-200 rounded" aria-hidden="true" />
              <div className="h-8 w-24 bg-gray-200 rounded" aria-hidden="true" />
            </div>
            <span className="sr-only">Loading...</span>
          </div>
        </div>
      </nav>
    );
  }

  const navLinkClassName = (isActive: boolean) => `
    px-3 py-2 rounded-md text-sm font-medium transition-colors
    ${isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'}
  `;

  const vendorNavLinkClassName = (isActive: boolean) => `
    px-3 py-2 rounded-md text-sm font-medium transition-colors
    ${isActive ? 'bg-green-100 text-green-700' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'}
  `;

  const adminNavLinkClassName = (isActive: boolean) => `
    px-3 py-2 rounded-md text-sm font-medium transition-colors
    ${isActive ? 'bg-purple-100 text-purple-700' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'}
  `;

  return (
    <nav className="bg-white shadow-sm" role="navigation" aria-label="Main navigation">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <Link to="/" className="text-xl font-bold text-gray-900" aria-label="FS-01 Marketplace Home">
          FS-01 Marketplace
        </Link>

        <ul className="flex items-center space-x-4" role="menubar">
          {isAuthenticated ? (
            <>
              <li role="none">
                <Link
                  to="/products"
                  className={navLinkClassName(location.pathname === '/products')}
                  role="menuitem"
                >
                  Browse Products
                </Link>
              </li>

              {hasRole('VENDOR') && (
                <>
                  <li role="none">
                    <Link
                      to="/vendor/dashboard"
                      className={vendorNavLinkClassName(location.pathname.startsWith('/vendor'))}
                      role="menuitem"
                    >
                      Vendor Dashboard
                    </Link>
                  </li>
                  <li role="none">
                    <Link
                      to="/vendor/products"
                      className={vendorNavLinkClassName(location.pathname === '/vendor/products')}
                      role="menuitem"
                    >
                      Vendor Products
                    </Link>
                  </li>
                </>
              )}

              {hasRole('ADMIN') && (
                <>
                  <li role="none">
                    <Link
                      to="/admin/dashboard"
                      className={adminNavLinkClassName(location.pathname.startsWith('/admin'))}
                      role="menuitem"
                    >
                      Admin Dashboard
                    </Link>
                  </li>
                  <li role="none">
                    <Link
                      to="/admin/users"
                      className={adminNavLinkClassName(location.pathname === '/admin/users')}
                      role="menuitem"
                    >
                      Admin Users
                    </Link>
                  </li>
                </>
              )}

              <li role="none" className="flex items-center space-x-3 pl-4 border-l border-gray-200">
                <span className="text-gray-700 text-sm" aria-hidden="true">
                  {user?.name} ({user?.roles.join(', ')})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  role="menuitem"
                >
                  Logout
                </Button>
              </li>
            </>
          ) : (
            <>
              <li role="none">
                <Link
                  to="/login"
                  className={navLinkClassName(false)}
                  role="menuitem"
                >
                  Login
                </Link>
              </li>
              <li role="none">
                <Link
                  to="/register"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                  role="menuitem"
                >
                  Register
                </Link>
              </li>
            </>
          )}
        </ul>
      </div>
    </nav>
  );
}