export type Severity = "info" | "warning" | "critical";

export type LiveNotification = {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  createdAt: string; // iso
  meta?: Record<string, unknown>;
};

type NotificationState = {
  notifications: LiveNotification[];
  unseenCount: number;
};

type Listener = (s: NotificationState) => void;

const state: NotificationState = { notifications: [], unseenCount: 0 };
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l({ ...state, notifications: [...state.notifications] });
}

export const notificationStore = {
  getState(): NotificationState {
    return { ...state, notifications: [...state.notifications] };
  },

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  add(n: Omit<LiveNotification, "id"> & { id?: string }) {
    const id =
      n.id ??
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`);

    const next: LiveNotification = {
      id,
      title: n.title,
      message: n.message,
      severity: n.severity,
      createdAt: n.createdAt,
      meta: n.meta,
    };

    state.notifications = [next, ...state.notifications].slice(0, 200);
    state.unseenCount = Math.min(999, state.unseenCount + 1);
    emit();
  },

  markAllSeen() {
    state.unseenCount = 0;
    emit();
  },

  remove(id: string) {
    state.notifications = state.notifications.filter((x) => x.id !== id);
    emit();
  },

  clear() {
    state.notifications = [];
    state.unseenCount = 0;
    emit();
  },
};

