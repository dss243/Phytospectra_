import { useEffect, useMemo, useState } from "react";
import type { StressAlertMessage } from "@/hooks/useWebSocket";
import {
  AlertTriangle,
  Info,
  MapPin,
  Thermometer,
} from "lucide-react";

export function StressAlertDialog({
  lastAlert,
  onAcknowledge,
}: {
  lastAlert: StressAlertMessage | null;
  onAcknowledge: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!lastAlert) return;
    setOpen(true);
  }, [lastAlert?.alert_id]);

  const content = useMemo(() => {
    if (!lastAlert) return null;

    const severity = lastAlert.severity;

    const Icon =
      severity === "high" ? AlertTriangle : severity === "medium" ? Thermometer : Info;

    const barColor =
      severity === "high"
        ? "border-red-500/30 bg-red-500/10 text-red-800"
        : severity === "medium"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-800"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-800";

    return { severity, Icon, barColor };
  }, [lastAlert]);

  if (!lastAlert || !content) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[100000] flex items-center justify-center p-4 ${open ? "" : "pointer-events-none"}`}
      style={{ display: open ? "flex" : "none" }}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={() => { setOpen(false); onAcknowledge(); }} />

      {/* modal */}
      <div className="relative w-full max-w-xl rounded-2xl border border-border/50 bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] overflow-hidden">
        <div className={`p-4 border-b ${content.barColor}`}>
          <div className="flex items-start gap-3">
            <content.Icon className="h-5 w-5 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                Stress Alert — {lastAlert.severity.toUpperCase()}
              </div>
              <div className="text-xs opacity-70 mt-1">Alert #{lastAlert.alert_id}</div>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm leading-relaxed">{lastAlert.message}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border/40 p-3">
              <Info className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-[11px] text-muted-foreground">Health score</div>
                <div className="text-sm font-semibold">{lastAlert.health_score.toFixed(0)}%</div>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-border/40 p-3">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-[11px] text-muted-foreground">Location</div>
                <div className="text-sm font-semibold">
                  {lastAlert.lat.toFixed(2)} , {lastAlert.lng.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border/40 flex items-center justify-end gap-2">
          <button
            className="px-4 py-2 rounded-xl border border-border/50 hover:bg-muted transition-colors text-sm font-medium"
            onClick={() => {
              setOpen(false);
              onAcknowledge();
            }}
            type="button"
          >
            Dismiss
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-95 transition-opacity text-sm font-semibold"
            onClick={() => {
              setOpen(false);
              onAcknowledge();
            }}
            type="button"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

