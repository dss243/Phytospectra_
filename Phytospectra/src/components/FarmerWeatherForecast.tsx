import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import type { WeatherForecastDay } from "@/lib/weather";
import { fetch7DayWeather } from "@/lib/weather";
import { CloudRain, Droplets, Wind, ThermometerSun, CloudSun } from "lucide-react";

// You can later wire this to the farmer's farm location (from DB/profile).
// For now, use a default lat/lon.
const DEFAULT_LAT = 36.75;
const DEFAULT_LON = 3.05;

function fmtMm(v: number | null) {
  if (v === null) return "-";
  return `${Math.round(v)} mm`;
}

function fmtC(v: number | null) {
  if (v === null) return "-";
  return `${Math.round(v)}°C`;
}

export function FarmerWeatherForecast() {
  const { role, loading } = useAuth();
  const [items, setItems] = useState<WeatherForecastDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canShow = !loading && role === "farmer";

  useEffect(() => {
    if (!canShow) return;

    const run = async () => {
      setPending(true);
      setError(null);
      try {
        const data = await fetch7DayWeather({ latitude: DEFAULT_LAT, longitude: DEFAULT_LON });
        setItems(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load weather";
        setError(msg);
      } finally {
        setPending(false);
      }
    };

    run();
  }, [canShow]);

  const next7 = useMemo(() => items.slice(0, 7), [items]);

  if (!canShow) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Weather next week" subtitle="Forecast for your farm area" gradient="gradient-live" icon={CloudSun}>
        {pending ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
      </PageHeader>

      {error ? (
        <div className="bg-card border border-border/40 rounded-2xl p-4 text-sm text-stress-severe">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        {next7.map((d) => (
          <div key={d.date} className="bg-card rounded-2xl border border-border/40 p-3">
            <div className="text-xs font-semibold opacity-80">{d.date.slice(5)}</div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <div className="flex flex-col">
                <div className="text-sm font-bold flex items-center gap-1">
                  <ThermometerSun className="h-4 w-4 text-primary" />
                  {fmtC(d.temperatureHighC)}
                </div>
                <div className="text-[11px] text-muted-foreground">Low: {fmtC(d.temperatureLowC)}</div>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <CloudRain className="h-4 w-4 text-amber" />
                {fmtMm(d.precipitationMm)}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Droplets className="h-4 w-4 text-blue" />
                Wind: {d.windSpeedKmh !== null ? `${Math.round(d.windSpeedKmh)} km/h` : "-"}
              </div>
            </div>

            <div className="mt-2 text-[11px] font-semibold text-emerald-600/90">{d.summary}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

