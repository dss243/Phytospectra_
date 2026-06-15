import { useState, useEffect, useLayoutEffect, useCallback, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { resolveMaskUrls } from "@/lib/maskUrls";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { getBackendBaseUrl, backendFetch, backendHeaders } from "@/lib/backend";
import {
  X, ChevronDown, ChevronRight, ImageOff, Loader2,
  Layers, CheckCircle2, AlertCircle, RefreshCw,
  Images, MapPin, Satellite, Camera, FolderOpen, Sprout, TriangleAlert, Plane,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Field, Flight } from "@/types/backend";
import { useAlerts, type StressAlert } from "@/hooks/useAlerts";

// ── Types ──────────────────────────────────────────────────────────────────

type ImageRow = {
  id: string;
  storage_path: string;
  bucket_name: string;
  flight_id: string | null;
  field_id: string | null;
  gps: { lat: number; lng: number } | null;
  upload_source: string;
  uploaded_at?: string;
  publicUrl?: string;
};

type SegResult = {
  image_id: string;
  mask_url: string;
  stress_class?: string;
  confidence?: number;   // percentage 0.0–100.0, e.g. 87.5
  cached?: boolean;
};

type SegState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: SegResult[] }
  | { status: "error"; message: string };

type AnchorRect = Pick<DOMRect, "top" | "left" | "width" | "height">;

type SelectedImage = ImageRow & {
  fieldName: string;
  flightLabel: string;
  maskUrl?: string;
  anchor?: AnchorRect;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

function isUsableImageUrl(url?: string): boolean {
  if (!url) return false;
  // Private bucket public paths always 400 — treat as missing.
  if (url.includes("/object/public/")) return false;
  return true;
}

async function resolveSignedUrls(imgs: ImageRow[]): Promise<ImageRow[]> {
  const needsUrl = imgs.filter(
    (img) => img.storage_path && img.bucket_name && !isUsableImageUrl(img.publicUrl)
  );
  if (needsUrl.length === 0) return imgs;

  const byBucket: Record<string, ImageRow[]> = {};
  for (const img of needsUrl) {
    byBucket[img.bucket_name] = byBucket[img.bucket_name] || [];
    byBucket[img.bucket_name].push(img);
  }
  const urlMap: Record<string, string> = {};
  for (const [bucket, bucketImgs] of Object.entries(byBucket)) {
    const paths = bucketImgs.map((img) => img.storage_path);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, 60 * 60);
    if (error) {
      console.error(`Signed URL error for bucket "${bucket}":`, error);
      continue;
    }
    for (const entry of data ?? []) {
      const url =
        (entry as { signedUrl?: string; signedURL?: string }).signedUrl ||
        (entry as { signedUrl?: string; signedURL?: string }).signedURL;
      if (url) urlMap[entry.path] = url;
    }
  }
  return imgs.map((img) => ({
    ...img,
    publicUrl:
      urlMap[img.storage_path] ||
      (isUsableImageUrl(img.publicUrl) ? img.publicUrl : undefined),
  }));
}

// ── HealthBadge ─────────────────────────────────────────────────────────────

function HealthBadge({ result }: { result: SegResult }) {
  const cls        = result.stress_class;
  const confidence = result.confidence;
  if (!cls) return null;

  const colour =
    cls === "healthy"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : "text-red-700 bg-red-50 border-red-200";

  return (
    <div
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${colour}`}
    >
      {cls === "healthy" ? (
        <Sprout className="h-3 w-3" />
      ) : (
        <TriangleAlert className="h-3 w-3" />
      )}
      <span className="capitalize">{cls}</span>
      {confidence != null && (
        <span className="opacity-70">· {confidence} conf.</span>
      )}
    </div>
  );
}

// ── Alert dot ────────────────────────────────────────────────────────────────

function AlertDot({ title = "Stress alert" }: { title?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" title={title}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-stress-severe opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-stress-severe" />
    </span>
  );
}

function flightHasAlert(alerts: StressAlert[], flightId: string): boolean {
  return alerts.some((a) => a.flight_id === flightId);
}

// ── SegStatus (manual run + view masks when done) ────────────────────────────

function SegStatus({
  flightId,
  seg,
  onSeg,
  onViewMasks,
}: {
  flightId: string;
  seg: SegState;
  onSeg: (flightId: string, force?: boolean) => void;
  onViewMasks: (flightId: string) => void;
}) {
  if (seg.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-lg bg-muted animate-pulse">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Running segmentation…
      </div>
    );
  }
  if (seg.status === "done") {
    const hasMasks = seg.results.length > 0;
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Segmentation ready{hasMasks ? ` · ${seg.results.length}` : ""}
        </div>
        {hasMasks && (
          <button
            type="button"
            onClick={() => onViewMasks(flightId)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
            title="View segmentation masks"
          >
            <Layers className="h-3 w-3" />
            View masks
          </button>
        )}
        <button
          onClick={() => onSeg(flightId, true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
          title="Re-run segmentation"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    );
  }
  if (seg.status === "error") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="h-3.5 w-3.5" />
          {seg.message}
        </div>
        <button
          onClick={() => onSeg(flightId)}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSeg(flightId)}
      className="flex items-center gap-1.5 text-xs font-medium text-white px-3 py-1.5 rounded-lg
                 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-700 hover:to-green-600
                 shadow-sm hover:shadow transition-all"
    >
      <Layers className="h-3.5 w-3.5" />
      Run Segmentation
    </button>
  );
}

// ── Section (collapsible) ──────────────────────────────────────────────────

function Section({
  title,
  titleIcon: TitleIcon,
  subtitle,
  count,
  defaultOpen = false,
  headerExtra,
  alertDot = false,
  children,
}: {
  title: string;
  titleIcon?: LucideIcon;
  subtitle?: string;
  count: number;
  defaultOpen?: boolean;
  headerExtra?: React.ReactNode;
  alertDot?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          {open
            ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          {TitleIcon && <TitleIcon className="h-4 w-4 shrink-0 text-primary" />}
          <span className="font-semibold truncate">{title}</span>
          {alertDot && <AlertDot title="Stress alert for this flight" />}
          {subtitle && <span className="text-xs text-muted-foreground shrink-0">{subtitle}</span>}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {count} image{count !== 1 ? "s" : ""}
          </span>
        </button>
        {headerExtra && <div className="shrink-0">{headerExtra}</div>}
      </div>
      {open && <div className="pl-6">{children}</div>}
    </div>
  );
}

// ── Image grid (masonry) ───────────────────────────────────────────────────

const HEIGHTS = ["h-40", "h-52", "h-44", "h-60", "h-48"];

function ImageGrid({
  images,
  segResults,
  onSelect,
}: {
  images: ImageRow[];
  segResults?: SegResult[];
  onSelect: (img: ImageRow, maskUrl?: string, anchor?: AnchorRect) => void;
}) {
  if (images.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <ImageOff className="h-4 w-4" /> No images
      </div>
    );
  }

  const maskByImageId = Object.fromEntries(
    (segResults ?? []).map((r) => [r.image_id, r])
  );

  return (
    <div className="space-y-4">
      {/* Masonry grid */}
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-3 space-y-3">
        {images.map((img, i) => {
          const seg = maskByImageId[img.id];
          return (
            <button
              type="button"
              key={img.id}
              onClick={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onSelect(img, seg?.mask_url, {
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                });
              }}
              className={`break-inside-avoid w-full ${HEIGHTS[i % HEIGHTS.length]} rounded-2xl overflow-hidden relative group shadow-soft hover:shadow-card transition-smooth`}
            >
              {img.publicUrl ? (
                <img
                  src={img.publicUrl}
                  alt="Field image"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-smooth"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-800 via-green-600 to-lime-400 group-hover:scale-105 transition-smooth" />
              )}
              {/* Segmentation badge */}
              {seg && (
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5 text-emerald-400" />
                  <span className="text-[9px] text-emerald-300 font-medium">Segmented</span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent text-white text-left">
                <div className="text-[10px] opacity-80">
                  {img.upload_source === "manual" ? (
                    <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" /> Manual</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Plane className="h-3 w-3" /> Drone</span>
                  )}{" "}
                  · {(img.uploaded_at ? new Date(img.uploaded_at) : new Date()).toLocaleDateString()}
                </div>
                {img.gps && (
                  <div className="text-[9px] opacity-60">
                    {img.gps.lat.toFixed(4)}, {img.gps.lng.toFixed(4)}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Per-image health + mask previews */}
      {segResults && segResults.length > 0 && (
        <div className="space-y-3 border-t border-border/30 pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Segmentation results — click an image above for side-by-side original + mask
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {images.map((img) => {
              const seg = maskByImageId[img.id];
              if (!seg?.mask_url || seg.mask_url.startsWith("local://")) return null;
              return (
                <div key={img.id} className="rounded-xl border border-border/40 overflow-hidden bg-muted/30">
                  <img
                    src={seg.mask_url}
                    alt="Segmentation mask"
                    loading="lazy"
                    className="w-full h-24 object-cover"
                  />
                  <div className="p-2 space-y-1">
                    <p className="text-[10px] text-muted-foreground truncate">
                      {img.storage_path.split("/").pop()}
                    </p>
                    <HealthBadge result={seg} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lightbox ───────────────────────────────────────────────────────────────

function Lightbox({ image, onClose }: { image: SelectedImage; onClose: () => void }) {
  const hasMask = Boolean(image.maskUrl) && !image.maskUrl?.startsWith("local://");
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  });

  // Keep gallery scroll position — don't jump to top when opening.
  useLayoutEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const scrollTop = main.scrollTop;
    const prevOverflow = main.style.overflow;
    main.style.overflow = "hidden";
    return () => {
      main.style.overflow = prevOverflow;
      main.scrollTop = scrollTop;
    };
  }, []);

  // Open the panel near the thumbnail the user clicked (clamped to viewport).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const pad = 16;
    const panelRect = panel.getBoundingClientRect();
    const anchor = image.anchor;

    if (anchor) {
      const anchorCenterY = anchor.top + anchor.height / 2;
      let top = anchorCenterY - panelRect.height / 2;
      top = Math.max(pad, Math.min(top, window.innerHeight - panelRect.height - pad));
      setPanelStyle({
        left: "50%",
        top,
        transform: "translateX(-50%)",
        maxHeight: `calc(100vh - ${pad * 2}px)`,
      });
    } else {
      setPanelStyle({
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        maxHeight: `calc(100vh - ${pad * 2}px)`,
      });
    }
  }, [image]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        style={panelStyle}
        className="fixed z-[1001] bg-card rounded-2xl max-w-5xl w-[calc(100%-2rem)] overflow-y-auto shadow-card animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <div>
            <h3 className="font-display font-bold">{image.fieldName}</h3>
            <p className="text-xs text-muted-foreground">{image.flightLabel}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Side-by-side or single image */}
        <div className="p-4">
          {hasMask ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground text-center">Original</p>
                {image.publicUrl ? (
                  <img
                    src={image.publicUrl}
                    alt="Original"
                    className="w-full rounded-xl object-contain max-h-[55vh]"
                  />
                ) : (
                  <div className="w-full h-48 rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground">
                    <ImageOff className="h-5 w-5 mr-2" /> No preview
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground text-center flex items-center justify-center gap-1">
                  <Layers className="h-3 w-3" /> Segmentation Mask
                </p>
                <img
                  src={image.maskUrl!}
                  alt="Segmentation mask"
                  className="w-full rounded-xl object-contain max-h-[55vh]"
                />
              </div>
            </div>
          ) : (
            image.publicUrl ? (
              <img
                src={image.publicUrl}
                alt="Full size"
                className="w-full rounded-xl object-contain max-h-[60vh]"
              />
            ) : (
              <div className="w-full h-64 rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground">
                <ImageOff className="h-6 w-6 mr-2" /> No preview available
              </div>
            )
          )}
        </div>

        {/* Meta */}
        <div className="px-4 pb-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Source:</span>{" "}
            {image.upload_source}
          </div>
          <div>
            <span className="font-medium text-foreground">Uploaded:</span>{" "}
            {new Date(image.uploaded_at).toLocaleString()}
          </div>
          {image.gps && (
            <div className="col-span-2">
              <span className="font-medium text-foreground">GPS:</span>{" "}
              {image.gps.lat.toFixed(6)}, {image.gps.lng.toFixed(6)}
            </div>
          )}
          <div className="col-span-2 text-[10px] break-all opacity-50">
            {image.storage_path}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Flight masks modal (uses Gallery seg results directly) ───────────────────

type MasksModalData = {
  flightId: string;
  label: string;
  images: ImageRow[];
  results: SegResult[];
};

function FlightMasksModal({
  data,
  onClose,
}: {
  data: MasksModalData;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<
    (SegResult & { previewUrl: string | null; fileLabel?: string })[]
  >([]);
  const [signing, setSigning] = useState(true);

  useLayoutEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const scrollTop = main.scrollTop;
    const prevOverflow = main.style.overflow;
    main.style.overflow = "hidden";
    return () => {
      main.style.overflow = prevOverflow;
      main.scrollTop = scrollTop;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setSigning(true);
      const signed = await resolveMaskUrls(data.results);
      if (!active) return;
      const imgById = Object.fromEntries(data.images.map((i) => [i.id, i]));
      setPreviews(
        signed.map((s) => ({
          ...s,
          fileLabel: imgById[s.image_id]?.storage_path.split("/").pop(),
        }))
      );
      setSigning(false);
    })();
    return () => { active = false; };
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden shadow-card flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border/40 shrink-0">
          <div>
            <h3 className="font-display font-bold flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Segmentation Masks
            </h3>
            <p className="text-xs text-muted-foreground">{data.label}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {signing ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading masks…
            </div>
          ) : previews.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No mask previews available for this flight.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {previews.map((s) => (
                <div
                  key={s.image_id}
                  className="rounded-xl border border-border/40 overflow-hidden bg-muted/20"
                >
                  {s.previewUrl ? (
                    <img
                      src={s.previewUrl}
                      alt="Segmentation mask"
                      className="w-full h-44 object-cover bg-black/5"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-44 flex items-center justify-center text-xs text-muted-foreground bg-muted/40">
                      Preview unavailable
                    </div>
                  )}
                  <div className="p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground truncate">
                      {s.fileLabel ?? s.image_id.slice(-8)}
                    </p>
                    <HealthBadge result={s} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main Gallery page ──────────────────────────────────────────────────────

export default function Gallery() {
  const [fields,   setFields]   = useState<Field[]>([]);
  const [flights,  setFlights]  = useState<Flight[]>([]);
  const [images,   setImages]   = useState<ImageRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [masksModal, setMasksModal] = useState<MasksModalData | null>(null);

  // Per-flight segmentation state: flightId → SegState
  const [segStates, setSegStates] = useState<Record<string, SegState>>({});

  const { alerts, refetch: refetchAlerts } = useAlerts();
  const base = getBackendBaseUrl();

  // ── Initial data load ──────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const token   = await getTokenFromSession();
        const headers = backendHeaders({ Authorization: `Bearer ${token}` });

        const [fieldsRes, flightsRes, imagesRes] = await Promise.all([
          backendFetch("/api/fields",           { headers }),
          backendFetch("/api/flights",          { headers }),
          backendFetch("/api/images?limit=200", { headers }),
        ]);

        if (!fieldsRes.ok)  throw new Error(`Fields: ${await fieldsRes.text()}`);
        if (!flightsRes.ok) throw new Error(`Flights: ${await flightsRes.text()}`);
        if (!imagesRes.ok)  throw new Error(`Images: ${await imagesRes.text()}`);

        const [fieldsData, flightsData, rawImages]: [Field[], Flight[], ImageRow[]] =
          await Promise.all([fieldsRes.json(), flightsRes.json(), imagesRes.json()]);

        if (!active) return;

        const normalized = rawImages.map((img) => ({
          ...img,
          publicUrl: isUsableImageUrl(img.publicUrl) ? img.publicUrl : undefined,
        }));
        const withUrls = normalized.some((img) => !img.publicUrl && img.storage_path)
          ? await resolveSignedUrls(normalized)
          : normalized;

        const previewCount = withUrls.filter((img) => img.publicUrl).length;
        if (previewCount < withUrls.length) {
          console.warn(
            `Gallery: ${withUrls.length - previewCount}/${withUrls.length} images missing preview URL — restart backend with SUPABASE_STORAGE_PUBLIC=false`
          );
        }

        setFields(fieldsData);
        setFlights(flightsData);
        setImages(withUrls);

        // Segmentation results load in background (don't block gallery thumbnails).
        const segInit: Record<string, SegState> = {};
        await Promise.allSettled(
          flightsData.map(async (fl) => {
            try {
              const res  = await backendFetch(`/api/segment/flight/${fl.id}`, { headers });
              if (!res.ok) return;
              const json = await res.json();
              const results: SegResult[] = (json.results ?? []).map((r: any) => ({
                image_id:    r.image_id,
                mask_url:    r.mask_url ?? "",
                stress_class: r.stress_class ?? undefined,
                confidence:  r.confidence ?? undefined,
                cached:      true,
              }));
              const valid = results.filter(
                (r) => r.mask_url && !r.mask_url.startsWith("local://")
              );
              if (valid.length > 0) {
                segInit[fl.id] = { status: "done", results: valid };
              }
            } catch {
              // silently ignore
            }
          })
        );
        if (!active) return;
        setSegStates(segInit);
        setLoading(false);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load gallery");
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => { active = false; };
  }, [base]);

  // ── Run segmentation for a flight ─────────────────────────────────────
  const runSegmentation = useCallback(async (flightId: string, force = false) => {
    setSegStates((prev) => ({ ...prev, [flightId]: { status: "loading" } }));
    try {
      const token = await getTokenFromSession();
      const path = `/api/segment/flight/${flightId}${force ? "?force=true" : ""}`;
      const res   = await backendFetch(path, {
        method:  "POST",
        headers: backendHeaders({ Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const results: SegResult[] = (json.results ?? []).map((r: any) => ({
        image_id:    r.image_id,
        mask_url:    r.mask_url ?? "",
        stress_class: r.stress_class ?? undefined,
        confidence:  r.confidence ?? undefined,
        cached:      r.cached ?? false,
      }));
      setSegStates((prev) => ({
        ...prev,
        [flightId]: { status: "done", results },
      }));
      void refetchAlerts();
    } catch (e) {
      setSegStates((prev) => ({
        ...prev,
        [flightId]: {
          status:  "error",
          message: e instanceof Error ? e.message : "Segmentation failed",
        },
      }));
    }
  }, [base, refetchAlerts]);

  // ── Group images ───────────────────────────────────────────────────────
  const grouped = fields.map((field) => {
    const fieldImgs    = images.filter((img) => img.field_id === field.id);
    const fieldFlights = flights.filter((fl)  => fl.field_id === field.id);

    const byFlight = fieldFlights.map((fl) => ({
      flight: fl,
      imgs:   fieldImgs.filter((img) => img.flight_id === fl.id),
    }));

    const manual = fieldImgs.filter((img) => img.flight_id === null);
    return { field, byFlight, manual, total: fieldImgs.length };
  });

  const fieldIds = new Set(fields.map((f) => f.id));
  const orphaned = images.filter((img) => img.field_id && !fieldIds.has(img.field_id));

  const unlinked = images.filter((img) => img.field_id === null);

  const openLightbox = (
    img: ImageRow,
    fieldName: string,
    flightLabel: string,
    maskUrl?: string,
    anchor?: AnchorRect,
  ) => setSelected({ ...img, fieldName, flightLabel, maskUrl, anchor });

  const openMasksModal = useCallback((flightId: string) => {
    const fl = flights.find((f) => f.id === flightId);
    const seg = segStates[flightId];
    if (!fl || seg?.status !== "done" || seg.results.length === 0) return;

    const field = fields.find((f) => f.id === fl.field_id);
    const flightDate = new Date(
      (fl as Flight & { created_at?: string }).flight_date ??
        (fl as Flight & { created_at?: string }).created_at ??
        Date.now()
    ).toLocaleDateString();

    setMasksModal({
      flightId,
      label: `${field?.field_name ?? "Field"} · Flight · ${flightDate}`,
      images: images.filter((i) => i.flight_id === flightId),
      results: seg.results,
    });
  }, [flights, segStates, fields, images]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Image Gallery"
        subtitle={
          !loading && !error
            ? `${images.length} image(s) · ${images.filter((i) => i.publicUrl).length} with preview`
            : "All field images grouped by field and flight"
        }
        gradient="gradient-gallery"
        icon={Images}
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading images…
        </div>
      )}

      {error && !loading && (
        <Card className="p-4 text-sm text-red-600 border-red-200 bg-red-50">{error}</Card>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {grouped.map(({ field, byFlight, manual, total }) => (
            <Card key={field.id} className="p-5 space-y-4">
              <Section
                title={field.field_name}
                titleIcon={MapPin}
                subtitle={field.crop_type ? `· ${field.crop_type}` : undefined}
                count={total}
                defaultOpen
              >
                <div className="space-y-5">
                  {byFlight.map(({ flight, imgs }) => {
                    const flightDate = new Date(
                      (flight as any).flight_date ?? (flight as any).created_at
                    ).toLocaleDateString();
                    const flightTag = flight.id.slice(-8);
                    const seg        = segStates[flight.id] ?? { status: "idle" };
                    const segResults = seg.status === "done" ? seg.results : undefined;

                    return (
                      <Section
                        key={flight.id}
                        title="Flight"
                        titleIcon={Satellite}
                        subtitle={`· ${flightDate} · ${flightTag}`}
                        count={imgs.length}
                        defaultOpen={imgs.length > 0}
                        alertDot={flightHasAlert(alerts, flight.id)}
                        headerExtra={
                          imgs.length > 0 ? (
                            <SegStatus
                              flightId={flight.id}
                              seg={seg}
                              onSeg={runSegmentation}
                              onViewMasks={openMasksModal}
                            />
                          ) : undefined
                        }
                      >
                        <ImageGrid
                          images={imgs}
                          segResults={segResults}
                          onSelect={(img, maskUrl, anchor) =>
                            openLightbox(img, field.field_name, `Flight · ${flightDate}`, maskUrl, anchor)
                          }
                        />
                      </Section>
                    );
                  })}

                  {manual.length > 0 && (
                    <Section
                      title="Manual uploads"
                      titleIcon={Camera}
                      subtitle="· no flight"
                      count={manual.length}
                      defaultOpen
                    >
                      <ImageGrid
                        images={manual}
                        onSelect={(img, _maskUrl, anchor) =>
                          openLightbox(img, field.field_name, "Manual upload", undefined, anchor)
                        }
                      />
                    </Section>
                  )}

                  {byFlight.length === 0 && manual.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <ImageOff className="h-4 w-4" /> No images for this field yet.
                    </div>
                  )}
                </div>
              </Section>
            </Card>
          ))}

          {orphaned.length > 0 && (
            <Card className="p-5">
              <Section
                title="Flight images"
                titleIcon={Plane}
                subtitle="· field not loaded in list"
                count={orphaned.length}
                defaultOpen
              >
                <ImageGrid
                  images={orphaned}
                  onSelect={(img, _maskUrl, anchor) =>
                    openLightbox(img, "Field", "Flight", undefined, anchor)
                  }
                />
              </Section>
            </Card>
          )}

          {unlinked.length > 0 && (
            <Card className="p-5">
              <Section
                title="Unlinked images"
                titleIcon={FolderOpen}
                subtitle="· no field assigned"
                count={unlinked.length}
                defaultOpen
              >
                <ImageGrid
                  images={unlinked}
                  onSelect={(img, _maskUrl, anchor) =>
                    openLightbox(img, "Unknown field", "No flight", undefined, anchor)
                  }
                />
              </Section>
            </Card>
          )}

          {images.length === 0 && (
            <Card className="p-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <ImageOff className="h-10 w-10 opacity-30" />
              <div className="text-sm">
                No images yet. Upload from the{" "}
                <span className="font-semibold">Analyze</span> page or during a flight.
              </div>
            </Card>
          )}
        </div>
      )}

      {selected && (
        <Lightbox image={selected} onClose={() => setSelected(null)} />
      )}
      {masksModal && (
        <FlightMasksModal data={masksModal} onClose={() => setMasksModal(null)} />
      )}
    </div>
  );
}