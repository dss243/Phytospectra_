import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Radar } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { DetectionMessage } from "@/types/backend";
import { getBackendBaseUrl, backendFetch } from "@/lib/backend";

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

export default function LatestDetections() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<DetectionMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendBaseUrl = getBackendBaseUrl();

  const refresh = async () => {
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/detections/latest`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as DetectionMessage[];
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load latest detections");
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  return (
    <div className="space-y-4">
      <PageHeader title="Latest Detections" subtitle="Most recent incoming drone classifications" gradient="gradient-gallery" icon={Radar} />

      {error ? (
        <div className="rounded-xl border border-stress-severe/30 bg-stress-severe/10 text-stress-severe px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">{pending ? "Loading…" : `${items.length} result(s)`}</div>
        <Button onClick={() => refresh()} disabled={pending}>
          {pending ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((d, idx) => (
          <Card key={`${d.zone_id}-${idx}`} className="p-5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Zone: {d.zone_id}</div>
                <div className="text-xs text-muted-foreground">{new Date(d.timestamp).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Health</div>
                <div className="font-bold">{Math.round(d.health_score * 10) / 10}/100</div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Stress class: <span className="font-semibold">{d.stress_class}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Confidence: <span className="font-semibold">{Math.round(d.confidence * 100)}%</span>
            </div>

            {d.heatmap_url ? (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Heatmap</div>
                <img src={d.heatmap_url} alt="heatmap" className="w-full rounded-xl border border-border/40" />
              </div>
            ) : null}
          </Card>
        ))}

        {!items.length && !pending ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">No detections yet.</Card>
        ) : null}
      </div>
    </div>
  );
}

