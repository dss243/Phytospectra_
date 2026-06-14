import { Microscope, Sprout, MessageCircle } from "lucide-react";
import { IconBox } from "@/components/IconBox";
import { LandingCard } from "@/components/landing/LandingUI";

export function AgronomistWave({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <>
      <div className="relative flex items-center gap-3 sm:gap-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <IconBox icon={Sprout} accent="green" size="sm" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Farmer
          </span>
        </div>

        <div className="relative min-w-0 flex-1">
          <svg viewBox="0 0 240 48" className="h-11 w-full" aria-hidden preserveAspectRatio="none">
            <defs>
              <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="hsl(var(--logo-green))" stopOpacity="0.25" />
                <stop offset="50%" stopColor="hsl(var(--logo-green))" stopOpacity="0.7" />
                <stop offset="100%" stopColor="hsl(var(--logo-green))" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            <path
              d="M0 24 C40 8, 80 40, 120 24 S200 8, 240 24"
              fill="none"
              stroke="url(#waveGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="animate-wave-dash"
            />
            <path
              d="M0 30 C40 14, 80 46, 120 30 S200 14, 240 30"
              fill="none"
              stroke="url(#waveGrad)"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.45"
              className="animate-wave-dash-reverse"
            />
            <circle cx="120" cy="24" r="3.5" fill="hsl(var(--logo-green))" />
          </svg>
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/12 bg-white px-2.5 py-1 text-[10px] font-semibold text-primary shadow-soft">
              <MessageCircle className="h-3 w-3" strokeWidth={1.5} />
              Expert sync
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <IconBox icon={Microscope} accent="green" size="sm" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agronomist
          </span>
        </div>
      </div>

      <p className="relative mt-3 text-center text-xs text-muted-foreground">
        Farmers and agronomists, connected
      </p>
    </>
  );

  if (embedded) return content;

  return (
    <LandingCard padding="md" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--logo-green)/0.04),transparent_70%)]" />
      {content}
    </LandingCard>
  );
}
