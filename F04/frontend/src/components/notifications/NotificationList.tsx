/**
 * NotificationList.tsx
 *
 * Lists the current user's notifications for the selected workspace.
 * Supports marking individual notifications as read and marking all as read.
 */

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { listNotifications, markNotificationRead, markNotificationsReadBulk, getUnreadCount } from "../../api/notifications";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";

interface Notification {
  id: number;
  notification_type: string;
  entity_type: string;
  entity_id: number | null;
  payload: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

export function NotificationList() {
  const { currentWorkspaceId } = useWorkspace();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [notifs, countResp] = await Promise.all([
        listNotifications(currentWorkspaceId),
        getUnreadCount(currentWorkspaceId),
      ]);
      setNotifications(Array.isArray(notifs) ? notifs : []);
      setUnreadCount(countResp.unread_count ?? 0);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      setError(err?.message ?? "Failed to mark notification as read");
    }
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      await markNotificationsReadBulk(unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err: any) {
      setError(err?.message ?? "Failed to mark all notifications as read");
    }
  };

  if (loading && notifications.length === 0) {
    return <LoadingSpinner label="Loading notifications…" />;
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        title="No notifications"
        message="You have no notifications for this workspace."
        icon="🔔"
      />
    );
  }

  return (
    <div className="notification-list">
      <h2 className="notification-list__title">Notifications</h2>
      {error && (
        <div className="notification-list__error" role="alert">
          {error}
        </div>
      )}
      <div className="notification-list__actions">
        <button
          className="notification-list__mark-all"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          type="button"
          aria-label="Mark all notifications as read"
        >
          Mark all as read ({unreadCount})
        </button>
      </div>
      <ul className="notification-list__list" role="list">
        {notifications.map((n) => (
          <li key={n.id} className={`notification-list__item${n.is_read ? " notification-list__item--read" : ""}`}>
            <div className="notification-list__content">
              <span className="notification-list__type">{n.notification_type}</span>
              <span className="notification-list__time">{new Date(n.created_at).toLocaleString()}</span>
              {!n.is_read && (
                <button
                  className="notification-list__mark-read"
                  onClick={() => handleMarkRead(n.id)}
                  type="button"
                  aria-label={`Mark notification ${n.id} as read`}
                >
                  Mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
