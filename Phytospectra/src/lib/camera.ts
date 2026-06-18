/**
 * MAPIR camera access.
 *
 * Default (original): browser → http://192.168.1.254 when on MAPIR Wi‑Fi.
 * Fallback: cloud backend + field PC bridge when direct is blocked.
 */
import { backendFetch, backendHeaders } from "@/lib/backend";

export const CAMERA_HOST =
  (import.meta.env.VITE_CAMERA_IP as string | undefined)?.trim() || "192.168.1.254";

export const CAMERA_PHOTO_DIR = "/DCIM/PHOTO";

export const CAMERA_PROBE_PATHS = [
  CAMERA_PHOTO_DIR,
  "/",
  "/?custom=1&cmd=3016",
];

const IMAGE_EXT = /\.(jpe?g|tiff?|png|raw)$/i;

let _authToken: string | null = null;
let _useBridge = false;

export function setCameraAuthToken(token: string | null) {
  _authToken = token;
}

function usesViteCameraProxy() {
  return import.meta.env.DEV;
}

function cameraPath(path: string, query = ""): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${p}${q}`;
}

/** Direct URL to the camera (original behaviour). */
export function cameraProxyUrl(path: string, query = ""): string {
  const rel = cameraPath(path, query);
  if (usesViteCameraProxy()) {
    return `/camera-proxy${rel}`;
  }
  return `http://${CAMERA_HOST}${rel}`;
}

export function cameraPhotoUrl(filename: string): string {
  return cameraProxyUrl(`${CAMERA_PHOTO_DIR}/${filename}`);
}

export function cameraCaptureUrl(): string {
  return cameraProxyUrl("/", "custom=1&cmd=1001");
}

function cameraAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const out = backendHeaders(extra);
  if (_authToken) out.Authorization = `Bearer ${_authToken}`;
  return out;
}

function proxyTarget(path: string, query = ""): string {
  const rel = cameraPath(path, query);
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

async function directCameraFetch(path: string, query = "", init?: RequestInit): Promise<Response> {
  return fetch(cameraProxyUrl(path, query), init);
}

async function bridgedCameraFetch(path: string, query = "", init?: RequestInit): Promise<Response> {
  if (usesViteCameraProxy()) {
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

async function cameraFetch(path: string, query = "", init?: RequestInit): Promise<Response> {
  if (_useBridge && _authToken) {
    return bridgedCameraFetch(path, query, init);
  }
  return directCameraFetch(path, query, init);
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
    /* regex fallback */
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
  const endpoints: Array<string | { path: string; query: string }> = [
    CAMERA_PHOTO_DIR,
    { path: "/get_file_info.cgi", query: `DIR=${encodeURIComponent(CAMERA_PHOTO_DIR)}` },
  ];

  for (const endpoint of endpoints) {
    try {
      const path = typeof endpoint === "string" ? endpoint : endpoint.path;
      const query = typeof endpoint === "string" ? "" : endpoint.query;
      const res = await cameraFetch(path, query);
      if (!res.ok) continue;
      const names = parseCameraFileListHtml(await res.text());
      if (names.length > 0) return names;
    } catch {
      /* try next */
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
  const res = _useBridge
    ? await cameraFetch("/", "custom=1&cmd=1001")
    : await fetch(cameraCaptureUrl());
  if (!res.ok) throw new Error(`Capture failed: HTTP ${res.status}`);
}

export async function fetchCameraParams(
  query = "param=battery_level,storage_free,gps_status",
): Promise<string> {
  const res = await cameraFetch("/get_params.cgi", query);
  if (!res.ok) throw new Error(`Params failed: HTTP ${res.status}`);
  return res.text();
}

async function probeDirectCamera(timeoutMs: number): Promise<{ ok: boolean; path?: string }> {
  for (const path of CAMERA_PROBE_PATHS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await directCameraFetch(path, "", { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        _useBridge = false;
        return { ok: true, path };
      }
    } catch {
      /* try next */
    }
  }
  return { ok: false };
}

async function probeBridgedCamera(timeoutMs: number): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!_authToken) {
    return { ok: false, error: "Sign in first, then try again." };
  }
  try {
    const res = await backendFetch("/api/camera/ping", {
      headers: cameraAuthHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const json = await res.json();
      _useBridge = true;
      return { ok: true, path: json.path ?? "/api/camera/ping" };
    }
    let detail = await res.text();
    try {
      const j = JSON.parse(detail) as { detail?: string };
      detail = j.detail ?? detail;
    } catch {
      /* plain text */
    }
    return { ok: false, error: detail || `Backend returned HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Probe camera — direct MAPIR first (original), then cloud bridge if needed. */
export async function probeCameraViaProxy(
  timeoutMs = 8000,
): Promise<{ ok: boolean; path?: string; error?: string; mode?: "direct" | "bridge" }> {
  const direct = await probeDirectCamera(timeoutMs);
  if (direct.ok) {
    return { ...direct, mode: "direct" };
  }

  const bridged = await probeBridgedCamera(Math.max(timeoutMs, 20000));
  if (bridged.ok) {
    return { ...bridged, mode: "bridge" };
  }

  return {
    ok: false,
    error:
      `No response from camera at ${CAMERA_HOST}. ` +
      "Join the MAPIR hotspot in Windows Wi‑Fi first, then click Detect camera again.",
  };
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
