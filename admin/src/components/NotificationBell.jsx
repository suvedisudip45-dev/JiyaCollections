import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Bell } from "lucide-react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";

const backendUrl = String(import.meta.env.VITE_BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");
const pageSize = 10;

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const NotificationBell = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const rootRef = useRef(null);
  const requestId = useRef(0);
  const loadingRef = useRef(false);
  const countRequestId = useRef(0);

  const refreshUnreadCount = useCallback(async () => {
    const currentRequestId = ++countRequestId.current;
    try {
      const response = await axios.get(`${backendUrl}/api/portal-notifications/unread-count`, {
        cacheResponse: false,
      });
      if (currentRequestId === countRequestId.current) {
        setUnreadCount(Number(response.data.count) || 0);
      }
    } catch (error) {
      console.error("Unable to refresh admin notification count.", error);
    }
  }, []);

  const loadPage = useCallback(async (pageCursor = null, replace = false) => {
    if (loadingRef.current && !replace) return;
    const currentRequestId = ++requestId.current;
    if (replace) {
      loadingRef.current = false;
      setNotifications([]);
      setCursor(null);
      setHasMore(false);
    }
    loadingRef.current = true;
    setLoading(true);
    setListError(false);
    try {
      const response = await axios.get(`${backendUrl}/api/portal-notifications`, {
        params: { limit: pageSize, ...(pageCursor ? { cursor: pageCursor } : {}) },
        cacheResponse: false,
      });
      if (currentRequestId !== requestId.current) return;
      const result = response.data;
      setNotifications((current) => replace ? result.notifications : [...current, ...result.notifications]);
      setCursor(result.nextCursor || null);
      setHasMore(Boolean(result.hasMore));
    } catch (error) {
      if (currentRequestId !== requestId.current) return;
      console.error("Unable to load admin notifications.", error);
      setListError(true);
    } finally {
      if (currentRequestId === requestId.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  const closeMenu = useCallback(() => {
    requestId.current += 1;
    loadingRef.current = false;
    setLoading(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
    const timer = window.setInterval(refreshUnreadCount, 30000);
    return () => {
      window.clearInterval(timer);
      countRequestId.current += 1;
    };
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) closeMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, open]);

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    setOpen(true);
    void loadPage(null, true);
    void refreshUnreadCount();
  };

  const openNotification = async (notification) => {
    try {
      if (!notification.isRead) {
        const response = await axios.patch(
          `${backendUrl}/api/portal-notifications/${encodeURIComponent(notification.id)}/read`,
          {},
        );
        setNotifications((current) => current.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item
        ));
        if (response.data.changed) {
          setUnreadCount((current) => Math.max(0, current - 1));
        }
        void refreshUnreadCount();
      }
      closeMenu();
      if (notification.href?.startsWith("/") && !notification.href.startsWith("//")) {
        navigate(notification.href);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Notification could not be opened.");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleMenu}
        aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        aria-controls="admin-notification-menu"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-light bg-white text-ink-secondary transition hover:bg-surface-subtle"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="admin-notification-menu"
          aria-label="Notifications"
          className="fixed right-3 top-16 z-[70] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border-light bg-white shadow-elevated"
        >
          <header className="flex items-center justify-between border-b border-border-light px-4 py-3">
            <h2 className="text-sm font-bold text-ink-primary">Notifications</h2>
            {unreadCount > 0 && (
              <span className="text-xs font-medium text-ink-muted">{unreadCount} unread</span>
            )}
          </header>
          <div
            className="max-h-[min(70vh,28rem)] overflow-y-auto"
            onScroll={(event) => {
              const element = event.currentTarget;
              if (hasMore && !loading && cursor && element.scrollHeight - element.scrollTop - element.clientHeight < 48) {
                void loadPage(cursor);
              }
            }}
          >
            {notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                onClick={() => void openNotification(notification)}
                className={`block w-full border-b border-border-light px-4 py-3 text-left transition hover:bg-surface-subtle ${
                  notification.isRead ? "bg-white" : "bg-sky-50"
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-xs font-semibold text-ink-primary">{notification.title}</span>
                  {!notification.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread" />}
                </span>
                <span className="mt-1 block text-xs leading-5 text-ink-secondary">{notification.message}</span>
                <span className="mt-1.5 block text-[10px] text-ink-muted">{formatDate(notification.createdAt)}</span>
              </button>
            ))}

            {loading && <p className="px-4 py-3 text-center text-xs text-ink-muted">Loading notifications…</p>}
            {listError && (
              <div className="px-4 py-4 text-center">
                <p className="text-xs text-rose-700">Notifications could not be loaded.</p>
                <button type="button" onClick={() => void loadPage(null, true)} className="mt-2 text-xs font-semibold text-brand-700 hover:underline">
                  Try again
                </button>
              </div>
            )}
            {!loading && !listError && notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-ink-muted">No notifications yet.</p>
            )}
            {hasMore && !loading && <p className="px-4 py-2 text-center text-[10px] text-ink-muted">Scroll for older notifications</p>}
          </div>
        </section>
      )}
    </div>
  );
};

export default NotificationBell;
