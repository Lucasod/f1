import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorAlert } from './ErrorAlert';

describe('ErrorAlert', () => {
  describe('Variants', () => {
    it('renders error variant with correct classes', () => {
      render(<ErrorAlert message="Error message" variant="error" />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('bg-red-50');
      expect(alert).toHaveClass('border-red-200');
      expect(alert).toHaveClass('text-red-700');
    });

    it('renders warning variant with correct classes', () => {
      render(<ErrorAlert message="Warning message" variant="warning" />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('bg-yellow-50');
      expect(alert).toHaveClass('border-yellow-200');
      expect(alert).toHaveClass('text-yellow-800');
    });

    it('renders info variant with correct classes', () => {
      render(<ErrorAlert message="Info message" variant="info" />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('bg-blue-50');
      expect(alert).toHaveClass('border-blue-200');
      expect(alert).toHaveClass('text-blue-700');
    });
  });

  describe('Basic rendering', () => {
    it('renders message', () => {
      render(<ErrorAlert message="Error message" />);
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
      render(<ErrorAlert message="Error message" title="Error Title" />);
      expect(screen.getByText('Error Title')).toBeInTheDocument();
    });

    it('renders action button when action is provided', () => {
      render(
        <ErrorAlert
          message="Error message"
          action={{ label: 'Retry', onClick: vi.fn() }}
        />
      );
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('renders dismiss button when dismissible and onDismiss provided', () => {
      render(
        <ErrorAlert
          message="Error message"
          dismissible
          onDismiss={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Dismiss alert' })).toBeInTheDocument();
    });
  });

  describe('Dismissible', () => {
    it('calls onDismiss when dismiss button is clicked', () => {
      const handleDismiss = vi.fn();
      render(
        <ErrorAlert
          message="Error message"
          dismissible
          onDismiss={handleDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not render dismiss button when onDismiss not provided', () => {
      render(
        <ErrorAlert
          message="Error message"
          dismissible
        />
      );
      expect(screen.queryByRole('button', { name: 'Dismiss alert' })).not.toBeInTheDocument();
    });

    it('does not render dismiss button when dismissible is false', () => {
      render(
        <ErrorAlert
          message="Error message"
          dismissible={false}
          onDismiss={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: 'Dismiss alert' })).not.toBeInTheDocument();
    });

    it('uses title in dismiss button aria-label', () => {
      render(
        <ErrorAlert
          message="Error message"
          title="Custom Title"
          dismissible
          onDismiss={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Dismiss Custom Title' })).toBeInTheDocument();
    });
  });

  describe('ARIA live region', () => {
    it('uses role="alert" by default for non-dismissible', () => {
      render(<ErrorAlert message="Error message" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('uses role="status" and aria-live="polite" when dismissible', () => {
      render(
        <ErrorAlert
          message="Error message"
          dismissible
          onDismiss={vi.fn()}
        />
      );
      const alert = screen.getByRole('status');
      expect(alert).toHaveAttribute('aria-live', 'polite');
    });

    it('allows custom role override', () => {
      render(<ErrorAlert message="Error message" role="region" />);
      expect(screen.getByRole('region')).toBeInTheDocument();
    });
  });

  describe('Icons', () => {
    it('renders error icon for error variant', () => {
      render(<ErrorAlert message="Error" variant="error" />);
      const icon = screen.getByRole('alert').querySelector('svg[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });

    it('renders warning icon for warning variant', () => {
      render(<ErrorAlert message="Warning" variant="warning" />);
      const icon = screen.getByRole('alert').querySelector('svg[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });

    it('renders info icon for info variant', () => {
      render(<ErrorAlert message="Info" variant="info" />);
      const icon = screen.getByRole('alert').querySelector('svg[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });

    it('icons have aria-hidden="true"', () => {
      render(<ErrorAlert message="Error" />);
      const icon = screen.getByRole('alert').querySelector('svg[aria-hidden="true"]');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<ErrorAlert message="Error" className="custom-alert" />);
      expect(screen.getByRole('alert')).toHaveClass('custom-alert');
    });
  });

  describe('Action button', () => {
    it('renders action button with ghost variant', () => {
      render(
        <ErrorAlert
          message="Error"
          action={{ label: 'Retry', onClick: vi.fn() }}
        />
      );
      const button = screen.getByRole('button', { name: 'Retry' });
      expect(button).toHaveClass('bg-transparent');
      expect(button).toHaveClass('text-gray-700');
    });

    it('calls action onClick when clicked', () => {
      const handleClick = vi.fn();
      render(
        <ErrorAlert
          message="Error"
          action={{ label: 'Retry', onClick: handleClick }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});