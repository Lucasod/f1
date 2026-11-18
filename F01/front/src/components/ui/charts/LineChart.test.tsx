import { render, screen } from '@testing-library/react';
import { LineChart } from './LineChart';

const mockData = [
  { name: 'Jan', sales: 100 },
  { name: 'Feb', sales: 200 },
  { name: 'Mar', sales: 150 },
];

describe('LineChart', () => {
  it('renders without crashing', () => {
    render(
      <LineChart
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
