import {
  AlertTriangle,
  Droplets,
  FlaskConical,
  LucideIcon,
  Siren,
  Sprout,
  Zap,
} from "lucide-react";
import { StressClass } from "@/lib/mockData";
import { cn } from "@/lib/utils";

const STRESS_ICONS: Record<StressClass, LucideIcon> = {
  healthy: Sprout,
  drought: Droplets,
  disease: FlaskConical,
  nutrient: FlaskConical,
  mild: AlertTriangle,
  moderate: Zap,
  severe: Siren,
};

const STRESS_COLORS: Record<StressClass, string> = {
  healthy: "text-stress-healthy",
  drought: "text-secondary",
  disease: "text-stress-moderate",
  nutrient: "text-[hsl(258_90%_56%)]",
  mild: "text-stress-mild",
  moderate: "text-stress-moderate",
  severe: "text-stress-severe",
};

export function StressClassIcon({
  stress,
  className,
}: {
  stress: StressClass;
  className?: string;
}) {
  const Icon = STRESS_ICONS[stress];
  return <Icon className={cn("h-4 w-4 shrink-0", STRESS_COLORS[stress], className)} strokeWidth={2} aria-hidden />;
}
