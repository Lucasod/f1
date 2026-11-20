import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { Input, Button, Card, ErrorAlert } from '@/components/ui';

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

export function LoginForm() {
  const { login, isLoading, error: authError, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const from = (location.state as { from?: Location })?.from;

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email format';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Password is required';
    return undefined;
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {
      email: validateEmail(email),
      password: validatePassword(password)
    };
    setErrors(newErrors);
    // Mark all fields as touched on submit attempt
    setTouched({ email: true, password: true });
    return !newErrors.email && !newErrors.password;
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    if (field === 'email') {
      setErrors(prev => ({ ...prev, email: validateEmail(email) }));
    } else if (field === 'password') {
      setErrors(prev => ({ ...prev, password: validatePassword(password) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!validateForm()) return;

    try {
      const user = await login(email, password);
      const dashboard = user.roles.includes('ADMIN') ? '/admin/dashboard'
        : user.roles.includes('VENDOR') ? '/vendor/dashboard' : '/dashboard';
      const path = from?.pathname;
      const destination = path && path.startsWith('/') && !path.startsWith('//')
        ? { pathname: path, search: from?.search || '', hash: from?.hash || '' }
        : dashboard;
      navigate(destination, { replace: true });
    } catch {
      // Error is handled by auth store
    }
  };

  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Login</h2>
        <p className="text-gray-500 mt-1">Enter your credentials to access your account</p>
      </div>

      {authError && (
        <ErrorAlert
          message={authError === 'INVALID_CREDENTIALS' ? 'Invalid email or password' : authError}
          onDismiss={clearError}
          dismissible
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Input
          id="email"
          type="email"
          label="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => handleBlur('email')}
          error={touched.email ? errors.email : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.email && !!errors.email}
        />

        <Input
          id="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => handleBlur('password')}
          error={touched.password ? errors.password : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.password && !!errors.password}
        />

        <Button type="submit" fullWidth isLoading={isLoading}>
          Login
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600">
        Don't have an account?{' '}
        <a href="/register" className="text-blue-600 hover:underline font-medium">
          Register
        </a>
      </p>
    </Card>
  );
}
