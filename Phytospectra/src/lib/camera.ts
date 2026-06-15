/** MAPIR camera — browser → cloud backend (ngrok) → PC → camera hotspot. */
import { backendFetch, backendHeaders } from "@/lib/backend";

export const CAMERA_HOST =
  (import.meta.env.VITE_CAMERA_IP as string | undefined)?.trim() || "192.168.1.254";

export const CAMERA_PHOTO_DIR = "/DCIM/PHOTO";

const IMAGE_EXT = /\.(jpe?g|tiff?|png|raw)$/i;

let _authToken: string | null = null;

export function setCameraAuthToken(token: string | null) {
  _authToken = token;
}

function cameraAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const out = backendHeaders(extra);
  if (_authToken) out.Authorization = `Bearer ${_authToken}`;
  return out;
}

function cameraPath(path: string, query = ""): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${p}${q}`;
}

/** Proxy path without leading slash, optional ?query for backend route. */
function proxyTarget(path: string, query = ""): string {
  const rel = cameraPath(path, query);
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

async function cameraFetch(path: string, query = "", init?: RequestInit): Promise<Response> {
  if (import.meta.env.DEV) {
    return fetch(`/camera-proxy${cameraPath(path, query)}`, {
      ...init,
      headers: cameraAuthHeaders(init?.headers),
    });
  }
  return backendFetch(`/api/camera/proxy/${proxyTarget(path, query)}`, {
    ...init,
    headers: cameraAuthHeaders(init?.headers),
  });
}

export function parseCameraFileListHtml(html: string): string[] {
  const names: string[] = [];

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const a of doc.querySelectorAll("table a")) {
      const text = (a.textContent ?? "").trim();
      const href = (a.getAttribute("href") ?? "").trim();
      const candidate = text || href.split("/").pop() || "";
      if (IMAGE_EXT.test(candidate) && candidate.toLowerCase() !== "remove") {
        names.push(candidate);
      }
    }
  } catch {
    // regex fallback below
  }

  if (names.length === 0) {
    for (const m of html.matchAll(/(\d{4}_\d{6}_\d{6}_\d+\.JPG)/gi)) {
      names.push(m[1]);
    }
  }

  if (names.length === 0) {
    for (const m of html.matchAll(/([A-Za-z0-9_\-]+\.(?:jpg|jpeg|tif|tiff|png))/gi)) {
      names.push(m[1]);
    }
  }

  return [...new Set(names)].sort();
}

export async function fetchCameraFileList(): Promise<string[]> {
  const endpoints: Array<{ path: string; query?: string }> = [
    { path: CAMERA_PHOTO_DIR },
    { path: "/get_file_info.cgi", query: `DIR=${encodeURIComponent(CAMERA_PHOTO_DIR)}` },
  ];

  for (const { path, query } of endpoints) {
    try {
      const res = await cameraFetch(path, query ?? "");
      if (!res.ok) continue;
      const names = parseCameraFileListHtml(await res.text());
      if (names.length > 0) return names;
    } catch {
      // try next
    }
  }
  return [];
}

export async function downloadCameraPhoto(filename: string): Promise<Blob> {
  const res = await cameraFetch(`${CAMERA_PHOTO_DIR}/${filename}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return res.blob();
}

export async function triggerCameraCapture(): Promise<void> {
  const res = await cameraFetch("/", "custom=1&cmd=1001");
  if (!res.ok) throw new Error(`Capture failed: HTTP ${res.status}`);
}

export async function fetchCameraParams(
  query = "param=battery_level,storage_free,gps_status",
): Promise<string> {
  const res = await cameraFetch("/get_params.cgi", query);
  if (!res.ok) throw new Error(`Params failed: HTTP ${res.status}`);
  return res.text();
}

export async function probeCameraViaProxy(
  timeoutMs = 45000,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!_authToken) {
    return { ok: false, error: "Sign in first, then try again." };
  }

  // Step 1 — can the browser reach the PC backend through ngrok?
  try {
    const health = await backendFetch("/api/health", {
      headers: cameraAuthHeaders(),
      signal: AbortSignal.timeout(12000),
    });
    if (!health.ok) {
      return {
        ok: false,
        error:
          "Backend is up but unhealthy. Restart uvicorn on the PC and try again.",
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error:
        "Cannot reach your PC through ngrok (timed out). On the PC: keep uvicorn + ngrok running, " +
        "stay on MAPIR Wi‑Fi, and keep USB phone tethering ON so ngrok still has internet. " +
        "On the phone, open the ngrok URL /api/health in the browser to test. " +
        `(${msg})`,
    };
  }

  // Step 2 — can the PC backend reach the camera?
  try {
    const res = await backendFetch("/api/camera/ping", {
      headers: cameraAuthHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const json = await res.json();
      return { ok: true, path: json.path ?? "/api/camera/ping" };
    }
    let detail = await res.text();
    try {
      const j = JSON.parse(detail) as { detail?: string };
      detail = j.detail ?? detail;
    } catch {
      /* plain text */
    }
    if (res.status === 401) {
      return {
        ok: false,
        error: detail || "Session expired — log out and log in again on phytospectra.vercel.app.",
      };
    }
    if (res.status === 503 || res.status === 502) {
      return {
        ok: false,
        error:
          detail ||
          "Backend is online but cannot reach the camera. On the PC: MAPIR Wi‑Fi + test http://192.168.1.254 in a browser on that same PC.",
      };
    }
    return { ok: false, error: detail || `Backend returned HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Backend reachable but camera check timed out. Confirm http://192.168.1.254 opens on the PC. (${msg})`,
    };
  }
}

export async function cameraPhotoBlobUrl(filename: string): Promise<string> {
  const blob = await downloadCameraPhoto(filename);
  return URL.createObjectURL(blob);
}

export type FieldBridgeStatus = {
  registered_bridge_url?: string | null;
  env_bridge_url?: string | null;
  effective_bridge_url?: string | null;
  registered_at?: string | null;
  field_hostname?: string | null;
  websocket_connected?: boolean;
  mode?: string | null;
};

export async function getFieldBridgeStatus(): Promise<FieldBridgeStatus | null> {
  if (!_authToken) return null;
  try {
    const res = await backendFetch("/api/camera/bridge/status", {
      headers: cameraAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as FieldBridgeStatus;
  } catch {
    return null;
  }
}

export async function registerFieldBridge(bridgeUrl: string): Promise<{ ok: boolean; error?: string; status?: FieldBridgeStatus }> {
  if (!_authToken) {
    return { ok: false, error: "Sign in first." };
  }
  const url = bridgeUrl.trim().replace(/\/$/, "");
  if (!url.startsWith("https://")) {
    return { ok: false, error: "Paste the https ngrok URL from the field laptop." };
  }
  try {
    const res = await backendFetch("/api/camera/bridge/register", {
      method: "POST",
      headers: { ...cameraAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ bridge_url: url }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      let detail = await res.text();
      try {
        const j = JSON.parse(detail) as { detail?: string };
        detail = j.detail ?? detail;
      } catch {
        /* plain */
      }
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    const status = (await res.json()) as FieldBridgeStatus;
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
