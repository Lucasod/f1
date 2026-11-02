import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payoutApi, Payout, PayoutStatus, CreatePayoutInput } from '@/shared/api/payout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Input } from '@/components/ui/Input';

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

function getStatusVariant(status: PayoutStatus): 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case PayoutStatus.PENDING:
      return 'warning';
    case PayoutStatus.APPROVED:
      return 'info';
    case PayoutStatus.PROCESSING:
      return 'info';
    case PayoutStatus.COMPLETED:
      return 'success';
    case PayoutStatus.FAILED:
      return 'error';
    case PayoutStatus.CANCELLED:
      return 'error';
    default:
      return 'neutral';
  }
}

export function PayoutPage() {
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(true);
  const [amount, setAmount] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payouts'],
    queryFn: () => payoutApi.list(),
  });

  const payouts: Payout[] = data?.payouts ?? [];

  const createMutation = useMutation({
    mutationFn: (input: CreatePayoutInput) => payoutApi.create(input),
    onSuccess: () => {
      setFormError(null);
      setAmount('');
      setBankAccount('');
      setReference('');
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to request payout');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => payoutApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Amount must be a positive number');
      return;
    }
    setFormError(null);
    createMutation.mutate({
      amount: numericAmount,
      bankAccount: bankAccount.trim() || undefined,
      reference: reference.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
            <Spinner size="lg" label="Loading payouts" withStatusRole />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ErrorAlert
            title="Error loading payouts"
            message={`Failed to load payouts. ${error instanceof Error ? error.message : ''}`.trim()}
            variant="error"
            role="alert"
            action={{
              label: 'Retry / Try again',
              onClick: () => refetch(),
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Payouts</h1>
            <p className="mt-1 text-gray-600">Request and track your payouts</p>
          </div>
          <Button onClick={() => setShowForm((prev) => !prev)}>
            {showForm ? 'Hide Form' : 'Request Payout'}
          </Button>
        </div>

        {showForm && (
          <Card variant="bordered" padding="lg" className="mb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Request New Payout</h2>

              {formError && (
                <ErrorAlert
                  message={formError}
                  variant="error"
                  dismissible
                  onDismiss={() => setFormError(null)}
                />
              )}

              <Input
                id="amount"
                type="number"
                label="Amount"
                required
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={createMutation.isPending}
              />

              <Input
                id="bankAccount"
                type="text"
                label="Bank Account"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="Bank account details"
                disabled={createMutation.isPending}
              />

              <Input
                id="reference"
                type="text"
                label="Reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Reference"
                disabled={createMutation.isPending}
              />

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowForm(false)}
                  disabled={createMutation.isPending}
                >
                  Close
                </Button>
                <Button type="submit" isLoading={createMutation.isPending}>
                  {createMutation.isPending ? 'Requesting...' : 'Request Payout'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {payouts.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            description="You haven't requested any payouts yet."
            icon={EmptyStateIcons.orders}
            action={{ label: 'New Payout', onClick: () => setShowForm(true) }}
          />
        ) : (
          <Card variant="bordered" padding="none">
            <div className="overflow-x-auto">
              <table className="w-full" role="table">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bank Account</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payouts.map((payout) => (
                    <tr key={payout.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-mono text-gray-900">{payout.id}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(payout.amount)}</td>
                      <td className="px-6 py-4">
                        <Badge variant={getStatusVariant(payout.status)} size="sm" dot>
                          {payout.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatDate(payout.requestedAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{payout.bankAccount ?? '-'}</td>
                      <td className="px-6 py-4">
                        {payout.status === PayoutStatus.PENDING && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelMutation.mutate(payout.id)}
                            disabled={cancelMutation.isPending}
                            className="text-red-600 hover:text-red-900 hover:bg-red-50"
                          >
                            Cancel Payout
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default PayoutPage;
