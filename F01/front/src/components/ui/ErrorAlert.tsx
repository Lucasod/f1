import { HTMLAttributes } from 'react';
import { Button } from './Button';

export type ErrorAlertVariant = 'error' | 'warning' | 'info';

export interface ErrorAlertProps extends HTMLAttributes<HTMLDivElement> {
  message: string;
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  variant?: ErrorAlertVariant;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const variantClasses: Record<ErrorAlertVariant, string> = {
  error: 'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
};

const iconClasses: Record<ErrorAlertVariant, React.ReactNode> = {
  error: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 001.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-5a1 1 0 011 1v3a1 1 0 11-2 0V6a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
};

export function ErrorAlert({
  message,
  title,
  dismissible = false,
  onDismiss,
  variant = 'error',
  action,
  className = '',
  role = 'alert',
  ...props
}: ErrorAlertProps) {
  // Use aria-live="polite" for dismissible alerts to announce dismissal
  const liveRegion = dismissible ? 'polite' : undefined;
  const effectiveRole = dismissible ? 'status' : role;

  return (
    <div
      className={`
        p-4 rounded-lg border flex gap-3
        ${variantClasses[variant]}
        ${className}
      `}
      role={effectiveRole}
      aria-live={liveRegion}
      {...props}
    >
      <div className="flex-shrink-0" aria-hidden="true">
        {iconClasses[variant]}
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <h4 className="font-medium text-sm mb-1">{title}</h4>
        )}
        <p className="text-sm">{message}</p>
        {action && (
          <Button variant="ghost" size="sm" onClick={action.onClick} className="mt-2">
            {action.label}
          </Button>
        )}
      </div>
      {dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 text-current opacity-50 hover:opacity-75 transition-opacity"
          aria-label={`Dismiss ${title || 'alert'}`}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414-1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
          </svg>
        </button>
      )}
    </div>
  );
}