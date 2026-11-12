import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from './ChartContainer';

export interface BarData {
  name: string;
  [key: string]: number | string;
}

export interface BarChartProps {
  data: BarData[];
  title: string;
  xKey: string;
  yKeys: string[];
  yKeyLabels: Record<string, string>;
  height?: number;
  loading?: boolean;
  error: string | null;
  emptyMessage?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#ca8a04', // yellow
  '#7c3aed', // purple
  '#0891b2', // cyan
];

export function BarChart({
  data,
  title,
  xKey,
  yKeys,
  yKeyLabels,
  height = 300,
  loading = false,
  error = null,
  emptyMessage = 'No data available',
  colors = DEFAULT_COLORS,
}: BarChartProps) {
  return (
    <ChartContainer
      title={title}
      loading={loading}
      error={error}
      emptyMessage={emptyMessage}
    >
      {data.length === 0 ? null : (
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              content={({ active, payload, label }: any) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm text-sm">
                      <p className="font-medium text-gray-900 mb-1">{label}</p>
                      {payload.map((entry: any, i: number) => (
                        <p key={i} className="flex justify-between">
                          <span className="text-gray-500">{yKeyLabels[entry.dataKey] || entry.dataKey}</span>
                          <span className="font-medium text-gray-900">{entry.value?.toFixed?.(2) ?? entry.value}</span>
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            {yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[index % colors.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
