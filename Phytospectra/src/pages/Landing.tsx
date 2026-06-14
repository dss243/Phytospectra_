import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { IconBox } from "@/components/IconBox";
import { HeroPanel } from "@/components/HeroPanel";
import { HeroPills } from "@/components/HeroPills";
import { AppFeatureGrid } from "@/components/AppFeatureGrid";
import { AnalyticsPreview } from "@/components/AnalyticsPreview";
import { WorkflowShowcase } from "@/components/WorkflowShowcase";
import { LandingBackground } from "@/components/landing/LandingBackground";
import {
  LandingBadge,
  LandingCard,
  LandingSection,
  LandingSectionHeader,
} from "@/components/landing/LandingUI";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight,
  Menu,
  X,
  ChevronRight,
  Eye,
  Plane,
  Map,
  MessageSquare,
  Cloud,
  Quote,
  ShieldCheck,
} from "lucide-react";

const WORKFLOW = [
  {
    step: "01",
    icon: Plane,
    accent: "green" as const,
    title: "Fly your drone",
    description: "Capture multispectral imagery. Flights sync to the cloud automatically after landing.",
  },
  {
    step: "02",
    icon: Map,
    accent: "green" as const,
    title: "Review segmentation",
    description: "See crop classes, stress zones, and field analytics from each flight.",
  },
  {
    step: "03",
    icon: MessageSquare,
    accent: "green" as const,
    title: "Get expert advice",
    description: "Share drone maps with an agronomist or use the AI assistant.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Segmentation maps with coordinates save us hundreds of field hours every season.",
    initials: "DR",
    name: "Dr. Raymond Vance",
    role: "Chief Agronomist, GreenHorizon Ltd",
  },
  {
    quote:
      "We caught a nitrogen deficiency five days before visible symptoms appeared.",
    initials: "JM",
    name: "Julian Mercer",
    role: "Organic Crop Cultivator, Mercer Fields",
  },
];

const STATS = [
  { value: "94.8%", label: "Detection accuracy" },
  { value: "30%", label: "Fertilizer saved" },
  { value: "24/7", label: "Expert access" },
];

export default function Landing() {
  const { user, role, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!loading && user && role) {
    return <Navigate to="/home" replace />;
  }

  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#demo", label: "Demo" },
    { href: "#workflow", label: "Workflow" },
    { href: "#testimonials", label: "Community" },
  ];

  return (
    <div className="min-h-screen landing-grid-bg relative overflow-x-hidden">
      <LandingBackground />

      <header className="sticky top-0 z-50 w-full px-4 sm:px-6 lg:px-8 pt-4">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 rounded-2xl border border-border/50 bg-white/90 px-4 shadow-soft backdrop-blur-xl sm:px-5">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Logo size="nav" variant="flat" />
            <span className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">
              Phytospectra
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-muted-foreground transition-smooth hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <Link to="/auth?mode=signin">
              <Button variant="ghost" size="sm" className="rounded-xl font-semibold">
                Sign In
              </Button>
            </Link>
            <Link to="/auth?mode=signup">
              <Button size="sm" className="rounded-xl font-semibold shadow-soft">
                Get Started
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-xl p-2 transition-smooth hover:bg-muted md:hidden"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        {mobileMenuOpen && (
          <LandingCard className="mx-auto mt-2 max-w-6xl md:hidden" padding="sm">
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <hr className="my-3 border-border/40" />
              <div className="grid grid-cols-2 gap-2">
                <Link to="/auth?mode=signin" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full rounded-xl font-semibold">
                    Sign In
                  </Button>
                </Link>
                <Link to="/auth?mode=signup" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full rounded-xl font-semibold">Sign Up</Button>
                </Link>
              </div>
            </div>
          </LandingCard>
        )}
      </header>

      <section className="relative px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24">
        <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-2 lg:gap-x-16">
          <div className="animate-fade-up space-y-6 text-center lg:text-left">
            <LandingBadge dot>Drone crop intelligence</LandingBadge>

            <div className="space-y-4">
              <h1 className="font-display text-[2.75rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-[3.75rem]">
                <span className="text-gradient-hero">Crop intelligence,</span>
                <br />
                <span className="text-foreground">from the sky</span>
              </h1>
              <p className="mx-auto max-w-md text-base leading-relaxed text-muted-foreground lg:mx-0">
                Fly a drone over your fields. Imagery syncs to the cloud automatically, then
                Phytospectra turns each flight into crop insights with expert support when you need it.
              </p>
            </div>

            <HeroPills />

            <div className="flex flex-col items-center gap-3 sm:flex-row lg:items-start">
              <Link to="/auth?mode=signup" className="w-full sm:w-auto">
                <Button className="group h-12 w-full rounded-2xl px-8 font-semibold shadow-glow sm:w-auto">
                  Start free trial
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="#demo" className="w-full sm:w-auto">
                <Button variant="outline" className="h-12 w-full rounded-2xl border-border/60 bg-white/80 px-8 font-semibold sm:w-auto">
                  <Eye className="mr-2 h-4 w-4" />
                  See analytics
                </Button>
              </a>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center lg:text-left">
                  <div className="font-display text-2xl font-bold tracking-tight">{stat.value}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <HeroPanel />
        </div>
      </section>

      <LandingSection id="features" alt>
        <LandingSectionHeader
          eyebrow="Features"
          title="What Phytospectra offers"
          description="Cloud sync, AI segmentation, field analytics, and expert guidance in one place."
        />
        <AppFeatureGrid />
      </LandingSection>

      <LandingSection id="demo">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-5">
            <LandingBadge>
              <Cloud className="h-3.5 w-3.5" strokeWidth={1.5} />
              Cloud dashboard
            </LandingBadge>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Field analytics at a glance
            </h2>
            <p className="max-w-md leading-relaxed text-muted-foreground">
              Each cloud-synced drone flight updates your dashboard with health trends, zone maps, and alerts.
            </p>
            <Link to="/auth?mode=signup">
              <Button className="h-11 rounded-xl px-6 font-semibold shadow-soft">
                Open dashboard
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
          <AnalyticsPreview />
        </div>
      </LandingSection>

      <LandingSection id="workflow" alt>
        <LandingSectionHeader
          eyebrow="Workflow"
          title="How it works"
          description="From drone flight to field action in three steps."
        />
        <WorkflowShowcase />
        <div className="grid gap-4 md:grid-cols-3">
          {WORKFLOW.map((step) => (
            <LandingCard key={step.step} hover padding="lg" className="relative text-center">
              <span className="absolute right-5 top-5 font-display text-3xl font-bold text-primary/10">
                {step.step}
              </span>
              <div className="mx-auto mb-4 w-fit">
                <IconBox icon={step.icon} accent={step.accent} size="md" />
              </div>
              <h3 className="font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
            </LandingCard>
          ))}
        </div>
      </LandingSection>

      <LandingSection id="testimonials">
        <LandingSectionHeader
          eyebrow="Community"
          title="Trusted by growers"
          description="Farmers and agronomists using Phytospectra every day."
        />
        <div className="grid gap-5 md:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <LandingCard key={t.name} hover padding="lg">
              <Quote className="mb-3 h-6 w-6 text-primary/20" strokeWidth={1.5} />
              <blockquote className="text-[15px] leading-relaxed text-foreground/90">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <div className="mt-6 flex items-center gap-3 border-t border-border/40 pt-5">
                <div className="relative shrink-0">
                  <div className="absolute -inset-px rounded-full bg-gradient-to-br from-primary/30 to-primary/15" />
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white font-display text-sm font-bold">
                    {t.initials}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </LandingCard>
          ))}
        </div>
      </LandingSection>

      <section className="relative overflow-hidden border-t border-sidebar-border bg-[hsl(var(--logo-green))] px-4 pb-0 pt-20 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_100%,hsl(var(--logo-green)/0.4),transparent)]" />
        <div className="relative z-10 mx-auto max-w-3xl space-y-6">
          <IconBox icon={ShieldCheck} accent="green" size="lg" dark className="mx-auto" />
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to get started?
          </h2>
          <p className="mx-auto max-w-md text-sm text-white/65">
            Create your account and explore the dashboard in minutes.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/auth?mode=signup">
              <Button className="h-12 w-full rounded-2xl px-8 font-semibold shadow-glow sm:w-auto">
                Create free account
              </Button>
            </Link>
            <Link to="/auth?mode=signin">
              <Button
                variant="outline"
                className="h-12 w-full rounded-2xl border-white/15 bg-white/5 px-8 font-semibold text-white hover:bg-white/10 sm:w-auto"
              >
                Sign in
              </Button>
            </Link>
          </div>
        </div>
        <footer className="relative z-10 mx-auto mt-16 flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-white/10 py-8 text-xs text-white/45 sm:flex-row">
          <div>© {new Date().getFullYear()} Phytospectra Inc.</div>
          <div className="flex gap-5">
            {["Terms", "Privacy", "Support"].map((item) => (
              <span key={item} className="cursor-pointer transition-smooth hover:text-white/80">
                {item}
              </span>
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}
