// src/lib/backend.ts
//
// Hosted deployment uses VITE_BACKEND_URL (cloud API).
// Camera workflow: browser → VITE_BACKEND_URL (ngrok) → PC → MAPIR hotspot.

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

/** Extra headers for ngrok free tier (skips browser warning on API calls). */
export function getBackendRequestHeaders(): Record<string, string> {
  const configured = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "";
  const base = configured.trim() ? trimUrl(configured) : getBackendBaseUrl();
  if (base.includes("ngrok")) {
    return { "ngrok-skip-browser-warning": "true" };
  }
  return {};
}

/** Merge ngrok/proxy headers with caller headers. */
export function backendHeaders(extra?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = { ...getBackendRequestHeaders() };
  if (!extra) return out;
  if (extra instanceof Headers) {
    extra.forEach((v, k) => {
      out[k] = v;
    });
  } else if (Array.isArray(extra)) {
    for (const [k, v] of extra) out[k] = v;
  } else {
    Object.assign(out, extra);
  }
  return out;
}

/** fetch() to the backend with ngrok headers and correct base URL. */
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `${getBackendBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: backendHeaders(init.headers) });
}

/** True when the hosted API responds (internet Wi‑Fi / mobile data). */
export async function probeBackendReachable(): Promise<boolean> {
  try {
    const res = await backendFetch("/api/health", {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Local uvicorn on the farmer's PC — proxies MAPIR camera on hotspot Wi‑Fi. */
export function getLocalBackendBaseUrl() {
  const v = import.meta.env.VITE_LOCAL_BACKEND_URL as string | undefined;
  if (v && v.trim()) return trimUrl(v);
  return "http://127.0.0.1:8000";
}

export async function probeLocalBackendReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getLocalBackendBaseUrl()}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Camera hotspot workflow must run from http://localhost:8080 (npm run dev).
 * HTTPS sites (Vercel) cannot call http://192.168.1.254 or http://127.0.0.1.
 */
export function isCameraHotspotContext(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  );
}

export async function localBackendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = getLocalBackendBaseUrl();
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: backendHeaders(init.headers) });
}
