import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./useAuth";
import { makeAuthedClient } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

export interface StressAlert {
  id: string;
  farmer_id: string;
  agronomist_id: string | null;
  field_id: string;
  flight_id: string | null;
  alert_type: string;
  severity: "high" | "medium" | "low";
  message: string;
  health_score: number;
  lat: number;
  lng: number;
  created_at: string;
}

interface AlertsContextValue {
  alerts: StressAlert[];
  loading: boolean;
  refetch: () => Promise<void>;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

function prependAlert(prev: StressAlert[], row: StressAlert): StressAlert[] {
  if (prev.some((a) => a.id === row.id)) return prev;
  return [row, ...prev];
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { session, user } = useAuth();
  const [alerts, setAlerts] = useState<StressAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const client = await makeAuthedClient(async () => session.access_token);
      const data = await client.get<StressAlert[]>("/api/alerts");
      setAlerts(data);
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`alerts:user:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
          filter: `farmer_id=eq.${user.id}`,
        },
        (payload) => {
          setAlerts((prev) => prependAlert(prev, payload.new as StressAlert));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
          filter: `agronomist_id=eq.${user.id}`,
        },
        (payload) => {
          setAlerts((prev) => prependAlert(prev, payload.new as StressAlert));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return (
    <AlertsContext.Provider value={{ alerts, loading, refetch: fetchAlerts }}>
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) {
    throw new Error("useAlerts must be used within AlertsProvider");
  }
  return ctx;
}
