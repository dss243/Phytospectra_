import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { AlertTriangle, MapPin, Radio, Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Field } from "@/types/backend";
import { getBackendBaseUrl, backendFetch } from "@/lib/backend";

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

type Drone = {
  id: string;
  drone_name: string;
  drone_model?: string;
  esp32_device_id?: string;
  multispectral_camera?: string;
  field_id?: string;
  field_name?: string;
};

type NewDrone = {
  drone_name: string;
  drone_model: string;
  esp32_device_id: string;
  multispectral_camera: string;
  field_id: string;
};

const blank: NewDrone = {
  drone_name: "",
  drone_model: "",
  esp32_device_id: "",
  multispectral_camera: "MAPIR Survey3W",
  field_id: "",
};

export default function Drones() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Drone[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewDrone>(blank);
  const [editDraft, setEditDraft] = useState<{
    drone_name: string;
    drone_model: string;
    esp32_device_id: string;
    multispectral_camera: string;
  }>({
    drone_name: "",
    drone_model: "",
    esp32_device_id: "",
    multispectral_camera: "MAPIR Survey3W",
  });

  const backendBaseUrl = getBackendBaseUrl();

  useEffect(() => {
    if (loading || !user) return;
    let active = true;

    const run = async () => {
      setPending(true);
      setError(null);
      try {
        const token = await getTokenFromSession();

        // load fields and drones in parallel
        const [fieldsRes, dronesRes] = await Promise.all([
          backendFetch(`/api/fields`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          backendFetch(`/api/drones`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (!fieldsRes.ok) throw new Error(await fieldsRes.text());
        if (!dronesRes.ok) throw new Error(await dronesRes.text());

        const fieldsData = (await fieldsRes.json()) as Field[];
        const dronesData = (await dronesRes.json()) as Drone[];

        if (!active) return;
        setFields(fieldsData);
        setItems(dronesData);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        if (active) setPending(false);
      }
    };

    run();
    return () => { active = false; };
  }, [loading, user, backendBaseUrl]);

  // Fields that don't already have a drone assigned
  const availableFields = fields.filter(
    (f) => !items.some((d) => d.field_id === f.id)
  );

  const onCreate = async () => {
    if (!draft.drone_name.trim()) { setError("Drone name is required"); return; }
    if (!draft.field_id) { setError("You must assign this drone to a field"); return; }

    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/drones`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          drone_name:           draft.drone_name,
          drone_model:          draft.drone_model || null,
          esp32_device_id:      draft.esp32_device_id || null,
          multispectral_camera: draft.multispectral_camera || "MAPIR Survey3W",
          field_id:             draft.field_id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as Drone;

      // attach field_name for display
      const matchedField = fields.find((f) => f.id === created.field_id);
      setItems((prev) => [{ ...created, field_name: matchedField?.field_name }, ...prev]);
      setCreating(false);
      setDraft(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create drone");
    } finally {
      setPending(false);
    }
  };

  const startEdit = (d: Drone) => {
    setEditingId(d.id);
    setEditDraft({
      drone_name: d.drone_name,
      drone_model: d.drone_model || "",
      esp32_device_id: d.esp32_device_id || "",
      multispectral_camera: d.multispectral_camera || "MAPIR Survey3W",
    });
    setCreating(false);
  };

  const onSaveEdit = async (drone_id: string) => {
    if (!editDraft.drone_name.trim()) {
      setError("Drone name is required");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/drones/${drone_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          drone_name: editDraft.drone_name.trim(),
          drone_model: editDraft.drone_model.trim() || null,
          esp32_device_id: editDraft.esp32_device_id.trim() || null,
          multispectral_camera: editDraft.multispectral_camera.trim() || "MAPIR Survey3W",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as Drone;
      const matchedField = fields.find((f) => f.id === updated.field_id);
      setItems((prev) =>
        prev.map((x) =>
          x.id === drone_id
            ? { ...updated, field_name: matchedField?.field_name ?? x.field_name }
            : x
        )
      );
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update drone");
    } finally {
      setPending(false);
    }
  };

  const onDelete = async (drone_id: string) => {
    if (!window.confirm("Delete this drone?")) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/drones/${drone_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((x) => x.id !== drone_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete drone");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Drones"
        subtitle="Manage drones — one drone per field"
        gradient="gradient-gallery"
        icon={Radio}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {pending ? "Loading..." : `${items.length} drone(s)`}
        </div>
        <Button
          onClick={() => {
            if (!creating) {
              const sharedEsp32 = items.find((d) => d.esp32_device_id?.trim())?.esp32_device_id ?? "";
              setDraft({ ...blank, esp32_device_id: sharedEsp32 });
            } else {
              setDraft(blank);
            }
            setCreating((v) => !v);
          }}
          disabled={availableFields.length === 0 && !creating}
          title={availableFields.length === 0 ? "All fields already have a drone assigned" : ""}
        >
          {creating ? "Close" : "New drone"}
        </Button>
      </div>

      {availableFields.length === 0 && !creating && items.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-700 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>All your fields already have a drone assigned. Delete a drone or add a new field first.</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {creating && (
        <Card className="p-5 space-y-4">
          {availableFields.length === 0 ? (
            <div className="text-sm text-amber-600">
              No available fields. All fields already have a drone assigned.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Field assignment — dropdown, not free text */}
                <div className="space-y-2 md:col-span-2">
                  <Label>Assign to field *</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={draft.field_id}
                    onChange={(e) => setDraft((d) => ({ ...d, field_id: e.target.value }))}
                  >
                    <option value="">— Select a field —</option>
                    {availableFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name} {f.latitude != null ? `(${f.latitude.toFixed(4)}, ${f.longitude?.toFixed(4)})` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Only fields without a drone are shown.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Drone name *</Label>
                  <Input
                    value={draft.drone_name}
                    onChange={(e) => setDraft((d) => ({ ...d, drone_name: e.target.value }))}
                    placeholder="e.g. Alpha-1"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Drone model</Label>
                  <Input
                    value={draft.drone_model}
                    onChange={(e) => setDraft((d) => ({ ...d, drone_model: e.target.value }))}
                    placeholder="e.g. DJI Mavic 3"
                  />
                </div>

                <div className="space-y-2">
                  <Label>ESP32 Device ID</Label>
                  <Input
                    value={draft.esp32_device_id}
                    onChange={(e) => setDraft((d) => ({ ...d, esp32_device_id: e.target.value }))}
                    placeholder="esp32-mapir-01 (must match firmware DEVICE_ID)"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Multispectral camera</Label>
                  <Input
                    value={draft.multispectral_camera}
                    onChange={(e) => setDraft((d) => ({ ...d, multispectral_camera: e.target.value }))}
                    placeholder="MAPIR Survey3W"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={onCreate} disabled={pending || !draft.field_id}>
                  {pending ? "Creating..." : "Create drone"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setCreating(false); setDraft(blank); }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((d) => (
          <Card key={d.id} className="p-5 space-y-3">
            {editingId === d.id ? (
              <>
                <div className="font-semibold text-sm">Edit drone</div>
                <div className="space-y-2">
                  <Label>Drone name</Label>
                  <Input
                    value={editDraft.drone_name}
                    onChange={(e) => setEditDraft((x) => ({ ...x, drone_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ESP32 Device ID *</Label>
                  <Input
                    value={editDraft.esp32_device_id}
                    onChange={(e) => setEditDraft((x) => ({ ...x, esp32_device_id: e.target.value }))}
                    placeholder="esp32-mapir-01"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must match <code className="text-foreground">DEVICE_ID</code> in your ESP32 sketch exactly.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onSaveEdit(d.id)} disabled={pending}>
                    {pending ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{d.drone_name}</div>
                    <div className="text-xs text-muted-foreground">Model: {d.drone_model || "—"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(d)} disabled={pending}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(d.id)} disabled={pending}>
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    Field: <span className="font-medium text-foreground">{d.field_name || d.field_id || "—"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Camera className="h-3.5 w-3.5" />
                    Camera: {d.multispectral_camera || "—"}
                  </div>
                  <div>
                    🔌 ESP32:{" "}
                    <span className={d.esp32_device_id ? "font-medium text-foreground" : "text-amber-600"}>
                      {d.esp32_device_id || "Not set — tap Edit"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </Card>
        ))}
        {!items.length && !pending && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No drones yet. Create a field first, then assign a drone to it.
          </Card>
        )}
      </div>
    </div>
  );
}