import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { countUnacknowledged } from "@/lib/alertAck";
import { useAlerts } from "@/hooks/useAlerts";
import type { StressAlertMessage } from "@/hooks/useWebSocket";

/**
 * Unread stress alerts — stays visible until the user opens /alerts.
 */
export function usePendingStressAlerts(lastWsAlert: StressAlertMessage | null) {
  const { pathname } = useLocation();
  const { alerts, refetch } = useAlerts();

  useEffect(() => {
    if (lastWsAlert?.alert_id) {
      void refetch();
    }
  }, [lastWsAlert?.alert_id, refetch]);

  const pending = useMemo(() => {
    if (pathname === "/alerts") return 0;
    return countUnacknowledged(alerts);
  }, [alerts, pathname]);

  return pending;
}
