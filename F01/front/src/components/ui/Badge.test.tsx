import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  describe('Variants', () => {
    it('renders default variant with correct classes', () => {
      render(<Badge>Default</Badge>);
      const badge = screen.getByText('Default').closest('span');
      expect(badge).toHaveClass('bg-blue-100');
      expect(badge).toHaveClass('text-blue-800');
    });

    it('renders success variant with correct classes', () => {
      render(<Badge variant="success">Success</Badge>);
      const badge = screen.getByText('Success').closest('span');
      expect(badge).toHaveClass('bg-green-100');
      expect(badge).toHaveClass('text-green-800');
    });

    it('renders warning variant with correct classes', () => {
      render(<Badge variant="warning">Warning</Badge>);
      const badge = screen.getByText('Warning').closest('span');
      expect(badge).toHaveClass('bg-yellow-100');
      expect(badge).toHaveClass('text-yellow-800');
    });

    it('renders error variant with correct classes', () => {
      render(<Badge variant="error">Error</Badge>);
      const badge = screen.getByText('Error').closest('span');
      expect(badge).toHaveClass('bg-red-100');
      expect(badge).toHaveClass('text-red-800');
    });

    it('renders info variant with correct classes', () => {
      render(<Badge variant="info">Info</Badge>);
      const badge = screen.getByText('Info').closest('span');
      expect(badge).toHaveClass('bg-cyan-100');
      expect(badge).toHaveClass('text-cyan-800');
    });

    it('renders neutral variant with correct classes', () => {
      render(<Badge variant="neutral">Neutral</Badge>);
      const badge = screen.getByText('Neutral').closest('span');
      expect(badge).toHaveClass('bg-gray-100');
      expect(badge).toHaveClass('text-gray-800');
    });
  });

  describe('Sizes', () => {
    it('renders small size with correct classes', () => {
      render(<Badge size="sm">Small</Badge>);
      const badge = screen.getByText('Small').closest('span');
      expect(badge).toHaveClass('px-2');
      expect(badge).toHaveClass('py-0.5');
      expect(badge).toHaveClass('text-xs');
    });

    it('renders medium size with correct classes', () => {
      render(<Badge size="md">Medium</Badge>);
      const badge = screen.getByText('Medium').closest('span');
      expect(badge).toHaveClass('px-2.5');
      expect(badge).toHaveClass('py-0.5');
      expect(badge).toHaveClass('text-sm');
    });
  });

  describe('Dot indicator', () => {
    it('renders dot when dot prop is true', () => {
      render(<Badge dot>With Dot</Badge>);
      const badge = screen.getByText('With Dot').closest('span');
      const dot = badge?.querySelector('[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveClass('w-1.5');
      expect(dot).toHaveClass('h-1.5');
      expect(dot).toHaveClass('rounded-full');
    });

    it('does not render dot when dot prop is false', () => {
      render(<Badge>No Dot</Badge>);
      const badge = screen.getByText('No Dot').closest('span');
      const dots = badge?.querySelectorAll('[aria-hidden="true"]');
      expect(dots?.length).toBe(0);
    });

    it('renders correct dot color for each variant', () => {
      const { rerender } = render(<Badge variant="success" dot>Success</Badge>);
      const badge = screen.getByText('Success').closest('span');
      const dot = badge?.querySelector('[aria-hidden="true"]');
      expect(dot).toHaveClass('bg-green-500');

      rerender(<Badge variant="warning" dot>Warning</Badge>);
      const badge2 = screen.getByText('Warning').closest('span');
      const dot2 = badge2?.querySelector('[aria-hidden="true"]');
      expect(dot2).toHaveClass('bg-yellow-500');

      rerender(<Badge variant="error" dot>Error</Badge>);
      const badge3 = screen.getByText('Error').closest('span');
      const dot3 = badge3?.querySelector('[aria-hidden="true"]');
      expect(dot3).toHaveClass('bg-red-500');
    });
  });

  describe('Children', () => {
    it('renders children content', () => {
      render(<Badge>Custom Content</Badge>);
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });

    it('renders complex children', () => {
      render(
        <Badge>
          <span>Complex</span>
          <span>Content</span>
        </Badge>
      );
      expect(screen.getByText('Complex')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Badge className="custom-class">Custom</Badge>);
      const badge = screen.getByText('Custom').closest('span');
      expect(badge).toHaveClass('custom-class');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying span', () => {
      const ref = vi.fn();
      render(<Badge ref={ref}>Ref Test</Badge>);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLSpanElement);
    });
  });

  describe('ARIA', () => {
    it('dot has aria-hidden="true"', () => {
      render(<Badge dot>With Dot</Badge>);
      const badge = screen.getByText('With Dot').closest('span');
      const dot = badge?.querySelector('[aria-hidden="true"]');
      expect(dot).toHaveAttribute('aria-hidden', 'true');
    });
  });
});