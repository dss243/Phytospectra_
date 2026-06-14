import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { makeAuthedClient } from "@/lib/api";

const WS_BASE = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

export interface ConversationRequest {
  id: string;
  farmer_id: string;
  zone: string;
  issue: string;
  status: "open" | "resolved";
  created_at: string;
  health?: number;
  profiles: { display_name: string; farm_name: string } | null;
}

export function useExpertRequests() {
  const { session } = useAuth();
  const [requests, setRequests] = useState<ConversationRequest[]>([]);

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    const token = session.access_token;

    const load = async () => {
      try {
        const client = await makeAuthedClient(async () => token);
        const data = await client.get<ConversationRequest[]>("/api/conversations");
        if (!cancelled) setRequests(data);
      } catch (err) {
        console.error("Failed to load conversations", err);
      }
    };

    load();
    const interval = setInterval(load, 5000); // poll every 5s instead of WS

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session?.access_token]);

  return requests;
}