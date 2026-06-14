import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Bell,
  BellRing,
  Bot,
  Images,
  Inbox,
  Leaf,
  LogOut,
  MessageSquare,
  Plane,
  Plus,
  Radio,
  Satellite,
  Settings,
  Sprout,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/utils";

type NavLinkItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const farmerLinks: NavLinkItem[] = [
  { to: "/analytics", label: "Field Analytics", icon: BarChart3 },
  { to: "/fields", label: "Fields", icon: Sprout },
  { to: "/drones", label: "Drones", icon: Radio },
  { to: "/flights", label: "Flights", icon: Satellite },
  { to: "/gallery", label: "Image Gallery", icon: Images },
  { to: "/expert", label: "Ask an Expert", icon: MessageSquare },
  { to: "/alerts", label: "Stress Alerts", icon: BellRing },
  { to: "/chat", label: "AI Assistant", icon: Bot },
  { to: "/settings", label: "Settings", icon: Settings },
];

const agronomistLinks: NavLinkItem[] = [
  { to: "/expert-desk", label: "Farmer Requests", icon: Inbox },
  { to: "/alerts", label: "Stress Alerts", icon: BellRing },
  { to: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  wsUrl: string;
  wsConnected: boolean;
  dbConnected: boolean;
  unreadAlerts: number;
  clearUnread: () => void;
}

export function Sidebar({ unreadAlerts, clearUnread }: SidebarProps) {
  const { role, profile, signOut } = useAuth();

  const links = role === "agronomist" ? agronomistLinks : farmerLinks;
  const alertPath = role === "agronomist" ? "/expert-desk" : "/expert";

  return (
    <aside className="relative hidden h-screen w-80 shrink-0 flex-col gradient-sidebar border-r border-white/5 text-[hsl(var(--sidebar-foreground))] lg:flex">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.08),transparent_55%)]" />
      <Leaf className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 text-white/[0.04] animate-float-leaf" />
      <Plane className="pointer-events-none absolute -left-4 bottom-28 h-14 w-14 -rotate-12 text-white/[0.03] animate-float-leaf" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 shrink-0 border-b border-white/8 px-5 py-4">
        <div className="flex items-center gap-3.5">
          <NavLink
            to="/home"
            title="Home"
            className="shrink-0 rounded-xl transition-smooth hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <Logo size="md" className="ring-white/30" />
          </NavLink>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <NavLink
                to="/home"
                title="Home"
                className="font-display text-[1.35rem] font-bold leading-tight tracking-tight transition-smooth hover:text-white"
              >
                Phytospectra
              </NavLink>
              {unreadAlerts > 0 && (
                <button
                  type="button"
                  onClick={clearUnread}
                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stress-severe/20 transition-smooth hover:bg-stress-severe/30"
                  title="Clear alert notifications"
                >
                  <Bell className="h-4 w-4 text-stress-severe animate-pulse-live" />
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-stress-severe text-[9px] font-bold text-white">
                    {unreadAlerts > 9 ? "9+" : unreadAlerts}
                  </span>
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="max-w-[11rem] truncate text-sm font-medium opacity-80">
                {profile?.display_name || "Your account"}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/90">
                {role === "agronomist" ? "Agronomist" : "Farmer"}
              </span>
            </div>
            {(profile?.farm_name || profile?.specialty) && (
              <p className="mt-0.5 truncate text-xs opacity-55">
                {profile.farm_name || profile.specialty}
              </p>
            )}
          </div>
        </div>

        {role === "farmer" && (
          <NavLink
            to="/farmer-analyze"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 py-2 text-sm font-semibold transition-smooth hover:bg-white/16"
            title="Upload & Analyze"
          >
            <Plus className="h-4 w-4" />
            Upload & Analyze
          </NavLink>
        )}
      </div>

      <nav className="relative z-10 flex min-h-0 flex-1 flex-col px-3 py-2">
        <div className="space-y-0.5">
          {links.map(({ to, label, icon }) => {
            const isAlertLink = to === alertPath;
            const isAlertsPage = to === "/alerts";
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => (isAlertLink || isAlertsPage) && clearUnread()}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[15px] font-medium transition-smooth",
                    isActive
                      ? "bg-white/14 text-white shadow-soft ring-1 ring-white/10"
                      : "text-white/72 hover:bg-white/8 hover:text-white",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary-glow shadow-glow" />
                    )}
                    <span className="flex min-w-0 items-center gap-3">
                      <AppIcon icon={icon} variant="sidebar" active={isActive} className="h-8 w-8" iconClassName="h-4 w-4" />
                      <span>{label}</span>
                    </span>

                    {(isAlertLink || isAlertsPage) && unreadAlerts > 0 ? (
                      <span className="flex h-5 min-w-5 shrink-0 animate-pulse-live items-center justify-center rounded-full bg-stress-severe px-1 text-[10px] font-bold text-white shadow-soft">
                        {unreadAlerts > 9 ? "9+" : unreadAlerts}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="relative z-10 shrink-0 border-t border-white/8 bg-black/10 px-5 py-3 backdrop-blur-sm">
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/8 py-2 text-sm font-medium transition-smooth hover:bg-white/14"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
