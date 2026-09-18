"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { LogIn, LogOut, User as UserIcon, X } from "lucide-react";
import { createContext, FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "./lib/supabase";

type SiteAuthValue = {
  supabase: SupabaseClient;
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
};

const SiteAuthContext = createContext<SiteAuthValue | null>(null);

export function SiteAuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const syncUser = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);
    if (!nextUser) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc("navigator_is_admin");
    setIsAdmin(!error && data === true);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void supabase.auth.getUser().then(({ data }) => syncUser(data.user));
    }, 0);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void syncUser(session?.user ?? null), 0);
    });

    return () => {
      window.clearTimeout(initialLoad);
      listener.subscription.unsubscribe();
    };
  }, [supabase, syncUser]);

  return (
    <SiteAuthContext.Provider value={{ supabase, user, isAdmin, loading }}>
      {children}
    </SiteAuthContext.Provider>
  );
}

export function useSiteAuth() {
  const context = useContext(SiteAuthContext);
  if (!context) throw new Error("useSiteAuth must be used within SiteAuthProvider.");
  return context;
}

export function AccountControl() {
  const { supabase, user, isAdmin, loading } = useSiteAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const result = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setSaving(false);
    if (result.error) setError(result.error.message);
    else setDialogOpen(false);
  }

  return (
    <>
      {user ? (
        <button className="account-control" type="button" onClick={() => void supabase.auth.signOut()} title={`Sign out ${user.email ?? ""}`}>
          <UserIcon size={15} /><span>{isAdmin ? "Owner" : "Read only"}</span><LogOut size={14} />
        </button>
      ) : (
        <button className="account-control" type="button" disabled={loading} onClick={() => { setError(""); setDialogOpen(true); }}>
          <LogIn size={15} /><span>{loading ? "Account" : "Sign in"}</span>
        </button>
      )}

      {dialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
          <section className="breeze-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
            <header>
              <h2 id="auth-dialog-title">Owner sign in</h2>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label="Close"><X size={17} /></button>
            </header>
            <form onSubmit={handleLogin}>
              <label>Email<input name="email" type="email" autoComplete="username" autoFocus required /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <footer>
                <button type="button" onClick={() => setDialogOpen(false)}>Cancel</button>
                <button className="primary" type="submit" disabled={saving}>{saving ? "Signing in…" : "Sign in"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
