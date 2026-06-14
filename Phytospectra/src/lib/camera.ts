/** MAPIR / Novatek WiFi defaults (override with VITE_CAMERA_IP). */
export const CAMERA_HOST =
  (import.meta.env.VITE_CAMERA_IP as string | undefined)?.trim() || "192.168.1.254";

export const CAMERA_PHOTO_DIR = "/DCIM/PHOTO";

const IMAGE_EXT = /\.(jpe?g|tiff?|png|raw)$/i;

/** Dev-only: Vite proxies /camera-proxy → camera IP. */
function usesViteCameraProxy() {
  return import.meta.env.DEV;
}

function cameraPath(path: string, query = ""): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${p}${q}`;
}

/**
 * URL to reach the camera from the farmer's browser.
 * On MAPIR Wi‑Fi the phone/laptop talks to the camera directly — no local backend.
 */
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

export const CAMERA_PROBE_PATHS = [
  CAMERA_PHOTO_DIR,
  "/",
  "/?custom=1&cmd=3016",
];

async function cameraFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : cameraProxyUrl(path);
  return fetch(url, init);
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
    // fall through to regex
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
      const url =
        typeof endpoint === "string"
          ? cameraProxyUrl(endpoint)
          : cameraProxyUrl(endpoint.path, endpoint.query);
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const names = parseCameraFileListHtml(text);
      if (names.length > 0) return names;
    } catch {
      // try next endpoint
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
  const res = await fetch(cameraCaptureUrl());
  if (!res.ok) throw new Error(`Capture failed: HTTP ${res.status}`);
}

export async function probeCameraViaProxy(
  timeoutMs = 8000,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  for (const path of CAMERA_PROBE_PATHS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await cameraFetch(path, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        return { ok: true, path };
      }
    } catch {
      // try next path
    }
  }
  return { ok: false, error: "No response from camera at " + CAMERA_HOST };
}
