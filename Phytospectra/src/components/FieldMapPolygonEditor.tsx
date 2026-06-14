import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip, FeatureGroup, useMapEvent } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type EditablePolygon = {
  id: string;
  name: string;
  positions: [number, number][]; // [lat,lng]
};

function clampLatLng(latlng: { lat: number; lng: number }) {
  return {
    lat: Math.max(-90, Math.min(90, latlng.lat)),
    lng: Math.max(-180, Math.min(180, latlng.lng)),
  };
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  // basic 2D segment intersection using lat/lng as coordinates
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const [dx, dy] = d;

  const det = (p: number, q: number, r: number, s: number) => p * s - q * r;
  const ab = det(ax - bx, ay - by, cx - dx, cy - dy);
  const cd = det(ax - bx, ay - by, cx - dx, cy - dy);
  void ab;
  void cd;

  const orient = (p: [number, number], q: [number, number], r: [number, number]) => {
    const [px, py] = p;
    const [qx, qy] = q;
    const [rx, ry] = r;
    return (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
  };

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) return false;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function selfIntersects(pts: [number, number][]) {
  if (pts.length < 4) return false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let j = i + 1; j < pts.length; j++) {
      const c = pts[j];
      const d = pts[(j + 1) % pts.length];
      // ignore adjacent edges
      if (i === j) continue;
      if ((i + 1) % pts.length === j) continue;
      if (i === (j + 1) % pts.length) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function overlapWarning(a: [number, number][], b: [number, number][]) {
  // lightweight overlap check: bounding box intersection
  const bbox = (pts: [number, number][]) => {
    const lats = pts.map(p => p[0]);
    const lngs = pts.map(p => p[1]);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  };
  const A = bbox(a);
  const B = bbox(b);
  const latOverlap = A.minLat <= B.maxLat && B.minLat <= A.maxLat;
  const lngOverlap = A.minLng <= B.maxLng && B.minLng <= A.maxLng;
  return latOverlap && lngOverlap;
}

function ClickToAdd({
  onAdd,
  enabled,
}: {
  enabled: boolean;
  onAdd: (latlng: [number, number]) => void;
}) {
  useMapEvent("click", (e) => {
    if (!enabled) return;
    const ll = clampLatLng({ lat: e.latlng.lat, lng: e.latlng.lng });
    onAdd([ll.lat, ll.lng]);
  });
  return null;
}

export function FieldMapPolygonEditor({
  initial,
  otherPolygons,
  onChange,
}: {
  initial: EditablePolygon[];
  otherPolygons: EditablePolygon[];
  onChange: (next: EditablePolygon[]) => void;
}) {
  const [polys, setPolys] = useState<EditablePolygon[]>(initial);
  const [activeId, setActiveId] = useState<string>(initial[0]?.id ?? "");
  const [drawing, setDrawing] = useState(true);

  const active = useMemo(() => polys.find(p => p.id === activeId) ?? polys[0], [polys, activeId]);
  const intersects = useMemo(() => (active ? selfIntersects(active.positions) : false), [active]);
  const overlaps = useMemo(() => {
    if (!active) return false;
    return otherPolygons.some(p => overlapWarning(active.positions, p.positions));
  }, [active, otherPolygons]);

  const setActivePositions = (positions: [number, number][]) => {
    const next = polys.map(p => (p.id === activeId ? { ...p, positions } : p));
    setPolys(next);
    onChange(next);
  };

  const onAddPoint = (latlng: [number, number]) => {
    if (!active) return;
    const nextPositions = [...active.positions, latlng];
    setActivePositions(nextPositions);
  };

  const removeLast = () => {
    if (!active) return;
    if (active.positions.length === 0) return;
    setActivePositions(active.positions.slice(0, -1));
  };

  const clear = () => {
    if (!active) return;
    setActivePositions([]);
  };

  const save = () => {
    setDrawing(false);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="font-display font-semibold">Field polygon editor</div>
            <div className="text-xs text-muted-foreground">Click to add vertices • validates self-intersection</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={removeLast} disabled={!drawing || !active || active.positions.length === 0}>
              Undo
            </Button>
            <Button variant="outline" onClick={clear} disabled={!drawing || !active || active.positions.length === 0}>
              Clear
            </Button>
            <Button onClick={save} disabled={!drawing}>Save polygon</Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs">
          {intersects ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20">
              <AlertTriangle className="h-3.5 w-3.5" /> Invalid boundary: self-intersection detected
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-xl bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5" /> Boundary looks valid
            </span>
          )}
          {overlaps ? (
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-xl bg-amber-500/10 text-amber-700 border border-amber-500/20">
              <AlertTriangle className="h-3.5 w-3.5" /> Potential overlap with other field
            </span>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl overflow-hidden border border-border/40">
          <MapContainer center={[36.48, 2.95]} zoom={14} className="h-[420px] w-full" zoomControl={false}>
            <ClickToAdd enabled={drawing} onAdd={onAddPoint} />
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            {polys.map((p) => (
              <Polygon
                key={p.id}
                positions={p.positions}
                pathOptions={{
                  color: p.id === activeId ? "hsl(142 71% 45%)" : "hsl(48 96% 53%)",
                  fillColor: p.id === activeId ? "hsl(142 71% 45%)" : "hsl(48 96% 53%)",
                  fillOpacity: p.id === activeId ? 0.25 : 0.18,
                  weight: p.id === activeId ? 2 : 1,
                }}
              >
                <Tooltip sticky>{p.name}</Tooltip>
              </Polygon>
            ))}
          </MapContainer>
        </div>
      </Card>
    </div>
  );
}

