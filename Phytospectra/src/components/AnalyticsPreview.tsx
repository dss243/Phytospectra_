import { BarChart3, Cloud } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LandingCard } from "@/components/landing/LandingUI";

const HEALTH_TREND = [
  { day: "Mon", health: 74 },
  { day: "Tue", health: 78 },
  { day: "Wed", health: 71 },
  { day: "Thu", health: 85 },
  { day: "Fri", health: 79 },
  { day: "Sat", health: 82 },
  { day: "Sun", health: 88 },
];

export function AnalyticsPreview() {
  return (
    <LandingCard padding="lg" className="relative h-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="label-caps">Cloud flight · Field health</p>
          <p className="font-display mt-1 text-3xl font-bold text-foreground">
            82<span className="text-lg text-muted-foreground">/100</span>
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <BarChart3 className="h-5 w-5 text-primary" strokeWidth={1.5} />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
        <Cloud className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.5} />
        <span>
          <span className="font-medium text-foreground">Auto-synced</span> from your last drone flight
        </span>
      </div>

      <div className="h-40 w-full rounded-xl border border-border/30 bg-muted/20 px-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={HEALTH_TREND} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[60, 100]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--primary) / 0.06)" }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(value: number) => [`${value}/100`, "Health"]}
            />
            <Bar
              dataKey="health"
              fill="hsl(var(--primary))"
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border/40 pt-5">
        {[
          { label: "Zones", value: "12" },
          { label: "Alerts", value: "3" },
          { label: "Flights", value: "18" },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-display text-lg font-bold text-foreground">{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </LandingCard>
  );
}
