/**
 * billing.ts — billing and subscription API functions.
 *
 * Wraps the workspace billing endpoints:
 *   GET    /workspaces/{id}/billing/          -> billing summary
 *   POST   /workspaces/{id}/billing/checkout/ -> create checkout session
 *   POST   /workspaces/{id}/billing/portal/   -> open customer portal
 *   POST   /workspaces/{id}/billing/cancel/   -> cancel subscription
 *   GET    /workspaces/{id}/billing/operations/{opId}/
 *   GET    /workspaces/{id}/usage/            -> quota usage
 *   DELETE /workspaces/{id}/delete/           -> delete workspace
 *
 * CSRF is handled by the shared API client (credentials: include, X-CSRFToken
 * injection for unsafe methods). No Stripe credentials or secrets are stored
 * in frontend code.
 */

import { request } from "./client";

export interface BillingSummary {
  plan: string;
  subscription_status: string;
  cancel_at_period_end: boolean;
  paid_through: string | null;
  sync_pending: boolean;
}

export interface WorkspaceUsage {
  plan: string;
  resources: {
    memberships: { used: number; limit: number | null };
    projects: { used: number; limit: number | null };
  };
}

export interface BillingOperation {
  id: string;
  kind: string;
  state: string;
  checkout_url?: string;
  portal_url?: string;
  safe_result: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/** GET /workspaces/{workspaceId}/billing/ */
export async function getBillingSummary(workspaceId: number): Promise<BillingSummary> {
  const data = await request<{ billing: BillingSummary }>(`/workspaces/${workspaceId}/billing/`);
  return data.billing;
}

/** POST /workspaces/{workspaceId}/billing/checkout/ */
export async function createCheckout(workspaceId: number, plan: string, idempotencyKey: string): Promise<{ operation: BillingOperation }> {
  return request(`/workspaces/${workspaceId}/billing/checkout/`, {
    method: "POST",
    body: JSON.stringify({ plan }),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** POST /workspaces/{workspaceId}/billing/portal/ */
export async function createPortal(workspaceId: number, idempotencyKey: string): Promise<{ operation: BillingOperation }> {
  return request(`/workspaces/${workspaceId}/billing/portal/`, {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** POST /workspaces/{workspaceId}/billing/cancel/ */
export async function cancelSubscription(workspaceId: number, timing: "period_end" | "immediate", idempotencyKey: string): Promise<{ operation: BillingOperation }> {
  return request(`/workspaces/${workspaceId}/billing/cancel/`, {
    method: "POST",
    body: JSON.stringify({ timing }),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** GET /workspaces/{workspaceId}/billing/operations/{operationId}/ */
export async function getBillingOperation(workspaceId: number, operationId: string): Promise<BillingOperation> {
  const data = await request<{ operation: BillingOperation }>(`/workspaces/${workspaceId}/billing/operations/${operationId}/`);
  return data.operation;
}

/** GET /workspaces/{workspaceId}/usage/ */
export async function getWorkspaceUsage(workspaceId: number): Promise<WorkspaceUsage> {
  const data = await request<{ usage: WorkspaceUsage }>(`/workspaces/${workspaceId}/usage/`);
  return data.usage;
}

/** DELETE /workspaces/{workspaceId}/delete/ */
export async function deleteWorkspace(workspaceId: number, confirmationName: string): Promise<void> {
  return request(`/workspaces/${workspaceId}/delete/`, {
    method: "DELETE",
    body: JSON.stringify({ confirmation_name: confirmationName }),
  });
}
