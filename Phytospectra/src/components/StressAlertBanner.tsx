import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";

export function StressAlertBanner({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Link
      to="/alerts"
      className="relative z-[99990] flex w-full items-center justify-center gap-3 border-b border-red-700/40 bg-red-600 px-4 py-3 text-white shadow-lg animate-in slide-in-from-top-2 duration-300 hover:bg-red-700 transition-colors"
      aria-live="assertive"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/30">
        <AlertTriangle className="h-5 w-5 animate-pulse" aria-hidden />
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-red-600">
          {count > 9 ? "9+" : count}
        </span>
      </span>
      <div className="min-w-0 flex-1 text-left sm:text-center">
        <p className="text-sm font-bold tracking-wide">
          Crop stress detected — action required
        </p>
        <p className="text-xs text-red-100/90">
          {count === 1
            ? "1 unread alert. Open Stress Alerts to review."
            : `${count} unread alerts. Open Stress Alerts to review.`}
        </p>
      </div>
      <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold">
        View alerts
        <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
