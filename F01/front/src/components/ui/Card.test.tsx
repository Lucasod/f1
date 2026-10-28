import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card';

describe('Card', () => {
  describe('Variants', () => {
    it('renders default variant with correct classes', () => {
      render(<Card>Default Card</Card>);
      const card = screen.getByText('Default Card').closest('div');
      expect(card).toHaveClass('bg-white');
      expect(card).toHaveClass('shadow-sm');
    });

    it('renders bordered variant with correct classes', () => {
      render(<Card variant="bordered">Bordered Card</Card>);
      const card = screen.getByText('Bordered Card').closest('div');
      expect(card).toHaveClass('bg-white');
      expect(card).toHaveClass('border');
      expect(card).toHaveClass('border-gray-200');
    });

    it('renders elevated variant with correct classes', () => {
      render(<Card variant="elevated">Elevated Card</Card>);
      const card = screen.getByText('Elevated Card').closest('div');
      expect(card).toHaveClass('bg-white');
      expect(card).toHaveClass('shadow-md');
    });
  });

  describe('Padding', () => {
    it('renders with no padding when padding="none"', () => {
      render(<Card padding="none">No Padding</Card>);
      const card = screen.getByText('No Padding').closest('div');
      expect(card).not.toHaveClass('p-4');
      expect(card).not.toHaveClass('p-6');
      expect(card).not.toHaveClass('p-8');
    });

    it('renders with small padding when padding="sm"', () => {
      render(<Card padding="sm">Small Padding</Card>);
      const card = screen.getByText('Small Padding').closest('div');
      expect(card).toHaveClass('p-4');
    });

    it('renders with medium padding when padding="md"', () => {
      render(<Card padding="md">Medium Padding</Card>);
      const card = screen.getByText('Medium Padding').closest('div');
      expect(card).toHaveClass('p-6');
    });

    it('renders with large padding when padding="lg"', () => {
      render(<Card padding="lg">Large Padding</Card>);
      const card = screen.getByText('Large Padding').closest('div');
      expect(card).toHaveClass('p-8');
    });
  });

  describe('Children', () => {
    it('renders children content', () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText('Card Content')).toBeInTheDocument();
    });

    it('renders complex children', () => {
      render(
        <Card>
          <div>Child 1</div>
          <div>Child 2</div>
        </Card>
      );
      expect(screen.getByText('Child 1')).toBeInTheDocument();
      expect(screen.getByText('Child 2')).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<Card className="custom-card">Custom</Card>);
      const card = screen.getByText('Custom').closest('div');
      expect(card).toHaveClass('custom-card');
    });
  });

  describe('Forward ref', () => {
    it('forwards ref to underlying div', () => {
      const ref = vi.fn();
      render(<Card ref={ref}>Ref Test</Card>);
      expect(ref).toHaveBeenCalled();
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('CardHeader', () => {
    it('renders header with children', () => {
      render(<Card><CardHeader>Header Content</CardHeader></Card>);
      expect(screen.getByText('Header Content')).toBeInTheDocument();
    });

    it('applies mb-4 class', () => {
      render(<Card><CardHeader>Header</CardHeader></Card>);
      const header = screen.getByText('Header').closest('div');
      expect(header).toHaveClass('mb-4');
    });

    it('forwards ref', () => {
      const ref = vi.fn();
      render(<Card><CardHeader ref={ref}>Header</CardHeader></Card>);
      expect(ref).toHaveBeenCalled();
    });
  });

  describe('CardTitle', () => {
    it('renders as h3 by default', () => {
      render(<Card><CardTitle>Title</CardTitle></Card>);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Title');
    });

    it('renders as specified heading level', () => {
      render(<Card><CardTitle as="h1">H1 Title</CardTitle></Card>);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('H1 Title');
    });

    it('applies correct classes', () => {
      render(<Card><CardTitle>Title</CardTitle></Card>);
      const title = screen.getByRole('heading', { level: 3 });
      expect(title).toHaveClass('text-xl');
      expect(title).toHaveClass('font-semibold');
      expect(title).toHaveClass('text-gray-900');
    });

    it('forwards ref', () => {
      const ref = vi.fn();
      render(<Card><CardTitle ref={ref}>Title</CardTitle></Card>);
      expect(ref).toHaveBeenCalled();
    });
  });

  describe('CardDescription', () => {
    it('renders description text', () => {
      render(<Card><CardDescription>Description text</CardDescription></Card>);
      expect(screen.getByText('Description text')).toBeInTheDocument();
    });

    it('applies correct classes', () => {
      render(<Card><CardDescription>Description</CardDescription></Card>);
      const desc = screen.getByText('Description').closest('p');
      expect(desc).toHaveClass('text-sm');
      expect(desc).toHaveClass('text-gray-500');
      expect(desc).toHaveClass('mt-1');
    });

    it('forwards ref', () => {
      const ref = vi.fn();
      render(<Card><CardDescription ref={ref}>Description</CardDescription></Card>);
      expect(ref).toHaveBeenCalled();
    });
  });

  describe('CardContent', () => {
    it('renders content', () => {
      render(<Card><CardContent>Content</CardContent></Card>);
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('forwards ref', () => {
      const ref = vi.fn();
      render(<Card><CardContent ref={ref}>Content</CardContent></Card>);
      expect(ref).toHaveBeenCalled();
    });
  });

  describe('CardFooter', () => {
    it('renders footer with children', () => {
      render(<Card><CardFooter>Footer Content</CardFooter></Card>);
      expect(screen.getByText('Footer Content')).toBeInTheDocument();
    });

    it('applies correct classes', () => {
      render(<Card><CardFooter>Footer</CardFooter></Card>);
      const footer = screen.getByText('Footer').closest('div');
      expect(footer).toHaveClass('mt-4');
      expect(footer).toHaveClass('flex');
      expect(footer).toHaveClass('items-center');
      expect(footer).toHaveClass('gap-3');
    });

    it('forwards ref', () => {
      const ref = vi.fn();
      render(<Card><CardFooter ref={ref}>Footer</CardFooter></Card>);
      expect(ref).toHaveBeenCalled();
    });
  });
});