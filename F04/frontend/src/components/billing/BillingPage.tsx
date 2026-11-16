/**
 * BillingPage.tsx
 *
 * Billing and subscription management page for the selected workspace.
 * Displays the current plan, quota usage, and actions to upgrade or cancel.
 * Loading, empty, and error states are handled explicitly.
 */

import { useState, useEffect } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import {
  getBillingSummary,
  createCheckout,
  cancelSubscription,
  getWorkspaceUsage,
  BillingSummary,
  WorkspaceUsage,
} from "../../api/billing";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";

export function BillingPage() {
  const { currentWorkspaceId } = useWorkspace();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, u] = await Promise.all([
        getBillingSummary(currentWorkspaceId),
        getWorkspaceUsage(currentWorkspaceId),
      ]);
      setSummary(s);
      setUsage(u);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load billing");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentWorkspaceId]);

  const handleCheckout = async () => {
    if (!currentWorkspaceId) return;
    setCreatingCheckout(true);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const result = await createCheckout(currentWorkspaceId, "pro", idempotencyKey);
      if (result.operation.checkout_url) {
        window.location.href = result.operation.checkout_url;
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to create checkout");
    } finally {
      setCreatingCheckout(false);
    }
  };

  const handleCancel = async () => {
    if (!currentWorkspaceId) return;
    if (!confirm("Cancel your Pro subscription? Access will switch to Free after confirmation.")) return;
    setCanceling(true);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      await cancelSubscription(currentWorkspaceId, "period_end", idempotencyKey);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to cancel subscription");
    } finally {
      setCanceling(false);
    }
  };

  if (loading && !summary) {
    return <LoadingSpinner label="Loading billing…" />;
  }

  if (!summary) {
    return <EmptyState title="Billing unavailable" message="Unable to load billing information." icon="💳" />;
  }

  const isPro = summary.plan === "pro";
  const memberships = usage?.resources.memberships;
  const projects = usage?.resources.projects;

  return (
    <div className="billing-page">
      <h1>Billing</h1>
      {error && <div className="billing-page__error" role="alert">{error}</div>}

      <div className="billing-page__plan">
        <h2>Current Plan</h2>
        <p>
          <strong>Plan:</strong> {summary.plan.charAt(0).toUpperCase() + summary.plan.slice(1)}
        </p>
        <p><strong>Status:</strong> {summary.subscription_status || "n/a"}</p>
        {summary.cancel_at_period_end && (
          <p><strong>Cancellation scheduled:</strong> Yes (at period end)</p>
        )}
        {summary.paid_through && (
          <p>
            <strong>Paid through:</strong> {new Date(summary.paid_through).toLocaleDateString()}
          </p>
        )}
        {summary.sync_pending && <p><strong>Sync:</strong> Pending reconciliation</p>}
      </div>

      <div className="billing-page__usage">
        <h2>Quota Usage</h2>
        {memberships && projects && (
          <ul className="billing-page__usage-list">
            <li>
              <strong>Memberships:</strong> {memberships.used} / {memberships.limit ?? "unlimited"}
            </li>
            <li>
              <strong>Projects:</strong> {projects.used} / {projects.limit ?? "unlimited"}
            </li>
          </ul>
        )}
      </div>

      <div className="billing-page__actions">
        {!isPro && (
          <button
            className="billing-page__btn billing-page__btn--primary"
            onClick={handleCheckout}
            disabled={creatingCheckout}
            type="button"
          >
            {creatingCheckout ? "Creating checkout…" : "Upgrade to Pro (test mode)"}
          </button>
        )}
        {isPro && (
          <button
            className="billing-page__btn billing-page__btn--danger"
            onClick={handleCancel}
            disabled={canceling}
            type="button"
          >
            {canceling ? "Canceling…" : "Cancel Pro Subscription"}
          </button>
        )}
      </div>
    </div>
  );
}
