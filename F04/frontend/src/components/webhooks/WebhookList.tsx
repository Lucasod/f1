/**
 * WebhookList.tsx
 *
 * Lists webhook subscriptions for the selected workspace.
 * Supports creating, updating, enabling/disabling, and deleting subscriptions.
 * Shows delivery status for each subscription.
 */

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
} from "../../api/webhooks";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";

interface WebhookSubscription {
  id: number;
  url: string;
  events: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface WebhookDelivery {
  id: number;
  event_type: string;
  status: string;
  attempt: number;
  response_status: number | null;
  error_message: string;
  created_at: string;
}

export function WebhookList() {
  const { currentWorkspaceId } = useWorkspace();
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");

  const loadSubscriptions = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const subs = await listWebhookSubscriptions(currentWorkspaceId);
      setSubscriptions(Array.isArray(subs) ? subs : []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  const handleCreateSubscription = async () => {
    if (!currentWorkspaceId || !newUrl) return;
    setCreating(true);
    setError(null);
    try {
      await createWebhookSubscription(currentWorkspaceId, newUrl, newEvents, newSecret);
      setNewUrl("");
      setNewEvents([]);
      setNewSecret("");
      await loadSubscriptions();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create webhook subscription");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleEnabled = async (sub: WebhookSubscription) => {
    try {
      await updateWebhookSubscription(sub.id, { is_enabled: !sub.is_enabled });
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, is_enabled: !s.is_enabled } : s))
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to update webhook");
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!confirm("Delete this webhook subscription?")) return;
    try {
      await deleteWebhookSubscription(id);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete webhook");
    }
  };

  const handleViewDeliveries = async (subId: number) => {
    try {
      const dels = await listWebhookDeliveries(subId);
      setDeliveries(Array.isArray(dels) ? dels : []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load deliveries");
    }
  };

  if (loading && subscriptions.length === 0) {
    return <LoadingSpinner label="Loading webhooks…" />;
  }

  return (
    <div className="webhook-list">
      <h2 className="webhook-list__title">Webhooks</h2>
      {error && (
        <div className="webhook-list__error" role="alert">
          {error}
        </div>
      )}
      <div className="webhook-list__create">
        <form
          className="webhook-list__create-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateSubscription();
          }}
          noValidate
        >
          <input
            className="webhook-list__url-input"
            type="url"
            placeholder="https://example.com/webhook"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            required
            aria-label="Destination URL"
          />
          <input
            className="webhook-list__secret-input"
            type="text"
            placeholder="Signing secret (HMAC key)"
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            aria-label="Signing secret"
          />
          <button
            className="webhook-list__create-submit"
            type="submit"
            disabled={creating || !newUrl}
          >
            {creating ? "Creating…" : "Add Webhook"}
          </button>
        </form>
      </div>
      {subscriptions.length === 0 && (
        <EmptyState
          title="No webhooks yet"
          message="Add a webhook subscription to receive event notifications."
          icon="🔗"
        />
      )}
      {subscriptions.length > 0 && (
        <>
          <ul className="webhook-list__list" role="list">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="webhook-list__item">
                <div className="webhook-list__info">
                  <span className="webhook-list__url">{sub.url}</span>
                  <span className={`webhook-list__enabled ${sub.is_enabled ? "webhook-list__enabled--on" : "webhook-list__enabled--off"}`}>
                    {sub.is_enabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className="webhook-list__events">{sub.events.join(", ")}</span>
                </div>
                <div className="webhook-list__actions">
                  <button
                    className="webhook-list__toggle"
                    onClick={() => handleToggleEnabled(sub)}
                    type="button"
                    aria-label={`${sub.is_enabled ? "Disable" : "Enable"} webhook ${sub.id}`}
                  >
                    {sub.is_enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="webhook-list__deliveries"
                    onClick={() => handleViewDeliveries(sub.id)}
                    type="button"
                    aria-label={`View deliveries for webhook ${sub.id}`}
                  >
                    Deliveries
                  </button>
                  <button
                    className="webhook-list__delete"
                    onClick={() => handleDeleteSubscription(sub.id)}
                    type="button"
                    aria-label={`Delete webhook ${sub.id}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {deliveries.length > 0 && (
            <div className="webhook-list__deliveries-section">
              <h3>Recent Deliveries</h3>
              <ul className="webhook-list__delivery-list" role="list">
                {deliveries.map((d) => (
                  <li key={d.id} className="webhook-list__delivery-item">
                    <span className="webhook-list__delivery-event">{d.event_type}</span>
                    <span className={`webhook-list__delivery-status ${d.status}`}>{d.status}</span>
                    {d.response_status && (
                      <span className="webhook-list__delivery-status-code">HTTP {d.response_status}</span>
                    )}
                    {d.error_message && (
                      <span className="webhook-list__delivery-error">{d.error_message}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
