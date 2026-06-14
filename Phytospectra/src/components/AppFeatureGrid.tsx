import { CORE_FEATURES } from "@/lib/appFeatures";
import { IconBox } from "@/components/IconBox";
import { LandingCard } from "@/components/landing/LandingUI";

export function AppFeatureGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CORE_FEATURES.map(({ icon, label, desc, accent }) => (
        <LandingCard key={label} hover padding="md" className="flex items-start gap-4">
          <IconBox icon={icon} accent={accent} size="sm" />
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          </div>
        </LandingCard>
      ))}
    </div>
  );
}
