import { render, screen } from '@testing-library/react';
import { Spinner, LoadingOverlay, Skeleton, ProductCardSkeleton, TableRowSkeleton } from './Spinner';

function getSpinnerSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) {
    throw new Error('Expected spinner SVG to render');
  }
  return svg;
}

function getSkeleton(container: HTMLElement): HTMLElement {
  const skeleton = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!skeleton) {
    throw new Error('Expected skeleton to render');
  }
  return skeleton;
}

describe('Spinner', () => {
  describe('Basic rendering', () => {
    it('renders spinner with default size', () => {
      const { container } = render(<Spinner />);
      const svg = getSpinnerSvg(container);
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('h-8');
      expect(svg).toHaveClass('w-8');
    });

    it('renders spinner with sm size', () => {
      const { container } = render(<Spinner size="sm" />);
      const svg = getSpinnerSvg(container);
      expect(svg).toHaveClass('h-4');
      expect(svg).toHaveClass('w-4');
    });

    it('renders spinner with md size', () => {
      const { container } = render(<Spinner size="md" />);
      const svg = getSpinnerSvg(container);
      expect(svg).toHaveClass('h-8');
      expect(svg).toHaveClass('w-8');
    });

    it('renders spinner with lg size', () => {
      const { container } = render(<Spinner size="lg" />);
      const svg = getSpinnerSvg(container);
      expect(svg).toHaveClass('h-12');
      expect(svg).toHaveClass('w-12');
    });

    it('renders label in sr-only span', () => {
      render(<Spinner label="Loading data..." />);
      expect(screen.getByText('Loading data...')).toHaveClass('sr-only');
    });

    it('applies animate-spin class', () => {
      const { container } = render(<Spinner />);
      const svg = getSpinnerSvg(container);
      expect(svg).toHaveClass('animate-spin');
    });

    it('applies text-blue-600 color', () => {
      const { container } = render(<Spinner />);
      const svg = getSpinnerSvg(container);
      expect(svg).toHaveClass('text-blue-600');
    });
  });

  describe('Status role', () => {
    it('does not add role by default', () => {
      const { container } = render(<Spinner />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).not.toHaveAttribute('role');
    });

    it('adds role="status" when withStatusRole is true', () => {
      const { container } = render(<Spinner withStatusRole />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).toHaveAttribute('role', 'status');
    });

    it('adds aria-live="polite" when withStatusRole is true', () => {
      const { container } = render(<Spinner withStatusRole />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).toHaveAttribute('aria-live', 'polite');
    });

    it('adds aria-label with the label when withStatusRole is true', () => {
      const { container } = render(<Spinner label="Loading data..." withStatusRole />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).toHaveAttribute('aria-label', 'Loading data...');
    });

    it('does not add aria-label when withStatusRole is false', () => {
      const { container } = render(<Spinner label="Loading data..." />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).not.toHaveAttribute('aria-label');
    });
  });

  describe('Custom className', () => {
    it('applies custom className to wrapper', () => {
      const { container } = render(<Spinner className="custom-spinner" />);
      const wrapper = getSpinnerSvg(container).parentElement;
      expect(wrapper).toHaveClass('custom-spinner');
    });
  });

  describe('SVG structure', () => {
    it('renders circle and path elements', () => {
      const { container } = render(<Spinner />);
      const svg = getSpinnerSvg(container);
      const circle = svg.querySelector('circle');
      const path = svg.querySelector('path');
      expect(circle).toBeInTheDocument();
      expect(path).toBeInTheDocument();
    });

    it('circle has correct attributes', () => {
      const { container } = render(<Spinner />);
      const circle = getSpinnerSvg(container).querySelector('circle');
      expect(circle).toHaveAttribute('cx', '12');
      expect(circle).toHaveAttribute('cy', '12');
      expect(circle).toHaveAttribute('r', '10');
      expect(circle).toHaveAttribute('stroke', 'currentColor');
      expect(circle).toHaveAttribute('stroke-width', '4');
    });
  });
});

describe('LoadingOverlay', () => {
  describe('Basic rendering', () => {
    it('renders overlay with default label', () => {
      render(<LoadingOverlay />);
      expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    });

    it('renders overlay with custom label', () => {
      render(<LoadingOverlay label="Saving changes..." />);
      expect(screen.getByRole('status')).toHaveTextContent('Saving changes...');
    });

    it('renders spinner inside overlay', () => {
      const { container } = render(<LoadingOverlay />);
      expect(getSpinnerSvg(container)).toBeInTheDocument();
    });

    it('applies fixed positioning classes', () => {
      render(<LoadingOverlay />);
      const overlay = screen.getByRole('status');
      expect(overlay).toHaveClass('fixed');
      expect(overlay).toHaveClass('inset-0');
      expect(overlay).toHaveClass('z-50');
    });

    it('applies backdrop blur', () => {
      render(<LoadingOverlay />);
      const overlay = screen.getByRole('status');
      expect(overlay).toHaveClass('bg-white/80');
      expect(overlay).toHaveClass('backdrop-blur-sm');
    });
  });

  describe('Size', () => {
    it('passes size to inner spinner', () => {
      const { container } = render(<LoadingOverlay size="lg" />);
      const spinner = getSpinnerSvg(container);
      expect(spinner).toHaveClass('h-12');
      expect(spinner).toHaveClass('w-12');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      render(<LoadingOverlay className="custom-overlay" />);
      const overlay = screen.getByRole('status');
      expect(overlay).toHaveClass('custom-overlay');
    });
  });
});

describe('Skeleton', () => {
  describe('Variants', () => {
    it('renders text variant by default', () => {
      const { container } = render(<Skeleton />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('rounded');
    });

    it('renders circular variant', () => {
      const { container } = render(<Skeleton variant="circular" />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('rounded-full');
    });

    it('renders rectangular variant', () => {
      const { container } = render(<Skeleton variant="rectangular" />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('rounded-lg');
    });
  });

  describe('Dimensions', () => {
    it('applies width style', () => {
      const { container } = render(<Skeleton width="200px" />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveStyle({ width: '200px' });
    });

    it('applies height style', () => {
      const { container } = render(<Skeleton height="100px" />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveStyle({ height: '100px' });
    });

    it('applies numeric width', () => {
      const { container } = render(<Skeleton width={200} />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveStyle({ width: '200px' });
    });
  });

  describe('Animation', () => {
    it('applies animate-pulse class', () => {
      const { container } = render(<Skeleton />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('animate-pulse');
    });

    it('applies bg-gray-200 color', () => {
      const { container } = render(<Skeleton />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('bg-gray-200');
    });
  });

  describe('ARIA', () => {
    it('has aria-hidden="true"', () => {
      const { container } = render(<Skeleton />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = render(<Skeleton className="custom-skeleton" />);
      const skeleton = getSkeleton(container);
      expect(skeleton).toHaveClass('custom-skeleton');
    });
  });
});

describe('ProductCardSkeleton', () => {
  it('renders product card skeleton structure', () => {
    render(<ProductCardSkeleton />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders image skeleton', () => {
    const { container } = render(<ProductCardSkeleton />);
    const imageSkeleton = container.querySelector('article > [aria-hidden="true"]');
    expect(imageSkeleton).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders text skeletons for title, description, price', () => {
    const { container } = render(<ProductCardSkeleton />);
    const textSkeletons = container.querySelectorAll('article .p-4 > [aria-hidden="true"]');
    expect(textSkeletons).toHaveLength(3);
  });
});

describe('TableRowSkeleton', () => {
  it('renders correct number of columns by default', () => {
    render(<table><tbody><TableRowSkeleton /></tbody></table>);
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(5);
  });

  it('renders specified number of columns', () => {
    render(<table><tbody><TableRowSkeleton columns={3} /></tbody></table>);
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(3);
  });

  it('applies animate-pulse to row', () => {
    render(<table><tbody><TableRowSkeleton /></tbody></table>);
    const row = screen.getByRole('row');
    expect(row).toHaveClass('animate-pulse');
  });

  it('renders skeleton in each cell', () => {
    const { container } = render(<table><tbody><TableRowSkeleton columns={2} /></tbody></table>);
    const skeletons = container.querySelectorAll('td > [aria-hidden="true"]');
    expect(skeletons).toHaveLength(2);
  });
});