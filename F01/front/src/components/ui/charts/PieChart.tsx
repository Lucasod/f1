import {
  PieChart as RechartsPieChart,
  Pie,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from './ChartContainer';

export interface PieData {
  name: string;
  value: number;
}

export interface PieChartProps {
  data: PieData[];
  title: string;
  height?: number;
  loading?: boolean;
  error: string | null;
  emptyMessage?: string;
}

export function PieChart({
  data,
  title,
  height = 300,
  loading = false,
  error = null,
  emptyMessage = 'No data available',
}: PieChartProps) {
  return (
    <ChartContainer
      title={title}
      loading={loading}
      error={error}
      emptyMessage={emptyMessage}
    >
      {data.length === 0 ? null : (
        <ResponsiveContainer width="100%" height={height}>
          <RechartsPieChart>
            <Tooltip
              content={({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const total = data.reduce((sum, item) => sum + item.value, 0);
                  const entry = payload[0];
                  const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0';
                  return (
                    <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm text-sm">
                      <p className="font-medium text-gray-900 mb-1">{entry.name}</p>
                      <p className="flex justify-between">
                        <span className="text-gray-500">Value</span>
                        <span className="font-medium text-gray-900">{entry.value}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-gray-500">Percentage</span>
                        <span className="font-medium text-gray-900">{percent}%</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={80}
              outerRadius={100}
              fill="#8884d8"
              label
            />
          </RechartsPieChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
