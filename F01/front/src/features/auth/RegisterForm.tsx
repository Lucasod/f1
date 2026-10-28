import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { PersonRole } from '@/shared/types/person';
import { Input, Select, Button, Card, ErrorAlert } from '@/components/ui';

type TaxIdType = 'CPF' | 'CNPJ';

interface FormData {
  name: string;
  taxIdType: TaxIdType;
  taxIdValue: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  name?: string;
  taxIdType?: string;
  taxIdValue?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
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
    confirmPassword: ''
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
      confirmPassword: validateConfirmPassword(formData.password, formData.confirmPassword)
    };
    setErrors(newErrors);
    // Mark all fields as touched on submit attempt
    setTouched({
      name: true,
      taxIdType: true,
      taxIdValue: true,
      email: true,
      password: true,
      confirmPassword: true
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
        role: PersonRole.CONSUMER
      });
    } catch {
      // Error handled by auth store
    }
  };

  const taxIdTypeOptions = [
    { value: 'CPF', label: 'CPF (Individual)' },
    { value: 'CNPJ', label: 'CNPJ (Company)' },
  ];

  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Register</h2>
        <p className="text-gray-500 mt-1">Create your account to get started</p>
      </div>

      {authError && (
        <ErrorAlert
          message={
            authError === 'EMAIL_ALREADY_EXISTS' ? 'Email already registered' :
            authError === 'TAX_ID_ALREADY_EXISTS' ? 'Tax ID already registered' :
            authError === 'WEAK_PASSWORD' ? 'Password does not meet requirements' :
            authError === 'INVALID_EMAIL' ? 'Invalid email format' :
            authError === 'INVALID_TAX_ID' ? 'Invalid CPF/CNPJ' :
            authError
          }
          onDismiss={clearError}
          dismissible
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Input
          id="name"
          type="text"
          label="Name"
          autoComplete="name"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          onBlur={() => handleBlur('name')}
          error={touched.name ? errors.name : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.name && !!errors.name}
        />

        <Select
          id="taxIdType"
          label="Tax ID Type"
          value={formData.taxIdType}
          onChange={(e) => handleTaxIdTypeChange(e.target.value as TaxIdType)}
          onBlur={() => handleBlur('taxIdType')}
          error={touched.taxIdType ? errors.taxIdType : undefined}
          required
          disabled={isLoading}
          options={taxIdTypeOptions}
          placeholder="Select type"
          aria-invalid={touched.taxIdType && !!errors.taxIdType}
        />

        <Input
          id="taxIdValue"
          type="text"
          label="Tax ID Value"
          placeholder={formData.taxIdType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
          value={formData.taxIdValue}
          onChange={(e) => handleChange('taxIdValue', e.target.value)}
          onBlur={() => handleBlur('taxIdValue')}
          error={touched.taxIdValue ? errors.taxIdValue : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.taxIdValue && !!errors.taxIdValue}
        />

        <Input
          id="email"
          type="email"
          label="Email"
          autoComplete="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
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
          autoComplete="new-password"
          value={formData.password}
          onChange={(e) => handleChange('password', e.target.value)}
          onBlur={() => handleBlur('password')}
          error={touched.password ? errors.password : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.password && !!errors.password}
        />

        <Input
          id="confirmPassword"
          type="password"
          label="Confirm Password"
          autoComplete="new-password"
          value={formData.confirmPassword}
          onChange={(e) => handleChange('confirmPassword', e.target.value)}
          onBlur={() => handleBlur('confirmPassword')}
          error={touched.confirmPassword ? errors.confirmPassword : undefined}
          required
          disabled={isLoading}
          aria-invalid={touched.confirmPassword && !!errors.confirmPassword}
        />

        <Button type="submit" fullWidth isLoading={isLoading}>
          Register
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <a href="/login" className="text-blue-600 hover:underline font-medium">
          Login
        </a>
      </p>
    </Card>
  );
}