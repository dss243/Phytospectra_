import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";

/** Pan the map when center/zoom changes (e.g. after geolocation). */
export function MapSetView({
  center,
  zoom,
}: {
  center: LatLngTuple;
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [map, center, zoom]);
  return null;
}

export function requestUserMapCenter(
  onSuccess: (lat: number, lng: number) => void,
  onError?: (message: string) => void,
) {
  if (!navigator.geolocation) {
    onError?.("Geolocation not supported in this browser");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
    (err) => onError?.(err.message),
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
  );
}
