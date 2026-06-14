import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LandingBadge({
  children,
  className,
  dot = false,
}: {
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-primary/12 bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary shadow-soft backdrop-blur-sm",
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      {children}
    </span>
  );
}

export function LandingSectionHeader({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-12 max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      {eyebrow && <p className="label-caps mb-3 text-primary">{eyebrow}</p>}
      <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export function LandingCard({
  children,
  className,
  hover = false,
  padding = "md",
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "sm" | "md" | "lg";
}) {
  const pad = { sm: "p-4", md: "p-5", lg: "p-8" }[padding];
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 bg-white/85 shadow-soft backdrop-blur-sm",
        pad,
        hover &&
          "transition-smooth hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LandingShell({
  children,
  className,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-border/40 bg-white/90 p-8 shadow-card backdrop-blur-sm lg:p-10",
        className,
      )}
    >
      {glow && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--logo-green)/0.05),transparent_55%)]" />
      )}
      {children}
    </div>
  );
}

export function LandingSection({
  id,
  children,
  className,
  alt = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  alt?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-20 px-4 sm:px-6 lg:px-8",
        alt ? "border-y border-border/40 bg-white/60 backdrop-blur-sm" : "",
        className,
      )}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}
