import { useState } from "react";
import { X, Download, FolderOpen, Camera, Thermometer } from "lucide-react";
import { ZoneData, healthLabel, stressLabel } from "@/lib/mockData";
import { StressClassIcon } from "@/components/StressClassIcon";

export function ZoneDetailPanel({ zone, onClose }: { zone: ZoneData | null; onClose: () => void }) {
  const [tab, setTab] = useState<"photo" | "heat">("photo");
  if (!zone) return null;
  const h = healthLabel(zone.health_score);
  return (
    <>
      <div className="absolute inset-0 bg-black/40 z-[1000] backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full md:w-[400px] bg-card z-[1001] shadow-card animate-slide-in-right overflow-y-auto">
        <div className="p-5 border-b border-border/50 flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl font-bold">{zone.name}</h3>
            <span className="inline-block mt-2 text-xs px-2.5 py-1 rounded-full text-white font-semibold" style={{ background: h.color }}>{h.label}</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 pt-4 flex gap-2">
          {([
            { key: "photo" as const, label: "Drone Photo", icon: Camera },
            { key: "heat" as const, label: "Heat Analysis", icon: Thermometer },
          ]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-smooth flex items-center justify-center gap-1.5 ${tab === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="p-5">
          <div className="aspect-video rounded-xl overflow-hidden relative" style={{
            background: tab === "photo"
              ? "linear-gradient(135deg, hsl(25 95% 53%), hsl(280 50% 40%), hsl(142 71% 45%))"
              : `linear-gradient(135deg, ${h.color}, hsl(258 90% 66%))`,
          }} />
          <div className="mt-5 text-center">
            <div className="font-display text-5xl font-bold" style={{ color: h.color }}>{zone.health_score}<span className="text-lg text-muted-foreground">/100</span></div>
            <div className="mt-2 text-sm font-semibold flex items-center justify-center gap-2">
              <StressClassIcon stress={zone.stress_class} />
              {stressLabel(zone.stress_class)}
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Confidence</span><span>{Math.round(zone.confidence * 100)}%</span></div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-smooth" style={{ width: `${zone.confidence * 100}%`, background: `linear-gradient(90deg, ${h.color}, hsl(var(--primary-glow)))` }} />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
            <div className="bg-muted/40 rounded-xl p-3"><div className="text-muted-foreground">GPS</div><div className="font-mono mt-1">{zone.gps.lat.toFixed(4)}, {zone.gps.lng.toFixed(4)}</div></div>
            <div className="bg-muted/40 rounded-xl p-3"><div className="text-muted-foreground">Captured</div><div className="mt-1">{new Date(zone.timestamp).toLocaleTimeString()}</div></div>
          </div>
          <div className="mt-5 space-y-2">
            <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"><Download className="h-4 w-4" /> Download Image</button>
            <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm font-semibold"><FolderOpen className="h-4 w-4" /> View Full History</button>
          </div>
        </div>
      </div>
    </>
  );
}
