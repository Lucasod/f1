import { HTMLAttributes } from 'react';
import { Spinner } from '../Spinner';
import { EmptyState, EmptyStateIcons } from '../EmptyState';
import { ErrorAlert } from '../ErrorAlert';

export interface ChartContainerProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  loading?: boolean;
  error: string | null;
  emptyMessage?: string;
  children?: React.ReactNode;
  retryAction?: { label: string; onClick: () => void };
}

export function ChartContainer({
  title,
  loading,
  error,
  emptyMessage = 'No data available',
  children,
  className = '',
  retryAction,
  ...props
}: ChartContainerProps) {
  if (loading) {
    return (
      <div
        className={`flex items-center justify-center min-h-[300px] ${className}`}
        role="status"
        aria-live="polite"
        {...props}
      >
        <Spinner size="lg" label={title ? `Loading ${title}...` : 'Loading chart...'} withStatusRole />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className} p-8`} {...props}>
        <ErrorAlert
          title={`Error loading ${title || 'chart'}`}
          message={error}
          variant="error"
          role="alert"
          action={retryAction}
        />
      </div>
    );
  }

  if (!children) {
    return (
      <div className={`${className} flex items-center justify-center min-h-[300px]`} {...props}>
        <EmptyState
          title={title ? `${title} - no data` : 'No data'}
          description={emptyMessage}
          icon={EmptyStateIcons.generic}
          centered
        />
      </div>
    );
  }

  return (
    <div className={className} {...props}>
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
      )}
      <div className="min-h-[300px]">{children}</div>
    </div>
  );
}
