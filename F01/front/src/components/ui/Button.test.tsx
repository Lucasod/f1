import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  describe('Variants', () => {
    it('renders primary variant with correct classes', () => {
      render(<Button>Primary</Button>);
      const button = screen.getByRole('button', { name: 'Primary' });
      expect(button).toHaveClass('bg-blue-600');
      expect(button).toHaveClass('text-white');
    });

    it('renders secondary variant with correct classes', () => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole('button', { name: 'Secondary' });
      expect(button).toHaveClass('bg-gray-100');
      expect(button).toHaveClass('text-gray-900');
    });

    it('renders ghost variant with correct classes', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const button = screen.getByRole('button', { name: 'Ghost' });
      expect(button).toHaveClass('bg-transparent');
      expect(button).toHaveClass('text-gray-700');
    });

    it('renders danger variant with correct classes', () => {
      render(<Button variant="danger">Danger</Button>);
      const button = screen.getByRole('button', { name: 'Danger' });
      expect(button).toHaveClass('bg-red-600');
      expect(button).toHaveClass('text-white');
    });

    it('renders outline variant with correct classes', () => {
      render(<Button variant="outline">Outline</Button>);
      const button = screen.getByRole('button', { name: 'Outline' });
      expect(button).toHaveClass('border');
      expect(button).toHaveClass('border-gray-300');
    });
  });

  describe('Sizes', () => {
    it('renders small size with correct classes', () => {
      render(<Button size="sm">Small</Button>);
      const button = screen.getByRole('button', { name: 'Small' });
      expect(button).toHaveClass('px-3');
      expect(button).toHaveClass('py-1.5');
      expect(button).toHaveClass('text-sm');
    });

    it('renders medium size with correct classes', () => {
      render(<Button size="md">Medium</Button>);
      const button = screen.getByRole('button', { name: 'Medium' });
      expect(button).toHaveClass('px-4');
      expect(button).toHaveClass('py-2');
      expect(button).toHaveClass('text-sm');
    });

    it('renders large size with correct classes', () => {
      render(<Button size="lg">Large</Button>);
      const button = screen.getByRole('button', { name: 'Large' });
      expect(button).toHaveClass('px-6');
      expect(button).toHaveClass('py-3');
      expect(button).toHaveClass('text-base');
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner and text when isLoading is true', () => {
      render(<Button isLoading>Loading</Button>);
      const button = screen.getByRole('button', { name: 'Loading...' });
      expect(button).toBeDisabled();
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      // Spinner SVG is present but aria-hidden
      expect(button.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    });

    it('uses custom loadingText when provided', () => {
      render(<Button isLoading loadingText="Saving...">Save</Button>);
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();
    });

    it('disables button when loading', () => {
      render(<Button isLoading>Loading</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('Disabled state', () => {
    it('disables button when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button', { name: 'Disabled' });
      expect(button).toBeDisabled();
      // Tailwind disabled: pseudo-classes don't appear in classList
      // but the button is properly disabled
    });

    it('does not call onClick when disabled', () => {
      const handleClick = vi.fn();
      render(<Button disabled onClick={handleClick}>Disabled</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('Icons', () => {
    it('renders leftIcon when provided', () => {
      render(<Button leftIcon={<span data-testid="left-icon">←</span>}>With Icon</Button>);
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('renders rightIcon when provided', () => {
      render(<Button rightIcon={<span data-testid="right-icon">→</span>}>With Icon</Button>);
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('renders both icons when provided', () => {
      render(
        <Button
          leftIcon={<span data-testid="left">←</span>}
          rightIcon={<span data-testid="right">→</span>}
        >
          Both Icons
        </Button>
      );
      expect(screen.getByTestId('left')).toBeInTheDocument();
      expect(screen.getByTestId('right')).toBeInTheDocument();
    });
  });

  describe('Full width', () => {
    it('applies full width class when fullWidth is true', () => {
      render(<Button fullWidth>Full Width</Button>);
      const button = screen.getByRole('button', { name: 'Full Width' });
      expect(button).toHaveClass('w-full');
    });
  });

  describe('asChild pattern', () => {
    it('renders as child element when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Link Button' });
      expect(link).toHaveClass('bg-blue-600');
      expect(link).toHaveClass('text-white');
    });

    it('applies button styles to child Link', () => {
      render(
        <Button asChild variant="secondary">
          <a href="/test">Styled Link</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Styled Link' });
      expect(link).toHaveClass('bg-gray-100');
      expect(link).toHaveClass('text-gray-900');
    });

    it('prevents click when disabled in asChild mode', () => {
      const handleClick = vi.fn();
      render(
        <Button asChild disabled onClick={handleClick}>
          <a href="/test">Disabled Link</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Disabled Link' });
      fireEvent.click(link);
      expect(handleClick).not.toHaveBeenCalled();
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).toHaveAttribute('tabIndex', '-1');
    });

    it('calls onClick when not disabled in asChild mode', () => {
      const handleClick = vi.fn();
      const childClick = vi.fn();
      render(
        <Button asChild onClick={handleClick}>
          <a href="#test" onClick={childClick}>Enabled Link</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Enabled Link' });
      fireEvent.click(link);
      expect(handleClick).toHaveBeenCalled();
      expect(childClick).toHaveBeenCalled();
    });

    it('passes button attributes to the child element', () => {
      render(
        <Button asChild aria-label="Continue" title="Continue to checkout" data-testid="checkout-link">
          <a href="/checkout">Continue</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Continue' });
      expect(link).toHaveAttribute('title', 'Continue to checkout');
      expect(link).toHaveAttribute('data-testid', 'checkout-link');
    });

    it('falls back to button when child is not a valid element', () => {
      render(<Button asChild>Not an element</Button>);
      const button = screen.getByRole('button', { name: 'Not an element' });
      expect(button).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Button className="custom-btn">Custom</Button>);
      const button = screen.getByRole('button', { name: 'Custom' });
      expect(button).toHaveClass('custom-btn');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying button', () => {
      const ref = vi.fn();
      render(<Button ref={ref}>Ref Test</Button>);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement);
    });
  });

  describe('Click handling', () => {
    it('calls onClick handler', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click me</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});