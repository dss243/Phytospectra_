/** Light animated backdrop — shared by landing and app shell */
export function AppBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="animate-drift-a absolute -top-40 left-1/2 h-[520px] w-[780px] -translate-x-1/2 rounded-full bg-primary/[0.06] blur-[110px]" />
      <div className="landing-scan-sweep" />
      <svg
        className="absolute left-0 top-[14%] h-[50%] w-full opacity-[0.14]"
        viewBox="0 0 1440 600"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M-40 420 C200 280, 420 180, 720 220 S1240 380, 1480 260"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeDasharray="8 14"
          className="animate-flight-path"
        />
      </svg>
      <div className="landing-field-dots absolute inset-0" />
    </div>
  );
}

export const LandingBackground = AppBackground;
