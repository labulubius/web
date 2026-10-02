"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteShell } from "../site-shell";
import { useSiteAuth } from "../site-auth";
import "./agent.css";

const AGENT_ORIGIN = "https://agent.labulubius.com";
const REFRESH_INTERVAL_MS = 45 * 60 * 1000;
const AGENT_SESSION_HINT_KEY = "pi-agent-session-established";

type ConnectionState = "idle" | "connecting" | "ready" | "error";

function hasAgentSessionHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AGENT_SESSION_HINT_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberAgentSession(established: boolean): void {
  try {
    if (established) window.localStorage.setItem(AGENT_SESSION_HINT_KEY, "true");
    else window.localStorage.removeItem(AGENT_SESSION_HINT_KEY);
  } catch {
    // The signed HttpOnly cookie remains authoritative when storage is blocked.
  }
}

export function AgentFrame() {
  const { supabase, user, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [connection, setConnection] = useState<ConnectionState>(() => (
    hasAgentSessionHint() ? "ready" : "idle"
  ));
  const [error, setError] = useState("");
  const [frameGeneration, setFrameGeneration] = useState(0);
  const generation = useRef(0);
  const frameReloadPending = useRef(false);

  const connect = useCallback(async () => {
    const request = ++generation.current;
    // Refreshing the cross-origin session must not unmount the iframe. Mobile
    // browsers suspend this page while the system image picker is open; a
    // Supabase token refresh when the page resumes used to switch this state
    // back to "connecting", destroying Pi Web and its in-memory attachment.
    setConnection((current) => current === "ready" ? current : "connecting");
    setError("");
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token;
      if (!token) throw new Error("Your website session has expired. Please sign in again.");

      const response = await fetch(`${AGENT_ORIGIN}/api/owner-auth`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : `Agent authentication failed (${response.status}).`);
      }
      if (request !== generation.current) return;
      const reloadFrame = frameReloadPending.current;
      frameReloadPending.current = false;
      rememberAgentSession(true);
      setConnection("ready");
      if (reloadFrame) setFrameGeneration((current) => current + 1);
    } catch (failure) {
      if (request !== generation.current) return;
      setConnection((current) => current === "ready" ? current : "error");
      setError(failure instanceof Error ? failure.message : "Unable to connect to the Mac mini agent.");
    }
  }, [supabase]);

  useEffect(() => {
    if (loading || !user || !isAdmin) return;
    let cancelled = false;
    void fetch(`${AGENT_ORIGIN}/api/owner-auth`, {
      credentials: "include",
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as { authenticated?: unknown } | null;
      if (cancelled) return;
      if (response.ok && body?.authenticated === true) {
        rememberAgentSession(true);
        setConnection("ready");
      } else {
        frameReloadPending.current = true;
      }
    }).catch(() => {
      // The normal owner-token exchange below remains the recovery path.
    });
    return () => { cancelled = true; };
  }, [isAdmin, loading, user]);

  useEffect(() => {
    if (loading || !user || !isAdmin) return;
    const initial = window.setTimeout(() => void connect(), 0);
    const refresh = window.setInterval(() => void connect(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [connect, isAdmin, loading, user]);

  useEffect(() => {
    if (loading || user || authError || !hasAgentSessionHint()) return;
    generation.current++;
    frameReloadPending.current = true;
    rememberAgentSession(false);
    void fetch(`${AGENT_ORIGIN}/api/owner-auth`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {
      // The outer account is still signed out; a later visit retries cleanup.
    });
  }, [authError, loading, user]);

  if (connection === "ready" && user && isAdmin) {
    return <main className="agent-page"><iframe key={frameGeneration} className="agent-frame" src={AGENT_ORIGIN} title="Pi Agent on Mac mini" referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write" /></main>;
  }

  if (loading) {
    return <SiteShell active="/agent" title="Pi Agent"><main className="agent-gate"><div className="agent-gate-card"><p role="status">Checking owner access…</p></div></main></SiteShell>;
  }

  if (authError) {
    return <SiteShell active="/agent" title="Pi Agent"><main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p role="alert">{authError}</p><button type="button" onClick={retryAuth}>Retry account check</button></div></main></SiteShell>;
  }

  if (!user || !isAdmin) {
    return <SiteShell active="/agent" title="Pi Agent"><main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p>This page is available only to the site owner. Use Sign in in the top toolbar to continue.</p></div></main></SiteShell>;
  }

  if (connection !== "ready") {
    const message = connection === "connecting" ? "Connecting securely to the Mac mini…" : error || "Agent connection is unavailable.";
    return <SiteShell active="/agent" title="Pi Agent"><main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p role={connection === "error" ? "alert" : "status"}>{message}</p>{connection === "error" && <button type="button" onClick={() => void connect()}>Retry connection</button>}</div></main></SiteShell>;
  }

  return null;
}
