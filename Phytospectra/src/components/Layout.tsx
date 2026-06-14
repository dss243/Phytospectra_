import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { AlertBell } from "./AlertBell";
import { StressAlertMessage } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

export function Layout({
  children, wsConnected, dbConnected, wsUrl,
  lastAlert, unreadAlerts, clearUnread,
}: {
  children: ReactNode;
  wsConnected: boolean;
  dbConnected: boolean;
  wsUrl: string;
  lastAlert: StressAlertMessage | null;
  unreadAlerts: number;
  clearUnread: () => void;
}) {
  const { pathname } = useLocation();
  const isChatPage = pathname === "/chat";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        wsUrl={wsUrl}
        wsConnected={wsConnected}
        dbConnected={dbConnected}
        unreadAlerts={unreadAlerts}
        clearUnread={clearUnread}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col app-shell-bg">
        <header className="flex h-14 shrink-0 items-center justify-end border-b border-border/50 bg-white/90 px-4 shadow-soft backdrop-blur-xl md:px-6">
          <AlertBell
            lastAlert={lastAlert}
            unreadAlerts={unreadAlerts}
            clearUnread={clearUnread}
          />
        </header>
        <main
          className={cn(
            "min-h-0 flex-1 p-4 animate-fade-slide-down md:p-6 lg:p-8",
            isChatPage ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
