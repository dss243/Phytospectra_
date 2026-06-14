import { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { X, Send, Loader2, Users, MessageSquare, Lightbulb, WifiOff } from "lucide-react";
import { useExpertChat } from "@/hooks/useExpertChat";
import { useAuth } from "@/hooks/useAuth";
import { makeAuthedClient } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Agronomist {
  user_id: string;
  display_name: string | null;
  specialty: string | null;
}

interface ActiveChat {
  agronomist: Agronomist;
  conversationId: string;
}

const TIPS = [
  {
    t: "Detect drought 4 days early",
    b: "Watch NDVI drop combined with NDWI to spot moisture stress before leaves wilt.",
  },
  {
    t: "Disease pattern recognition",
    b: "Circular yellow patches typically signal early fungal infection — isolate the area fast.",
  },
  {
    t: "Best flight time",
    b: "Fly between 10 AM and 2 PM for optimal multispectral reflectance.",
  },
];

function avatarInitials(name: string | null) {
  const parts = (name ?? "Agronomist").trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "AG";
}

export default function Expert() {
  const { user, session } = useAuth();

  const [agronomists, setAgronomists] = useState<Agronomist[]>([]);
  const [loadingAgronomists, setLoadingAgronomists] = useState(true);

  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [openingFor, setOpeningFor] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, send, connected } = useExpertChat(
    activeChat?.conversationId ?? null
  );

  // ── Fetch agronomists from Supabase ──────────────────────────────────────
  useEffect(() => {
    async function loadAgronomists() {
      setLoadingAgronomists(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("user_id, display_name, specialty")
          .in(
            "user_id",
            // sub-select agronomist user_ids from user_roles
            (
              await supabase
                .from("user_roles")
                .select("user_id")
                .eq("role", "agronomist")
            ).data?.map((r: { user_id: string }) => r.user_id) ?? []
          );

        if (error) throw error;
        setAgronomists(data ?? []);
      } catch (err) {
        console.error("Failed to load agronomists", err);
      } finally {
        setLoadingAgronomists(false);
      }
    }

    loadAgronomists();
  }, []);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Open / reuse conversation ────────────────────────────────────────────
  const openChat = async (agronomist: Agronomist) => {
    if (!session?.access_token) return;
    setOpeningFor(agronomist.user_id);
    try {
      const token = session.access_token;
      const client = await makeAuthedClient(async () => token);
      const res = await client.post<{ id: string }>("/api/conversations", {
        agronomist_id: agronomist.user_id,
        zone: "—",
        issue: "New question",
      });
      setActiveChat({ agronomist, conversationId: res.id });
    } catch (err) {
      console.error("Failed to open conversation", err);
      toast.error(
        err instanceof Error ? err.message : "Could not start chat. Is the backend running?"
      );
    } finally {
      setOpeningFor(null);
    }
  };

  const closeChat = () => {
    setActiveChat(null);
    setMsg("");
  };

  const handleSend = () => {
    const trimmed = msg.trim();
    if (!trimmed || !connected) return;
    send(trimmed);
    setMsg("");
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ask an Expert"
        subtitle="Real human agronomists, ready to help"
        gradient="gradient-expert"
        icon={MessageSquare}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Expert list ───────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Available Experts
          </h3>

          {/* Loading skeleton */}
          {loadingAgronomists && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-card rounded-2xl border border-border/40 p-4 flex items-center gap-4 animate-pulse"
                >
                  <div className="h-12 w-12 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-40" />
                    <div className="h-2 bg-muted rounded w-28" />
                  </div>
                  <div className="h-8 w-16 bg-muted rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loadingAgronomists && agronomists.length === 0 && (
            <div className="bg-card rounded-2xl border border-border/40 p-8 text-center text-sm text-muted-foreground">
              No agronomists available right now. Check back soon.
            </div>
          )}

          {/* Agronomist cards */}
          {!loadingAgronomists &&
            agronomists.map((e) => (
              <div
                key={e.user_id}
                className="bg-card rounded-2xl shadow-soft border border-border/40 p-4 flex items-center gap-4"
              >
                <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold relative shrink-0 ring-2 ring-primary/15">
                  {avatarInitials(e.display_name)}
                  {/* All fetched agronomists are considered online */}
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-stress-healthy" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {e.display_name ?? "Agronomist"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.specialty ?? "Agricultural Expert"}
                  </div>
                </div>
                <button
                  disabled={openingFor === e.user_id}
                  onClick={() => openChat(e)}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:shadow-glow transition-smooth flex items-center gap-2 shrink-0"
                >
                  {openingFor === e.user_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {openingFor === e.user_id ? "Opening…" : "Chat"}
                </button>
              </div>
            ))}
        </div>

        {/* ── Tips ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber" /> Community Tips
          </h3>
          {TIPS.map((t) => (
            <div
              key={t.t}
              className="bg-card rounded-2xl shadow-soft border border-border/40 p-4"
            >
              <div className="font-semibold text-sm">{t.t}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat modal ────────────────────────────────────────────────── */}
      {activeChat && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeChat}
        >
          <div
            className="bg-card rounded-2xl w-full max-w-md h-[560px] flex flex-col shadow-card animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-border/40 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {avatarInitials(activeChat.agronomist.display_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">
                  {activeChat.agronomist.display_name ?? "Agronomist"}
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  {connected ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-stress-healthy animate-pulse-live" />
                      <span className="text-stress-healthy">connected</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        reconnecting…
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={closeChat}
                className="p-2 rounded-lg hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-6">
                  Send a message to start the conversation. The agronomist will
                  be notified instantly.
                </div>
              )}
              {messages.map((m) => {
                const isMe = m.sender_id === user?.id;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-0.5 ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                        isMe
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.body}
                    </div>
                    <span className="text-[10px] text-muted-foreground px-1">
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border/40 flex gap-2">
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={connected ? "Type a message…" : "Reconnecting…"}
                disabled={!connected}
                className="flex-1 bg-muted rounded-xl px-3 py-2 text-sm outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!msg.trim() || !connected}
                className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 transition-smooth"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}