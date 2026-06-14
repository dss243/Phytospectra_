import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/phytospectra-logo.jpg";
import { MapPin, Sprout, Microscope } from "lucide-react";
import { toast } from "sonner";
import { getBackendBaseUrl } from "@/lib/backend";

type Role = "farmer" | "agronomist";

async function pushAgronomistLocation(token: string) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await fetch(`${getBackendBaseUrl()}/api/profile/location`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        });
      } catch (err) {
        console.warn("[location] Failed to push on signup:", err);
      }
    },
    (err) => console.warn("[location] Geolocation error:", err.message),
    { enableHighAccuracy: true, timeout: 10_000 }
  );
}

export default function Auth() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [selectedRole, setSelectedRole] = useState<Role>("farmer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [farmName, setFarmName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user && role) {
    return <Navigate to="/home" replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              display_name: displayName,
              role: selectedRole,
              farm_name: selectedRole === "farmer" ? farmName : null,
              specialty: selectedRole === "agronomist" ? specialty : null,
            },
          },
        });
        if (error) throw error;

        // Push location immediately on agronomist account creation
        if (selectedRole === "agronomist" && data.session?.access_token) {
          await pushAgronomistLocation(data.session.access_token);
        }

        toast.success("Welcome aboard! 🌱");
        navigate("/home");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Refresh location on every agronomist login
        const userRole =
          data.user?.user_metadata?.role ||
          data.user?.app_metadata?.role;
        if (userRole === "agronomist" && data.session?.access_token) {
          await pushAgronomistLocation(data.session.access_token);
        }

        toast.success("Welcome back!");
        navigate("/home", { replace: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center app-shell-bg p-4">
      <div className="w-full max-w-md animate-fade-slide-down rounded-3xl border border-border/50 bg-white p-8 shadow-card md:p-9">
        <div className="text-center mb-7">
          <div className="mx-auto mb-4 flex justify-center rounded-2xl bg-white p-3">
            <img
              src={logo}
              alt="Phytospectra"
              className="w-full max-w-[260px] object-contain sm:max-w-[300px]"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">Crop intelligence, from the sky</p>
        </div>

        <div className="flex p-1 bg-muted/70 rounded-xl mb-6 ring-1 ring-border/40">
          {(["signin", "signup"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-smooth ${mode === m ? "bg-white text-foreground shadow-soft ring-1 ring-border/40" : "text-muted-foreground hover:text-foreground"}`}>
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        {mode === "signup" && (
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            {([
              { v: "farmer", l: "Farmer", icon: Sprout, sub: "Monitor my fields" },
              { v: "agronomist", l: "Agronomist", icon: Microscope, sub: "Help farmers" },
            ] as const).map(r => {
              const Icon = r.icon;
              const active = selectedRole === r.v;
              return (
                <button key={r.v} type="button" onClick={() => setSelectedRole(r.v)}
                  className={`p-3.5 rounded-xl border-2 transition-smooth text-left ${active ? "border-primary bg-primary/5 shadow-soft ring-1 ring-primary/10" : "border-border/50 hover:border-border hover:bg-muted/50"}`}>
                  <Icon className={`h-5 w-5 mb-1.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="font-semibold text-sm">{r.l}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{r.sub}</div>
                </button>
              );
            })}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3.5">
          {mode === "signup" && (
            <>
              <input required value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name" className="w-full bg-muted/40 border border-border/60 rounded-xl px-4 py-3 text-sm outline-none transition-smooth focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/20" />
              {selectedRole === "farmer" ? (
                <input value={farmName} onChange={e => setFarmName(e.target.value)}
                  placeholder="Farm name (optional)" className="w-full bg-muted/40 border border-border/60 rounded-xl px-4 py-3 text-sm outline-none transition-smooth focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/20" />
              ) : (
                <input value={specialty} onChange={e => setSpecialty(e.target.value)}
                  placeholder="Specialty (e.g. Crop disease)" className="w-full bg-muted/40 border border-border/60 rounded-xl px-4 py-3 text-sm outline-none transition-smooth focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/20" />
              )}
            </>
          )}
          <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" className="w-full bg-muted/40 border border-border/60 rounded-xl px-4 py-3 text-sm outline-none transition-smooth focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/20" />
          <input required type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" className="w-full bg-muted/40 border border-border/60 rounded-xl px-4 py-3 text-sm outline-none transition-smooth focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/20" />

          <button disabled={submitting} type="submit"
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-soft hover:shadow-glow transition-smooth disabled:opacity-50 active:scale-[0.98] mt-1">
            {submitting ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "signup" && selectedRole === "agronomist" && (
          <p className="text-center text-[11px] text-muted-foreground mt-4 leading-relaxed flex items-center justify-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            Your location will be used to match you with nearby stressed fields
          </p>
        )}

        <p className="text-center text-xs text-muted-foreground/80 mt-6 flex items-center justify-center gap-1.5">
          <Sprout className="h-3.5 w-3.5 text-primary" />
          Growing smarter, together
        </p>
      </div>
    </div>
  );
}