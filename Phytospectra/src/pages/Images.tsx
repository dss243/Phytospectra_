import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ImageRow } from "@/types/backend";
import { getBackendBaseUrl, backendFetch } from "@/lib/backend";

function getTokenFromSession() {
  return supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing session access token");
    return token;
  });
}

export default function Images() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<ImageRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fieldId, setFieldId] = useState<string>("");
  const [flightId, setFlightId] = useState<string>("");

  const backendBaseUrl = getBackendBaseUrl();

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (fieldId.trim()) params.set("field_id", fieldId.trim());
    if (flightId.trim()) params.set("flight_id", flightId.trim());
    return `${backendBaseUrl}/api/images?${params.toString()}`;
  }, [backendBaseUrl, fieldId, flightId]);

  const refresh = async () => {
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await fetch(queryUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ImageRow[];
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load images");
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, queryUrl]);

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this image row?")) return;
    setPending(true);
    setError(null);
    try {
      const token = await getTokenFromSession();
      const res = await backendFetch(`/api/images/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete image");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Images" subtitle="Browse uploaded/analyzed images" gradient="gradient-gallery" icon={ImageIcon} />

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Field ID (optional)</Label>
            <Input value={fieldId} onChange={(e) => setFieldId(e.target.value)} placeholder="field uuid" />
          </div>
          <div className="space-y-2">
            <Label>Flight ID (optional)</Label>
            <Input value={flightId} onChange={(e) => setFlightId(e.target.value)} placeholder="flight uuid" />
          </div>
          <div className="flex items-end">
            <Button onClick={() => refresh()} disabled={pending}>
              {pending ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="rounded-xl border border-stress-severe/30 bg-stress-severe/10 text-stress-severe px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((img) => (
          <Card key={img.id} className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">Image ID: {img.id}</div>
                <div className="text-xs text-muted-foreground">Storage: {img.storage_path || "—"}</div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => onDelete(img.id)} disabled={pending}>
                Delete
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Field: {img.field_id || "—"} · Flight: {img.flight_id || "—"} · Drone: {img.drone_id || "—"}
            </div>
          </Card>
        ))}

        {!items.length && !pending ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">No images found.</Card>
        ) : null}
      </div>
    </div>
  );
}

