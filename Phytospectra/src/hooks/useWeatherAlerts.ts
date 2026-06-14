import { useEffect } from "react";
import { notificationStore } from "@/stores/notificationStore";
import type { WeatherForecastDay } from "@/lib/weather";

type WeatherAlert = {
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
};

function buildAlertsFromWeather(days: WeatherForecastDay[]): WeatherAlert[] {
  const first = days?.[0];
  if (!first) return [];

  const alerts: WeatherAlert[] = [];

  const wind = first.windSpeedKmh;
  if (wind !== null && wind !== undefined) {
    if (wind >= 45) {
      alerts.push({
        severity: "critical",
        title: "Strong wind",
        message: "Drone flight is not recommended due to high wind speed.",
      });
    } else if (wind >= 25) {
      alerts.push({
        severity: "warning",
        title: "Breezy conditions",
        message: "High wind may reduce image stability and analysis quality.",
      });
    }
  }

  const precip = first.precipitationMm;
  if (precip !== null && precip >= 8) {
    alerts.push({
      severity: "critical",
      title: "Rain risk",
      message: "Avoid drone operation because rain may damage the drone and multispectral camera.",
    });
  }

  // cloud percentage isn't present in current WeatherForecastDay type yet,
  // so we infer from summary keyword.
  const summary = `${first.summary}`.toLowerCase();
  if (summary.includes("cloud") || summary.includes("overcast")) {
    alerts.push({
      severity: "warning",
      title: "Low sunlight",
      message: "Low sunlight conditions may reduce multispectral analysis quality.",
    });
  }

  const hi = first.temperatureHighC;
  if (hi !== null && hi >= 38) {
    alerts.push({
      severity: "critical",
      title: "Extreme heat",
      message: "High temperature may affect drone battery performance.",
    });
  }

  return alerts;
}

const dedupeSeen = new Set<string>();

function alertKey(day0: WeatherForecastDay | undefined, a: WeatherAlert) {
  const d = day0?.date ?? "no-date";
  return `${d}|${a.severity}|${a.title}|${a.message}`;
}

export function useWeatherAlerts(days: WeatherForecastDay[]) {
  const add = notificationStore.add;

  useEffect(() => {
    const day0 = days?.[0];
    const alerts = buildAlertsFromWeather(days);

    for (const a of alerts) {
      const key = alertKey(day0, a);
      if (dedupeSeen.has(key)) continue;
      dedupeSeen.add(key);

      add({
        title: a.title,
        message: a.message,
        severity: a.severity,
        createdAt: new Date().toISOString(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
}

