import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './app/providers/AuthProvider';
import { ProtectedRoute } from './app/routes/ProtectedRoute';
import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          
          {/* Protected routes for authenticated users */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<div className="p-4">Dashboard</div>} />
            <Route path="/products" element={<div className="p-4">Products</div>} />
          </Route>
          
          {/* Vendor only routes */}
          <Route element={<ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']} />}>
            <Route path="/vendor/dashboard" element={<div className="p-4">Vendor Dashboard</div>} />
            <Route path="/vendor/products" element={<div className="p-4">Vendor Products</div>} />
          </Route>
          
          {/* Admin only routes */}
          <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
            <Route path="/admin/dashboard" element={<div className="p-4">Admin Dashboard</div>} />
            <Route path="/admin/users" element={<div className="p-4">Admin Users</div>} />
          </Route>
          
          {/* Redirect unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;