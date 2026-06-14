import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENTS = {
  green: "from-primary/35 via-primary/20 to-primary/30",
  muted: "from-border via-muted to-border",
  slate: "from-slate-300/40 via-slate-200/25 to-slate-300/35",
  white: "from-white/30 via-white/15 to-white/5",
  emerald: "from-primary/35 via-primary/20 to-primary/30",
  sky: "from-primary/35 via-primary/20 to-primary/30",
  amber: "from-primary/35 via-primary/20 to-primary/30",
  violet: "from-primary/35 via-primary/20 to-primary/30",
} as const;

export function IconBox({
  icon: Icon,
  accent = "green",
  size = "md",
  className,
  dark = false,
}: {
  icon: LucideIcon;
  accent?: keyof typeof ACCENTS;
  size?: "sm" | "md" | "lg";
  className?: string;
  dark?: boolean;
}) {
  const dims = { sm: "h-10 w-10 rounded-xl", md: "h-14 w-14 rounded-2xl", lg: "h-16 w-16 rounded-2xl" }[size];
  const iconDims = { sm: "h-[18px] w-[18px]", md: "h-6 w-6", lg: "h-7 w-7" }[size];

  return (
    <div className={cn("relative shrink-0 p-px bg-gradient-to-br", ACCENTS[accent], dims, className)}>
      <div
        className={cn(
          "flex h-full w-full items-center justify-center",
          size === "sm" ? "rounded-[11px]" : "rounded-[15px]",
          dark ? "bg-[hsl(var(--logo-green))]" : "bg-card",
        )}
      >
        <Icon
          className={cn(iconDims, dark ? "text-primary-foreground/90" : "text-foreground/80")}
          strokeWidth={1.5}
          aria-hidden
        />
      </div>
    </div>
  );
}
