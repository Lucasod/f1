import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';

type TaxIdType = 'CPF' | 'CNPJ';
type UserRole = 'CONSUMER' | 'VENDOR' | 'ADMIN';

interface FormData {
  name: string;
  taxIdType: TaxIdType;
  taxIdValue: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
}

interface FormErrors {
  name?: string;
  taxIdType?: string;
  taxIdValue?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
  general?: string;
}

const validateCpf = (cpf: string): boolean => {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1+$/.test(clean)) return false;
  
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i]) * (10 - i);
  }
  let check1 = (sum * 10) % 11;
  if (check1 === 10) check1 = 0;
  if (check1 !== parseInt(clean[9])) return false;
  
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i]) * (11 - i);
  }
  let check2 = (sum * 10) % 11;
  if (check2 === 10) check2 = 0;
  return check2 === parseInt(clean[10]);
};

const validateCnpj = (cnpj: string): boolean => {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return false;
  if (/^(\d)\1+$/.test(clean)) return false;
  
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(clean[i]) * weights1[i];
  }
  let check1 = sum % 11;
  check1 = check1 < 2 ? 0 : 11 - check1;
  if (check1 !== parseInt(clean[12])) return false;
  
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(clean[i]) * weights2[i];
  }
  let check2 = sum % 11;
  check2 = check2 < 2 ? 0 : 11 - check2;
  return check2 === parseInt(clean[13]);
};

export function RegisterForm() {
  const { register, isLoading, error: authError, clearError } = useAuth();
  const [formData, setFormData] = useState<FormData>({
    name: '',
    taxIdType: 'CPF',
    taxIdValue: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'CONSUMER'
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateName = (value: string): string | undefined => {
    if (!value.trim()) return 'Name is required';
    return undefined;
  };

  const validateTaxIdType = (value: string): string | undefined => {
    if (!value) return 'Tax ID type is required';
    return undefined;
  };

  const validateTaxIdValue = (type: TaxIdType, value: string): string | undefined => {
    if (!value.trim()) return 'Tax ID value is required';
    if (type === 'CPF' && !validateCpf(value)) return 'Invalid CPF format';
    if (type === 'CNPJ' && !validateCnpj(value)) return 'Invalid CNPJ format';
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email format';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    return undefined;
  };

  const validateConfirmPassword = (password: string, confirm: string): string | undefined => {
    if (!confirm) return 'Confirm password is required';
    if (password !== confirm) return 'Passwords do not match';
    return undefined;
  };

  const validateRole = (value: string): string | undefined => {
    if (!value) return 'Role is required';
    return undefined;
  };

  const validateField = (field: keyof FormData): string | undefined => {
    switch (field) {
      case 'name':
        return validateName(formData.name);
      case 'taxIdType':
        return validateTaxIdType(formData.taxIdType);
      case 'taxIdValue':
        return validateTaxIdValue(formData.taxIdType, formData.taxIdValue);
      case 'email':
        return validateEmail(formData.email);
      case 'password':
        return validatePassword(formData.password);
      case 'confirmPassword':
        return validateConfirmPassword(formData.password, formData.confirmPassword);
      case 'role':
        return validateRole(formData.role);
      default:
        return undefined;
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {
      name: validateName(formData.name),
      taxIdType: validateTaxIdType(formData.taxIdType),
      taxIdValue: validateTaxIdValue(formData.taxIdType, formData.taxIdValue),
      email: validateEmail(formData.email),
      password: validatePassword(formData.password),
      confirmPassword: validateConfirmPassword(formData.password, formData.confirmPassword),
      role: validateRole(formData.role)
    };
    setErrors(newErrors);
    // Mark all fields as touched on submit attempt
    setTouched({
      name: true,
      taxIdType: true,
      taxIdValue: true,
      email: true,
      password: true,
      confirmPassword: true,
      role: true
    });
    return !Object.values(newErrors).some(Boolean);
  };

  const handleBlur = (field: keyof FormData) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(field);
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error on change if field was touched
    if (touched[field]) {
      const error = field === 'taxIdValue' 
        ? validateTaxIdValue(formData.taxIdType, value)
        : field === 'confirmPassword'
          ? validateConfirmPassword(formData.password, value)
          : validateField(field);
      setErrors(prev => ({ ...prev, [field]: error }));
    }
  };

  const handleTaxIdTypeChange = (value: TaxIdType) => {
    setFormData(prev => ({ ...prev, taxIdType: value, taxIdValue: '' }));
    setErrors(prev => ({ ...prev, taxIdValue: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!validateForm()) return;

    try {
      await register({
        name: formData.name,
        taxIdType: formData.taxIdType,
        taxIdValue: formData.taxIdValue.replace(/\D/g, ''),
        email: formData.email,
        password: formData.password,
        role: formData.role
      });
    } catch {
      // Error handled by auth store
    }
  };

  const getInputProps = (field: keyof FormData, extraProps: React.InputHTMLAttributes<HTMLInputElement> = {}) => ({
    value: formData[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleChange(field, e.target.value),
    onBlur: () => handleBlur(field),
    disabled: isLoading,
    'aria-invalid': touched[field] && !!errors[field],
    'aria-describedby': touched[field] && errors[field] ? `${field}-error` : undefined,
    ...extraProps
  });

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-center">Register</h2>
      
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            {...getInputProps('name', { className: 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500' })}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.name && errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {touched.name && errors.name && (
            <p id="name-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="taxIdType" className="block text-sm font-medium text-gray-700 mb-1">
            Tax ID Type
          </label>
          <select
            id="taxIdType"
            value={formData.taxIdType}
            onChange={(e) => handleTaxIdTypeChange(e.target.value as TaxIdType)}
            onBlur={() => handleBlur('taxIdType')}
            disabled={isLoading}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.taxIdType && errors.taxIdType ? 'border-red-500' : 'border-gray-300'
            }`}
            aria-invalid={touched.taxIdType && !!errors.taxIdType}
            aria-describedby={touched.taxIdType && errors.taxIdType ? 'taxIdType-error' : undefined}
          >
            <option value="">Select type</option>
            <option value="CPF">CPF (Individual)</option>
            <option value="CNPJ">CNPJ (Company)</option>
          </select>
          {touched.taxIdType && errors.taxIdType && (
            <p id="taxIdType-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.taxIdType}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="taxIdValue" className="block text-sm font-medium text-gray-700 mb-1">
            Tax ID Value
          </label>
          <input
            id="taxIdValue"
            type="text"
            placeholder={formData.taxIdType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
            {...getInputProps('taxIdValue', { className: 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500' })}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.taxIdValue && errors.taxIdValue ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {touched.taxIdValue && errors.taxIdValue && (
            <p id="taxIdValue-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.taxIdValue}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...getInputProps('email', { className: 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500' })}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.email && errors.email ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {touched.email && errors.email && (
            <p id="email-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            {...getInputProps('password', { className: 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500' })}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.password && errors.password ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {touched.password && errors.password && (
            <p id="password-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...getInputProps('confirmPassword', { className: 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500' })}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.confirmPassword && errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {touched.confirmPassword && errors.confirmPassword && (
            <p id="confirmPassword-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
            Role
          </label>
          <select
            id="role"
            value={formData.role}
            onChange={(e) => handleChange('role', e.target.value)}
            onBlur={() => handleBlur('role')}
            disabled={isLoading}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              touched.role && errors.role ? 'border-red-500' : 'border-gray-300'
            }`}
            aria-invalid={touched.role && !!errors.role}
            aria-describedby={touched.role && errors.role ? 'role-error' : undefined}
          >
            <option value="">Select role</option>
            <option value="CONSUMER">Consumer</option>
            <option value="VENDOR">Vendor</option>
            <option value="ADMIN">Admin</option>
          </select>
          {touched.role && errors.role && (
            <p id="role-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.role}
            </p>
          )}
        </div>

        {authError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm" role="alert">
            {authError === 'EMAIL_ALREADY_EXISTS' ? 'Email already registered' :
             authError === 'TAX_ID_ALREADY_EXISTS' ? 'Tax ID already registered' :
             authError === 'WEAK_PASSWORD' ? 'Password does not meet requirements' :
             authError === 'INVALID_EMAIL' ? 'Invalid email format' :
             authError === 'INVALID_TAX_ID' ? 'Invalid CPF/CNPJ' :
             authError}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Register'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <a href="/login" className="text-blue-600 hover:underline">
          Login
        </a>
      </p>
    </div>
  );
}