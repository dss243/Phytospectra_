// src/lib/backend.ts
//
// Hosted deployment uses VITE_BACKEND_URL (cloud API).
// Camera workflow: save photos on MAPIR Wi‑Fi, analyze when internet is available.

const trimUrl = (v: string) => v.trim().replace(/\/$/, "");

/** Cloud API — fields, auth-backed data, storage analysis when online. */
export function getBackendBaseUrl() {
  const v = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (v && v.trim()) return trimUrl(v);

  return `http://${window.location.hostname}:8000`;
}

export function getBackendWsBaseUrl() {
  const v = import.meta.env.VITE_BACKEND_WS_URL as string | undefined;
  if (v && v.trim()) return trimUrl(v);

  const http = getBackendBaseUrl();
  return http.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

/** True when the hosted API responds (internet Wi‑Fi / mobile data). */
export async function probeBackendReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
