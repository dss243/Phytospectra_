import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getBackendWsBaseUrl } from "@/lib/backend";

// ── Message types ─────────────────────────────────────────────────────────────

export interface DetectionMessage {
  type?: "detection";
  zone_id: string;
  timestamp: string;
  gps: { lat: number; lng: number };
  health_score: number;
  stress_class: string;
  confidence: number;
  heatmap_url?: string;
  drone_image_url?: string;
}

export interface StressAlertMessage {
  type: "stress_alert";
  alert_id: string;
  farmer_id: string;
  agronomist_id: string | null;
  field_id: string;
  severity: "low" | "medium" | "high";
  health_score: number;
  message: string;
  lat: number;
  lng: number;
}

export type WsMessage = DetectionMessage | StressAlertMessage;

function buildDashboardWsUrl(token: string, overrideBase?: string | null): string {
  const base = (overrideBase && overrideBase.trim())
    ? overrideBase.trim().replace(/\/$/, "")
    : `${getBackendWsBaseUrl()}/ws/dashboard`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(baseUrl: string | null) {
  const { session } = useAuth();
  const { toast } = useToast();

  const [connected, setConnected]       = useState(false);
  const [lastMessage, setLastMessage]   = useState<DetectionMessage | null>(null);
  const [lastAlert, setLastAlert]       = useState<StressAlertMessage | null>(null);

  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  const url = useMemo(() => {
    const token = session?.access_token;
    if (!token) return null;
    return buildDashboardWsUrl(token, baseUrl);
  }, [baseUrl, session?.access_token]);

  const handleMessage = useCallback((raw: string) => {
    try {
      const msg: WsMessage = JSON.parse(raw);

      if (msg.type === "stress_alert") {
        setLastAlert(msg);

        const severityEmoji = { high: "🔴", medium: "🟡", low: "🟢" }[msg.severity] ?? "⚠️";

        toast({
          title: `${severityEmoji} Stress Alert — ${msg.severity.toUpperCase()}`,
          description: msg.message,
          variant: msg.severity === "high" ? "destructive" : "default",
          duration: msg.severity === "high" ? 10_000 : 5_000,
        });
        return;
      }

      setLastMessage(msg as DetectionMessage);
    } catch {
      // malformed frame — ignore
    }
  }, [toast]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const connect = () => {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen    = () => { if (!cancelled) setConnected(true); };
        ws.onclose   = () => {
          if (cancelled) return;
          setConnected(false);
          timerRef.current = window.setTimeout(connect, 3000);
        };
        ws.onerror   = () => ws.close();
        ws.onmessage = (e) => handleMessage(e.data);

      } catch {
        timerRef.current = window.setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [url, handleMessage]);

  return { connected, lastMessage, lastAlert };
}
