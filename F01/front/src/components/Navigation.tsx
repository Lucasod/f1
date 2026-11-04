import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCart } from '@/features/cart/useCart';
import { Button } from '@/components/ui';

export function Navigation() {
  const { user, isAuthenticated, isLoading, hasRole, logout } = useAuth();
  const { data: cartData, error: cartError } = useCart();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

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

  const cartCount = cartData?.cart.items.reduce((total, item) => total + item.quantity, 0);
  const cartLabel = cartError
    ? 'Cart unavailable'
    : cartCount === undefined
      ? 'Cart'
      : `Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`;

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

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <nav className="bg-white shadow-sm" role="navigation" aria-label="Main navigation">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex justify-between items-center py-4">
          <Link
            to="/"
            className="text-xl font-bold text-gray-900"
            aria-label="FS-01 Marketplace Home"
            onClick={closeMenu}
          >
            FS-01 Marketplace
          </Link>

          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMenuOpen}
            aria-controls="main-navigation-menu"
            onClick={() => setIsMenuOpen(open => !open)}
          >
            <span className="sr-only">{isMenuOpen ? 'Close menu' : 'Open menu'}</span>
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              {isMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>

          <ul
            id="main-navigation-menu"
            className={`${isMenuOpen ? 'flex' : 'hidden'} absolute left-0 right-0 top-full z-50 flex-col gap-2 bg-white p-4 shadow-md md:static md:flex md:flex-row md:items-center md:gap-1 md:bg-transparent md:p-0 md:shadow-none`}
            role="menubar"
          >
            <li role="none">
              <Link
                to="/products"
                className={navLinkClassName(location.pathname.startsWith('/products'))}
                role="menuitem"
                onClick={closeMenu}
              >
                Browse Products
              </Link>
            </li>

            <li role="none">
              <Link
                to="/cart"
                className={navLinkClassName(location.pathname === '/cart')}
                role="menuitem"
                aria-label={cartLabel}
                onClick={closeMenu}
              >
                Cart
                {cartCount !== undefined && !cartError && (
                  <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                    {cartCount}
                  </span>
                )}
                {cartError && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700" role="status">
                    Unavailable
                  </span>
                )}
              </Link>
            </li>

            {isAuthenticated ? (
              <>
                {hasRole('CONSUMER') && (
                  <>
                    <li role="none">
                      <Link to="/dashboard" className={navLinkClassName(location.pathname === '/dashboard')} role="menuitem" onClick={closeMenu}>
                        Consumer Dashboard
                      </Link>
                    </li>
                    <li role="none">
                      <Link to="/orders" className={navLinkClassName(location.pathname.startsWith('/orders'))} role="menuitem" onClick={closeMenu}>
                        My Orders
                      </Link>
                    </li>
                    <li role="none">
                      <Link to="/profile" className={navLinkClassName(location.pathname === '/profile')} role="menuitem" onClick={closeMenu}>
                        My Profile
                      </Link>
                    </li>
                    {!hasRole('VENDOR') && (
                      <li role="none">
                        <Link to="/vendor/onboard" className={navLinkClassName(location.pathname === '/vendor/onboard')} role="menuitem" onClick={closeMenu}>
                          Become a Seller
                        </Link>
                      </li>
                    )}
                  </>
                )}

                {hasRole('VENDOR') && (
                  <>
                    <li role="none">
                      <Link to="/vendor/dashboard" className={vendorNavLinkClassName(location.pathname.startsWith('/vendor'))} role="menuitem" onClick={closeMenu}>
                        Vendor Dashboard
                      </Link>
                    </li>
                    <li role="none">
                      <Link to="/vendor/products" className={vendorNavLinkClassName(location.pathname === '/vendor/products')} role="menuitem" onClick={closeMenu}>
                        Vendor Products
                      </Link>
                    </li>
                    <li role="none">
                      <Link to="/vendor/orders" className={vendorNavLinkClassName(location.pathname.startsWith('/vendor/orders'))} role="menuitem" onClick={closeMenu}>
                        Vendor Orders
                      </Link>
                    </li>
                  </>
                )}

                {hasRole('ADMIN') && (
                  <li role="none">
                    <Link to="/admin/dashboard" className={adminNavLinkClassName(location.pathname.startsWith('/admin'))} role="menuitem" onClick={closeMenu}>
                      Admin Dashboard
                    </Link>
                  </li>
                )}

                <li role="none" className="flex items-center space-x-3 border-t border-gray-200 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                  <span className="text-gray-700 text-sm">
                    {user?.name} ({user?.roles.join(', ')})
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { closeMenu(); logout(); }} role="menuitem">
                    Logout
                  </Button>
                </li>
              </>
            ) : (
              <>
                <li role="none">
                  <Link to="/login" className={navLinkClassName(false)} role="menuitem" onClick={closeMenu}>
                    Login
                  </Link>
                </li>
                <li role="none">
                  <Link to="/register" className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors" role="menuitem" onClick={closeMenu}>
                    Register
                  </Link>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
}
