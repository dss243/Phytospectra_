import type { ReactNode } from "react";
import { ArrowRight, Bot, Cloud, Plane } from "lucide-react";
import { LandingCard } from "@/components/landing/LandingUI";

function CloudSyncPreview() {
  return (
    <div className="flex h-full min-h-[100px] flex-col justify-center rounded-xl border border-border/50 bg-muted/20 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
          <Plane className="h-5 w-5 text-primary" strokeWidth={1.5} />
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Cloud className="h-5 w-5 text-primary" strokeWidth={1.5} />
        </div>
      </div>
      <p className="mt-3 text-xs font-semibold text-foreground">Flight synced to cloud</p>
      <p className="mt-1 text-[10px] text-muted-foreground">field_scan_042.tif · auto-ingested</p>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Ready for analysis
      </div>
    </div>
  );
}

function MapPreview() {
  const cells = [
    "bg-primary/70",
    "bg-primary/55",
    "bg-primary/40",
    "bg-primary/60",
    "bg-amber-400/70",
    "bg-primary/50",
    "bg-primary/45",
    "bg-primary/65",
    "bg-primary/55",
  ];
  return (
    <div className="flex h-full min-h-[100px] flex-col rounded-xl border border-border/50 bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span>Segmentation map</span>
        <span className="text-primary">12 zones</span>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1.5">
        {cells.map((color, i) => (
          <div key={i} className={`rounded-md ${color}`} />
        ))}
      </div>
    </div>
  );
}

function ExpertPreview() {
  return (
    <div className="flex h-full min-h-[100px] flex-col justify-end gap-2 rounded-xl border border-border/50 bg-muted/20 p-3">
      <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[10px] leading-relaxed text-primary-foreground">
        Zone B shows low NDVI. Possible nitrogen stress.
      </div>
      <div className="flex max-w-[92%] items-start gap-2 rounded-2xl rounded-bl-md border border-border/40 bg-white px-3 py-2 shadow-soft">
        <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.5} />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Recommend soil test + split nitrogen application this week.
        </p>
      </div>
    </div>
  );
}

function StepColumn({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 font-display text-xs font-bold text-primary">
          {step}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

function StepArrow() {
  return (
    <div className="hidden items-center justify-center pt-8 text-primary/30 md:flex">
      <ArrowRight className="h-5 w-5" strokeWidth={1.5} />
    </div>
  );
}

/** Static three-panel workflow preview */
export function WorkflowShowcase() {
  return (
    <LandingCard padding="lg" className="mb-8 overflow-hidden">
      <div className="mb-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
        <Cloud className="h-3.5 w-3.5" strokeWidth={1.5} />
        Cloud-powered workflow
      </div>

      <div className="hidden md:grid md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-start md:gap-3">
        <StepColumn step="1" title="Fly & cloud sync">
          <CloudSyncPreview />
        </StepColumn>
        <StepArrow />
        <StepColumn step="2" title="Review maps">
          <MapPreview />
        </StepColumn>
        <StepArrow />
        <StepColumn step="3" title="Act on insights">
          <ExpertPreview />
        </StepColumn>
      </div>

      <div className="flex flex-col gap-6 md:hidden">
        <StepColumn step="1" title="Fly & cloud sync">
          <CloudSyncPreview />
        </StepColumn>
        <StepColumn step="2" title="Review maps">
          <MapPreview />
        </StepColumn>
        <StepColumn step="3" title="Act on insights">
          <ExpertPreview />
        </StepColumn>
      </div>
    </LandingCard>
  );
}
