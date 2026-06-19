import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BarChart3, LineChart, Loader2, Sprout } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { backendFetch, backendHeaders } from "@/lib/backend";
import { Field } from "@/types/backend";
import { StressFlightMap } from "@/components/StressFlightMap";
import { mergeSegmentRowsForMap, toSegmentationMapPoints, toUploadedMapPoints } from "@/lib/gpsMap";
import { Label } from "@/components/ui/label";

const HEALTH_COLORS = [
  "hsl(142 71% 45%)",
  "hsl(48 96% 53%)",
  "hsl(25 95% 53%)",
  "hsl(0 84% 60%)",
  "hsl(220 10% 55%)",
];

const ZONE_LABELS = ["Healthy", "Mild", "Moderate", "Severe", "Not analyzed"] as const;

type StressMapPointRow = {
  image_id: string;
  gps?: { lat: number; lng: number } | null;
  health_score?: number | null;
  stress_class?: string | null;
  gps_source?: string | null;
};

type TrendPoint = {
  date: string;
  health: number;
  flight_id: string;
  images: number;
};

type StressFlightRow = {
  flight: string;
  flight_id: string;
  healthy: number;
  mild: number;
  moderate: number;
  severe: number;
  not_analyzed: number;
};

type ZoneSlice = { name: string; value: number };

type FieldAnalytics = {
  trends: TrendPoint[];
  stress_by_flight: StressFlightRow[];
  zone_distribution: ZoneSlice[];
  summary: {
    avg_health: number | null;
    total_images_analyzed: number;
    total_images_uploaded?: number;
    flights_with_data: number;
  };
};

const EMPTY_ANALYTICS: FieldAnalytics = {
  trends: [],
  stress_by_flight: [],
  zone_distribution: [
    { name: "Healthy", value: 0 },
    { name: "Mild", value: 0 },
    { name: "Moderate", value: 0 },
    { name: "Severe", value: 0 },
    { name: "Not analyzed", value: 0 },
  ],
  summary: { avg_health: null, total_images_analyzed: 0, total_images_uploaded: 0, flights_with_data: 0 },
};

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground text-center px-6">
      {message}
    </div>
  );
}

export default function Analytics() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [analytics, setAnalytics] = useState<FieldAnalytics>(EMPTY_ANALYTICS);
  const [mapRows, setMapRows] = useState<StressMapPointRow[]>([]);
  const [uploadedMapRows, setUploadedMapRows] = useState<
    { image_id: string; lat?: number | null; lng?: number | null; gps_source?: string | null; upload_source?: string | null }[]
  >([]);
  const [fieldMeta, setFieldMeta] = useState<Field | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await backendFetch("/api/fields", {
          headers: backendHeaders({ Authorization: `Bearer ${token}` }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as Field[];
        if (!active) return;
        setFields(data);
        if (data.length > 0) setSelectedFieldId(data[0].id);
      } catch {
        /* fields list optional */
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedFieldId) {
      setAnalytics(EMPTY_ANALYTICS);
      setMapRows([]);
      setUploadedMapRows([]);
      setFieldMeta(null);
      return;
    }

    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;

        const headers = backendHeaders({ Authorization: `Bearer ${token}` });
        const [mapRes, analyticsRes] = await Promise.all([
          backendFetch(`/api/fields/${selectedFieldId}/stress-map`, { headers }),
          backendFetch(`/api/fields/${selectedFieldId}/analytics`, { headers }),
        ]);

        if (!active) return;

        if (analyticsRes.ok) {
          const json = (await analyticsRes.json()) as FieldAnalytics;
          setAnalytics({
            trends: json.trends ?? [],
            stress_by_flight: json.stress_by_flight ?? [],
            zone_distribution: json.zone_distribution ?? EMPTY_ANALYTICS.zone_distribution,
            summary: json.summary ?? EMPTY_ANALYTICS.summary,
          });
        } else {
          setAnalytics(EMPTY_ANALYTICS);
        }

        if (mapRes.ok) {
          const json = await mapRes.json();
          const field = json.field as Field;
          setFieldMeta(field);

          const rows: StressMapPointRow[] = (json.points ?? []).map(
            (p: {
              image_id: string;
              lat?: number | null;
              lng?: number | null;
              health_score?: number | null;
              stress_class?: string | null;
              gps_source?: string | null;
            }) => ({
              image_id: p.image_id,
              gps:
                p.lat != null && p.lng != null
                  ? { lat: p.lat, lng: p.lng }
                  : null,
              health_score: p.health_score ?? null,
              stress_class: p.stress_class ?? null,
              gps_source: p.gps_source ?? null,
            }),
          );
          const uploadedRows = (json.uploaded_points ?? []) as {
            image_id: string;
            lat?: number | null;
            lng?: number | null;
            gps_source?: string | null;
            upload_source?: string | null;
          }[];
          setMapRows(mergeSegmentRowsForMap(rows, []));
          setUploadedMapRows(uploadedRows);
          setSelectedPinId(null);
        } else {
          setMapRows([]);
          setUploadedMapRows([]);
          setFieldMeta(fields.find((f) => f.id === selectedFieldId) ?? null);
        }
      } catch {
        if (active) {
          setAnalytics(EMPTY_ANALYTICS);
          setMapRows([]);
          setUploadedMapRows([]);
          setFieldMeta(fields.find((f) => f.id === selectedFieldId) ?? null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [selectedFieldId, fields]);

  const mapPoints = useMemo(
    () => [...toSegmentationMapPoints(mapRows), ...toUploadedMapPoints(uploadedMapRows)],
    [mapRows, uploadedMapRows],
  );
  const zoneDist = analytics.zone_distribution.filter((z) => z.value > 0);
  const hasTrends = analytics.trends.length > 0;
  const hasStressBreakdown = analytics.stress_by_flight.length > 0;
  const hasZoneData = zoneDist.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field Analytics"
        subtitle="Charts and map — all SegFormer results with GPS; gray = not analyzed yet"
        gradient="gradient-analytics"
        icon={BarChart3}
      />

      {fields.length > 0 ? (
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-4 flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
          <div className="w-full sm:w-72 space-y-1.5">
            <Label className="text-xs">Field</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedFieldId}
              onChange={(e) => setSelectedFieldId(e.target.value)}
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.field_name}
                </option>
              ))}
            </select>
          </div>
          {!loading && selectedFieldId && (
            <div className="flex flex-wrap gap-4 text-sm">
              {(analytics.summary.total_images_uploaded ?? 0) > 0 && (
                <div>
                  <span className="text-muted-foreground">Uploaded </span>
                  <span className="font-semibold">{analytics.summary.total_images_uploaded}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Analyzed </span>
                <span className="font-semibold">{analytics.summary.total_images_analyzed}</span>
              </div>
              {analytics.summary.avg_health != null && (
                <div>
                  <span className="text-muted-foreground">Avg health </span>
                  <span className="font-semibold">{analytics.summary.avg_health}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground px-1">
          Create a field under Fields, then run segmentation on a flight to see analytics here.
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading field analytics…
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <Sprout className="h-4 w-4 text-primary" /> Avg health by flight
            </h3>
            {hasTrends ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={analytics.trends}>
                  <defs>
                    <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                    }}
                    formatter={(value: number, _name, props) => {
                      const images = (props.payload as TrendPoint)?.images;
                      return [`${value}%`, images != null ? `avg · ${images} image(s)` : "avg health"];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="health"
                    stroke="hsl(142 71% 37%)"
                    strokeWidth={2.5}
                    fill="url(#hg)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty message="No segmented flights for this field yet." />
            )}
          </div>

          <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
            <h3 className="font-display font-semibold mb-4">Health zone distribution</h3>
            {hasZoneData ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={zoneDist}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                  >
                    {zoneDist.map((slice) => {
                      const idx = ZONE_LABELS.indexOf(slice.name as (typeof ZONE_LABELS)[number]);
                      return (
                        <Cell key={slice.name} fill={HEALTH_COLORS[idx >= 0 ? idx : 0]} />
                      );
                    })}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty message="Run segmentation on a flight to see health distribution." />
            )}
          </div>

          <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5 lg:col-span-2">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <LineChart className="h-4 w-4 text-secondary" /> Health breakdown by flight
            </h3>
            {hasStressBreakdown ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.stress_by_flight}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="flight" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                    }}
                  />
                  <Legend />
                  <Bar dataKey="healthy" stackId="a" fill={HEALTH_COLORS[0]} name="Healthy" />
                  <Bar dataKey="mild" stackId="a" fill={HEALTH_COLORS[1]} name="Mild" />
                  <Bar dataKey="moderate" stackId="a" fill={HEALTH_COLORS[2]} name="Moderate" />
                  <Bar dataKey="severe" stackId="a" fill={HEALTH_COLORS[3]} name="Severe" />
                  <Bar dataKey="not_analyzed" stackId="a" fill={HEALTH_COLORS[4]} name="Not analyzed" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty message="Health breakdown appears after you segment images on at least one flight." />
            )}
          </div>
        </div>
      )}

      <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5 space-y-4">
        <div>
          <h3 className="font-display font-semibold">Field map</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Pin color = health (green healthy → red severe) · gray = uploaded, not segmented yet
          </p>
        </div>

        {!loading && selectedFieldId && (fieldMeta || mapPoints.length > 0) ? (
          <div className="space-y-2">
            <div className="h-[360px] w-full">
              <StressFlightMap
                points={mapPoints}
                boundary={fieldMeta?.boundary ?? null}
                center={{
                  lat: fieldMeta?.latitude ?? mapPoints[0]?.lat,
                  lng: fieldMeta?.longitude ?? mapPoints[0]?.lng,
                }}
                selectedId={selectedPinId}
                onSelect={(p) => setSelectedPinId(p.image_id)}
                variant="health"
              />
            </div>
            {mapPoints.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {mapPoints.length} pin{mapPoints.length !== 1 ? "s" : ""} on map
              </p>
            )}
            {mapPoints.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No pins with GPS yet. Use MAPIR photos with EXIF GPS and re-run segmentation.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
