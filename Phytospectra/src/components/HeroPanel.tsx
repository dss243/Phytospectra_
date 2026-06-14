import logo from "@/assets/phytospectra-logo.jpg";
import { AgronomistWave } from "@/components/AgronomistWave";

export function HeroPanel() {
  return (
    <div
      className="animate-fade-up w-full lg:max-w-[440px] lg:justify-self-end lg:pt-4"
      style={{ animationDelay: "0.12s" }}
    >
      <div className="rounded-2xl border border-border/40 bg-white p-8 shadow-soft">
        <div className="flex justify-center">
          <img
            src={logo}
            alt="Phytospectra"
            className="w-full max-w-[280px] object-contain sm:max-w-[320px]"
          />
        </div>

        <div className="mt-6 border-t border-border/40 pt-6">
          <AgronomistWave embedded />
        </div>
      </div>
    </div>
  );
}
