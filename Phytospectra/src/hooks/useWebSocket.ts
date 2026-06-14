import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(baseUrl: string | null) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [connected, setConnected]       = useState(false);
  const [lastMessage, setLastMessage]   = useState<DetectionMessage | null>(null);
  const [lastAlert, setLastAlert]       = useState<StressAlertMessage | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  // Append user_id as query param so the backend can route targeted messages
  const url = baseUrl && user?.id
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}user_id=${user.id}`
    : baseUrl;

  const handleMessage = useCallback((raw: string) => {
    try {
      const msg: WsMessage = JSON.parse(raw);

      // ── Stress alert ───────────────────────────────────────────────────────
      if (msg.type === "stress_alert") {
        setLastAlert(msg);
        setUnreadAlerts(n => n + 1);

        const severityEmoji = { high: "🔴", medium: "🟡", low: "🟢" }[msg.severity] ?? "⚠️";

        toast({
          title: `${severityEmoji} Stress Alert — ${msg.severity.toUpperCase()}`,
          description: msg.message,
          variant: msg.severity === "high" ? "destructive" : "default",
          duration: msg.severity === "high" ? 10_000 : 5_000,
        });
        return;
      }

      // ── Regular detection (existing behaviour) ─────────────────────────────
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

  const clearUnread = useCallback(() => setUnreadAlerts(0), []);

  return { connected, lastMessage, lastAlert, unreadAlerts, clearUnread };
}