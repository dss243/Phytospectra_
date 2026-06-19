import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { AlertBell } from "./AlertBell";
import { StressAlertBanner } from "./StressAlertBanner";
import { StressAlertMessage } from "@/hooks/useWebSocket";
import { usePendingStressAlerts } from "@/hooks/usePendingStressAlerts";
import { cn } from "@/lib/utils";

export function Layout({
  children, wsConnected, dbConnected, lastAlert,
}: {
  children: ReactNode;
  wsConnected: boolean;
  dbConnected: boolean;
  lastAlert: StressAlertMessage | null;
}) {
  const { pathname } = useLocation();
  const isChatPage = pathname === "/chat";
  const pendingAlerts = usePendingStressAlerts(lastAlert);
  const showAlertBanner = pendingAlerts > 0 && pathname !== "/alerts";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        wsConnected={wsConnected}
        dbConnected={dbConnected}
        pendingAlerts={pendingAlerts}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col app-shell-bg">
        {showAlertBanner && <StressAlertBanner count={pendingAlerts} />}
        <header className="flex h-14 shrink-0 items-center justify-end border-b border-border/50 bg-white/90 px-4 shadow-soft backdrop-blur-xl md:px-6">
          <AlertBell lastAlert={lastAlert} pendingAlerts={pendingAlerts} />
        </header>
        <main
          className={cn(
            "min-h-0 flex-1 p-4 animate-fade-slide-down md:p-6 lg:p-8",
            isChatPage ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        {showAlertBanner && (
          <div className="pointer-events-none fixed inset-0 z-[99980] ring-4 ring-inset ring-red-500/25 animate-pulse" aria-hidden />
        )}
      </div>
    </div>
  );
}
