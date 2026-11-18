import { HTMLAttributes } from 'react';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
  label?: string;
  /** If true, the spinner will include role="status" and aria-live="polite" on its wrapper.
   * Set to false when parent component already provides these attributes. */
  withStatusRole?: boolean;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Spinner({ 
  size = 'md', 
  label = 'Loading...', 
  className = '', 
  withStatusRole = false,
  ...props 
}: SpinnerProps) {
  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      role={withStatusRole ? 'status' : undefined}
      aria-live={withStatusRole ? 'polite' : undefined}
      aria-label={withStatusRole ? label : undefined}
      {...props}
    >
      <svg
        className={`animate-spin text-blue-600 ${sizeClasses[size]}`}
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
      <span className="sr-only">{label}</span>
    </div>
  );
}

export interface LoadingOverlayProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  size?: SpinnerSize;
}

export function LoadingOverlay({ label = 'Loading...', size = 'md', className = '', ...props }: LoadingOverlayProps) {
  return (
    <div
      className={`fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50 ${className}`}
      role="status"
      aria-live="polite"
      {...props}
    >
      <div className="bg-white rounded-xl shadow-lg p-8 flex flex-col items-center gap-4">
        <Spinner size={size} label={label} withStatusRole={false} />
        <p className="text-sm text-gray-600">{label}</p>
      </div>
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ variant = 'text', width, height, className = '', ...props }: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-200 rounded';
  
  let variantClasses = '';
  switch (variant) {
    case 'circular':
      variantClasses = 'rounded-full';
      break;
    case 'rectangular':
      variantClasses = 'rounded-lg';
      break;
    default:
      variantClasses = 'rounded';
  }

  return (
    <div
      className={`${baseClasses} ${variantClasses} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <article className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <Skeleton variant="rectangular" className="aspect-square w-full" />
      <div className="p-4 space-y-3">
        <Skeleton variant="text" width="80%" height="1.25rem" />
        <Skeleton variant="text" width="60%" height="1.25rem" />
        <Skeleton variant="text" width="40%" height="1rem" />
      </div>
    </article>
  );
}

export interface TableRowSkeletonProps {
  columns?: number;
}

export function TableRowSkeleton({ columns = 5 }: TableRowSkeletonProps) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton variant="text" width={i === 0 ? '120px' : '80px'} height="1rem" />
        </td>
      ))}
    </tr>
  );
}