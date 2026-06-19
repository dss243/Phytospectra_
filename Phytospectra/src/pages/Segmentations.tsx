import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Layers3, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useParams, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getBackendBaseUrl, backendFetch, backendHeaders } from "@/lib/backend";
import { resolveMaskUrls, type MaskResult } from "@/lib/maskUrls";
import { StressZoneMapSection } from "@/components/StressZoneMapSection";
import { mergeSegmentRowsForMap, toSegmentationMapPoints } from "@/lib/gpsMap";

type DisplayRow = MaskResult & {
  previewUrl: string | null;
};

type FieldMeta = {
  field_id?: string | null;
  field_name?: string | null;
  boundary?: Record<string, unknown> | null;
  latitude?: number | null;
  longitude?: number | null;
};

type PassedState = {
  segResults?: MaskResult[];
  field?: FieldMeta | null;
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

function parseSegmentResponse(json: Record<string, unknown>): {
  results: MaskResult[];
  field: FieldMeta | null;
} {
  const results = ((json.results as MaskResult[]) ?? []).map((r) => ({
    image_id: r.image_id,
    mask_url: r.mask_url ?? r.heatmap_url ?? null,
    heatmap_url: r.heatmap_url ?? r.mask_url ?? null,
    stress_class: r.stress_class ?? null,
    confidence: r.confidence ?? null,
    health_score: r.health_score ?? null,
    gps: r.gps ?? null,
  }));
  const field = (json.field as FieldMeta | null | undefined) ?? null;
  return { results, field };
}

export default function Segmentations() {
  const { user, loading: authLoading } = useAuth();
  const { flight_id } = useParams();
  const location = useLocation();
  const passed = location.state as PassedState | null;
  const backendBaseUrl = getBackendBaseUrl();

  const [items, setItems] = useState<DisplayRow[]>([]);
  const [fieldMeta, setFieldMeta] = useState<FieldMeta | null>(passed?.field ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyResults = useCallback(async (results: MaskResult[], field?: FieldMeta | null) => {
    const signed = await resolveMaskUrls(results);
    setItems(signed);
    if (field) setFieldMeta(field);
  }, []);

  const loadResults = useCallback(async (runIfEmpty = false) => {
    if (!flight_id) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const headers = backendHeaders({ Authorization: `Bearer ${token}` });

      let res = await backendFetch(`/api/segment/flight/${flight_id}`, { headers });
      if (!res.ok) throw new Error(await res.text());

      let json = await res.json();
      let { results, field } = parseSegmentResponse(json);

      if (results.length === 0 && runIfEmpty) {
        setRunning(true);
        res = await backendFetch(`/api/segment/flight/${flight_id}`, {
          method: "POST",
          headers,
        });
        if (!res.ok) throw new Error(await res.text());
        json = await res.json();
        ({ results, field } = parseSegmentResponse(json));
      }

      let flightImages: { id: string; gps?: unknown }[] = [];
      try {
        const imgRes = await backendFetch(`/api/flights/${flight_id}/images`, { headers });
        if (imgRes.ok) flightImages = await imgRes.json();
      } catch {
        /* optional */
      }

      const merged = mergeSegmentRowsForMap(results, flightImages);
      await applyResults(merged, field);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load segmentations");
    } finally {
      setPending(false);
      setRunning(false);
    }
  }, [backendBaseUrl, flight_id, applyResults]);

  useEffect(() => {
    if (authLoading || !user) return;

    if (passed?.segResults?.length) {
      void (async () => {
        let flightImages: { id: string; gps?: unknown }[] = [];
        if (flight_id) {
          try {
            const token = await getTokenFromSession();
            const imgRes = await backendFetch(`/api/flights/${flight_id}/images`, {
              headers: backendHeaders({ Authorization: `Bearer ${token}` }),
            });
            if (imgRes.ok) flightImages = await imgRes.json();
          } catch {
            /* optional */
          }
        }
        const merged = mergeSegmentRowsForMap(passed.segResults!, flightImages);
        await applyResults(merged, passed.field ?? null);
      })();
      return;
    }

    loadResults(false);
  }, [authLoading, user, flight_id, passed, loadResults, applyResults]);

  const runSegmentation = () => loadResults(true);

  const mapPoints = useMemo(() => toSegmentationMapPoints(items), [items]);
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

      {items.length > 0 && (
        <StressZoneMapSection
          points={mapPoints}
          boundary={fieldMeta?.boundary ?? null}
          center={{
            lat: fieldMeta?.latitude ?? mapPoints[0]?.lat,
            lng: fieldMeta?.longitude ?? mapPoints[0]?.lng,
          }}
          fieldName={fieldMeta?.field_name}
          selectedId={selectedId}
          onSelect={(p) => setSelectedId(p.image_id)}
          emptyHint="Field map shown — no segmented images with GPS. Check images have EXIF GPS or set field location in Fields."
        />
      )}

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
          <Card
            key={s.image_id}
            className={`p-5 space-y-3 cursor-pointer transition-colors ${
              selectedId === s.image_id ? "ring-2 ring-primary border-primary/40" : ""
            }`}
            onClick={() => setSelectedId(s.image_id)}
          >
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

            {s.gps && (
              <div className="text-[11px] text-muted-foreground font-mono">
                GPS: {s.gps.lat.toFixed(6)}, {s.gps.lng.toFixed(6)}
              </div>
            )}

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
