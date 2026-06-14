import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "farmer" | "agronomist";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: { display_name: string | null; farm_name: string | null; specialty: string | null; bio: string | null } | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setDisplayName: (name: string) => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<AuthCtx["profile"]>(null);
  const [loading, setLoading] = useState(true);

  // Track the last user ID we fetched meta for — avoids re-fetching on TOKEN_REFRESHED
  // when the user hasn't changed (same session, new token).
  const fetchedUidRef = useRef<string | null>(null);
  // Debounce guard: prevents overlapping fetchMeta calls.
  const fetchingRef = useRef(false);

  const roleFromMetadata = (sess: Session | null): AppRole | null => {
    const m = (sess?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const candidate = m.role ?? m.app_role ?? null;
    if (candidate === "farmer" || candidate === "agronomist") return candidate as AppRole;
    return null;
  };

  const fetchMeta = async (uid: string, currentSession: Session | null, force = false) => {
    if (fetchingRef.current) return;
    if (!force && fetchedUidRef.current === uid) return;
    fetchingRef.current = true;

    try {
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
        supabase.from("profiles").select("display_name, farm_name, specialty, bio").eq("user_id", uid).maybeSingle(),
      ]);

      const resolvedRole = (r?.role as AppRole | null) ?? roleFromMetadata(currentSession);
      setRole(resolvedRole);
      setProfile(p ?? null);
      fetchedUidRef.current = uid;
    } catch (err) {
      console.error("fetchMeta error:", err);
    } finally {
      fetchingRef.current = false;
    }
  };

  useEffect(() => {
    let active = true;

    // 1. Set up the listener FIRST (Supabase recommendation).
    //    This captures events that fire before getSession() resolves.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;

      if (event === "SIGNED_OUT") {
        setSession(null);
        setUser(null);
        setRole(null);
        setProfile(null);
        fetchedUidRef.current = null; // Reset so next sign-in fetches fresh
        return;
      }

      // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION
      if (s) {
        setSession(s);
        setUser(s.user);

        if (event === "USER_UPDATED") {
          return;
        }

        // Only fetch meta if this is a new user (not just a token refresh)
        if (s.user.id !== fetchedUidRef.current) {
          fetchMeta(s.user.id, s);
        }
      }
    });

    // 2. Then call getSession() to bootstrap — this will trigger INITIAL_SESSION
    //    in the listener above, so we don't need to call fetchMeta here again.
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.error("getSession error:", error);
      // If no session at all, clear loading
      if (!data.session) setLoading(false);
      // If there IS a session, the onAuthStateChange INITIAL_SESSION event handles it.
      // We just need to ensure loading is cleared once meta is fetched (see below).
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Clear loading once we know the auth state is resolved
  useEffect(() => {
    // loading stays true until we have a definitive state:
    // either no user, or user + role/profile resolved
    if (!user) {
      setLoading(false);
    } else if (fetchedUidRef.current === user.id) {
      // Meta has been fetched for the current user
      setLoading(false);
    }
  }, [user, role, profile]);

  const signOut = async () => {
    fetchedUidRef.current = null;
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (!user) return;
    fetchedUidRef.current = null;
    await fetchMeta(user.id, session, true);
  };

  const setDisplayName = (name: string) => {
    setProfile((prev) => ({
      display_name: name,
      farm_name: prev?.farm_name ?? null,
      specialty: prev?.specialty ?? null,
      bio: prev?.bio ?? null,
    }));
    setUser((prev) =>
      prev
        ? {
            ...prev,
            user_metadata: { ...prev.user_metadata, display_name: name },
          }
        : prev
    );
  };

  return (
    <Ctx.Provider value={{ user, session, role, profile, loading, signOut, refreshProfile, setDisplayName }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);