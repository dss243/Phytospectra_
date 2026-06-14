import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";

export function KpiCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: ReactNode;
  icon: LucideIcon;
  tone: "green" | "red" | "blue" | "purple";
}) {
  const tones = {
    green: "from-primary/10 to-primary/5",
    red: "from-stress-severe/10 to-stress-moderate/5",
    blue: "from-primary/8 to-primary/4",
    purple: "from-primary/8 to-primary/4",
  } as const;

  return (
    <div className={`group app-card bg-gradient-to-br ${tones[tone]} p-5 transition-smooth hover:-translate-y-0.5 hover:shadow-card`}>
      <AppIcon icon={icon} variant="kpi" tone={tone} />
      <div className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-muted-foreground">{title}</div>
    </div>
  );
}
