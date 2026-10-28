import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vendorApi, VendorOnboardInput } from '@/shared/api/vendor';

type VendorProfileError = {
  code?: string;
  message?: string;
  status?: number;
};

export function OnboardingForm() {
  const navigate = useNavigate();

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
      const error = err as VendorProfileError;
      const status = error.status ?? (error.message ? extractStatusFromMessage(error.message) : null);

      if (status === 404) {
        // No existing profile, allow onboarding
      } else if (status === 401 || status === 403) {
        navigate(status === 401 ? '/login' : '/access-denied');
      } else {
        // Network error, 5xx, or unknown
        setCheckProfileError({
          type: status && status >= 500 ? 'server' : 'network',
          message: 'Unable to check existing profile. Please try again.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const extractStatusFromMessage = (message: string): number | null => {
    const match = message.match(/\b(4\d{2}|5\d{2})\b/);
    return match ? parseInt(match[1], 10) : null;
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
    const error = err as VendorProfileError;
    const code = error.code ?? (error.message ? extractErrorCodeFromMessage(error.message) : null);

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
      navigate('/vendor/dashboard');
    } catch (err) {
      setError(mapBackendError(err));
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
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
        <span className="sr-only">Checking existing profile...</span>
      </div>
    );
  }

  if (checkProfileError) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-8" role="alert" aria-live="assertive">
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
          <h2 className="text-lg font-medium mb-2">Unable to Load Onboarding</h2>
          <p className="mb-4">{checkProfileError.message}</p>
          <button
            type="button"
            onClick={handleRetryCheckProfile}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div aria-live="polite" aria-atomic="true" className="sr-only" id="submit-status">
        {isSubmitting ? 'Creating store, please wait.' : ''}
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-8">Create Your Store</h1>

      {error && (
        <div
          className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700"
          role="alert"
          aria-live="assertive"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-sm underline hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div>
          <label htmlFor="storeName" className="block text-sm font-medium text-gray-700 mb-1">
            Store Name <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="storeName"
            type="text"
            value={formData.storeName}
            onChange={e => handleChange('storeName', e.target.value)}
            onBlur={() => validate()}
            className={`w-full px-3 py-2 border rounded-lg ${
              validationErrors.storeName ? 'border-red-500' : 'border-gray-300'
            } focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
            placeholder="Your store name"
            disabled={isSubmitting}
            aria-describedby={validationErrors.storeName ? 'storeName-error' : undefined}
            aria-invalid={validationErrors.storeName ? 'true' : 'false'}
          />
          {validationErrors.storeName && (
            <p
              id="storeName-error"
              className="mt-1 text-sm text-red-600"
              role="alert"
            >
              {validationErrors.storeName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
            Store Slug <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
              yourstore.
            </span>
            <input
              id="slug"
              type="text"
              value={formData.slug}
              onChange={e => handleChange('slug', e.target.value)}
              onBlur={() => validate()}
              className={`w-full px-3 py-2 pl-20 border rounded-lg ${
                validationErrors.slug ? 'border-red-500' : 'border-gray-300'
              } focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white`}
              placeholder="my-store"
              disabled={isSubmitting}
              aria-describedby={validationErrors.slug ? 'slug-error' : 'slug-hint'}
              aria-invalid={validationErrors.slug ? 'true' : 'false'}
            />
          </div>
          <p id="slug-hint" className="mt-1 text-xs text-gray-500">
            Lowercase letters, numbers, and hyphens only. Minimum 2 characters.
          </p>
          {validationErrors.slug && (
            <p
              id="slug-error"
              className="mt-1 text-sm text-red-600"
              role="alert"
            >
              {validationErrors.slug}
            </p>
          )}
        </div>

        <div className="pt-6 border-t border-gray-200">
          <button
            type="submit"
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            aria-live="polite"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating store...
              </>
            ) : (
              'Create Store'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}