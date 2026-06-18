import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StressFlightMap } from "@/components/StressFlightMap";
import type { StressMapPoint } from "@/components/StressFlightMap";
import { hasValidGps } from "@/lib/gpsMap";

export function StressZoneMapSection({
  points,
  boundary,
  center,
  fieldName,
  selectedId,
  onSelect,
  emptyHint,
}: {
  points: StressMapPoint[];
  boundary?: object | null;
  center?: { lat?: number | null; lng?: number | null };
  fieldName?: string | null;
  selectedId?: string | null;
  onSelect?: (p: StressMapPoint) => void;
  emptyHint?: string;
}) {
  const mapCenter = {
    lat: center?.lat ?? points[0]?.lat ?? null,
    lng: center?.lng ?? points[0]?.lng ?? null,
  };
  const canShowField =
    hasValidGps(mapCenter) || (boundary && typeof boundary === "object");

  if (!canShowField && points.length === 0) return null;

  return (
    <Card className="p-4 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <MapPin className="h-4 w-4 text-primary" />
        Stress zones on field
        {fieldName ? (
          <span className="text-muted-foreground font-normal">· {fieldName}</span>
        ) : null}
      </h3>
      <div className="h-[300px] w-full relative">
        <StressFlightMap
          points={points}
          boundary={boundary ?? null}
          center={mapCenter}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        {points.length === 0 && (
          <div className="absolute inset-x-4 top-4 z-[500] rounded-lg bg-card/95 border border-border/60 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            {emptyHint ??
              "No orange/red stress pins yet. Only moderate & severe zones are shown (health score under 55)."}
          </div>
        )}
      </div>
      {points.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {points.length} stressed zone{points.length !== 1 ? "s" : ""} · orange = moderate, red = severe
        </p>
      )}
    </Card>
  );
}
