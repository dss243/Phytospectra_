import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { makeAuthedClient } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, LogOut, Mail, Save, Settings as SettingsIcon, User } from "lucide-react";
import { toast } from "sonner";

function nameFromUser(user: ReturnType<typeof useAuth>["user"]) {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = typeof meta.display_name === "string" ? meta.display_name : "";
  if (fromMeta.trim()) return fromMeta.trim();
  const email = user?.email ?? "";
  return email.includes("@") ? email.split("@")[0] : "";
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Could not save your changes";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function Settings() {
  const { user, session, role, profile, signOut, refreshProfile, setDisplayName } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const pendingEmail = user?.new_email ?? null;

  useEffect(() => {
    setName(profile?.display_name?.trim() || nameFromUser(user));
    setEmail(user?.email ?? "");
    setLoaded(true);
  }, [profile, user]);

  const saveChanges = async () => {
    if (!user || !session?.access_token) {
      toast.error("You must be signed in to update your account");
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const currentEmail = (user.email ?? "").toLowerCase();

    const nameChanged = !trimmedEquals(trimmedName, profile?.display_name?.trim() || nameFromUser(user));
    const emailChanged = trimmedEmail !== currentEmail;

    if (!nameChanged && !emailChanged) return;

    if (nameChanged && !trimmedName) {
      toast.error("Please enter your name");
      return;
    }

    if (emailChanged && !isValidEmail(trimmedEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSaving(true);
    try {
      if (nameChanged) {
        const token = session.access_token;
        const client = await makeAuthedClient(async () => token);
        await client.patch<{ display_name: string }>("/api/profile/me", {
          display_name: trimmedName,
        });

        const { error: metaError } = await supabase.auth.updateUser({
          data: { display_name: trimmedName },
        });
        if (metaError) console.warn("Auth metadata update failed:", metaError.message);

        setDisplayName(trimmedName);
        await refreshProfile();
      }

      if (emailChanged) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: trimmedEmail,
        });
        if (emailError) throw emailError;

        if (nameChanged) {
          toast.success("Name saved. Check your inbox to confirm your new email.");
        } else {
          toast.info("Check your inbox to confirm your new email address.");
        }
      } else if (nameChanged) {
        toast.success("Profile updated");
      }
    } catch (err) {
      console.error("Save settings failed:", err);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const nameBaseline = profile?.display_name?.trim() || nameFromUser(user);
  const emailBaseline = (user?.email ?? "").toLowerCase();
  const nameChanged = loaded && !trimmedEquals(name, nameBaseline);
  const emailChanged = loaded && email.trim().toLowerCase() !== emailBaseline;
  const hasChanges = nameChanged || emailChanged;
  const canSave =
    hasChanges &&
    (!nameChanged || name.trim()) &&
    (!emailChanged || isValidEmail(email.trim()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Update your name and email"
        icon={SettingsIcon}
      />

      <div className="mx-auto max-w-lg space-y-4">
        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Account</h2>
          </div>

          <div>
            <label htmlFor="display-name" className="text-sm font-semibold">
              Display name
            </label>
            <input
              id="display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full bg-muted rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 ring-primary"
              placeholder="e.g. Maria Lopez"
              autoComplete="name"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Shown in the sidebar, expert chat, and alerts.
            </p>
          </div>

          <div>
            <label htmlFor="email" className="text-sm font-semibold flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full bg-muted rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 ring-primary"
              placeholder="you@example.com"
              autoComplete="email"
            />
            {pendingEmail && pendingEmail !== user?.email && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                Pending confirmation: {pendingEmail}. Check your inbox to finish the change.
              </p>
            )}
            {emailChanged && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Supabase will send a confirmation link to your new email before the change takes effect.
              </p>
            )}
          </div>

          <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Role:</span>{" "}
            {role === "agronomist" ? "Agronomist" : "Farmer"}
          </div>

          <Button
            onClick={saveChanges}
            disabled={saving || !canSave}
            className="w-full rounded-xl"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>

        <div className="bg-card rounded-2xl shadow-soft border border-border/40 p-6">
          <Button
            variant="outline"
            onClick={() => signOut()}
            className="w-full rounded-xl border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function trimmedEquals(a: string, b: string) {
  return a.trim() === b.trim();
}
