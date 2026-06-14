import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Cloud,
  CloudRain,
  CloudSun,
  Loader2,
  Satellite,
  ThermometerSun,
  Wind,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Field, Flight } from "@/types/backend";
import { getBackendBaseUrl } from "@/lib/backend";

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

// ─── Weather alert types ───────────────────────────────────────────────────

type WeatherAlert = {
  level: "danger" | "warning";
  icon: LucideIcon;
  message: string;
};

type WeatherStatus = {
  alerts: WeatherAlert[];
  loading: boolean;
  error: string | null;
};

// Thresholds
const WIND_DANGER_MS   = 10;  // >10 m/s = danger for drone
const WIND_WARNING_MS  = 6;   // >6 m/s  = warning
const HEAT_DANGER_C    = 38;  // >38°C   = dangerous for potato
const HEAT_WARNING_C   = 33;  // >33°C   = warning
const CLOUD_WARNING    = 80;  // >80%    = too cloudy for multispectral
const RAIN_THRESHOLD   = 0.5; // >0.5 mm/h = rain

async function fetchWeatherAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  // Open-Meteo — free, no API key required
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,windspeed_10m,precipitation,cloudcover` +
    `&windspeed_unit=ms`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  const data = await res.json();
  const c = data.current;

  const wind  = c.windspeed_10m   as number;
  const temp  = c.temperature_2m  as number;
  const rain  = c.precipitation   as number;
  const cloud = c.cloudcover      as number;

  const alerts: WeatherAlert[] = [];

  // Wind
  if (wind > WIND_DANGER_MS) {
    alerts.push({ level: "danger", icon: Wind, message: `Wind speed ${wind.toFixed(1)} m/s — drone flight is unsafe` });
  } else if (wind > WIND_WARNING_MS) {
    alerts.push({ level: "warning", icon: Wind, message: `Wind speed ${wind.toFixed(1)} m/s — fly with caution` });
  }

  if (rain > RAIN_THRESHOLD) {
    alerts.push({ level: "danger", icon: CloudRain, message: `Rain detected (${rain.toFixed(1)} mm/h) — flight not recommended` });
  }

  if (cloud > CLOUD_WARNING) {
    alerts.push({ level: "warning", icon: Cloud, message: `Cloud cover ${cloud}% — multispectral image quality may be poor` });
  }

  if (temp > HEAT_DANGER_C) {
    alerts.push({ level: "danger", icon: ThermometerSun, message: `Temperature ${temp.toFixed(1)}°C — extreme heat risk for potato crop` });
  } else if (temp > HEAT_WARNING_C) {
    alerts.push({ level: "warning", icon: ThermometerSun, message: `Temperature ${temp.toFixed(1)}°C — monitor crop for heat stress` });
  }

  return alerts;
}

// ─── Weather Alert Banner component ────────────────────────────────────────

function WeatherAlertBanner({ fieldId, fields }: { fieldId: string; fields: Field[] }) {
  const [status, setStatus] = useState<WeatherStatus>({ alerts: [], loading: false, error: null });

  useEffect(() => {
    if (!fieldId) { setStatus({ alerts: [], loading: false, error: null }); return; }
    const field = fields.find((f) => f.id === fieldId);
    if (!field?.latitude || !field?.longitude) {
      setStatus({ alerts: [], loading: false, error: "Field has no GPS coordinates — cannot check weather" });
      return;
    }

    let active = true;
    setStatus({ alerts: [], loading: true, error: null });

    fetchWeatherAlerts(field.latitude, field.longitude)
      .then((alerts) => { if (active) setStatus({ alerts, loading: false, error: null }); })
      .catch((e) => { if (active) setStatus({ alerts: [], loading: false, error: e.message }); });

    return () => { active = false; };
  }, [fieldId, fields]);

  if (!fieldId) return null;

  if (status.loading) {
    return (
      <div className="rounded-xl border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground animate-pulse flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking weather conditions…
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-700 px-4 py-3 text-sm flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        {status.error}
      </div>
    );
  }

  if (status.alerts.length === 0) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 text-green-700 px-4 py-3 text-sm flex items-center gap-2">
        <CloudSun className="h-4 w-4 shrink-0" />
        Weather conditions are clear — safe to fly
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {status.alerts.map((a, i) => {
        const Icon = a.icon;
        return (
        <div
          key={i}
          className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
            a.level === "danger"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">{a.level === "danger" ? "DANGER" : "WARNING"}</span>
            {" — "}
            {a.message}
          </span>
        </div>
      );})}
    </div>
  );
}

// ─── Main Flights page ──────────────────────────────────────────────────────

type NewFlight = {
  field_id: string;
  drone_id: string;
  altitude?: number;
};

const blank: NewFlight = {
  field_id: "",
  drone_id: "",
  altitude: undefined,
};

type DroneRow = {
  id: string;
  drone_name: string;
  field_id?: string;
  esp32_device_id?: string;
};

/** Prefer field-assigned drone; fall back to any registered drone for this account. */
function resolveDroneForField(drones: DroneRow[], field_id: string): DroneRow | undefined {
  if (!field_id || drones.length === 0) return undefined;
  const forField = drones.find((d) => d.field_id === field_id);
  if (forField) return forField;
  return drones.find((d) => d.esp32_device_id?.trim()) ?? drones[0];
}

export default function Flights() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const preselectedFieldId = params.get("field_id") || "";

  const [fields, setFields]   = useState<Field[]>([]);
  const [drones, setDrones]   = useState<DroneRow[]>([]);
  const [items, setItems]     = useState<Flight[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft]     = useState<NewFlight>(blank);
  const [esp32ActiveFlightId, setEsp32ActiveFlightId] = useState<string | null>(null);
  const [esp32ActiveFieldName, setEsp32ActiveFieldName] = useState<string | null>(null);

  const backendBaseUrl = getBackendBaseUrl();

  const loadEsp32Active = useCallback(async () => {
    try {
      const token = await getTokenFromSession();
      const res = await fetch(`${backendBaseUrl}/api/flights/esp32/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        flight_id?: string | null;
        field_name?: string | null;
      };
      setEsp32ActiveFlightId(data.flight_id ?? null);
      setEsp32ActiveFieldName(data.field_name ?? null);
    } catch {
      /* non-fatal */
    }
  }, [backendBaseUrl]);

  const loadFlights = useCallback(async (field_id?: string) => {
    const qs = field_id ? `?field_id=${field_id}` : "";
    const token = await getTokenFromSession();
    const res = await fetch(`${backendBaseUrl}/api/flights${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as Flight[];
  }, [backendBaseUrl]);

  useEffect(() => {
    if (loading || !user) return;
    let active = true;

    const run = async () => {
      setPending(true);
      setError(null);
      try {
        const token = await getTokenFromSession();

        const [fieldsRes, dronesRes] = await Promise.all([
          fetch(`${backendBaseUrl}/api/fields`,  { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${backendBaseUrl}/api/drones`,  { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!fieldsRes.ok) throw new Error(await fieldsRes.text());
        if (!dronesRes.ok) throw new Error(await dronesRes.text());

        const fieldsData = (await fieldsRes.json()) as Field[];
        const dronesData = (await dronesRes.json()) as DroneRow[];

        if (!active) return;
        setFields(fieldsData);
        setDrones(dronesData);

        const initialField = preselectedFieldId || fieldsData[0]?.id || "";

        // Auto-fill drone for the initial field
        const matchedDrone = resolveDroneForField(dronesData, initialField);
        setDraft({ field_id: initialField, drone_id: matchedDrone?.id || "", altitude: undefined });

        const fl = await loadFlights(initialField || undefined);
        if (active) setItems(fl);
        if (active) await loadEsp32Active();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        if (active) setPending(false);
      }
    };

    run();
    return () => { active = false; };
  }, [loading, user, backendBaseUrl, preselectedFieldId, loadFlights, loadEsp32Active]);

  // When field changes in the form, auto-select the drone assigned to it
  const onFieldChange = async (field_id: string) => {
    const matchedDrone = resolveDroneForField(drones, field_id);
    setDraft((d) => ({ ...d, field_id, drone_id: matchedDrone?.id || "" }));

    // reload flights list for new field
    setPending(true);
    setError(null);
    try {
      const fl = await loadFlights(field_id || undefined);
      setItems(fl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flights");
    } finally {
      setPending(false);
    }
  };

  const onCreate = async () => {
    if (!draft.field_id) { setError("Please select a field"); return; }
    if (!draft.drone_id) {
      setError("No drone registered — add one on the Drones page first");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await fetch(`${backendBaseUrl}/api/flights`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          field_id: draft.field_id,
          drone_id: draft.drone_id,
          altitude: draft.altitude ?? null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as Flight;
      setItems((prev) => [created, ...prev]);
      setCreating(false);
      setDraft((d) => ({ ...d, altitude: undefined }));
      await loadEsp32Active();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create flight");
    } finally {
      setPending(false);
    }
  };

  const onActivateEsp32 = async (flight_id: string) => {
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await fetch(`${backendBaseUrl}/api/flights/${flight_id}/activate-esp32`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      await loadEsp32Active();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set ESP32 target flight");
    } finally {
      setPending(false);
    }
  };

  const onDelete = async (flight_id: string) => {
    if (!window.confirm("Delete this flight?")) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await fetch(`${backendBaseUrl}/api/flights/${flight_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((x) => x.id !== flight_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete flight");
    } finally {
      setPending(false);
    }
  };

  const selectedField = useMemo(() => fields.find((f) => f.id === draft.field_id), [fields, draft.field_id]);
  const assignedDrone = useMemo(
    () => resolveDroneForField(drones, draft.field_id),
    [drones, draft.field_id],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Flights"
        subtitle="Create and manage drone flights per field"
        gradient="gradient-gallery"
        icon={Satellite}
      />

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Field selector + weather alert */}
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div className="space-y-2">
            <Label>Select field</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={draft.field_id}
              onChange={(e) => onFieldChange(e.target.value)}
              disabled={pending}
            >
              <option value="">— All fields —</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.field_name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Drone for this field</Label>
            <Input
              value={assignedDrone?.drone_name || (draft.field_id ? "No drone registered" : "—")}
              readOnly
              className={!assignedDrone && draft.field_id ? "text-red-500" : ""}
            />
          </div>
        </div>

        {/* Weather alerts — shown whenever a field is selected */}
        <WeatherAlertBanner fieldId={draft.field_id} fields={fields} />

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating((v) => !v)}>
            {creating ? "Close" : "New flight"}
          </Button>
        </div>
      </Card>

      {/* New flight form */}
      {creating && (
        <Card className="p-5 space-y-4">
          <div className="text-sm font-medium">
            New flight for{" "}
            <span className="text-primary">{selectedField?.field_name || "—"}</span>
            {assignedDrone && (
              <span className="text-muted-foreground"> · Drone: {assignedDrone.drone_name}</span>
            )}
          </div>

          {!assignedDrone && draft.field_id && (
            <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
              <AlertTriangle className="h-4 w-4 inline shrink-0" /> No drone registered yet. Go to the{" "}
              <a href="/drones" className="underline font-medium">Drones page</a> and add one first.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Field *</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.field_id}
                onChange={(e) => onFieldChange(e.target.value)}
              >
                <option value="">— Select a field —</option>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>{f.field_name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Altitude (m, optional)</Label>
              <Input
                value={draft.altitude ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, altitude: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="120"
                type="number"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={onCreate} disabled={pending || !draft.field_id || !draft.drone_id}>
              {pending ? "Creating..." : "Create flight"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => { setCreating(false); }}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Flights list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((fl) => {
          const flField = fields.find((f) => f.id === fl.field_id);
          const isEsp32Target = esp32ActiveFlightId === fl.id;
          return (
            <Card key={fl.id} className={`p-5 space-y-3 ${isEsp32Target ? "ring-2 ring-primary/40" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold truncate flex items-center gap-2">
                    {flField?.field_name || "Unknown field"}
                    {isEsp32Target && (
                      <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        ESP32 target
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Drone: {fl.drone_name || fl.drone_id || "—"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  {!isEsp32Target && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onActivateEsp32(fl.id)}
                      disabled={pending}
                    >
                      Send to ESP32
                    </Button>
                  )}
                  <Button size="sm" onClick={() => navigate(`/segmentations/${fl.id}`)} disabled={pending}>
                    Segmentations
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(fl.id)} disabled={pending}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Flight ID: {fl.id}</div>
                {fl.altitude != null && <div>Altitude: {fl.altitude} m</div>}
              </div>
            </Card>
          );
        })}

        {!items.length && !pending && (
          <Card className="p-8 text-center text-sm text-muted-foreground">No flights found for this field.</Card>
        )}
      </div>
    </div>
  );
}