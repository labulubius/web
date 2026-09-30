"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountControl, useSiteAuth } from "../site-auth";
import "./agent.css";

const AGENT_ORIGIN = "https://agent.labulubius.com";
const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

type ConnectionState = "idle" | "connecting" | "ready" | "error";

export function AgentFrame() {
  const { supabase, user, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState("");
  const generation = useRef(0);

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
      setConnection("ready");
    } catch (failure) {
      if (request !== generation.current) return;
      setConnection((current) => current === "ready" ? current : "error");
      setError(failure instanceof Error ? failure.message : "Unable to connect to the Mac mini agent.");
    }
  }, [supabase]);

  useEffect(() => {
    if (loading || !user || !isAdmin) return;
    const initial = window.setTimeout(() => void connect(), 0);
    const refresh = window.setInterval(() => void connect(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [connect, isAdmin, loading, user]);

  if (connection === "ready" && user && isAdmin) {
    return <main className="agent-page"><iframe className="agent-frame" src={AGENT_ORIGIN} title="Pi Agent on Mac mini" referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write" /></main>;
  }

  if (loading) {
    return <main className="agent-gate"><div className="agent-gate-card"><p>Checking owner access…</p></div></main>;
  }

  if (!user) {
    return <main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p>Sign in with the site owner account to continue.</p><AccountControl /></div></main>;
  }

  if (authError) {
    return <main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p role="alert">{authError}</p><button type="button" onClick={retryAuth}>Retry account check</button></div></main>;
  }

  if (!isAdmin) {
    return <main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p>This page is available only to the site owner.</p><AccountControl /></div></main>;
  }

  if (connection !== "ready") {
    return <main className="agent-gate"><div className="agent-gate-card"><h1>Pi Agent</h1><p>{connection === "connecting" ? "Connecting securely to the Mac mini…" : error || "Agent connection is unavailable."}</p>{connection === "error" && <button type="button" onClick={() => void connect()}>Retry connection</button>}</div></main>;
  }

  return null;
}
