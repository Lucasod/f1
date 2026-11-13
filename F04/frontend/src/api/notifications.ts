import { request } from "./client";

export async function listNotifications(workspaceId: number): Promise<any[]> {
  return request(`/notifications/?workspace_id=${workspaceId}`);
}

export async function getUnreadCount(workspaceId: number): Promise<{ unread_count: number }> {
  return request(`/notifications/unread_count/?workspace_id=${workspaceId}`);
}

export async function markNotificationRead(notificationId: number): Promise<any> {
  return request(`/notifications/${notificationId}/read/`, { method: "PATCH" });
}

export async function markNotificationsReadBulk(notificationIds: number[]): Promise<{ updated: number }> {
  return request("/notifications/read_bulk/", {
    method: "POST",
    body: JSON.stringify({ notification_ids: notificationIds }),
  });
}
