import { useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAlerts, StressAlert } from "@/hooks/useAlerts";
import { acknowledgeAlertIds } from "@/lib/alertAck";
import {
  AlertCircle, Info, BellRing,
  Clock, MapPin, Wifi, Inbox,
} from "lucide-react";

type Severity = "all" | "high" | "medium" | "low";

const SEVERITY_STYLES = {
  high:   { badge: "bg-red-100 text-red-800",    circle: "bg-red-100 text-red-700",    icon: BellRing },
  medium: { badge: "bg-amber-100 text-amber-800", circle: "bg-amber-100 text-amber-700", icon: AlertCircle },
  low:    { badge: "bg-green-100 text-green-800", circle: "bg-green-100 text-green-700", icon: Info },
};

function timeAgo(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function AlertRow({ alert }: { alert: StressAlert }) {
  const style = SEVERITY_STYLES[alert.severity];
  const Icon  = style.icon;

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border/40 last:border-b-0 hover:bg-muted/40 transition-smooth">
      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${style.circle}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">Field {alert.field_id.slice(0, 8)}</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide ${style.badge}`}>
            {alert.severity}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">
            score: <span className="font-semibold">{alert.health_score.toFixed(0)}%</span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.message}</p>
        <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />{timeAgo(alert.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />{alert.lat.toFixed(2)}°N, {alert.lng.toFixed(2)}°E
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Alerts() {
  const { alerts, loading } = useAlerts();
  const [filter, setFilter] = useState<Severity>("all");

  useEffect(() => {
    if (!loading) {
      acknowledgeAlertIds(alerts);
    }
  }, [loading, alerts]);

  const counts = {
    all:    alerts.length,
    high:   alerts.filter(a => a.severity === "high").length,
    medium: alerts.filter(a => a.severity === "medium").length,
    low:    alerts.filter(a => a.severity === "low").length,
  };

  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stress Alerts"
        subtitle="Real-time crop health notifications"
        gradient="gradient-expert"
        icon={BellRing}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total alerts",   value: counts.all,    color: "text-foreground" },
          { label: "High severity",  value: counts.high,   color: "text-red-600" },
          { label: "Medium",         value: counts.medium, color: "text-amber-600" },
          { label: "Low",            value: counts.low,    color: "text-green-600" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-2xl shadow-soft border border-border/40 p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`font-display text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Alert list */}
      <div className="bg-card rounded-2xl shadow-soft border border-border/40">
        {/* Filter tabs + live indicator */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 flex-wrap">
          {(["all", "high", "medium", "low"] as Severity[]).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-smooth ${
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {s} {s !== "all" && `(${counts[s]})`}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-stress-healthy">
            <Wifi className="h-3 w-3" />
            <span className="animate-pulse-live">live</span>
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-0 divide-y divide-border/40">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3 p-4 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-40" />
                  <div className="h-2 bg-muted rounded w-full" />
                  <div className="h-2 bg-muted rounded w-24" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Inbox className="h-8 w-8 opacity-30" />
            No {filter !== "all" ? filter : ""} alerts right now.
          </div>
        )}

        {/* Rows */}
        {!loading && filtered.map(a => <AlertRow key={a.id} alert={a} />)}
      </div>
    </div>
  );
}