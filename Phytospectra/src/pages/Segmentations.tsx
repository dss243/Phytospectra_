import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Layers3, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useParams, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getBackendBaseUrl } from "@/lib/backend";
import { resolveMaskUrls, type MaskResult } from "@/lib/maskUrls";

type DisplayRow = MaskResult & {
  previewUrl: string | null;
};

type PassedState = {
  segResults?: MaskResult[];
};

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

function formatConfidence(confidence: number | null | undefined): string {
  if (confidence == null) return "—";
  const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `${pct}%`;
}

export default function Segmentations() {
  const { user, loading: authLoading } = useAuth();
  const { flight_id } = useParams();
  const location = useLocation();
  const passed = (location.state as PassedState | null)?.segResults;
  const backendBaseUrl = getBackendBaseUrl();

  const [items, setItems] = useState<DisplayRow[]>([]);
  const [pending, setPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyResults = useCallback(async (results: MaskResult[]) => {
    const signed = await resolveMaskUrls(results);
    setItems(signed);
  }, []);

  const loadResults = useCallback(async (runIfEmpty = false) => {
    if (!flight_id) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const headers = { Authorization: `Bearer ${token}` };

      let res = await fetch(`${backendBaseUrl}/api/segment/flight/${flight_id}`, { headers });
      if (!res.ok) throw new Error(await res.text());

      let json = await res.json();
      let results: MaskResult[] = json.results ?? [];

      if (results.length === 0 && runIfEmpty) {
        setRunning(true);
        res = await fetch(`${backendBaseUrl}/api/segment/flight/${flight_id}`, {
          method: "POST",
          headers,
        });
        if (!res.ok) throw new Error(await res.text());
        json = await res.json();
        results = json.results ?? [];
      }

      await applyResults(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load segmentations");
    } finally {
      setPending(false);
      setRunning(false);
    }
  }, [backendBaseUrl, flight_id, applyResults]);

  useEffect(() => {
    if (authLoading || !user) return;

    if (passed?.length) {
      void applyResults(passed);
      return;
    }

    loadResults(false);
  }, [authLoading, user, flight_id, passed, loadResults, applyResults]);

  const runSegmentation = () => loadResults(true);

  const busy = pending || running;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Segmentation Masks"
        subtitle={flight_id ? `Flight · ${flight_id.slice(-8)}` : "Select a flight"}
        gradient="gradient-analytics"
        icon={Layers3}
      />

      {error ? (
        <div className="rounded-xl border border-stress-severe/30 bg-stress-severe/10 text-stress-severe px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {running ? "Running segmentation (may take a few minutes)…" : "Loading…"}
            </>
          ) : (
            `${items.length} mask(s)`
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/gallery">Back to Gallery</Link>
          </Button>
          <Button onClick={() => loadResults(false)} disabled={busy || !flight_id} size="sm">
            Refresh
          </Button>
          <Button onClick={runSegmentation} disabled={busy || !flight_id} size="sm">
            Run Segmentation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((s) => (
          <Card key={s.image_id} className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">Image · {s.image_id.slice(-8)}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  Stress: {s.stress_class || "—"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                Confidence: {formatConfidence(s.confidence)}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Health score:{" "}
              {s.health_score != null ? `${Math.round(s.health_score * 10) / 10}/100` : "—"}
            </div>

            {s.previewUrl ? (
              <img
                src={s.previewUrl}
                alt="Segmentation mask"
                className="w-full rounded-xl border border-border/40"
                loading="lazy"
              />
            ) : (
              <div className="h-[160px] rounded-xl border border-dashed border-border/50 bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
                Mask preview unavailable
              </div>
            )}
          </Card>
        ))}

        {!items.length && !busy ? (
          <Card className="p-8 text-center text-sm text-muted-foreground space-y-2 lg:col-span-2">
            <p>No segmentation masks yet for this flight.</p>
            <p className="text-xs">
              Go to the{" "}
              <Link to="/gallery" className="text-primary underline">
                Image Gallery
              </Link>{" "}
              and click <strong>Run Segmentation</strong> on a flight.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
