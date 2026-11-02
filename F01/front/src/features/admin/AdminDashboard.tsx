import { Link } from 'react-router-dom';
import { useOrders } from '@/features/order/useOrder';
import { Card } from '@/components/ui/Card';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Spinner } from '@/components/ui/Spinner';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function AdminDashboard() {
  const { data, isLoading, error, refetch } = useOrders({ page: 1, limit: 10 });
  const orders = data?.orders ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-gray-600">Recent marketplace orders</p>
        </header>

        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent orders</h2>
          </div>

          {isLoading && (
            <div className="flex justify-center p-12">
              <Spinner size="lg" label="Loading marketplace orders" withStatusRole />
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorAlert
                title="Unable to load marketplace orders"
                message="The order service did not return data. Try again."
                variant="error"
                role="alert"
                action={{ label: 'Try again', onClick: () => refetch() }}
              />
            </div>
          )}

          {!isLoading && !error && orders.length === 0 && (
            <p className="px-6 py-10 text-center text-gray-600">No marketplace orders yet.</p>
          )}

          {!isLoading && !error && orders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Order</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {orders.map(order => (
                    <tr key={order.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{order.id}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{formatDate(order.createdAt)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm capitalize text-gray-600">{order.status.replace(/_/g, ' ')}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{formatCurrency(order.totalAmount)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                        <Link className="font-medium text-blue-700 hover:text-blue-900" to={`/orders/${order.id}`}>
                          View order {order.id}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
