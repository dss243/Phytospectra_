import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Field } from "@/types/backend";
import { Sprout, MapPin, Leaf, AlertTriangle, CheckCircle2, Pencil, Wheat, LocateFixed } from "lucide-react";
import { getBackendBaseUrl, backendFetch } from "@/lib/backend";
import { MapContainer, TileLayer, FeatureGroup } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import { MapSetView, requestUserMapCenter } from "@/components/MapUserLocation";
import type { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, shadowUrl: markerShadow });

// ─── Types ──────────────────────────────────────────────────────────────────

type NewField = {
  field_name: string;
  crop_type: string;
  latitude?: number;
  longitude?: number;
  area_hectares?: number;
  boundary?: object;
  drone_name?: string;
  drone_model?: string;
};

const blankNewField: NewField = {
  field_name: "",
  crop_type: "potato",
  drone_name: "",
  drone_model: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function FieldCard({
  field,
  onDelete,
  pending,
}: {
  field: Field;
  onDelete: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="group relative rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all duration-200 overflow-hidden">
      {/* Accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-400 to-teal-600 rounded-l-2xl" />

      <div className="pl-5 pr-4 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{field.field_name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium px-2 py-0.5">
                <Sprout className="h-3 w-3" /> {field.crop_type || "—"}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(field.id)}
            disabled={pending}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
          >
            Delete
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-muted-foreground/70">
              GPS
            </div>
            {field.latitude != null && field.longitude != null ? (
              <span className="font-mono">
                {field.latitude.toFixed(4)}, {field.longitude.toFixed(4)}
              </span>
            ) : (
              "—"
            )}
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-muted-foreground/70">
              Area
            </div>
            {field.area_hectares != null ? (
              <span className="font-mono">{field.area_hectares} ha</span>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Fields() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Field[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewField>(blankNewField);
  const [step, setStep] = useState<"details" | "map">("details");
  const [mapCenter, setMapCenter] = useState<LatLngTuple>([36.48, 2.95]);
  const [mapZoom, setMapZoom] = useState(13);
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);

  const backendBaseUrl = getBackendBaseUrl();

  const goToMyLocation = () => {
    setLocating(true);
    setLocationHint(null);
    requestUserMapCenter(
      (lat, lng) => {
        setMapCenter([lat, lng]);
        setMapZoom(16);
        setLocating(false);
        setLocationHint("Map centered on your location — draw your field outline.");
      },
      (msg) => {
        setLocating(false);
        setLocationHint(msg ?? "Could not get your location — allow GPS in the browser or pan the map manually.");
      },
    );
  };

  useEffect(() => {
    if (step !== "map") return;
    goToMyLocation();
  }, [step]);

  // ── Load fields ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    const run = async () => {
      setPending(true);
      setError(null);
      try {
        const token = await getTokenFromSession();
        const res = await backendFetch(`/api/fields`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Field[];
        if (active) setItems(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load fields");
      } finally {
        if (active) setPending(false);
      }
    };
    run();
    return () => { active = false; };
  }, [loading, user, backendBaseUrl]);

  // ── Map polygon callback ─────────────────────────────────────────────────
  const onPolygonCreated = (e: any) => {
    const layer = e.layer;
    const geoJson = layer.toGeoJSON();
    const coords = geoJson.geometry.coordinates[0];

    const lats = coords.map((c: number[]) => c[1]);
    const lngs = coords.map((c: number[]) => c[0]);
    const centerLat = lats.reduce((a: number, b: number) => a + b, 0) / lats.length;
    const centerLng = lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length;

    setDraft((d) => ({
      ...d,
      boundary: geoJson.geometry,
      latitude: parseFloat(centerLat.toFixed(6)),
      longitude: parseFloat(centerLng.toFixed(6)),
    }));
  };

  // ── Create field (+ optional drone) ─────────────────────────────────────
  const onCreate = async () => {
    if (!draft.field_name.trim()) { setError("Field name is required"); return; }
    if (!draft.boundary) { setError("Please draw the field boundary on the map"); return; }

    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();

      // 1 — Create field
      const fieldRes = await backendFetch(`/api/fields`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          field_name:    draft.field_name,
          crop_type:     draft.crop_type || "potato",
          boundary:      draft.boundary,
          latitude:      draft.latitude,
          longitude:     draft.longitude,
          area_hectares: draft.area_hectares,
        }),
      });
      if (!fieldRes.ok) throw new Error(await fieldRes.text());
      const createdField = (await fieldRes.json()) as Field;

      // 2 — Optionally create & auto-assign drone
      if (draft.drone_name?.trim()) {
        const droneRes = await backendFetch(`/api/drones`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            drone_name:  draft.drone_name.trim(),
            drone_model: draft.drone_model?.trim() || null,
            field_id:    createdField.id,
          }),
        });
        if (!droneRes.ok) throw new Error(await droneRes.text());
      }

      setItems((prev) => [createdField, ...prev]);
      setCreating(false);
      setDraft(blankNewField);
      setStep("details");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create field");
    } finally {
      setPending(false);
    }
  };

  // ── Delete field ─────────────────────────────────────────────────────────
  const onDelete = async (field_id: string) => {
    if (!window.confirm("Delete this field?")) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/fields/${field_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((x) => x.id !== field_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete field");
    } finally {
      setPending(false);
    }
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraft(blankNewField);
    setStep("details");
    setError(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fields"
        subtitle="Create and manage your farm fields"
        gradient="gradient-gallery"
        icon={Sprout}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {pending && !creating ? (
            <span className="animate-pulse">Loading…</span>
          ) : (
            <span>
              <span className="font-semibold text-foreground">{items.length}</span> field
              {items.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <Button
          onClick={() => { setCreating((v) => !v); setStep("details"); setError(null); }}
          className="gap-2"
        >
          {creating ? "✕ Close" : "+ New field"}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-red-700 dark:text-red-400 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Creation Form ── */}
      {creating && (
        <Card className="overflow-hidden border-border shadow-sm">
          {/* Step tabs */}
          <div className="flex border-b border-border bg-muted/30">
            {(["details", "map"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                  step === s
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "details" ? "① Field & Drone Details" : "② Draw Boundary"}
                {step === s && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-6">
            {/* ── Step 1: Details ── */}
            {step === "details" && (
              <>
                <SectionTitle>Field Info</SectionTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>
                      Field name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={draft.field_name}
                      onChange={(e) => setDraft((d) => ({ ...d, field_name: e.target.value }))}
                      placeholder="e.g. North Plot"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Crop type</Label>
                    <Input
                      value={draft.crop_type}
                      onChange={(e) => setDraft((d) => ({ ...d, crop_type: e.target.value }))}
                      placeholder="potato"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Area (hectares)</Label>
                    <Input
                      type="number"
                      value={draft.area_hectares ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          area_hectares: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      placeholder="12.5"
                    />
                  </div>
                </div>

                <SectionTitle>Drone (optional)</SectionTitle>
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Adding a drone here will auto-assign it to this field so you can schedule flights immediately.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Drone name</Label>
                      <Input
                        value={draft.drone_name ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, drone_name: e.target.value }))}
                        placeholder="e.g. Drone Alpha"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Drone model</Label>
                      <Input
                        value={draft.drone_model ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, drone_model: e.target.value }))}
                        placeholder="e.g. DJI Mavic 3M"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => setStep("map")} className="gap-2">
                    Next: Draw Boundary →
                  </Button>
                </div>
              </>
            )}

            {/* ── Step 2: Map ── */}
            {step === "map" && (
              <>
                <SectionTitle>Field Boundary</SectionTitle>

                {/* Boundary status */}
                <div
                  className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${
                    draft.boundary
                      ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {draft.boundary ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>
                        Boundary captured — centre{" "}
                        <span className="font-mono font-medium">
                          {draft.latitude}, {draft.longitude}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4 shrink-0" />
                      <span>Use the polygon tool (top-right of the map) to draw your field outline</span>
                    </>
                  )}
                </div>

                {/* Map */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-muted-foreground">
                      Draw your farm plot — the outline appears on stress maps in Field Analytics.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={goToMyLocation}
                      disabled={locating}
                    >
                      <LocateFixed className={`h-3.5 w-3.5 ${locating ? "animate-pulse" : ""}`} />
                      {locating ? "Finding you…" : "My location"}
                    </Button>
                  </div>
                  {locationHint && (
                    <p className="text-xs text-muted-foreground">{locationHint}</p>
                  )}
                  <div className="rounded-xl overflow-hidden border border-border h-80 shadow-inner">
                    <MapContainer
                      center={mapCenter}
                      zoom={mapZoom}
                      style={{ height: "100%", width: "100%" }}
                    >
                      <MapSetView center={mapCenter} zoom={mapZoom} />
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="© OpenStreetMap contributors"
                      />
                      <FeatureGroup>
                        <EditControl
                          position="topright"
                          onCreated={onPolygonCreated}
                          draw={{
                            rectangle: false,
                            circle: false,
                            circlemarker: false,
                            marker: false,
                            polyline: false,
                            polygon: true,
                          }}
                        />
                      </FeatureGroup>
                    </MapContainer>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 justify-between flex-wrap">
                  <Button variant="outline" onClick={() => setStep("details")}>
                    ← Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={cancelCreate} disabled={pending}>
                      Cancel
                    </Button>
                    <Button
                      onClick={onCreate}
                      disabled={pending || !draft.boundary || !draft.field_name.trim()}
                    >
                      {pending ? (
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          Creating…
                        </span>
                      ) : (
                        "✓ Create field"
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* ── Fields grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((f) => (
          <FieldCard key={f.id} field={f} onDelete={onDelete} pending={pending} />
        ))}
        {!items.length && !pending && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Wheat className="h-7 w-7" />
            </div>
            <div className="text-sm font-medium text-foreground">No fields yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Click <span className="font-semibold">+ New field</span> to get started
            </div>
          </div>
        )}
      </div>
    </div>
  );
}