import { useState } from 'react';
import { useOrderMutations } from './useOrder';
import { Order, OrderStatus } from '@/shared/api/order';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { ErrorAlert } from '@/components/ui/ErrorAlert';

export interface OrderCommentSectionProps {
  order?: Order;
  orderId?: string;
  status?: OrderStatus;
  comment?: string;
  commentedAt?: string;
  commentedBy?: string;
  onCommentAdded?: (order: Order) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractStatus(err: unknown): number | undefined {
  const anyErr = err as { status?: number; response?: { status?: number } };
  return anyErr?.status ?? anyErr?.response?.status;
}

export function OrderCommentSection({
  order,
  orderId,
  status,
  comment,
  commentedAt,
  onCommentAdded,
}: OrderCommentSectionProps) {
  const { useAddOrderComment } = useOrderMutations();
  const addOrderCommentMutation = useAddOrderComment();

  const [commentText, setCommentText] = useState('');
  const [submittedComment, setSubmittedComment] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resolvedOrderId = order?.id ?? orderId ?? '';
  const resolvedStatus = order?.status ?? status;
  const resolvedExistingComment = order?.comment ?? comment;
  const resolvedExistingCommentedAt = order?.commentedAt ?? commentedAt;

  const existingComment = resolvedExistingComment ?? submittedComment;
  const existingCommentedAt = resolvedExistingCommentedAt ?? submittedAt;

  if (resolvedStatus !== 'delivered') {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    const trimmed = commentText.trim();
    if (trimmed.length === 0) {
      setErrorMessage('Comment is required.');
      return;
    }
    if (commentText.length > 1000) {
      setErrorMessage('Comment must be at most 1000 characters.');
      return;
    }

    try {
      const updated = await addOrderCommentMutation.mutateAsync({
        orderId: resolvedOrderId,
        comment: trimmed,
      });

      const updatedComment = (updated as { comment?: string } | undefined)?.comment ?? trimmed;
      const updatedCommentedAt =
        (updated as { commentedAt?: string } | undefined)?.commentedAt ?? new Date().toISOString();

      setSubmittedComment(updatedComment);
      setSubmittedAt(updatedCommentedAt);
      setCommentText('');
      onCommentAdded?.(updated as Order);
    } catch (err) {
      const httpStatus = extractStatus(err);
      if (httpStatus === 409) {
        setErrorMessage('Already commented: comment already exists for this order.');
      } else if (httpStatus === 422) {
        setErrorMessage('Order not delivered.');
      } else if (httpStatus === 403) {
        setErrorMessage('Access denied.');
      } else if (httpStatus === 404) {
        setErrorMessage('Order not found.');
      } else if (httpStatus !== undefined && httpStatus >= 500) {
        setErrorMessage('Server error. Please try again later.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to submit comment.');
      }
    }
  };

  return (
    <Card variant="bordered" padding="md" className="mb-6" data-testid="order-comment-section">
      <CardHeader>
        <CardTitle as="h3">Comentário do Pedido</CardTitle>
      </CardHeader>
      <CardContent>
        {existingComment ? (
          <div data-testid="order-comment-display" className="space-y-2">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{existingComment}</p>
            {existingCommentedAt && (
              <time
                data-testid="order-comment-timestamp"
                dateTime={existingCommentedAt}
                className="text-xs text-gray-500"
              >
                {formatDate(existingCommentedAt)}
              </time>
            )}
          </div>
        ) : (
          <form
            data-testid="order-comment-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
          >
            {errorMessage && (
              <ErrorAlert
                title="Comment submission failed"
                message={errorMessage}
                dismissible
                onDismiss={() => setErrorMessage(null)}
                role="alert"
              />
            )}

            <Textarea
              id="order-comment"
              label="Comentário"
              aria-label="Order comment"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder="Write your comment (max 1000 characters)"
              rows={4}
              maxLength={1000}
              disabled={addOrderCommentMutation.isPending}
              data-testid="order-comment-textarea"
            />

            <div className="flex justify-end">
              <Button
                type="submit"
                isLoading={addOrderCommentMutation.isPending}
                loadingText="Submitting..."
                data-testid="order-comment-submit"
                aria-label="Submit comment"
              >
                Enviar / Submit Comment
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default OrderCommentSection;
