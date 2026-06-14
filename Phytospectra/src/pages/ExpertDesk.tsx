import { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useExpertRequests } from "@/hooks/useExpertRequests";
import { useExpertChat } from "@/hooks/useExpertChat";
import { makeAuthedClient } from "@/lib/api";
import {
  Inbox,
  Leaf,
  AlertTriangle,
  MessageCircle,
  TrendingUp,
  CheckCircle2,
  Send,
  X,
  WifiOff,
  Clock,
  Wheat,
} from "lucide-react";

const URGENCY = {
  high:   "bg-stress-severe/15 text-stress-severe border-stress-severe/30",
  medium: "bg-amber/15 text-amber border-amber/30",
  low:    "bg-stress-healthy/15 text-stress-healthy border-stress-healthy/30",
} as const;

function urgencyFromHealth(health: number): keyof typeof URGENCY {
  if (health < 50) return "high";
  if (health < 70) return "medium";
  return "low";
}

function timeAgo(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ExpertDesk() {
  const { profile, session } = useAuth();
  const requests = useExpertRequests();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, send, connected } = useExpertChat(activeId);
  const active = requests.find((r) => r.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = msg.trim();
    if (!trimmed || !connected) return;
    send(trimmed);
    setMsg("");
  };

  const handleResolve = async () => {
    if (!activeId || !session?.access_token) return;
    const token = session.access_token;
    const client = await makeAuthedClient(async () => token);
    await client.post(`/api/conversations/${activeId}/resolve`, {});
    setActiveId(null);
  };

  const highUrgency = requests.filter(
    (r) => urgencyFromHealth(r.health ?? 100) === "high"
  ).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome, Dr. ${profile?.display_name || "Agronomist"}`}
        subtitle={
          profile?.specialty
            ? `${profile.specialty} · ${requests.length} farmer${requests.length !== 1 ? "s" : ""} waiting`
            : `${requests.length} farmer${requests.length !== 1 ? "s" : ""} waiting for your insight`
        }
        gradient="gradient-expert"
        icon={Inbox}
      />

      {/* ── Stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Open requests",      v: String(requests.length), icon: Inbox,         c: "text-primary" },
          { l: "High urgency",       v: String(highUrgency),     icon: AlertTriangle,  c: "text-stress-severe" },
          { l: "Resolved this week", v: "12",                    icon: CheckCircle2,   c: "text-stress-healthy" },
          { l: "Farmers helped",     v: "37",                    icon: TrendingUp,     c: "text-amber" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.l} className="bg-card rounded-2xl shadow-soft border border-border/40 p-4">
              <Icon className={`h-5 w-5 ${s.c}`} />
              <div className="font-display text-2xl font-bold mt-2">{s.v}</div>
              <div className="text-xs text-muted-foreground">{s.l}</div>
            </div>
          );
        })}
      </div>

      {/* ── Main grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Request list */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Farmer requests
          </h3>

          {requests.length === 0 && (
            <div className="bg-card rounded-2xl border border-border/40 p-8 text-center text-sm text-muted-foreground">
              No open requests right now. You'll be notified when a farmer reaches out.
            </div>
          )}

          {requests.map((r) => {
            const urgency = urgencyFromHealth(r.health ?? 100);
            return (
              <button
                key={r.id}
                onClick={() => setActiveId(r.id)}
                className={`w-full text-left bg-card rounded-2xl shadow-soft border transition-smooth hover:shadow-card ${
                  activeId === r.id
                    ? "border-primary/40 ring-1 ring-primary/20"
                    : "border-border/40"
                }`}
              >
                <div className="p-4 flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 ring-1 ring-primary/15">
                    <Wheat className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm truncate">
                        {r.profiles?.display_name ?? "Farmer"}
                      </div>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${URGENCY[urgency]}`}
                      >
                        {urgency}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.profiles?.farm_name ?? "—"} · Zone {r.zone}
                    </div>
                    <div className="text-sm mt-1.5 line-clamp-2">{r.issue}</div>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeAgo(r.created_at)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Tips sidebar */}
        <div className="space-y-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Leaf className="h-4 w-4" /> Today's tips
          </h3>
          {[
            { t: "Check weather window",  b: "Light rain forecast Thu — schedule fungicide before Wed evening." },
            { t: "Soil moisture trend",   b: "NDWI dropped 8% across Mitidja farms this week." },
            { t: "Community alert",       b: "3 farms reporting similar yellowing — possible regional issue." },
          ].map((t) => (
            <div key={t.t} className="bg-card rounded-2xl shadow-soft border border-border/40 p-4">
              <div className="font-semibold text-sm">{t.t}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat modal ──────────────────────────────────────────────── */}
      {active && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveId(null)}
        >
          <div
            className="bg-card rounded-2xl w-full max-w-md h-[600px] flex flex-col shadow-card animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-border/40 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 ring-1 ring-primary/15">
                <Wheat className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">
                  {active.profiles?.display_name ?? "Farmer"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {active.profiles?.farm_name} · Zone {active.zone}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {connected ? (
                  <span className="flex items-center gap-1 text-[10px] text-stress-healthy">
                    <span className="h-1.5 w-1.5 rounded-full bg-stress-healthy animate-pulse-live" />
                    live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <WifiOff className="h-3 w-3" />
                    reconnecting
                  </span>
                )}
                <button
                  onClick={() => setActiveId(null)}
                  className="p-2 rounded-lg hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Issue strip */}
            <div className="px-4 py-2 bg-muted/40 border-b border-border/30">
              <p className="text-xs text-muted-foreground line-clamp-1">
                <span className="font-medium text-foreground">Issue: </span>
                {active.issue}
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-6">
                  No messages yet. Send a reply to begin.
                </div>
              )}
              {messages.map((m) => {
                const isMe = m.sender_role === "agronomist";
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}
                  >
                    {!isMe && (
                      <span className="text-[10px] text-muted-foreground px-1">Farmer</span>
                    )}
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
            <div className="p-3 border-t border-border/40">
              <div className="flex gap-2">
                <input
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder={connected ? "Reply to farmer…" : "Reconnecting…"}
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
        </div>
      )}
    </div>
  );
}