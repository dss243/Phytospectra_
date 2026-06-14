import { useRef, useEffect, useState } from "react";
import type { StressAlertMessage } from "@/hooks/useWebSocket";

interface Props {
  lastAlert:    StressAlertMessage | null;
  unreadAlerts: number;
  clearUnread:  () => void;
}

const SEV_COLOR = { high: "text-red-500", medium: "text-amber-500", low: "text-green-600" };
const SEV_BAR   = { high: "#e24b4a",      medium: "#ef9f27",        low: "#639922" };

export function AlertBell({ lastAlert, unreadAlerts, clearUnread }: Props) {
  const [open, setOpen]       = useState(false);
  const [history, setHistory] = useState<StressAlertMessage[]>([]);
  const panelRef              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lastAlert) return;
    setHistory(prev =>
      prev.some(a => a.alert_id === lastAlert.alert_id)
        ? prev
        : [lastAlert, ...prev].slice(0, 50)
    );
  }, [lastAlert]);

  useEffect(() => {
    if (open) clearUnread();
  }, [open, clearUnread]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={`${unreadAlerts} unread alerts`}
        className="relative p-2 rounded-md hover:bg-muted transition-colors"
      >
        <span className="ti ti-bell text-xl" aria-hidden="true" />
        {unreadAlerts > 0 && (
          <span className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-red-500
                           text-white text-[10px] font-medium flex items-center justify-center">
            {unreadAlerts > 9 ? "9+" : unreadAlerts}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-background border rounded-lg
                        shadow-lg z-50 max-h-[420px] overflow-y-auto">
          <p className="px-4 py-2.5 text-sm font-medium border-b text-muted-foreground sticky top-0 bg-background">
            Alerts
          </p>

          {history.length === 0 ? (
            <p className="px-4 py-8 text-sm text-center text-muted-foreground">
              No alerts yet
            </p>
          ) : (
            history.map(a => (
              <div
                key={a.alert_id}
                className="px-4 py-3 border-b last:border-0 hover:bg-muted/50"
                style={{ borderLeft: `3px solid ${SEV_BAR[a.severity]}` }}
              >
                <p className="text-sm leading-snug">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Health: {a.health_score.toFixed(0)}% ·{" "}
                  <span className={SEV_COLOR[a.severity]}>{a.severity}</span>
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}