import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';

interface BaseInputProps {
  label?: string;
  error?: string;
  hint?: string;
  id: string;
  required?: boolean;
}

const sharedInputClasses = `
  w-full px-3 py-2 border rounded-lg
  bg-white text-gray-900 placeholder:text-gray-400
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
  transition-colors duration-150
  disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
  aria-invalid:border-red-500 aria-invalid:focus:ring-red-500
`;

export interface InputProps extends BaseInputProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  type?: 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'url';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, required, type = 'text', className = '', 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const errorId = error ? `${id}-error` : undefined;
    const hintId = hint && !error ? `${id}-hint` : undefined;
    const describedBy = [errorId, hintId, ariaDescribedBy].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
              {label}
            </label>
            {required && (
              <span className="text-red-500 ml-1" aria-hidden="true">*</span>
            )}
          </>
        )}
        <input
          ref={ref}
          id={id}
          type={type}
          className={`${sharedInputClasses} ${error ? 'border-red-500' : 'border-gray-300'} ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          aria-required={required}
          required={required}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export interface TextareaProps extends BaseInputProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, id, required, className = '', 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const errorId = error ? `${id}-error` : undefined;
    const hintId = hint && !error ? `${id}-hint` : undefined;
    const describedBy = [errorId, hintId, ariaDescribedBy].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
              {label}
            </label>
            {required && (
              <span className="text-red-500 ml-1" aria-hidden="true">*</span>
            )}
          </>
        )}
        <textarea
          ref={ref}
          id={id}
          className={`${sharedInputClasses} ${error ? 'border-red-500' : 'border-gray-300'} ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          aria-required={required}
          required={required}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export interface SelectProps extends BaseInputProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, id, required, options, placeholder, className = '', 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const errorId = error ? `${id}-error` : undefined;
    const hintId = hint && !error ? `${id}-hint` : undefined;
    const describedBy = [errorId, hintId, ariaDescribedBy].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
              {label}
            </label>
            {required && (
              <span className="text-red-500 ml-1" aria-hidden="true">*</span>
            )}
          </>
        )}
        <select
          ref={ref}
          id={id}
          className={`${sharedInputClasses} ${error ? 'border-red-500' : 'border-gray-300'} ${className} bg-white`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          aria-required={required}
          required={required}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';