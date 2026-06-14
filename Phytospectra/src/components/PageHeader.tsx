import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { IconBox } from "@/components/IconBox";

export function PageHeader({
  title,
  subtitle,
  icon,
  children,
  eyebrow,
  gradient: _gradient,
}: {
  title: string;
  subtitle?: string;
  gradient?: string;
  icon?: LucideIcon;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {icon && <IconBox icon={icon} accent="green" size="md" />}
        <div>
          {eyebrow && <p className="label-caps mb-2 text-primary">{eyebrow}</p>}
          <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
