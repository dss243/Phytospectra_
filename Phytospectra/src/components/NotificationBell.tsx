import { useMemo, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlertItem } from "@/components/AlertFeed";
import { AlertFeed } from "@/components/AlertFeed";

export function NotificationBell({ items, onOpenZone }: { items: AlertItem[]; onOpenZone?: (zone: string) => void }) {
  const [open, setOpen] = useState(false);

  const unread = useMemo(() => {
    // In a real implementation, you would use notification read state from DB/WS.
    // For now, show count of items.
    return items.length;
  }, [items]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="h-10 w-10 rounded-xl bg-white/5 hover:bg-white/10 border border-border/40 flex items-center justify-center"
        onClick={() => setOpen(o => !o)}
        aria-label="Open notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-amber text-black text-[10px] font-bold flex items-center justify-center border border-background/60">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[90vw] z-[100000]">
          <div className="bg-card border border-border/40 rounded-2xl shadow-card overflow-hidden">

            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <div className="font-display font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" /> Notifications
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-muted" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[380px] overflow-y-auto p-2">
              <AlertFeed items={items} onClick={(zone) => onOpenZone?.(zone)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

