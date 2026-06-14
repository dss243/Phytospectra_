import { useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { StressAlertDialog } from "./StressAlertDialog";

export function StressAlertMount({ wsUrl }: { wsUrl: string }) {
  const { lastAlert } = useWebSocket(wsUrl || null);

  const onAck = useCallback(() => {
    // We intentionally do not clear lastAlert in the hook right now.
    // The dialog closes itself, and the next alert will open again.
  }, []);

  return <StressAlertDialog lastAlert={lastAlert} onAcknowledge={onAck} />;
}

