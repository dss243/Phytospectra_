import { LatLngTuple } from "leaflet";

export type StressClass = "healthy" | "mild" | "drought" | "disease" | "nutrient" | "moderate" | "severe";

export interface ZoneData {
  id: string;
  name: string;
  polygon: LatLngTuple[];
  health_score: number;
  stress_class: StressClass;
  confidence: number;
  gps: { lat: number; lng: number };
  drone_image_url: string;
  heatmap_url: string;
  timestamp: string;
}

const baseImg = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&auto=format&fit=crop";

export const MOCK_ZONES: ZoneData[] = [
  {
    id: "A1", name: "North Field",
    polygon: [[36.4845, 2.945], [36.4845, 2.951], [36.4820, 2.951], [36.4820, 2.945]],
    health_score: 88, stress_class: "healthy", confidence: 0.92,
    gps: { lat: 36.4832, lng: 2.948 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date().toISOString(),
  },
  {
    id: "A2", name: "South Plot",
    polygon: [[36.4795, 2.948], [36.4795, 2.956], [36.4770, 2.956], [36.4770, 2.948]],
    health_score: 62, stress_class: "mild", confidence: 0.81,
    gps: { lat: 36.4782, lng: 2.952 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "A3", name: "Zone A",
    polygon: [[36.4820, 2.940], [36.4820, 2.946], [36.4798, 2.946], [36.4798, 2.940]],
    health_score: 41, stress_class: "drought", confidence: 0.87,
    gps: { lat: 36.4810, lng: 2.943 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: "B1", name: "Zone B",
    polygon: [[36.4795, 2.957], [36.4795, 2.964], [36.4770, 2.964], [36.4770, 2.957]],
    health_score: 22, stress_class: "disease", confidence: 0.9,
    gps: { lat: 36.4782, lng: 2.960 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "E1", name: "East Block",
    polygon: [[36.4820, 2.957], [36.4820, 2.965], [36.4798, 2.965], [36.4798, 2.957]],
    health_score: 75, stress_class: "healthy", confidence: 0.85,
    gps: { lat: 36.4810, lng: 2.961 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 2400000).toISOString(),
  },
  {
    id: "W1", name: "West Strip",
    polygon: [[36.4845, 2.937], [36.4845, 2.944], [36.4820, 2.944], [36.4820, 2.937]],
    health_score: 55, stress_class: "mild", confidence: 0.78,
    gps: { lat: 36.4832, lng: 2.940 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 3000000).toISOString(),
  },
  {
    id: "C1", name: "Center Patch",
    polygon: [[36.4795, 2.940], [36.4795, 2.947], [36.4770, 2.947], [36.4770, 2.940]],
    health_score: 70, stress_class: "healthy", confidence: 0.83,
    gps: { lat: 36.4782, lng: 2.943 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "O1", name: "Orchard Row",
    polygon: [[36.4845, 2.952], [36.4845, 2.958], [36.4820, 2.958], [36.4820, 2.952]],
    health_score: 80, stress_class: "healthy", confidence: 0.89,
    gps: { lat: 36.4832, lng: 2.955 },
    drone_image_url: baseImg, heatmap_url: baseImg,
    timestamp: new Date(Date.now() - 4200000).toISOString(),
  },
];

export function healthLabel(score: number): { label: string; color: string; key: StressClass } {
  if (score >= 75) return { label: "Healthy", color: "hsl(var(--stress-healthy))", key: "healthy" };
  if (score >= 55) return { label: "Mild Stress", color: "hsl(var(--stress-mild))", key: "mild" };
  if (score >= 35) return { label: "Moderate", color: "hsl(var(--stress-moderate))", key: "moderate" };
  return { label: "Severe", color: "hsl(var(--stress-severe))", key: "severe" };
}

export function stressEmoji(s: StressClass): string {
  switch (s) {
    case "healthy": return "🌿";
    case "drought": return "💧";
    case "disease": return "🦠";
    case "nutrient": return "🧪";
    case "mild": return "⚠️";
    case "moderate": return "⚡";
    case "severe": return "🚨";
  }
}

export function stressLabel(s: StressClass): string {
  return ({
    healthy: "Healthy",
    drought: "Drought Stress",
    disease: "Disease Detected",
    nutrient: "Nutrient Deficiency",
    mild: "Mild Stress",
    moderate: "Moderate Stress",
    severe: "Severe Stress",
  } as Record<StressClass, string>)[s];
}

export const TRENDS = Array.from({ length: 14 }, (_, i) => ({
  date: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(5, 10),
  health: Math.round(60 + Math.sin(i / 2) * 12 + Math.random() * 8),
}));

export const STRESS_BREAKDOWN = Array.from({ length: 6 }, (_, i) => ({
  flight: `Flight ${i + 1}`,
  healthy: 30 + Math.round(Math.random() * 20),
  mild: 15 + Math.round(Math.random() * 15),
  moderate: 10 + Math.round(Math.random() * 10),
  severe: 2 + Math.round(Math.random() * 8),
}));