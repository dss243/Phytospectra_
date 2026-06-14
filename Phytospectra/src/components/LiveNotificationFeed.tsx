import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Info } from "lucide-react";
import { notificationStore } from "@/stores/notificationStore";
import type { Severity } from "@/stores/notificationStore";

function severityIcon(sev: Severity) {
  if (sev === "critical") return <AlertTriangle className="h-4 w-4" />;
  if (sev === "warning") return <AlertTriangle className="h-4 w-4" />;
  return <Info className="h-4 w-4" />;
}

function severityStyles(sev: Severity) {
  if (sev === "critical")
    return {
      wrapper: "bg-rose-500/10 border-rose-500/20 text-rose-700",
      icon: "text-rose-500",
    };
  if (sev === "warning")
    return {
      wrapper: "bg-amber-500/10 border-amber-500/20 text-amber-700",
      icon: "text-amber-500",
    };
  return {
    wrapper: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700",
    icon: "text-emerald-500",
  };
}

function useNotificationsSnapshot() {
  const [items, setItems] = useState(() => notificationStore.getState());
  useEffect(() => {
    const unsub = notificationStore.subscribe((s) => setItems(s));
    return () => {
      unsub();
    };
  }, []);
  return items;
}

export function LiveNotificationFeed() {
  const snapshot = useNotificationsSnapshot();
  const items = snapshot.notifications;
  const markAllSeen = notificationStore.markAllSeen;

  const top = useMemo(() => items.slice(0, 8), [items]);

  return (
    <div className="bg-card rounded-2xl shadow-soft border border-border/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Drone & Weather Alerts
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{items.length} total</span>
          <button
            onClick={markAllSeen}
            className="text-xs px-2 py-1 rounded-xl hover:bg-muted text-muted-foreground"
            type="button"
          >
            Mark seen
          </button>
        </div>
      </div>
      <div className="p-2 max-h-[280px] overflow-y-auto space-y-2">
        {top.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No alerts right now.</div>
        ) : (
          top.map((n) => {
            const styles = severityStyles(n.severity);
            return (
              <div
                key={n.id}
                className={`p-3 rounded-2xl border ${styles.wrapper} flex items-start gap-3`}
              >
                <div className={styles.icon}>{severityIcon(n.severity)}</div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{n.title}</div>
                  <div className="text-xs opacity-90 leading-relaxed">{n.message}</div>
                  <div className="text-[10px] opacity-60 mt-2">{new Date(n.createdAt).toLocaleTimeString()}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

