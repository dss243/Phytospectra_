import { supabase } from "@/integrations/supabase/client";

export type MaskResult = {
  image_id: string;
  mask_url?: string | null;
  heatmap_url?: string | null;
  stress_class?: string | null;
  confidence?: number | null;
  health_score?: number | null;
  gps?: { lat: number; lng: number } | null;
};

function rawMaskUrl(r: MaskResult): string | null {
  const url = r.mask_url ?? r.heatmap_url ?? null;
  if (!url || url.startsWith("local://")) return null;
  return url;
}

export function parseStorageRef(url: string): { bucket: string; path: string } | null {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

/** Resolve signed preview URLs for segmentation masks (private buckets). */
export async function resolveMaskUrls<T extends MaskResult>(rows: T[]): Promise<(T & { previewUrl: string | null })[]> {
  if (rows.length === 0) return [];

  const withRaw = rows.map((row) => ({ row, raw: rawMaskUrl(row) }));
  const alreadySigned = withRaw.filter(({ raw }) => raw?.includes("/object/sign/"));
  const needsSign = withRaw.filter(
    ({ raw }) => raw && !raw.includes("/object/sign/") && parseStorageRef(raw),
  );

  const signedByImage: Record<string, string> = {};
  for (const { row, raw } of alreadySigned) {
    if (raw) signedByImage[row.image_id] = raw;
  }

  const byBucket: Record<string, { imageId: string; path: string }[]> = {};
  for (const { row, raw } of needsSign) {
    const ref = raw ? parseStorageRef(raw) : null;
    if (!ref) continue;
    byBucket[ref.bucket] = byBucket[ref.bucket] || [];
    byBucket[ref.bucket].push({ imageId: row.image_id, path: ref.path });
  }

  for (const [bucket, entries] of Object.entries(byBucket)) {
    const paths = entries.map((e) => e.path);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    if (error) {
      console.error(`Mask signed URL error for bucket "${bucket}":`, error);
      continue;
    }
    for (const entry of data ?? []) {
      const url =
        (entry as { signedUrl?: string; signedURL?: string }).signedUrl ||
        (entry as { signedUrl?: string; signedURL?: string }).signedURL;
      const match = entries.find((e) => e.path === entry.path);
      if (url && match) signedByImage[match.imageId] = url;
    }
  }

  return withRaw.map(({ row, raw }) => ({
    ...row,
    previewUrl:
      signedByImage[row.image_id] ??
      (raw && !raw.includes("/object/public/") ? raw : null),
  }));
}
