import { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { Sprout } from "lucide-react";
import { ZoneData, healthLabel } from "@/lib/mockData";

const droneIcon = L.divIcon({
  className: "",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:hsl(152 65% 38%);box-shadow:0 2px 8px rgba(0,0,0,0.25);">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12v9"/><path d="M4.5 9.5 12 12l7.5-2.5"/><path d="M12 12 9.5 4.5 12 12l2.5-7.5"/><path d="M12 12 4.5 14.5 12 12l7.5 2.5"/></svg>
  </div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
});

function MapLegend() {
  const items = [
    { c: "hsl(142 71% 45%)", l: "Healthy" },
    { c: "hsl(48 96% 53%)", l: "Mild Stress" },
    { c: "hsl(25 95% 53%)", l: "Moderate" },
    { c: "hsl(0 84% 60%)", l: "Severe" },
  ];
  return (
    <div className="absolute bottom-3 right-3 z-[400] bg-white/95 backdrop-blur rounded-xl shadow-card p-3 text-xs space-y-1.5">
      <div className="font-semibold mb-1 flex items-center gap-1.5">
        <Sprout className="h-3.5 w-3.5 text-primary" /> Health Legend
      </div>
      {items.map(i => (
        <div key={i.l} className="flex items-center gap-2">
          <span className="h-3 w-3 rounded" style={{ background: i.c }} /> {i.l}
        </div>
      ))}
    </div>
  );
}

function Resize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export function FieldMap({
  zones, onZoneClick, dronePos,
}: { zones: ZoneData[]; onZoneClick: (z: ZoneData) => void; dronePos: [number, number] }) {
  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-card border border-border/40">
      <MapContainer center={[36.48, 2.95]} zoom={14} className="h-full w-full" zoomControl={false}>
        <Resize />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles © Esri"
          maxZoom={19}
        />
        {zones.map(z => {
          const h = healthLabel(z.health_score);
          return (
            <Polygon
              key={z.id}
              positions={z.polygon}
              pathOptions={{ color: h.color, fillColor: h.color, fillOpacity: 0.35, weight: 2 }}
              eventHandlers={{ click: () => onZoneClick(z) }}
            >
              <Tooltip sticky>
                <strong>{z.name}</strong> — {h.label} ({z.health_score}/100)
              </Tooltip>
            </Polygon>
          );
        })}
        <Marker position={dronePos} icon={droneIcon} />
      </MapContainer>
      <MapLegend />
    </div>
  );
}