import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vendorApi, VendorOnboardInput, VendorApiException } from '@/shared/api/vendor';
import { Input, Button, Card, ErrorAlert, Spinner } from '@/components/ui';
import { useAuthStore } from '@/app/providers/authStore';

export function OnboardingForm() {
  const navigate = useNavigate();
  const refreshUserProfile = useAuthStore(state => state.refreshUserProfile);

  const [formData, setFormData] = useState<VendorOnboardInput>({
    storeName: '',
    slug: '',
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [checkProfileError, setCheckProfileError] = useState<{
    type: 'network' | 'auth' | 'server';
    message: string;
  } | null>(null);

  useEffect(() => {
    checkExistingProfile();
  }, []);

  const checkExistingProfile = async () => {
    try {
      const response = await vendorApi.getMe();
      if (response.vendor) {
        navigate('/vendor/dashboard');
      }
    } catch (err) {
      if (err instanceof VendorApiException) {
        const status = err.status;
        if (status === 404) {
          // No existing profile, allow onboarding
        } else if (status === 401 || status === 403) {
          navigate(status === 401 ? '/login' : '/access-denied');
        } else {
          // 5xx or other errors
          setCheckProfileError({
            type: status >= 500 ? 'server' : 'network',
            message: 'Unable to check existing profile. Please try again.',
          });
        }
      } else {
        // Network or unknown error
        setCheckProfileError({
          type: 'network',
          message: 'Unable to check existing profile. Please try again.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: keyof VendorOnboardInput, value: string) => {
    const trimmedValue = value.trim();
    setFormData(prev => ({ ...prev, [field]: trimmedValue }));
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    const storeName = formData.storeName.trim();
    const slug = formData.slug.trim();

    if (!storeName) {
      newErrors.storeName = 'Store name is required';
    } else if (storeName.length < 2) {
      newErrors.storeName = 'Store name must be at least 2 characters';
    }

    if (!slug) {
      newErrors.slug = 'Slug is required';
    } else if (slug.length < 2) {
      newErrors.slug = 'Slug must be at least 2 characters';
    } else if (!/^[a-z0-9-]+$/.test(slug)) {
      newErrors.slug = 'Slug must contain only lowercase letters, numbers, and hyphens';
    }

    setValidationErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mapBackendError = (err: unknown): string => {
    let code: string | null = null;
    if (err instanceof VendorApiException) {
      code = err.code ?? null;
    } else {
      const error = err as { code?: string; message?: string };
      code = error.code ?? (error.message ? extractErrorCodeFromMessage(error.message) : null);
    }

    const errorMessages: Record<string, string> = {
      SLUG_ALREADY_EXISTS: 'This store slug is already taken. Please choose another.',
      INVALID_SLUG_FORMAT: 'Slug must contain only lowercase letters, numbers, and hyphens.',
      STORE_NAME_REQUIRED: 'Store name is required.',
      PERSON_ALREADY_HAS_VENDOR: 'You already have a vendor profile.',
      ADMIN_CANNOT_BE_VENDOR: 'Admin users cannot create a vendor profile.',
      INVALID_COMMISSION_PCT: 'Invalid commission percentage.',
    };

    return code && errorMessages[code]
      ? errorMessages[code]
      : 'Error creating vendor profile. Please try again.';
  };

  const extractErrorCodeFromMessage = (message: string): string | null => {
    const match = message.match(/\b(SLUG_ALREADY_EXISTS|INVALID_SLUG_FORMAT|STORE_NAME_REQUIRED|PERSON_ALREADY_HAS_VENDOR|ADMIN_CANNOT_BE_VENDOR|INVALID_COMMISSION_PCT)\b/);
    return match ? match[1] : null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await vendorApi.onboard(formData);
      try {
        await refreshUserProfile();
      } catch (sessionError) {
        console.error('Vendor onboarding succeeded but session refresh failed:', sessionError);
        setError('Your store was created, but your session could not be updated. Sign in again to access the Vendor Dashboard.');
        return;
      }
      navigate('/vendor/dashboard');
    } catch (err) {
      if (err instanceof VendorApiException) {
        // For 401/403, redirect to login/access-denied
        if (err.status === 401) {
          navigate('/login');
          return;
        }
        if (err.status === 403) {
          navigate('/access-denied');
          return;
        }
        // For other statuses, use the error code mapping
        setError(mapBackendError(err));
      } else {
        setError(mapBackendError(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryCheckProfile = () => {
    setCheckProfileError(null);
    setIsLoading(true);
    checkExistingProfile();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <Spinner size="lg" label="Checking existing profile..." />
      </div>
    );
  }

  if (checkProfileError) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-8" role="alert" aria-live="assertive">
        <Card variant="bordered" padding="lg" className="border-yellow-200 bg-yellow-50">
          <h2 className="text-lg font-medium text-yellow-800 mb-2">Unable to Load Onboarding</h2>
          <p className="text-yellow-800 mb-4">{checkProfileError.message}</p>
          <Button variant="outline" onClick={handleRetryCheckProfile}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div aria-live="polite" aria-atomic="true" className="sr-only" id="submit-status">
        {isSubmitting ? 'Creating store, please wait.' : ''}
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-8">Create Your Store</h1>

      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          dismissible
          className="mb-6"
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Input
          id="storeName"
          type="text"
          label="Store Name"
          required
          value={formData.storeName}
          onChange={e => handleChange('storeName', e.target.value)}
          onBlur={validate}
          error={validationErrors.storeName}
          placeholder="Your store name"
          disabled={isSubmitting}
          aria-invalid={!!validationErrors.storeName}
        />

        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
            Store Slug <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
              yourstore.
            </span>
            <Input
              id="slug"
              type="text"
              value={formData.slug}
              onChange={e => handleChange('slug', e.target.value)}
              onBlur={validate}
              error={validationErrors.slug}
              placeholder="my-store"
              disabled={isSubmitting}
              aria-invalid={!!validationErrors.slug}
              className="pl-20"
            />
          </div>
          <p id="slug-hint" className="mt-1 text-xs text-gray-500">
            Lowercase letters, numbers, and hyphens only. Minimum 2 characters.
          </p>
        </div>

        <div className="pt-6 border-t border-gray-200">
          <Button type="submit" fullWidth isLoading={isSubmitting} loadingText="Creating store...">
            Create Store
          </Button>
        </div>
      </form>
    </Card>
  );
}