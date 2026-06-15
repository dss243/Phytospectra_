/** Cache field list for MAPIR hotspot step (no internet / no cloud API). */
import type { Field } from "@/types/backend";

const KEY = "phytospectra_fields_cache_v1";

export function saveFieldsCache(fields: Field[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), fields }));
  } catch {
    // quota / private mode
  }
}

export function loadFieldsCache(): Field[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { fields?: Field[] };
    return parsed.fields ?? [];
  } catch {
    return [];
  }
}
