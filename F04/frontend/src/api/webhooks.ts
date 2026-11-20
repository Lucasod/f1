import { request } from "./client";

export async function listWebhookSubscriptions(workspaceId: number): Promise<any[]> {
  return request(`/webhooks/?workspace_id=${workspaceId}`);
}

export async function createWebhookSubscription(workspaceId: number, url: string, events: string[], signingSecret: string): Promise<any> {
  return request("/webhooks/", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, url, events, is_enabled: true, signing_secret: signingSecret }),
  });
}

export async function getWebhookSubscription(subscriptionId: number): Promise<any> {
  return request(`/webhooks/${subscriptionId}/`);
}

export async function updateWebhookSubscription(subscriptionId: number, data: any): Promise<any> {
  return request(`/webhooks/${subscriptionId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteWebhookSubscription(subscriptionId: number): Promise<void> {
  return request(`/webhooks/${subscriptionId}/`, { method: "DELETE" });
}

export async function listWebhookDeliveries(subscriptionId: number): Promise<any[]> {
  return request(`/webhooks/${subscriptionId}/deliveries/`);
}
