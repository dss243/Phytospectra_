import type { StressMapPoint } from "@/components/StressFlightMap";

export type GpsCoords = { lat: number; lng: number };

export function hasValidGps(gps?: GpsCoords | null): gps is GpsCoords {
  if (!gps) return false;
  if (gps.lat === 0 && gps.lng === 0) return false;
  return (
    Number.isFinite(gps.lat) &&
    Number.isFinite(gps.lng) &&
    Math.abs(gps.lat) <= 90 &&
    Math.abs(gps.lng) <= 180
  );
}

export function normalizeGps(raw: unknown): GpsCoords | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const lat = g.lat ?? g.latitude;
  const lng = g.lng ?? g.longitude;
  if (lat == null || lng == null) return null;
  const coords = { lat: Number(lat), lng: Number(lng) };
  return hasValidGps(coords) ? coords : null;
}

/** Map pins only for moderate (35–54) and severe (<35) — SegFormer "stressed" always included. */
export type StressMapTier = "moderate" | "severe";

export function stressMapTier(
  health_score?: number | null,
  stress_class?: string | null,
): StressMapTier | null {
  const cls = (stress_class ?? "").toLowerCase();
  if (cls === "healthy") return null;

  if (health_score != null && Number.isFinite(health_score)) {
    if (cls !== "stressed" && health_score >= 55) return null;
    if (health_score >= 35) return "moderate";
    return "severe";
  }

  if (cls === "stressed") return "moderate";
  if (cls && cls !== "healthy") return "moderate";
  return null;
}

export function isMapWorthyStress(
  health_score?: number | null,
  stress_class?: string | null,
): boolean {
  return stressMapTier(health_score, stress_class) != null;
}

export type SegmentMapRow = {
  image_id: string;
  gps?: GpsCoords | null;
  health_score?: number | null;
  stress_class?: string | null;
  heatmap_url?: string | null;
  mask_url?: string | null;
  gps_source?: string | null;
};

/** Merge GPS from segmentation row or flight image — no field-centroid guess. */
export function mergeSegmentRowsForMap(
  segments: SegmentMapRow[],
  images: { id: string; gps?: unknown }[],
): SegmentMapRow[] {
  const imgById = Object.fromEntries(images.map((i) => [i.id, i]));

  return segments.map((seg) => {
    const gps =
      normalizeGps(seg.gps) ?? normalizeGps(imgById[seg.image_id]?.gps) ?? null;
    return { ...seg, gps };
  });
}

export function toStressMapPoints(
  rows: SegmentMapRow[],
  options?: { stressedOnly?: boolean },
): StressMapPoint[] {
  const stressedOnly = options?.stressedOnly !== false;

  return rows.flatMap((row) => {
    const gps = normalizeGps(row.gps);
    if (!gps) return [];
    if (stressedOnly && !isMapWorthyStress(row.health_score, row.stress_class)) {
      return [];
    }
    return [
      {
        image_id: row.image_id,
        lat: gps.lat,
        lng: gps.lng,
        health_score: row.health_score ?? undefined,
        stress_class: row.stress_class ?? undefined,
        heatmap_url: row.heatmap_url ?? row.mask_url ?? undefined,
        gps_source: row.gps_source ?? undefined,
      },
    ];
  });
}
