"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { LogIn, LogOut, User as UserIcon, X } from "lucide-react";
import { createContext, FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibleDialog } from "./accessible-dialog";
import { getSupabaseBrowserClient } from "./lib/supabase";

type SiteAuthValue = {
  supabase: SupabaseClient;
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  authError: string;
  retryAuth: () => void;
};

const SiteAuthContext = createContext<SiteAuthValue | null>(null);

export function SiteAuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const generation = useRef(0);

  const syncUser = useCallback(async (nextUser: User | null, request = ++generation.current) => {
    if (request !== generation.current) return;
    setLoading(true); setAuthError("");
    if (!nextUser) {
      if (request !== generation.current) return;
      setUser(null); setIsAdmin(false); setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.rpc("site_is_admin");
      if (request !== generation.current) return;
      if (error) throw error;
      setUser(nextUser); setIsAdmin(data === true); setLoading(false);
    } catch {
      if (request !== generation.current) return;
      setUser(nextUser); setIsAdmin(false); setAuthError("Account permissions could not be verified."); setLoading(false);
    }
  }, [supabase]);

  const invalidateAuth = useCallback(() => { generation.current++; }, []);

  const retryAuth = useCallback(() => {
    const request = ++generation.current;
    setLoading(true); setAuthError("");
    void supabase.auth.getUser().then(({ data, error }) => {
      if (request !== generation.current) return;
      if (error?.name === "AuthSessionMissingError") return syncUser(null, request);
      if (error) throw error;
      return syncUser(data.user, request);
    }).catch(() => {
      if (request !== generation.current) return;
      setUser(null); setIsAdmin(false); setAuthError("Account service is temporarily unavailable."); setLoading(false);
    });
  }, [supabase, syncUser]);

  useEffect(() => {
    const initialLoad = window.setTimeout(retryAuth, 0);
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const request = ++generation.current;
      window.setTimeout(() => void syncUser(session?.user ?? null, request), 0);
    });
    return () => {
      invalidateAuth();
      window.clearTimeout(initialLoad);
      listener.subscription.unsubscribe();
    };
  }, [supabase, syncUser, retryAuth, invalidateAuth]);

  return <SiteAuthContext.Provider value={{ supabase, user, isAdmin, loading, authError, retryAuth }}>{children}</SiteAuthContext.Provider>;
}

export function useSiteAuth() {
  const context = useContext(SiteAuthContext);
  if (!context) throw new Error("useSiteAuth must be used within SiteAuthProvider.");
  return context;
}

export function AccountControl() {
  const { supabase, user, isAdmin, loading, authError } = useSiteAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await supabase.auth.signInWithPassword({ email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") });
      if (result.error) setError(result.error.message); else setDialogOpen(false);
    } catch { setError("Sign in is temporarily unavailable."); }
    finally { setSaving(false); }
  }

  async function signOut() {
    setSaving(true); setError("");
    try {
      const { error: failure } = await supabase.auth.signOut();
      if (failure) setError(failure.message);
    } catch { setError("Sign out is temporarily unavailable."); }
    finally { setSaving(false); }
  }

  return <>
    {authError ? <button className="account-control" type="button" disabled={loading} onClick={() => { setError(""); setDialogOpen(true); }} title={authError}><LogIn size={15} /><span>{loading ? "Account" : "Sign in"}</span></button>
      : user ? <button className="account-control" type="button" disabled={loading || saving} onClick={() => void signOut()} title={`Sign out ${user.email ?? ""}`}><UserIcon size={15} /><span>{loading ? "Checking…" : isAdmin ? "Owner" : "Read only"}</span><LogOut size={14} /></button>
      : <button className="account-control" type="button" disabled={loading} onClick={() => { setError(""); setDialogOpen(true); }}><LogIn size={15} /><span>{loading ? "Account" : "Sign in"}</span></button>}
    {error && !dialogOpen && <span className="account-error" role="alert">{error}</span>}
    {dialogOpen && <AccessibleDialog labelledBy="auth-dialog-title" busy={saving} onClose={() => setDialogOpen(false)} className="auth-dialog">
      <header><h2 id="auth-dialog-title">Site owner sign in</h2><button type="button" disabled={saving} onClick={() => setDialogOpen(false)} aria-label="Close"><X size={17} /></button></header>
      <form onSubmit={handleLogin}>
        <label>Email<input name="email" type="email" autoComplete="username" autoFocus required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={() => setDialogOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Signing in…" : "Sign in"}</button></footer>
      </form>
    </AccessibleDialog>}
  </>;
}
