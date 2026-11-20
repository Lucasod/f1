import { render, screen } from '@testing-library/react';
import { PieChart } from './PieChart';

const mockData = [
  { name: 'Category A', value: 100 },
  { name: 'Category B', value: 200 },
  { name: 'Category C', value: 150 },
];

describe('PieChart', () => {
  it('renders without crashing', () => {
    render(
      <PieChart
        data={mockData}
        title="Test Chart"
        error={null}
      />
    );
    expect(screen.getByText('Test Chart')).toBeInTheDocument();
  });
});
