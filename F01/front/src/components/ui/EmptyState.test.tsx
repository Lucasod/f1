import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState, EmptyStateIcons } from './EmptyState';

describe('EmptyState', () => {
  describe('Basic rendering', () => {
    it('renders title', () => {
      render(<EmptyState title="No items" />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No items');
    });

    it('renders description when provided', () => {
      render(<EmptyState title="No items" description="There are no items to display" />);
      expect(screen.getByText('There are no items to display')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
      render(<EmptyState title="No items" icon={<span data-testid="icon">📦</span>} />);
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
  });

  describe('Action', () => {
    it('renders action button when action is provided', () => {
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick: vi.fn() }}
        />
      );
      expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
    });

    it('uses primary variant by default for action', () => {
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick: vi.fn() }}
        />
      );
      const button = screen.getByRole('button', { name: 'Add Item' });
      expect(button).toHaveClass('bg-blue-600');
    });

    it('uses specified variant for action', () => {
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick: vi.fn(), variant: 'secondary' }}
        />
      );
      const button = screen.getByRole('button', { name: 'Add Item' });
      expect(button).toHaveClass('bg-gray-100');
    });

    it('calls onClick when action button is clicked', () => {
      const handleClick = vi.fn();
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick: handleClick }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Centered layout', () => {
    it('centers content by default', () => {
      render(<EmptyState title="No items" />);
      const container = screen.getByText('No items').closest('div');
      expect(container).toHaveClass('flex');
      expect(container).toHaveClass('flex-col');
      expect(container).toHaveClass('items-center');
      expect(container).toHaveClass('justify-center');
      expect(container).toHaveClass('text-center');
    });

    it('does not center when centered={false}', () => {
      render(<EmptyState title="No items" centered={false} />);
      const container = screen.getByText('No items').closest('div');
      expect(container).not.toHaveClass('items-center');
      expect(container).not.toHaveClass('justify-center');
      expect(container).not.toHaveClass('text-center');
    });
  });

  describe('Icon', () => {
    it('applies aria-hidden to icon wrapper', () => {
      render(<EmptyState title="No items" icon={<span>📦</span>} />);
      const iconWrapper = screen.getByText('📦').closest('div');
      expect(iconWrapper).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<EmptyState title="No items" className="custom-empty" />);
      const container = screen.getByText('No items').closest('div');
      expect(container).toHaveClass('custom-empty');
    });
  });

  describe('EmptyStateIcons', () => {
    it('exports products icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.products} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports search icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.search} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports cart icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.cart} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports orders icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.orders} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports profile icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.profile} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports notifications icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.notifications} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });

    it('exports generic icon', () => {
      render(<EmptyState title="Test" icon={EmptyStateIcons.generic} />);
      expect(screen.getByText('Test').closest('div')?.querySelector('svg')).toBeInTheDocument();
    });
  });
});