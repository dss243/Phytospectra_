import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Trash2 } from "lucide-react";
import { ChatMessageContent } from "@/components/ChatMessageContent";
import { IconBox } from "@/components/IconBox";
import { getBackendBaseUrl } from "@/lib/backend";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isWelcome?: boolean;
  isError?: boolean;
}

const WELCOME: Message = {
  role: "assistant",
  content:
    "Hello! I'm **Phytospectra AI**, your agricultural assistant. I can help you interpret field data, analyze crop stress, understand drone imagery results, and answer agronomic questions. How can I help you today?",
  timestamp: new Date(),
  isWelcome: true,
};

export default function ChatBot() {
  const backendBaseUrl = getBackendBaseUrl();
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  const buildPayload = (history: Message[]) =>
    history
      .filter((m) => !m.isWelcome && !m.isError)
      .map((m) => ({ role: m.role, content: m.content }));

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: Message = { role: "user", content: text, timestamp: new Date() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    const payload = buildPayload(history);

    try {
      const res = await fetch(`${backendBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (!mountedRef.current || controller.signal.aborted) return;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, timestamp: new Date() },
      ]);
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") return;

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach the server. Please try again.",
          timestamp: new Date(),
          isError: true,
        },
      ]);
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setLoading(false);
    setMessages([{ ...WELCOME, timestamp: new Date() }]);
    setInput("");
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const suggestions = [
    "What causes yellowing leaves in wheat?",
    "How to interpret NDVI results?",
    "Signs of water stress in corn",
    "Best practices for drone scouting",
  ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem-3rem)] max-w-3xl min-h-0 flex-col gap-4 md:h-[calc(100dvh-3.5rem-4rem)]">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <IconBox icon={Bot} accent="green" size="sm" />
          <div>
            <h1 className="font-display text-base font-semibold leading-tight">Phytospectra AI</h1>
            <p className="text-xs text-muted-foreground">Agricultural Expert Assistant</p>
          </div>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      <div
        ref={messagesRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.map((msg, i) => (
          <div
            key={`${msg.timestamp.getTime()}-${i}`}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                msg.role === "assistant"
                  ? "bg-primary/10 text-primary"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <Bot className="h-4 w-4" />
              ) : (
                <User className="h-4 w-4" />
              )}
            </div>
            <div
              className={`flex max-w-[78%] flex-col gap-1 ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm bg-white/90 ring-1 ring-border/40"
                }`}
              >
                {msg.role === "assistant" ? (
                  <ChatMessageContent text={msg.content} />
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
              <span className="px-1 text-[11px] text-muted-foreground">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white/90 px-4 py-3 ring-1 ring-border/40">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {messages.length === 1 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInput(s)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2 rounded-xl border border-border/50 bg-white/90 p-2 shadow-soft transition-colors focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about crop health, field data, agronomic advice…"
          rows={1}
          className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      <p className="shrink-0 text-center text-[11px] text-muted-foreground">
        Powered by Groq · Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
