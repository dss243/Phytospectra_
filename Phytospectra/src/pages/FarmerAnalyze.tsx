import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import {
  AlertTriangle, Image as ImageIcon, UploadCloud, MapPin,
  Camera, Wifi, WifiOff, Plug, PlugZap, RefreshCw,
  FolderOpen, Play, Battery, HardDrive, Loader2,
  CheckCircle2, XCircle, Download,
} from "lucide-react";
import { backendFetch, backendHeaders, getBackendBaseUrl, probeBackendReachable } from "@/lib/backend";
import { downloadCameraSetupInstaller } from "@/lib/cameraSetupDownload";
import { saveFieldsCache, loadFieldsCache } from "@/lib/fieldsCache";
import { analyzeRunHttp, analyzeFromUploadViaWebSocket, blobToBase64 } from "@/lib/analyze";
import {
  listPendingCameraPhotos,
  removePendingCameraPhoto,
  savePendingCameraPhoto,
  type PendingCameraPhoto,
} from "@/lib/pendingCameraPhoto";
import {
  CAMERA_HOST,
  CAMERA_PHOTO_DIR,
  downloadCameraPhoto,
  fetchCameraFileList,
  fetchCameraParams,
  setCameraAuthToken,
  probeCameraViaProxy,
  triggerCameraCapture,
  cameraPhotoBlobUrl,
  getFieldBridgeStatus,
  type FieldBridgeStatus,
} from "@/lib/camera";
import { Field } from "@/types/backend";

// ── Types ─────────────────────────────────────────────────────────────────────

type ClassifyResponse = {
  zone_id: string;
  timestamp: string;
  gps: { lat: number; lng: number };
  health_score: number;
  stress_class: string;
  confidence: number;
  heatmap_url?: string;
  heatmap_data_url?: string;
  offline?: boolean;
  drone_image_url?: string;
};

type CamStatus = {
  battery?: string;
  gps?: string;
  storage?: string;
  count?: number;
};

type ConnState = "idle" | "connecting" | "connected" | "error";
type LogEntry = { t: string; m: string; k: "ok" | "err" | "info" };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Missing session access token");
  return token;
}

function nowStr() {
  return new Date().toLocaleTimeString();
}

function revokeIfBlobUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

// ── Stress class → display config ─────────────────────────────────────────────
// Driven purely by stress_class from the model — no derived "severity" logic
function stressDisplay(stressClass: string): {
  label: string;
  colorCard: string;
  colorText: string;
  icon: React.ReactNode;
} {
  const s = stressClass.toLowerCase();
  if (s === "healthy") {
    return {
      label: "Healthy",
      colorCard: "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800",
      colorText: "text-green-700 dark:text-green-300",
      icon: <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />,
    };
  }
  // anything else (stressed, mild_stress, moderate_stress, severe_stress …)
  return {
    label: stressClass.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    colorCard: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800",
    colorText: "text-red-700 dark:text-red-300",
    icon: <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />,
  };
}

// ── CameraPanel ───────────────────────────────────────────────────────────────

interface CameraPanelProps {
  selectedFieldId: string;
  analyzing: boolean;
  onAnalyzeCamera: (filename: string, previewUrl: string) => Promise<void>;
  onError: (msg: string) => void;
}

function CameraPanel({ selectedFieldId, analyzing, onAnalyzeCamera, onError }: CameraPanelProps) {
  const [conn, setConn] = useState<ConnState>("idle");
  const [mock, setMock] = useState(false);
  const [status, setStatus] = useState<CamStatus>({});
  const [files, setFiles] = useState<string[]>([]);
  const [selFile, setSelFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingF, setLoadingF] = useState(false);
  const [working, setWorking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<FieldBridgeStatus | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const connected = conn === "connected";
  const MOCK_FILES = ["IMG_0001.JPG", "IMG_0002.JPG", "IMG_0003.JPG", "IMG_0004.JPG", "IMG_0005.JPG", "IMG_0006.JPG"];

  const addLog = useCallback((m: string, k: LogEntry["k"] = "info") => {
    setLogs(p => [...p.slice(-49), { t: nowStr(), m, k }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    void getToken()
      .then(async (token) => {
        setCameraAuthToken(token);
        const st = await getFieldBridgeStatus();
        if (st) setBridgeStatus(st);
      })
      .catch(() => setCameraAuthToken(null));
    const poll = window.setInterval(async () => {
      const st = await getFieldBridgeStatus();
      if (st) setBridgeStatus(st);
    }, 8000);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    if (mock || files.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const fn of files.slice(0, 30)) {
        try {
          next[fn] = await cameraPhotoBlobUrl(fn);
        } catch {
          /* skip broken thumb */
        }
        if (cancelled) return;
      }
      if (!cancelled) {
        setThumbs((prev) => {
          Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, mock]);

  async function detectCamera() {
    setConn("connecting");
    setMock(false);
    setLastError(null);
    addLog(`Checking camera (via backend → ${CAMERA_HOST})…`);
    try {
      const { data: sess } = await supabase.auth.getSession();
      let token = sess.session?.access_token;
      if (!token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token;
      }
      if (!token) {
        throw new Error("Not logged in — open phytospectra.vercel.app, sign in, then try again.");
      }
      setCameraAuthToken(token);

      const backendOk = await probeBackendReachable();
      if (!backendOk) {
        throw new Error(
          "Cannot reach the PC backend (ngrok). On the phone: use mobile data or home Wi‑Fi — not MAPIR Wi‑Fi. " +
          `Test in the phone browser: ${getBackendBaseUrl()}/api/health`,
        );
      }

      const probe = await probeCameraViaProxy();
      if (!probe.ok) throw new Error(probe.error ?? "timeout");
      setConn("connected");
      addLog(`Camera detected at ${CAMERA_HOST}.`, "ok");
      try {
        const st = await fetchCameraParams();
        const pairs: Record<string, string> = {};
        st.split("\n").forEach(line => { const [k, v] = line.split("="); if (k && v) pairs[k.trim()] = v.trim(); });
        setStatus({
          battery: pairs["battery_level"] ? `${pairs["battery_level"]}%` : undefined,
          gps: pairs["gps_status"] ?? undefined,
          storage: pairs["storage_free"] ? `${pairs["storage_free"]} free` : undefined,
        });
      } catch { /* non-critical */ }
      await listFiles(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setConn("error"); setMock(false); setStatus({}); setFiles([]);
      setLastError(msg);
      addLog(`Camera not reachable (${msg}).`, "err");
    }
  }

  function enableDemoMode() {
    setLastError(null);
    setMock(true); setConn("connected");
    setStatus({ battery: "82%", gps: "Fixed · 6 sats", storage: "14.2 GB free", count: 124 });
    setFiles(MOCK_FILES);
    addLog("Demo mode enabled.", "info");
  }

  function clearCameraSession() {
    setConn("idle"); setMock(false); setStatus({}); setFiles([]);
    setSelFile(null); setPreview(null); setLastError(null);
    addLog("Camera session cleared.");
  }

  async function listFiles(forceMock = mock) {
    setLoadingF(true);
    addLog(`Listing ${CAMERA_PHOTO_DIR}/…`);
    if (forceMock) {
      setFiles(MOCK_FILES); addLog(`${MOCK_FILES.length} files (demo)`, "ok");
      setLoadingF(false); return;
    }
    try {
      const names = await fetchCameraFileList();
      if (names.length === 0) throw new Error("No photos found in /DCIM/PHOTO");
      setFiles(names); setStatus(s => ({ ...s, count: names.length }));
      addLog(`${names.length} files loaded.`, "ok");
    } catch (e: unknown) {
      addLog(`List failed: ${e instanceof Error ? e.message : String(e)}`, "err");
      setFiles([]);
    } finally { setLoadingF(false); }
  }

  async function selectFile(fn: string) {
    if (!selectedFieldId) {
      onError("Please select a field first.");
      return;
    }
    if (mock) {
      setSelFile(fn);
      addLog(`Selected: ${fn} (demo)`);
      setPreview(null);
      return;
    }
    if (working || analyzing) return;

    setSelFile(fn);
    setWorking(true);
    addLog(`Saving ${fn} from camera…`);
    try {
      revokeIfBlobUrl(preview);
      const blob = await downloadCameraPhoto(fn);
      const previewUrl = URL.createObjectURL(blob);
      setPreview(previewUrl);
      await onAnalyzeCamera(fn, previewUrl);
      addLog(`${fn} saved on this device.`, "ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`Failed: ${msg}`, "err");
      onError(msg);
    } finally {
      setWorking(false);
    }
  }

  async function snapshot() {
    addLog("Triggering shutter…");
    if (mock) { addLog("Snapshot (demo).", "ok"); return; }
    try {
      await triggerCameraCapture();
      await new Promise(r => setTimeout(r, 2500));
      await listFiles(false);
      addLog("Snapshot captured.", "ok");
    } catch (e: unknown) { addLog(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`, "err"); }
  }

  async function captureAndSave() {
    if (!selectedFieldId) { onError("Please select a field first."); return; }
    if (mock) { addLog("Demo mode: use manual upload instead.", "err"); return; }
    setWorking(true);
    addLog("Capturing photo…");
    try {
      await triggerCameraCapture();
      await new Promise(r => setTimeout(r, 2500));
      const names = await fetchCameraFileList();
      if (names.length === 0) throw new Error("No files found after capture");
      const latest = names[names.length - 1];
      setFiles(names);
      setWorking(false);
      await selectFile(latest);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`Failed: ${msg}`, "err");
      onError(msg);
      setWorking(false);
    }
  }

  const connColor = { idle: "text-muted-foreground", connecting: "text-amber-500", connected: "text-green-600", error: "text-red-500" }[conn];
  const connLabel = { idle: "Not detected", connecting: "Checking…", connected: mock ? "Demo data" : "Camera ready", error: "Not reachable" }[conn];
  const gridBusy = working || analyzing;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm"><Camera className="h-4 w-4" /> MAPIR Survey W3</div>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${connColor}`}>
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {connLabel}
          {mock && <span className="ml-1 text-[10px] text-amber-500">(demo)</span>}
        </span>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs space-y-3">
        <p className="font-medium text-foreground">First time on this PC?</p>
        <p className="text-muted-foreground">
          Click the button below once. Windows may ask &quot;Run anyway&quot; — choose Run. After that you never install again.
        </p>
        <Button
          type="button"
          size="sm"
          className="gap-2 w-full sm:w-auto"
          onClick={() => downloadCameraSetupInstaller()}
          disabled={!!bridgeStatus?.websocket_connected}
        >
          <Download className="h-4 w-4" />
          Set up this PC (one time)
        </Button>
        {bridgeStatus?.websocket_connected ? (
          <p className="text-green-700 dark:text-green-400 text-[11px]">
            Already set up on this PC — you can use Detect camera below.
          </p>
        ) : (
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Save both files to the same folder (Downloads), then double-click the <span className="font-mono">.bat</span> file</li>
            <li>Each time: MAPIR Wi‑Fi + USB internet</li>
            <li>Green status below → <span className="font-medium text-foreground">Detect camera</span></li>
          </ol>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs space-y-1">
        <p className="font-medium text-foreground">Your PC</p>
        {bridgeStatus?.websocket_connected ? (
          <p className="text-green-700 dark:text-green-400">
            Your PC connected{bridgeStatus.field_hostname ? ` (${bridgeStatus.field_hostname})` : ""}
          </p>
        ) : (
          <p className="text-amber-700 dark:text-amber-400">Waiting for your PC… (MAPIR Wi‑Fi + USB internet)</p>
        )}
      </div>

      {conn === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs space-y-2">
          <p className="flex items-start gap-1.5 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {lastError ?? "Camera detect failed."}
          </p>
          <p className="text-muted-foreground">
            Phone must use <span className="font-medium text-foreground">mobile data or home Wi‑Fi</span> (not MAPIR).
            PC stays on MAPIR + USB tethering for ngrok.
          </p>
          <p className="text-muted-foreground break-all">
            Backend test:{" "}
            <a
              href={`${getBackendBaseUrl()}/api/health`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {getBackendBaseUrl()}/api/health
            </a>
          </p>
          <Button size="sm" variant="outline" onClick={enableDemoMode} className="h-7 text-xs">
            Use demo mode (fake camera files — use Manual Upload below for real AI)
          </Button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={detectCamera} disabled={connected || conn === "connecting"} className="gap-1.5">
          <Plug className="h-3.5 w-3.5" />{conn === "connecting" ? "Checking…" : "Detect camera"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => listFiles()} disabled={!connected} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={clearCameraSession}
          disabled={conn === "idle" || conn === "connecting"}
          className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50 dark:hover:bg-red-950">
          <PlugZap className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      {connected && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: <Battery className="h-3 w-3" />, label: "Battery", val: status.battery },
            { icon: <MapPin className="h-3 w-3" />, label: "GPS", val: status.gps },
            { icon: <HardDrive className="h-3 w-3" />, label: "Storage", val: status.storage },
            { icon: <ImageIcon className="h-3 w-3" />, label: "Photos", val: status.count != null ? String(status.count) : undefined },
          ].map(m => (
            <div key={m.label} className="rounded-lg border border-border/40 bg-card px-3 py-2">
              <div className="flex items-center gap-1 text-muted-foreground text-[10px] mb-0.5">{m.icon} {m.label}</div>
              <div className="text-sm font-semibold">{m.val ?? "—"}</div>
            </div>
          ))}
        </div>
      )}

      {connected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Preview</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={snapshot} disabled={working || mock} className="h-7 text-xs gap-1">
                <Camera className="h-3 w-3" /> Snapshot
              </Button>
              <Button size="sm" onClick={captureAndSave} disabled={gridBusy || !selectedFieldId || mock} className="h-7 text-xs gap-1">
                {gridBusy ? <><Loader2 className="h-3 w-3 animate-spin" /> Working…</> : <><Camera className="h-3 w-3" /> Capture</>}
              </Button>
            </div>
          </div>
          {!selectedFieldId && (
            <p className="text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Select a field above before capturing.
            </p>
          )}
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/40 overflow-hidden flex items-center justify-center min-h-[130px]">
            {preview
              ? <img src={preview} alt="Camera preview" className="w-full max-h-[180px] object-contain" onError={() => setPreview(null)} />
              : <span className="text-xs text-muted-foreground">{mock ? "Demo mode — no real preview" : "Select a file below or take a snapshot"}</span>}
          </div>
        </div>
      )}

      {connected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium flex items-center gap-1"><FolderOpen className="h-3.5 w-3.5" /> {CAMERA_PHOTO_DIR}/</span>
            <Button size="sm" variant="ghost" onClick={() => listFiles()} disabled={loadingF} className="h-6 text-xs gap-1 px-2">
              <RefreshCw className={`h-3 w-3 ${loadingF ? "animate-spin" : ""}`} />{loadingF ? "Loading…" : "Reload"}
            </Button>
          </div>
          {!selectedFieldId && connected && (
            <p className="text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Select a field above before choosing a photo.
            </p>
          )}
          {files.length === 0
            ? <p className="text-xs text-muted-foreground py-1">No files found. Click Reload.</p>
            : (
              <div className="grid grid-cols-3 gap-1.5">
                {files.map(fn => {
                  const thumbUrl = mock ? null : thumbs[fn] ?? null;
                  const isSaving = gridBusy && selFile === fn;
                  return (
                    <div
                      key={fn}
                      onClick={() => !gridBusy && selectFile(fn)}
                      className={`aspect-[4/3] rounded-lg border relative overflow-hidden flex items-center justify-center
                        ${gridBusy ? "cursor-wait opacity-70" : "cursor-pointer"}
                        ${selFile === fn ? "border-primary bg-primary/5" : "border-border/40 bg-muted/40 hover:border-border"}`}
                    >
                      {isSaving && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
                          <Loader2 className="h-5 w-5 animate-spin text-white" />
                        </div>
                      )}
                      {thumbUrl
                        ? <img src={thumbUrl} alt={fn} className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />
                        : <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground/40"><ImageIcon className="h-5 w-5" /></div>}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/55 text-[8px] text-white px-1 py-0.5 truncate z-10">{fn}</div>
                    </div>
                  );
                })}
              </div>
            )}
          {selFile && !gridBusy && (
            <p className="text-[11px] text-muted-foreground pt-1 font-mono truncate">{selFile} — saved on this device</p>
          )}
        </div>
      )}

      {logs.length > 0 && (
        <div ref={logRef} className="rounded-lg bg-muted/50 border border-border/30 px-2.5 py-2 font-mono text-[10px] max-h-24 overflow-y-auto space-y-0.5">
          {logs.map((l, i) => (
            <div key={i} className={l.k === "ok" ? "text-green-600 dark:text-green-400" : l.k === "err" ? "text-red-500" : "text-muted-foreground"}>
              [{l.t}] {l.m}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FarmerAnalyze() {
  const { role, loading, user } = useAuth() as {
    role: string; loading: boolean; user: { id: string } | null;
  };

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pickedPreviewUrl, setPickedPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyResponse | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingCameraPhoto[]>([]);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const canShow = !loading && role === "farmer";

  const refreshPendingPhotos = useCallback(async () => {
    setPendingPhotos(await listPendingCameraPhotos());
  }, []);

  const refreshBackendStatus = useCallback(async () => {
    setBackendReachable(await probeBackendReachable());
  }, []);

  useEffect(() => {
    if (!canShow) return;
    void (async () => {
      try {
        const token = await getToken();
        setCameraAuthToken(token);
      } catch {
        setCameraAuthToken(null);
      }
    })();
  }, [canShow, user?.id]);

  useEffect(() => {
    if (!canShow) return;
    void refreshPendingPhotos();
    void refreshBackendStatus();
    const onOnline = () => { void refreshBackendStatus(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [canShow, refreshPendingPhotos, refreshBackendStatus]);

  useEffect(() => {
    if (!canShow) return;
    let active = true;
    (async () => {
      setFieldsLoading(true);
      try {
        const token = await getToken();
        const res = await backendFetch("/api/fields", { headers: backendHeaders({ Authorization: `Bearer ${token}` }) });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Field[];
        if (!active) return;
        setFields(data);
        saveFieldsCache(data);
        if (data.length > 0) setSelectedFieldId(data[0].id);
      } catch (e) {
        const cached = loadFieldsCache();
        if (cached.length > 0) {
          setFields(cached);
          setSelectedFieldId(cached[0].id);
          setInfoMessage("Using saved field list (offline / MAPIR Wi‑Fi).");
        }
        console.error("Fields fetch error:", e);
      }
      finally { if (active) setFieldsLoading(false); }
    })();
    return () => { active = false; };
  }, [canShow]);

  useEffect(() => { return () => { revokeIfBlobUrl(pickedPreviewUrl); }; }, [pickedPreviewUrl]);

  if (!canShow) return null;

  const uploadAndRunAnalyze = async (
    file: File,
    previewUrl?: string,
  ) => {
    setProcessing(true);
    setProgressMessage("Uploading image…");
    setError(null);
    setResult(null);

    if (previewUrl !== undefined) {
      revokeIfBlobUrl(pickedPreviewUrl);
      setSelectedFile(file);
      setPickedPreviewUrl(previewUrl);
    }

    try {
      if (!user?.id) throw new Error("User not found. Please sign in again.");
      const token = await getToken();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("field_id", selectedFieldId);
      formData.append("upload_source", "manual");

      const uploadRes = await backendFetch("/api/upload", {
        method: "POST",
        headers: backendHeaders({ Authorization: `Bearer ${token}` }),
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
      }

      const { storage_path, bucket, image_id } = await uploadRes.json();

      setProgressMessage("Running AI classification…");
      const analysis = await analyzeRunHttp(
        {
          object_path: storage_path,
          bucket,
          field_id: selectedFieldId,
          image_id,
          flight_id: null,
        },
        token,
        setProgressMessage,
      );
      setResult({
        ...analysis,
        gps: analysis.gps ?? { lat: 0, lng: 0 },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze image");
    } finally {
      setProcessing(false);
      setProgressMessage(null);
    }
  };

  const analyzeBlobViaWebSocket = async (
    filename: string,
    blob: Blob,
    fieldId: string,
    previewUrl?: string,
  ) => {
    if (previewUrl !== undefined) {
      revokeIfBlobUrl(pickedPreviewUrl);
      setSelectedFile(null);
      setPickedPreviewUrl(previewUrl);
    }

    const token = await getToken();
    const image_base64 = await blobToBase64(blob);

    setProgressMessage("Connecting to AI pipeline…");
    const analysis = await analyzeFromUploadViaWebSocket(
      {
        filename,
        image_base64,
        field_id: fieldId,
        upload_source: "camera",
      },
      token,
      setProgressMessage,
    );
    setResult({
      ...analysis,
      gps: analysis.gps ?? { lat: 0, lng: 0 },
    });
  };

  const runCameraAnalyze = async (filename: string, previewUrl: string) => {
    setProcessing(true);
    setProgressMessage("Downloading photo from camera…");
    setError(null);
    setInfoMessage(null);
    setResult(null);

    try {
      const blob = await downloadCameraPhoto(filename);
      const localPreview = URL.createObjectURL(blob);
      revokeIfBlobUrl(pickedPreviewUrl);
      setSelectedFile(null);
      setPickedPreviewUrl(localPreview);

      setProgressMessage("Saving photo on this device…");
      const fieldName = fields.find(f => f.id === selectedFieldId)?.field_name;
      await savePendingCameraPhoto({
        filename,
        fieldId: selectedFieldId,
        fieldName,
        blob,
      });
      await refreshPendingPhotos();

      setInfoMessage(
        "Photo saved. Switch to internet Wi‑Fi, reopen this page, then click Analyze saved photo in the yellow box.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save camera photo";
      setError(msg);
      throw e;
    } finally {
      setProcessing(false);
      setProgressMessage(null);
    }
  };

  const analyzePendingPhoto = async (pending: PendingCameraPhoto) => {
    setProcessing(true);
    setProgressMessage("Connecting to AI pipeline…");
    setError(null);
    setInfoMessage(null);
    setResult(null);

    try {
      const online = await probeBackendReachable();
      setBackendReachable(online);
      if (!online) {
        throw new Error("Backend not reachable — connect to Wi‑Fi with internet first.");
      }

      const previewUrl = URL.createObjectURL(pending.blob);
      await analyzeBlobViaWebSocket(pending.filename, pending.blob, pending.fieldId, previewUrl);
      await removePendingCameraPhoto(pending.id);
      await refreshPendingPhotos();
      setInfoMessage(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to analyze saved photo";
      setError(msg);
    } finally {
      setProcessing(false);
      setProgressMessage(null);
    }
  };

  const onPickFile = (f: File | null) => {
    setError(null); setResult(null);
    revokeIfBlobUrl(pickedPreviewUrl);
    if (!f) { setSelectedFile(null); setPickedPreviewUrl(null); return; }
    setSelectedFile(f);
    setPickedPreviewUrl(URL.createObjectURL(f));
  };

  const analyze = async () => {
    if (!selectedFile || !selectedFieldId) return;
    if (!window.confirm("Upload this image and run analysis?")) return;
    await uploadAndRunAnalyze(selectedFile, pickedPreviewUrl ?? undefined);
  };

  const selectedField = fields.find(f => f.id === selectedFieldId);
  const canAnalyze = !!selectedFile && !!selectedFieldId && !processing;

  // Compute display config from stress_class directly
  const stress = result ? stressDisplay(result.stress_class) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Drone Image Analysis"
        subtitle="Vercel app + ngrok backend bridges MAPIR hotspot on your PC"
        gradient="gradient-analytics"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <UploadCloud className="h-4 w-4" /> Patch-based crop stress classification
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left column ── */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-4 space-y-3">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Select field</Label>
            {fieldsLoading ? (
              <div className="text-xs text-muted-foreground animate-pulse">Loading fields…</div>
            ) : fields.length === 0 ? (
              <div className="text-xs text-amber-500">No fields found. Please create a field first.</div>
            ) : (
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedFieldId} onChange={e => setSelectedFieldId(e.target.value)} disabled={processing}
              >
                <option value="">— Select a field —</option>
                {fields.map(f => <option key={f.id} value={f.id}>{f.field_name}</option>)}
              </select>
            )}
          </Card>

          {pendingPhotos.length > 0 && (
            <Card className="p-4 space-y-3 border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-800">
              <div className="font-semibold text-sm flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-amber-600" />
                Saved photo{pendingPhotos.length > 1 ? "s" : ""} waiting
              </div>
              <p className="text-xs text-muted-foreground">
                {backendReachable
                  ? "Internet is available — you can run analysis now."
                  : "Connect to Wi‑Fi with internet, then analyze."}
              </p>
              <div className="space-y-2">
                {pendingPhotos.map(p => (
                  <div key={p.id} className="rounded-lg border border-amber-200/80 bg-white/70 dark:bg-black/20 px-3 py-2 text-xs space-y-2">
                    <div className="font-mono truncate">{p.filename}</div>
                    <div className="text-muted-foreground">
                      Field: {p.fieldName ?? p.fieldId} · saved {new Date(p.savedAt).toLocaleString()}
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={!backendReachable || processing}
                      onClick={() => void analyzePendingPhoto(p)}
                    >
                      {processing
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Working…</>
                        : <><Play className="h-3 w-3" /> Analyze saved photo</>}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <CameraPanel
            selectedFieldId={selectedFieldId}
            analyzing={processing}
            onAnalyzeCamera={runCameraAnalyze}
            onError={setError}
          />

          <Card className="p-4 space-y-4">
            <div className="font-semibold text-sm flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Or upload manually</div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Image file</Label>
              <input
                type="file" accept=".tif,.tiff,.png,.jpg,.jpeg" className="w-full text-sm"
                onChange={e => onPickFile(e.target.files?.[0] ?? null)} disabled={processing}
              />
            </div>

            {selectedFile && selectedFieldId && (
              <div className="rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div><span className="font-medium text-foreground">Field:</span> {selectedField?.field_name}</div>
                <div><span className="font-medium text-foreground">File:</span> {selectedFile.name}</div>
                <div><span className="font-medium text-foreground">Size:</span> {(selectedFile.size / 1024).toFixed(1)} KB</div>
              </div>
            )}

            <Button onClick={analyze} className="w-full" disabled={!canAnalyze}>
              {processing
                ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processing…</span>
                : "Run AI classification"}
            </Button>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Images are saved to Supabase storage first, then analyzed via WebSocket.
            </div>
          </Card>
        </div>

        {/* ── Right column ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Original image — never cleared during processing */}
          <Card className="p-5 space-y-3">
            <h3 className="font-display font-semibold">Original image</h3>
            {pickedPreviewUrl ? (
              <div className="rounded-xl border border-border/40 bg-muted overflow-hidden">
                <img src={pickedPreviewUrl} alt="Selected" className="w-full max-h-[420px] object-contain" />
              </div>
            ) : (
              <div className="h-[220px] rounded-xl border border-dashed border-border/50 bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
                Connect your MAPIR W3 or upload an image manually.
              </div>
            )}
          </Card>

          {/* Result card */}
          <Card className="p-5 space-y-4">
            <h3 className="font-display font-semibold">Analysis result</h3>

            {processing && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
                {progressMessage ?? "Running classification pipeline…"}
              </div>
            )}

            {infoMessage && !processing && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{infoMessage}</span>
              </div>
            )}

            {error && !processing && (
              <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}

            {!result && !processing && !error && !infoMessage && (
              <div className="text-sm text-muted-foreground">
                Run classification to see the result.
              </div>
            )}

            {result && !processing && stress && (
              <div className="space-y-4">
                {/* ── Main verdict banner ── */}
                <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${stress.colorCard}`}>
                  {stress.icon}
                  <div>
                    <div className={`font-bold text-lg leading-tight ${stress.colorText}`}>{stress.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Model confidence: <span className="font-semibold">{Math.round(result.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* ── GPS ── */}
                {result.gps && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    GPS: {result.gps.lat.toFixed(6)}, {result.gps.lng.toFixed(6)}
                  </div>
                )}

                {result.offline && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Analyzed offline (camera Wi‑Fi). Results are not saved to the cloud until you reconnect to the internet.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}