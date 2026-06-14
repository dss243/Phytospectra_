export type WeatherForecastDay = {
  date: string; // YYYY-MM-DD
  temperatureHighC: number | null;
  temperatureLowC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  summary: string;
};

// Open-Meteo example helper
// Uses geocoded lat/lon only; you can replace with your API.
export async function fetch7DayWeather(opts: {
  latitude: number;
  longitude: number;
}): Promise<WeatherForecastDay[]> {
  const { latitude, longitude } = opts;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Weather request failed: ${res.status}`);
  }

  const json = await res.json();

  const days: string[] = json?.daily?.time ?? [];
  const tMax: number[] = json?.daily?.temperature_2m_max ?? [];
  const tMin: number[] = json?.daily?.temperature_2m_min ?? [];
  const pSum: number[] = json?.daily?.precipitation_sum ?? [];
  const wMax: number[] = json?.daily?.wind_speed_10m_max ?? [];

  const len = days.length;

  const out: WeatherForecastDay[] = [];
  for (let i = 0; i < len; i++) {
    const high = typeof tMax[i] === "number" ? tMax[i] : null;
    const low = typeof tMin[i] === "number" ? tMin[i] : null;
    const precip = typeof pSum[i] === "number" ? pSum[i] : null;
    const wind = typeof wMax[i] === "number" ? wMax[i] : null;

    // Very simple summary
    let summary = "";
    if (precip !== null && precip >= 10) summary = "Rainy";
    else if (precip !== null && precip >= 2) summary = "Light rain possible";
    else summary = "Dry";

    out.push({
      date: days[i],
      temperatureHighC: high,
      temperatureLowC: low,
      precipitationMm: precip,
      windSpeedKmh: wind,
      summary,
    });
  }

  return out;
}

