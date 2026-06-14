export function StatusBadge({ status }: { status: "live" | "idle" | "offline" }) {
  const map = {
    live: { label: "● LIVE", cls: "bg-stress-healthy text-white animate-pulse-live" },
    idle: { label: "○ IDLE", cls: "bg-amber text-white" },
    offline: { label: "× OFFLINE", cls: "bg-stress-severe text-white" },
  } as const;
  const v = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold tracking-wide ring-1 ring-white/20 ${v.cls} shadow-soft`}>
      {v.label}
    </span>
  );
}