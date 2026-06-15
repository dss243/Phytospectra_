import { getBackendBaseUrl, getBackendWsBaseUrl, backendFetch, backendHeaders } from "@/lib/backend";

export type AnalyzeResult = {
  zone_id: string;
  timestamp: string;
  gps?: { lat: number; lng: number };
  health_score: number;
  stress_class: string;
  confidence: number;
  heatmap_url?: string;
  heatmap_data_url?: string;
  offline?: boolean;
  storage_path?: string;
  bucket?: string;
  image_id?: string;
};

type StorageAnalyzeParams = {
  object_path: string;
  bucket: string;
  field_id?: string;
  image_id?: string;
  flight_id?: string | null;
  upload_source?: string;
};

type UploadAnalyzeParams = {
  filename: string;
  image_base64: string;
  field_id?: string;
  flight_id?: string | null;
  upload_source?: string;
};

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read image data"));
    reader.readAsDataURL(blob);
  });
}

function analyzeViaWebSocket(
  wsPath: string,
  token: string,
  payload: Record<string, unknown>,
  onProgress?: (message: string) => void,
  wsBaseUrl: string = getBackendWsBaseUrl(),
): Promise<AnalyzeResult> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${wsBaseUrl}${wsPath}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;

        if (data.type === "progress" && typeof data.message === "string") {
          onProgress?.(data.message);
          return;
        }

        if (data.type === "error") {
          ws.close();
          finish(() => reject(new Error(String(data.message ?? "Analysis failed"))));
          return;
        }

        if (data.type === "result" || data.stress_class) {
          ws.close();
          finish(() => resolve(parseAnalyzeResult(data)));
          return;
        }
      } catch (e) {
        ws.close();
        finish(() => reject(e instanceof Error ? e : new Error("Invalid WebSocket response")));
      }
    };

    ws.onerror = () => {
      finish(() => reject(new Error("WebSocket connection failed")));
      ws.close();
    };

    ws.onclose = () => {
      window.setTimeout(() => {
        finish(() => reject(new Error("Analysis connection closed before result")));
      }, 50);
    };
  });
}

type AnalyzeRunParams = {
  object_path: string;
  bucket: string;
  field_id?: string;
  image_id?: string | null;
  flight_id?: string | null;
};

function parseAnalyzeResult(data: Record<string, unknown>): AnalyzeResult {
  return {
    zone_id: String(data.zone_id ?? "unknown"),
    timestamp: String(data.timestamp ?? new Date().toISOString()),
    gps: data.gps as AnalyzeResult["gps"],
    health_score: Number(data.health_score ?? 0),
    stress_class: String(data.stress_class ?? "unknown"),
    confidence: Number(data.confidence ?? 0),
    heatmap_url: data.heatmap_url as string | undefined,
    heatmap_data_url: data.heatmap_data_url as string | undefined,
    offline: Boolean(data.offline),
    storage_path: data.storage_path as string | undefined,
    bucket: data.bucket as string | undefined,
    image_id: data.image_id as string | undefined,
  };
}

/** Manual upload: run ViT after POST /api/upload (HTTP — reliable on all networks). */
export async function analyzeRunHttp(
  params: AnalyzeRunParams,
  token: string,
  onProgress?: (message: string) => void,
  baseUrl: string = getBackendBaseUrl().replace(/\/$/, ""),
): Promise<AnalyzeResult> {
  onProgress?.("Running ViT classification (vit_ndvi_leaf_health.pt)…");

  const res = await backendFetch("/api/analyze/run", {
    method: "POST",
    headers: backendHeaders({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      object_path: params.object_path,
      bucket: params.bucket,
      field_id: params.field_id ?? null,
      image_id: params.image_id ?? null,
      flight_id: params.flight_id ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Analysis failed (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseAnalyzeResult(data);
}

export function analyzeFromStorageViaWebSocket(
  params: StorageAnalyzeParams,
  token: string,
  onProgress?: (message: string) => void,
  wsBaseUrl: string = getBackendWsBaseUrl(),
): Promise<AnalyzeResult> {
  return analyzeViaWebSocket(
    "/ws/analyze/from-storage",
    token,
    {
      object_path: params.object_path,
      bucket: params.bucket,
      field_id: params.field_id ?? null,
      image_id: params.image_id ?? null,
      flight_id: params.flight_id ?? null,
      upload_source: params.upload_source ?? "manual",
    },
    onProgress,
    wsBaseUrl,
  );
}

/** Camera on MAPIR Wi‑Fi: browser fetches the photo, hosted backend analyzes via WebSocket. */
export function analyzeFromUploadViaWebSocket(
  params: UploadAnalyzeParams,
  token: string,
  onProgress?: (message: string) => void,
  wsBaseUrl: string = getBackendWsBaseUrl(),
): Promise<AnalyzeResult> {
  return analyzeViaWebSocket(
    "/ws/analyze/from-upload",
    token,
    {
      filename: params.filename,
      image_base64: params.image_base64,
      field_id: params.field_id ?? null,
      flight_id: params.flight_id ?? null,
      upload_source: params.upload_source ?? "camera",
    },
    onProgress,
    wsBaseUrl,
  );
}
