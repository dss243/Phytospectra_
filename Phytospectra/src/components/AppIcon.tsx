import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AppIconVariant = "sidebar" | "kpi" | "header" | "badge" | "inline";

const kpiToneClass = {
  green: "from-primary/35 via-primary/20 to-primary/25 text-primary",
  red: "from-stress-severe/35 via-stress-moderate/20 to-stress-severe/25 text-stress-severe",
  blue: "from-primary/30 via-primary/15 to-primary/20 text-primary",
  purple: "from-primary/25 via-primary/12 to-primary/18 text-primary",
} as const;

const kpiInnerClass = {
  green: "bg-primary/8",
  red: "bg-stress-severe/8",
  blue: "bg-primary/6",
  purple: "bg-primary/6",
} as const;

export function AppIcon({
  icon: Icon,
  variant = "inline",
  tone,
  active = false,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  variant?: AppIconVariant;
  tone?: keyof typeof kpiToneClass;
  active?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  if (variant === "inline") {
    return <Icon className={cn("h-4 w-4", iconClassName)} strokeWidth={1.5} aria-hidden />;
  }

  if (variant === "kpi" && tone) {
    return (
      <div className={cn("relative h-11 w-11 shrink-0 rounded-2xl p-px bg-gradient-to-br", kpiToneClass[tone], className)}>
        <div className={cn("flex h-full w-full items-center justify-center rounded-[15px]", kpiInnerClass[tone])}>
          <Icon className={cn("h-5 w-5", kpiToneClass[tone].split(" ").slice(-1), iconClassName)} strokeWidth={1.5} />
        </div>
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <span
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl p-px transition-smooth",
          active
            ? "bg-gradient-to-br from-white/35 to-white/10"
            : "bg-gradient-to-br from-white/25 to-white/5 group-hover:from-white/35",
          className,
        )}
        aria-hidden
      >
        <span className={cn("flex h-full w-full items-center justify-center rounded-[11px]", active ? "bg-white/15" : "bg-white/10")}>
          <Icon className={cn("h-[18px] w-[18px] text-white/90", iconClassName)} strokeWidth={1.5} />
        </span>
      </span>
    );
  }

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-white/80",
          className,
        )}
        aria-hidden
      >
        <Icon className={cn("h-[18px] w-[18px] text-primary", iconClassName)} strokeWidth={1.5} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-primary/8 sm:flex",
        className,
      )}
      aria-hidden
    >
      <Icon className={cn("h-6 w-6 text-primary", iconClassName)} strokeWidth={1.5} />
    </span>
  );
}
