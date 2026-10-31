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
import { ProductCatalogPage } from './features/catalog/ProductCatalogPage';
import { CartPage } from './features/cart/CartPage';

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
            <Route path="/products/:productId" element={<div className="p-4">Product Detail (TODO)</div>} />
            
            {/* Protected routes for authenticated users */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div className="p-4">Dashboard</div>} />
              <Route path="/products" element={<div className="p-4">Products</div>} />
              <Route path="/cart" element={<CartPage />} />
            </Route>
            
            {/* Vendor only routes */}
            <Route element={<ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']} />}>
              <Route path="/vendor/dashboard" element={<VendorDashboard />} />
              <Route path="/vendor/products" element={<div className="p-4">Vendor Products</div>} />
              <Route path="/vendor/products/new" element={<ProductForm />} />
              <Route path="/vendor/products/:productId/edit" element={<ProductForm />} />
              <Route path="/vendor/onboard" element={<OnboardingForm />} />
            </Route>
            
            {/* Admin only routes */}
            <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
              <Route path="/admin/dashboard" element={<div className="p-4">Admin Dashboard</div>} />
              <Route path="/admin/users" element={<div className="p-4">Admin Users</div>} />
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
