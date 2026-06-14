import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Bell, Sprout, Thermometer, Wind } from "lucide-react";
import { healthLabel } from "@/lib/mockData";

export interface AlertItem {
  id: string;
  zone: string;
  health: number;
  confidence: number;
  timestamp: string;
}

function AlertIcon({ health }: { health: number }) {
  const h = healthLabel(health);

  // Map the existing health buckets to a more “notification-like” icon.
  // (Front-end-only; colors stay consistent with healthLabel.)
  if (h.label.toLowerCase().includes("healthy")) {
    return <Bell className="h-4 w-4 text-emerald-400" />;
  }

  if (h.label.toLowerCase().includes("mild")) {
    return <Thermometer className="h-4 w-4 text-amber-400" />;
  }

  if (h.label.toLowerCase().includes("moderate")) {
    return <Wind className="h-4 w-4 text-orange-400" />;
  }

  return <AlertTriangle className="h-4 w-4 text-rose-400" />;
}

export function AlertFeed({ items, onClick }: { items: AlertItem[]; onClick?: (id: string) => void }) {
  return (
    <div className="bg-card rounded-2xl shadow-soft border border-border/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Live Detections
        </h3>
        <span className="text-xs text-muted-foreground">{items.length} events</span>
      </div>
      <div className="max-h-[320px] overflow-y-auto divide-y divide-border/40">
        {items.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Sprout className="h-5 w-5 text-stress-healthy" />
            All zones healthy! Your crops are thriving.
          </div>
        )}
        {items.map((it) => {
          const h = healthLabel(it.health);
          return (
            <button
              key={it.id}
              onClick={() => onClick?.(it.zone)}
              className="w-full text-left flex items-center gap-3 p-3 hover:bg-muted/40 transition-smooth animate-fade-slide-down"
              style={{ borderLeft: `4px solid ${h.color}` }}
            >
              <div
                className="h-9 w-9 rounded-xl bg-muted/60 border border-border/40 flex items-center justify-center flex-none"
                aria-hidden="true"
              >
                <AlertIcon health={it.health} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{it.zone}</div>
                <div className="text-xs text-muted-foreground">{h.label} · {Math.round(it.confidence * 100)}% confident</div>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(it.timestamp), { addSuffix: true })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

