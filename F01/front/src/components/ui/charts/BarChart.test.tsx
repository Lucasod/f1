import { render, screen } from '@testing-library/react';
import { BarChart } from './BarChart';

const mockData = [
  { name: 'Jan', sales: 100 },
  { name: 'Feb', sales: 200 },
  { name: 'Mar', sales: 150 },
];

describe('BarChart', () => {
  it('renders without crashing', () => {
    render(
      <BarChart
        data={mockData}
        title="Test Chart"
        xKey="name"
        yKeys={['sales']}
        yKeyLabels={{ sales: 'Sales' }}
        error={null}
      />
    );
    expect(screen.getByText('Test Chart')).toBeInTheDocument();
  });
});
