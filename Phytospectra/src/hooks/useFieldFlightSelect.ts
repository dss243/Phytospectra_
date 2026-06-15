/**
 * useFieldFlightSelect.ts
 * 
 * Shared hook that loads all fields + their flights and exposes
 * selected values + setter helpers. Use this in Flights, Images,
 * and any page that currently has raw UUID <Input> fields.
 *
 * Usage:
 *   const { fields, flights, selectedField, selectedFlight,
 *           setSelectedField, setSelectedFlight, pending, error } = useFieldFlightSelect();
 *
 * Then render <FieldFlightSelectors ... /> (see component below) instead of
 * raw UUID inputs.
 */

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getBackendBaseUrl, backendFetch } from "@/lib/backend";
import { Field, Flight } from "@/types/backend";

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export interface UseFieldFlightSelectReturn {
  fields: Field[];
  flights: Flight[];
  selectedField: Field | null;
  selectedFlight: Flight | null;
  setSelectedField: (field: Field | null) => void;
  setSelectedFlight: (flight: Flight | null) => void;
  /** Convenience ids */
  fieldId: string | null;
  flightId: string | null;
  pending: boolean;
  error: string | null;
  reloadFlights: (fieldId: string) => Promise<void>;
}

export function useFieldFlightSelect(
  initialFieldId?: string | null,
  initialFlightId?: string | null
): UseFieldFlightSelectReturn {
  const { user, loading } = useAuth();
  const backendBaseUrl = getBackendBaseUrl();

  const [fields, setFields] = useState<Field[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlights = useCallback(
    async (fieldId: string) => {
      if (!fieldId) { setFlights([]); return; }
      setPending(true);
      try {
        const token = await getToken();
        const res = await fetch(
          `${backendBaseUrl}/api/flights?field_id=${fieldId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Flight[];
        setFlights(data);
        // If there was a pre-selected flight, try to restore it
        if (initialFlightId) {
          const match = data.find((f) => f.id === initialFlightId);
          if (match) setSelectedFlight(match);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load flights");
      } finally {
        setPending(false);
      }
    },
    [backendBaseUrl, initialFlightId]
  );

  // Load fields on mount
  useEffect(() => {
    if (loading || !user) return;
    let active = true;

    (async () => {
      setPending(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await backendFetch(`/api/fields`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Field[];
        if (!active) return;
        setFields(data);

        // Auto-select: prefer initialFieldId, else first field
        const toSelect =
          (initialFieldId && data.find((f) => f.id === initialFieldId)) ||
          data[0] ||
          null;
        setSelectedField(toSelect);
        if (toSelect) await loadFlights(toSelect.id);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load fields");
      } finally {
        if (active) setPending(false);
      }
    })();

    return () => { active = false; };
  }, [loading, user, backendBaseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // When field changes, reload flights
  const handleSetField = useCallback(
    (field: Field | null) => {
      setSelectedField(field);
      setSelectedFlight(null);
      setFlights([]);
      if (field) loadFlights(field.id);
    },
    [loadFlights]
  );

  return {
    fields,
    flights,
    selectedField,
    selectedFlight,
    setSelectedField: handleSetField,
    setSelectedFlight,
    fieldId: selectedField?.id ?? null,
    flightId: selectedFlight?.id ?? null,
    pending,
    error,
    reloadFlights: loadFlights,
  };
}
