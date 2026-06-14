import logo from "@/assets/phytospectra-logo.jpg";
import { cn } from "@/lib/utils";

const SIZES = {
  nav: { shell: "h-10 w-10 rounded-xl p-1", img: "h-full w-full rounded-lg" },
  sm: { shell: "h-12 w-12 rounded-xl p-1", img: "h-full w-full rounded-lg" },
  md: { shell: "h-[4.5rem] w-[4.5rem] rounded-2xl p-1.5", img: "h-full w-full rounded-xl" },
  lg: { shell: "h-28 w-28 rounded-2xl p-2", img: "h-full w-full rounded-xl" },
  xl: { shell: "h-32 w-32 rounded-3xl p-2", img: "h-full w-full rounded-2xl" },
  hero: { shell: "h-36 w-36 rounded-3xl p-2.5 sm:h-40 sm:w-40", img: "h-full w-full rounded-2xl" },
};

export function Logo({
  className,
  size = "md",
  glow = false,
  variant = "default",
}: {
  className?: string;
  size?: keyof typeof SIZES;
  glow?: boolean;
  variant?: "default" | "flat";
}) {
  const s = SIZES[size];
  const isFlat = variant === "flat";

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-white",
        s.shell,
        isFlat
          ? "shadow-soft ring-1 ring-primary/15"
          : "shadow-elevated ring-[3px] ring-primary/30",
        glow && !isFlat && "shadow-glow ring-primary/50 ring-offset-2 ring-offset-white",
        className,
      )}
    >
      <img src={logo} alt="Phytospectra" className={cn(s.img, "object-contain")} />
    </div>
  );
}
