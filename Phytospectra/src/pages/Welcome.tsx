import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Camera,
  Images,
  Inbox,
  MessageSquare,
  Radio,
  Satellite,
  Sprout,
  BellRing,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

type GuideStep = {
  step: number;
  title: string;
  body: string;
  tips: string[];
  to: string;
  linkLabel: string;
  icon: LucideIcon;
};

const FARMER_GUIDE: GuideStep[] = [
  {
    step: 1,
    title: "Add your fields",
    body: "Start by creating the fields you monitor. Draw the boundary on the map, set the crop type, and save GPS coordinates for weather and flight planning.",
    tips: ["Go to Fields and click Add field", "Draw the polygon on the map or enter coordinates", "One field can have one assigned drone"],
    to: "/fields",
    linkLabel: "Open Fields",
    icon: Sprout,
  },
  {
    step: 2,
    title: "Register your drone",
    body: "Link each drone to a field. Add the model, multispectral camera, and ESP32 device ID if you use automated sync.",
    tips: ["Open Drones from the sidebar", "Assign exactly one drone per field", "Edit later if you swap hardware"],
    to: "/drones",
    linkLabel: "Open Drones",
    icon: Radio,
  },
  {
    step: 3,
    title: "Plan and log a flight",
    body: "Create a flight for a field before you fly. Phytospectra checks weather at the field location so you know if conditions are safe.",
    tips: ["Pick the field and assigned drone", "Review weather warnings before takeoff", "After landing, imagery syncs to the cloud automatically"],
    to: "/flights",
    linkLabel: "Open Flights",
    icon: Satellite,
  },
  {
    step: 4,
    title: "Review analytics and maps",
    body: "Open Field Analytics to see health trends, zone distribution, and stress breakdown from your synced flights. Browse the Image Gallery for raw captures.",
    tips: ["Charts update when new flights sync", "Compare flights over time", "Open segmentations from a flight for detailed masks"],
    to: "/analytics",
    linkLabel: "Open Analytics",
    icon: BarChart3,
  },
  {
    step: 5,
    title: "Watch stress alerts",
    body: "When the system detects stressed zones, alerts appear in Stress Alerts and the bell icon in the top bar. Act on severe zones first.",
    tips: ["Red badges on the sidebar show unread alerts", "Each alert links to the affected zone", "Clear notifications after you review them"],
    to: "/alerts",
    linkLabel: "Open Alerts",
    icon: BellRing,
  },
  {
    step: 6,
    title: "Get help when you need it",
    body: "Use the AI Assistant for quick crop questions, or Ask an Expert to message an agronomist with context from your field data.",
    tips: ["AI works best with specific field or crop questions", "Expert chat keeps your conversation history", "Use Upload & Analyze (+ on sidebar) for leaf camera scans"],
    to: "/chat",
    linkLabel: "Open AI Assistant",
    icon: Bot,
  },
];

const FARMER_EXTRA = [
  {
    title: "Leaf camera scan",
    body: "Connect your MAPIR camera in Windows, then use Upload & Analyze for a quick stress check without a full drone flight.",
    to: "/farmer-analyze",
    linkLabel: "Upload & Analyze",
    icon: Camera,
  },
  {
    title: "Image gallery",
    body: "Browse all synced multispectral images by field and flight. Useful for comparing captures side by side.",
    to: "/gallery",
    linkLabel: "Open Gallery",
    icon: Images,
  },
];

const AGRO_GUIDE: GuideStep[] = [
  {
    step: 1,
    title: "Check farmer requests",
    body: "Farmers send questions from Ask an Expert. Your desk lists open requests with field context so you can prioritize urgent cases.",
    tips: ["Unread requests show a dot on the sidebar", "Open a thread to read history and reply", "Location sync helps match you with nearby farms"],
    to: "/expert-desk",
    linkLabel: "Open Farmer Requests",
    icon: Inbox,
  },
  {
    step: 2,
    title: "Monitor stress alerts",
    body: "Stress Alerts show field events across farms you support. Use them to spot patterns and reach out before farmers ask.",
    tips: ["Severe alerts need the fastest response", "Cross-check with the farmer's latest flight analytics", "Bell icon shows live notifications"],
    to: "/alerts",
    linkLabel: "Open Alerts",
    icon: BellRing,
  },
  {
    step: 3,
    title: "Reply with clear advice",
    body: "Keep replies practical: name the likely cause, suggest a field action, and mention if a follow-up flight would help confirm.",
    tips: ["Reference zone IDs when available", "Note weather or timing constraints", "Mark resolved threads when done"],
    to: "/expert-desk",
    linkLabel: "Back to desk",
    icon: MessageSquare,
  },
];

function greetingName(displayName: string | null | undefined, email: string | undefined) {
  if (displayName?.trim()) return displayName.trim();
  if (email) return email.split("@")[0];
  return "there";
}

function GuideStepCard({ step, title, body, tips, to, linkLabel, icon: Icon, index }: GuideStep & { index: number }) {
  return (
      <article
      className="group app-card flex gap-5 p-5 transition-smooth hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-card md:p-6 animate-fade-up"
      style={{ animationDelay: `${0.12 + index * 0.07}s` }}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-display text-lg font-bold text-primary ring-1 ring-primary/15 transition-spring group-hover:scale-105">
        {step}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 transition-smooth group-hover:bg-primary/12">
              <Icon className="h-5 w-5 text-primary transition-smooth group-hover:scale-110" strokeWidth={1.5} />
            </span>
            <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
          </div>
          <Link to={to} className="group/link">
            <Button size="sm" variant="outline" className="rounded-xl border-border/60 bg-white transition-smooth group-hover/link:border-primary/30 group-hover/link:shadow-soft">
              {linkLabel}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
            </Button>
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        <ul className="space-y-1.5 border-t border-border/40 pt-3">
          {tips.map((tip, tipIndex) => (
            <li
              key={tip}
              className="flex gap-2 text-sm text-foreground/90 animate-fade-up"
              style={{ animationDelay: `${0.2 + index * 0.07 + tipIndex * 0.04}s` }}
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export default function Welcome() {
  const { role, profile, user } = useAuth();
  const isAgronomist = role === "agronomist";
  const name = greetingName(profile?.display_name, user?.email);
  const guide = isAgronomist ? AGRO_GUIDE : FARMER_GUIDE;

  return (
    <div className="space-y-8 pb-6">
      <div className="animate-fade-up">
        <PageHeader
          icon={BookOpen}
          eyebrow="Getting started"
          title={`Welcome, ${name}`}
          subtitle={
            isAgronomist
              ? "Follow these steps to use your agronomist desk, respond to farmers, and track field stress."
              : "Follow these steps to set up your farm, fly drones, read analytics, and act on crop stress."
          }
        />
      </div>

      <div
        className="app-card animate-fade-up border-primary/15 bg-primary/[0.04] p-5 md:p-6"
        style={{ animationDelay: "0.08s" }}
      >
        <h2 className="font-display text-base font-bold">Recommended order</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isAgronomist
            ? "Start with Farmer Requests each session, keep Stress Alerts open for new events, then reply with actionable advice."
            : "Set up Fields and Drones first, then log Flights. After imagery syncs, check Analytics and Alerts. Use AI or Expert chat when you need guidance."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {guide.map((item, i) => (
            <span
              key={item.step}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-white/80 px-3 py-1 text-xs font-medium text-primary animate-fade-up"
              style={{ animationDelay: `${0.14 + i * 0.05}s` }}
            >
              <span className="font-display font-bold">{item.step}</span>
              {item.title}
            </span>
          ))}
        </div>
      </div>

      <div className="relative space-y-4">
        <div className="pointer-events-none absolute bottom-4 left-[1.375rem] top-4 hidden w-px bg-gradient-to-b from-primary/25 via-primary/10 to-transparent md:block" />
        {guide.map((item, index) => (
          <GuideStepCard key={item.step} {...item} index={index} />
        ))}
      </div>

      {!isAgronomist && (
        <div className="animate-fade-up" style={{ animationDelay: `${0.12 + guide.length * 0.07}s` }}>
          <h2 className="mb-4 font-display text-lg font-bold tracking-tight">Also useful</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FARMER_EXTRA.map(({ title, body, to, linkLabel, icon: Icon }, i) => (
              <div
                key={title}
                className="app-card p-5 transition-smooth hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-card animate-fade-up"
                style={{ animationDelay: `${0.18 + guide.length * 0.07 + i * 0.06}s` }}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8">
                    <Icon className="h-5 w-5 text-primary" strokeWidth={1.5} />
                  </span>
                  <h3 className="font-semibold">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                <Link to={to} className="group/link mt-4 inline-block">
                  <Button size="sm" variant="ghost" className="h-9 px-0 text-primary hover:bg-transparent hover:text-primary/80">
                    {linkLabel}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="app-card animate-fade-up p-5 text-center md:p-6"
        style={{ animationDelay: `${0.2 + guide.length * 0.07}s` }}
      >
        <p className="text-sm text-muted-foreground">
          Need to change profile or connection settings?
        </p>
        <Link to="/settings" className="mt-3 inline-block">
          <Button variant="outline" className="rounded-xl">
            Open Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}
