import { HERO_PILLS } from "@/lib/appFeatures";

export function HeroPills() {
  return (
    <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
      {HERO_PILLS.map((label) => (
        <span
          key={label}
          className="rounded-full border border-border/50 bg-white/80 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-soft"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
