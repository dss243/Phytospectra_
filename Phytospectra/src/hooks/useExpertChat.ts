import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { makeAuthedClient } from "@/lib/api";

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_role: "farmer" | "agronomist";
  body: string;
  created_at: string;
}

export function useExpertChat(conversationId: string | null) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    if (!conversationId || !session?.access_token) return;
    try {
      const client = await makeAuthedClient(async () => session.access_token);
      const data = await client.get<ChatMessage[]>(
        `/api/conversations/${conversationId}/messages`
      );
      setMessages(data);
      lastCountRef.current = data.length;
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [conversationId, session?.access_token]);

  // Start polling when conversation opens
  useEffect(() => {
    if (!conversationId || !session?.access_token) return;

    fetchMessages(); // immediate first fetch

    pollRef.current = setInterval(fetchMessages, 2000); // poll every 2s

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      setMessages([]);
      setConnected(false);
      lastCountRef.current = 0;
    };
  }, [conversationId, session?.access_token, fetchMessages]);

  const send = useCallback(async (body: string) => {
    if (!conversationId || !session?.access_token) return;
    try {
      const client = await makeAuthedClient(async () => session.access_token);
      await client.post(`/api/conversations/${conversationId}/messages`, { body });
      await fetchMessages(); // refresh immediately after sending
    } catch (err) {
      console.error("[useExpertChat] Failed to send message", err);
    }
  }, [conversationId, session?.access_token, fetchMessages]);

  return { messages, send, connected };
}