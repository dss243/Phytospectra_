import { useEffect } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";

export type StressMapPoint = {
  image_id: string;
  lat: number;
  lng: number;
  health_score?: number | null;
  stress_class?: string | null;
  heatmap_url?: string | null;
  model?: string;
  storage_path?: string | null;
};

function healthColor(score: number | null | undefined): string {
  if (score == null) return "hsl(220 10% 55%)";
  if (score >= 75) return "hsl(142 71% 45%)";
  if (score >= 55) return "hsl(48 96% 53%)";
  if (score >= 35) return "hsl(25 95% 53%)";
  return "hsl(0 84% 60%)";
}

function Resize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

function FitBounds({ points, boundary }: { points: StressMapPoint[]; boundary?: object | null }) {
  const map = useMap();
  useEffect(() => {
    const coords: LatLngTuple[] = points.map((p) => [p.lat, p.lng]);
    const ring = boundaryRing(boundary);
    if (ring) {
      for (const [lng, lat] of ring) coords.push([lat, lng]);
    }
    if (coords.length) {
      map.fitBounds(coords, { padding: [40, 40], maxZoom: 17 });
    }
  }, [map, points, boundary]);
  return null;
}

function boundaryRing(boundary: object | null | undefined): [number, number][] | null {
  if (!boundary || typeof boundary !== "object") return null;
  const b = boundary as Record<string, unknown>;
  let geom = b;
  if (b.type === "Feature" && b.geometry && typeof b.geometry === "object") {
    geom = b.geometry as Record<string, unknown>;
  }
  if (geom.type !== "Polygon") return null;
  const coords = geom.coordinates as unknown;
  if (!Array.isArray(coords) || !Array.isArray(coords[0])) return null;
  return coords[0] as [number, number][];
}

export function StressFlightMap({
  points,
  boundary,
  center,
  selectedId,
  onSelect,
}: {
  points: StressMapPoint[];
  boundary?: object | null;
  center?: { lat?: number | null; lng?: number | null };
  selectedId?: string | null;
  onSelect?: (p: StressMapPoint) => void;
}) {
  const defaultCenter: LatLngTuple = [
    center?.lat ?? points[0]?.lat ?? 36.48,
    center?.lng ?? points[0]?.lng ?? 2.95,
  ];
  const ring = boundaryRing(boundary);
  const polygonPositions: LatLngTuple[] | null = ring
    ? ring.map(([lng, lat]) => [lat, lng] as LatLngTuple)
    : null;

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-card border border-border/40">
      <MapContainer center={defaultCenter} zoom={15} className="h-full w-full" zoomControl={false}>
        <Resize />
        <FitBounds points={points} boundary={boundary} />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles © Esri"
          maxZoom={19}
        />
        {polygonPositions && (
          <Polygon
            positions={polygonPositions}
            pathOptions={{ color: "#fff", fillColor: "transparent", weight: 2, dashArray: "6 4" }}
          />
        )}
        {points.map((p) => {
          const color = healthColor(p.health_score);
          const selected = selectedId === p.image_id;
          return (
            <CircleMarker
              key={p.image_id}
              center={[p.lat, p.lng]}
              radius={selected ? 12 : 8}
              pathOptions={{
                color: "#fff",
                weight: selected ? 3 : 2,
                fillColor: color,
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onSelect?.(p) }}
            >
              <Tooltip sticky>
                Health {p.health_score != null ? Math.round(p.health_score) : "—"}/100
                {p.model ? ` · ${p.model}` : ""}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="absolute bottom-3 right-3 z-[400] bg-white/95 backdrop-blur rounded-xl shadow-card p-3 text-xs space-y-1.5">
        <div className="font-semibold mb-1">Stress map (GPS)</div>
        {[
          { c: healthColor(80), l: "Healthy (75+)" },
          { c: healthColor(65), l: "Mild (55–74)" },
          { c: healthColor(45), l: "Moderate (35–54)" },
          { c: healthColor(20), l: "Severe (under 35)" },
        ].map((i) => (
          <div key={i.l} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: i.c }} /> {i.l}
          </div>
        ))}
      </div>
    </div>
  );
}
