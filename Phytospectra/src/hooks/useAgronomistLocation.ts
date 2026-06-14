import { useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { getBackendBaseUrl } from "@/lib/backend";

const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export function useAgronomistLocation() {
  const { session, role } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRunRef   = useRef(false);

  const pushLocation = useCallback(async (lat: number, lng: number) => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${getBackendBaseUrl()}/api/profile/location`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error(await res.text());
      console.info("[location] pushed %.6f, %.6f", lat, lng);
    } catch (err) {
      console.warn("[location] push failed:", err);
    }
  }, [session?.access_token]);

  const fetchAndPush = useCallback(() => {
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!navigator.geolocation) {
      console.warn("[location] Geolocation not supported");
      return;
    }

    if (!isSecure) {
      // Dev fallback when accessing via local network IP
      if (import.meta.env.DEV) {
        console.warn("[location] Not secure origin — using dev fallback coordinates");
        pushLocation(36.7538, 3.0588); // Algiers — replace with your real coords
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => pushLocation(pos.coords.latitude, pos.coords.longitude),
      (err) => console.warn("[location] Geolocation error:", err.message),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, [pushLocation]);

  useEffect(() => {
    if (role !== "agronomist" || !session?.access_token) return;

    if (!hasRunRef.current) {
      fetchAndPush();
      hasRunRef.current = true;
    }

    intervalRef.current = setInterval(fetchAndPush, UPDATE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      hasRunRef.current = false;
    };
  }, [role, session?.access_token, fetchAndPush]);
}