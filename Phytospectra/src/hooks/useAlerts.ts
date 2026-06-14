import { useEffect, useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { makeAuthedClient } from "@/lib/api";
// ✅ correct path
import { supabase } from "@/integrations/supabase/client"; // your existing client

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

export function useAlerts() {
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

  // Initial fetch + polling fallback
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Realtime: prepend new alerts instantly without waiting for next poll
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
          // Matches both farmer and agronomist rows
          filter: `farmer_id=eq.${user.id}`,
        },
        (payload) => {
          setAlerts((prev) => [payload.new as StressAlert, ...prev]);
        }
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
          setAlerts((prev) => {
            // Avoid duplicates if polling also catches it
            if (prev.some((a) => a.id === (payload.new as StressAlert).id)) return prev;
            return [payload.new as StressAlert, ...prev];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  return { alerts, loading, refetch: fetchAlerts };
}