import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './app/providers/AuthProvider';
import { ProtectedRoute } from './app/routes/ProtectedRoute';
import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { Navigation } from './components/Navigation';
import { VendorDashboard } from './features/vendor/VendorDashboard';
import { ProductForm } from './features/vendor/ProductForm';
import { OnboardingForm } from './features/vendor/OnboardingForm';
import { ConsumerDashboard } from './features/consumer/ConsumerDashboard';
import { ProductCatalogPage } from './features/catalog/ProductCatalogPage';
import { ProductDetailPage } from './features/catalog/ProductDetailPage';
import { CartPage } from './features/cart/CartPage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { OrderHistoryPage } from './features/order/OrderHistoryPage';
import { OrderDetailPage } from './features/order/OrderDetailPage';
import { VendorOrderPage } from './features/order/VendorOrderPage';
import { PayoutPage } from './features/vendor/PayoutPage';
import { ConsumerProfile } from './features/consumer/ConsumerProfile';
import { AdminDashboard } from './features/admin/AdminDashboard';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navigation />
        <main className="min-h-screen bg-gray-50">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            
            {/* Public product routes */}
            <Route path="/products" element={<ProductCatalogPage />} />
            <Route path="/products/:productId" element={<ProductDetailPage />} />
            
            {/* Guest carts are available without signing in. */}
            <Route path="/cart" element={<CartPage />} />

            {/* Consumer experience (also available to Consumers who are Vendors). */}
            <Route element={<ProtectedRoute allowedRoles={['CONSUMER']} />}>
              <Route path="/dashboard" element={<ConsumerDashboard />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/orders" element={<OrderHistoryPage />} />
              <Route path="/profile" element={<ConsumerProfile />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['CONSUMER', 'VENDOR', 'ADMIN']} />}>
              <Route path="/orders/:orderId" element={<OrderDetailPage />} />
            </Route>
            
            {/* Vendor only routes */}
            <Route element={<ProtectedRoute allowedRoles={['CONSUMER', 'VENDOR']} />}>
              <Route path="/vendor/onboard" element={<OnboardingForm />} />
            </Route>
            <Route element={<ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']} />}>
              <Route path="/vendor/dashboard" element={<VendorDashboard />} />
              <Route path="/vendor/products" element={<div className="p-4">Vendor Products</div>} />
              <Route path="/vendor/products/new" element={<ProductForm />} />
              <Route path="/vendor/products/:productId/edit" element={<ProductForm />} />
              <Route path="/vendor/orders" element={<VendorOrderPage />} />
              <Route path="/vendor/payouts" element={<PayoutPage />} />
            </Route>
            
            {/* Admin only routes */}
            <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
            </Route>
            
            {/* Redirect unknown routes to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
