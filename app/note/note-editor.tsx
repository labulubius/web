"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";

type SaveState = "loading" | "saved" | "pending" | "saving" | "error" | "conflict";

export function NoteEditor() {
  const { supabase, isAdmin, loading } = useSiteAuth();
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const current = useRef("");
  const saved = useRef("");
  const revision = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef(false);
  const blocked = useRef(false);
  const generation = useRef(0);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((delay = 800) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, delay);
  }, []);

  const save = useCallback(async () => {
    if (writing.current || blocked.current || revision.current === null || current.current === saved.current) return;
    const version = generation.current;
    const value = current.current;
    const expected = revision.current;
    writing.current = true;
    setState("saving");
    setMessage("");
    try {
      // The revision condition prevents another tab/device from being silently overwritten.
      const { data, error } = await supabase.from("private_note")
        .update({ content: value }).eq("id", 1).eq("revision", expected)
        .select("revision").maybeSingle();
      if (version !== generation.current) return;
      if (error) throw error;
      if (!data) {
        blocked.current = true;
        setState("conflict");
        setMessage("This note was changed elsewhere. Copy your unsaved text before reloading.");
        return;
      }
      revision.current = data.revision;
      saved.current = value;
      if (current.current === value) setState("saved");
      else { setState("pending"); schedule(); }
    } catch {
      if (version === generation.current) {
        setState("error");
        setMessage("Could not save. Your text is still here; retry when connected.");
      }
    } finally {
      writing.current = false;
    }
  }, [supabase, schedule]);
  useEffect(() => { saveRef.current = save; }, [save]);

  useEffect(() => {
    const version = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    current.current = "";
    saved.current = "";
    revision.current = null;
    blocked.current = false;
    // Defer state updates to the async callback; keep the effect for external data synchronization.
    void (async () => {
      setReady(false);
      setText("");
      setState("loading");
      setMessage("");
      if (loading || !isAdmin) return;
      const { data, error } = await supabase.from("private_note").select("content,revision").eq("id", 1).maybeSingle();
      if (version !== generation.current) return;
      if (error || !data) {
        setState("error");
        setMessage("Could not load the note. Check that the database migration is installed, then reload.");
        return;
      }
      current.current = data.content;
      saved.current = data.content;
      revision.current = data.revision;
      setReady(true);
      setText(data.content);
      setState("saved");
    })();
    return () => { generation.current++; if (timer.current) clearTimeout(timer.current); };
  }, [supabase, isAdmin, loading]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current === saved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function change(value: string) {
    current.current = value;
    setText(value);
    if (blocked.current) return;
    setState(value === saved.current ? "saved" : "pending");
    if (value === saved.current) { if (timer.current) clearTimeout(timer.current); timer.current = null; }
    else schedule();
  }

  if (loading) return <section className="note-view"><p>Checking account…</p></section>;
  if (!isAdmin) return <section className="note-view"><h1>Private Note</h1><p>Only the site owner can read or edit this note. Sign in to continue.</p></section>;

  return (
    <section className="note-view">
      <header className="note-header"><div><h1>Private Note</h1><p>Plain text · Private to Owner · Autosaved</p></div>
        <span className={`note-state note-state-${state}`} role="status" aria-live="polite">
          {state === "loading" ? "Loading…" : state === "saved" ? "Saved" : state === "pending" ? "Unsaved changes" : state === "saving" ? "Saving…" : state === "conflict" ? "Conflict" : "Save failed"}
        </span>
      </header>
      {message && <p className="note-message" role="alert">{message}</p>}
      {(state === "error" && ready) && <button type="button" onClick={() => void save()} className="note-retry">Retry save</button>}
      <textarea className="note-text" aria-label="Private note" placeholder="Start writing…" spellCheck={false} maxLength={100000}
        value={text} disabled={!ready} onChange={(event) => change(event.target.value)}
        onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void save(); } }} />
    </section>
  );
}
