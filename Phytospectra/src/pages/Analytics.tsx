import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TRENDS, STRESS_BREAKDOWN, MOCK_ZONES } from "@/lib/mockData";
import { BarChart3, LineChart, Loader2, Sprout } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { backendFetch, backendHeaders } from "@/lib/backend";
import { Field } from "@/types/backend";
import { StressFlightMap } from "@/components/StressFlightMap";
import { mergeSegmentRowsForMap, toStressMapPoints } from "@/lib/gpsMap";
import { Label } from "@/components/ui/label";

const STRESS_COLORS = [
  "hsl(142 71% 45%)",
  "hsl(48 96% 53%)",
  "hsl(25 95% 53%)",
  "hsl(0 84% 60%)",
];

type StressMapPointRow = {
  image_id: string;
  gps?: { lat: number; lng: number } | null;
  health_score?: number | null;
  stress_class?: string | null;
  gps_source?: string | null;
};

export default function Analytics() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [mapRows, setMapRows] = useState<StressMapPointRow[]>([]);
  const [fieldMeta, setFieldMeta] = useState<Field | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const dist = [
    { name: "Healthy", value: MOCK_ZONES.filter((z) => z.health_score >= 75).length },
    { name: "Mild", value: MOCK_ZONES.filter((z) => z.health_score >= 55 && z.health_score < 75).length },
    { name: "Moderate", value: MOCK_ZONES.filter((z) => z.health_score >= 35 && z.health_score < 55).length },
    { name: "Severe", value: MOCK_ZONES.filter((z) => z.health_score < 35).length },
  ];

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
        /* keep charts without map */
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedFieldId) {
      setMapRows([]);
      setFieldMeta(null);
      return;
    }

    let active = true;
    setMapLoading(true);
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;

        const res = await backendFetch(`/api/fields/${selectedFieldId}/stress-map`, {
          headers: backendHeaders({ Authorization: `Bearer ${token}` }),
        });
        if (!res.ok) throw new Error(await res.text());

        const json = await res.json();
        if (!active) return;

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

        const merged = mergeSegmentRowsForMap(rows, []);
        setMapRows(merged);
        setSelectedPinId(null);
      } catch {
        if (active) {
          setMapRows([]);
          setFieldMeta(fields.find((f) => f.id === selectedFieldId) ?? null);
        }
      } finally {
        if (active) setMapLoading(false);
      }
    })();

    return () => { active = false; };
  }, [selectedFieldId, fields]);

  const mapPoints = useMemo(() => toStressMapPoints(mapRows), [mapRows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field Analytics"
        subtitle="Trends, comparisons and crop intelligence"
        gradient="gradient-analytics"
        icon={BarChart3}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
          <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
            <Sprout className="h-4 w-4 text-primary" /> Average Health Trend (14d)
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={TRENDS}>
              <defs>
                <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
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
        </div>

        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
          <h3 className="font-display font-semibold mb-4">Current Zone Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={dist}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={3}
              >
                {dist.map((_, i) => (
                  <Cell key={i} fill={STRESS_COLORS[i]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5 lg:col-span-2">
          <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
            <LineChart className="h-4 w-4 text-secondary" /> Stress Breakdown by Flight
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={STRESS_BREAKDOWN}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="flight" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                }}
              />
              <Legend />
              <Bar dataKey="healthy" stackId="a" fill="hsl(142 71% 45%)" />
              <Bar dataKey="mild" stackId="a" fill="hsl(48 96% 53%)" />
              <Bar dataKey="moderate" stackId="a" fill="hsl(25 95% 53%)" />
              <Bar dataKey="severe" stackId="a" fill="hsl(0 84% 60%)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
          <div>
            <h3 className="font-display font-semibold">Stress zones map</h3>
            <p className="text-xs text-muted-foreground mt-1">
              SegFormer results · orange = moderate, red = severe
            </p>
          </div>
          {fields.length > 0 ? (
            <div className="w-full sm:w-64 space-y-1.5">
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
          ) : (
            <p className="text-xs text-muted-foreground">Create a field first to see the map.</p>
          )}
        </div>

        {mapLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading stress map…
          </div>
        ) : selectedFieldId && (fieldMeta || mapPoints.length > 0) ? (
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
              />
            </div>
            {mapPoints.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {mapPoints.length} pin{mapPoints.length !== 1 ? "s" : ""} from image GPS (EXIF/GeoTIFF) · hover for coordinates
              </p>
            )}
            {mapPoints.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No pins with real GPS. Old uploads may have fake coords — re-run SegFormer after restarting the backend, or use MAPIR photos with GPS in EXIF.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
