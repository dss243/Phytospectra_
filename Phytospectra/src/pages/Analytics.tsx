import { PageHeader } from "@/components/PageHeader";
import { TRENDS, STRESS_BREAKDOWN, MOCK_ZONES } from "@/lib/mockData";
import { BarChart3, LineChart, Sprout } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STRESS_COLORS = ["hsl(142 71% 45%)", "hsl(48 96% 53%)", "hsl(25 95% 53%)", "hsl(0 84% 60%)"];

export default function Analytics() {
  const dist = [
    { name: "Healthy", value: MOCK_ZONES.filter(z => z.health_score >= 75).length },
    { name: "Mild", value: MOCK_ZONES.filter(z => z.health_score >= 55 && z.health_score < 75).length },
    { name: "Moderate", value: MOCK_ZONES.filter(z => z.health_score >= 35 && z.health_score < 55).length },
    { name: "Severe", value: MOCK_ZONES.filter(z => z.health_score < 35).length },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Field Analytics" subtitle="Trends, comparisons and crop intelligence" gradient="gradient-analytics" icon={BarChart3} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
          <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
            <Sprout className="h-4 w-4 text-primary" /> Average Health Trend (14d)
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={TRENDS}>
              <defs>
                <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
              <Area type="monotone" dataKey="health" stroke="hsl(142 71% 37%)" strokeWidth={2.5} fill="url(#hg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5">
          <h3 className="font-display font-semibold mb-4">🥧 Current Zone Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={dist} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3}>
                {dist.map((_, i) => <Cell key={i} fill={STRESS_COLORS[i]} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-5 lg:col-span-2">
          <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
            <LineChart className="h-4 w-4 text-secondary" /> Stress Breakdown by Flight
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={STRESS_BREAKDOWN}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="flight" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
              <Legend />
              <Bar dataKey="healthy" stackId="a" fill="hsl(142 71% 45%)" />
              <Bar dataKey="mild" stackId="a" fill="hsl(48 96% 53%)" />
              <Bar dataKey="moderate" stackId="a" fill="hsl(25 95% 53%)" />
              <Bar dataKey="severe" stackId="a" fill="hsl(0 84% 60%)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}