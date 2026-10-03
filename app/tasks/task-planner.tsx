"use client";

import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Inbox,
  ListTodo,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import { OwnerAccess } from "../owner-access";
import { useSiteAuth } from "../site-auth";
import {
  addDays,
  compareTasks,
  formatDate,
  localDate,
  minutesToTime,
  timeToMinutes,
  type PlannerTask,
  type TaskDraft,
} from "../lib/tasks";

type PlannerView = "inbox" | "day";
type LoadState = "idle" | "loading" | "ready" | "error";

function emptyDraft(date: string | null): TaskDraft {
  return { title: "", notes: "", scheduled_date: date, start_minute: null };
}

function draftFromTask(task: PlannerTask): TaskDraft {
  return {
    title: task.title,
    notes: task.notes,
    scheduled_date: task.scheduled_date,
    start_minute: task.start_minute,
  };
}

function TaskRow({ task, onEdit, onToggle, onDelete }: {
  task: PlannerTask;
  onEdit: (task: PlannerTask) => void;
  onToggle: (task: PlannerTask) => void;
  onDelete: (task: PlannerTask) => void;
}) {
  const completed = task.status === "completed";
  return (
    <article className={`task-row${completed ? " task-row-completed" : ""}`}>
      <button
        className="task-check"
        type="button"
        onClick={() => onToggle(task)}
        aria-label={completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
      >
        {completed && <Check size={14} />}
      </button>
      <button className="task-row-body" type="button" onClick={() => onEdit(task)}>
        <strong>{task.title}</strong>
        {(task.notes || task.scheduled_date) && <span>
          {task.notes || (task.scheduled_date ? formatDate(task.scheduled_date, { weekday: "short" }) : "")}
        </span>}
      </button>
      {task.start_minute !== null && <time className="task-time">{minutesToTime(task.start_minute)}</time>}
      <div className="task-row-actions">
        <button type="button" onClick={() => onEdit(task)} title="Edit task" aria-label={`Edit ${task.title}`}><Pencil size={14} /></button>
        {completed && <button type="button" onClick={() => onToggle(task)} title="Restore task" aria-label={`Restore ${task.title}`}><RotateCcw size={14} /></button>}
        <button className="task-delete" type="button" onClick={() => onDelete(task)} title="Delete task" aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

function TaskDialog({ task, initial, saving, error, onClose, onSave }: {
  task: PlannerTask | null;
  initial: TaskDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized: TaskDraft = {
      title: draft.title.trim(),
      notes: draft.notes.trim(),
      scheduled_date: draft.scheduled_date,
      start_minute: draft.scheduled_date ? draft.start_minute : null,
    };
    if (normalized.title) onSave(normalized);
  }

  return (
    <AccessibleDialog labelledBy="task-dialog-title" busy={saving} onClose={onClose} className="task-dialog">
      <header>
        <h2 id="task-dialog-title">{task ? "Edit task" : "New task"}</h2>
        <button type="button" disabled={saving} onClick={onClose} aria-label="Close"><X size={17} /></button>
      </header>
      <form onSubmit={submit}>
        <label>Title<input autoFocus required maxLength={300} value={draft.title} onChange={(event) => set("title", event.target.value)} /></label>
        <label>Notes<textarea rows={4} maxLength={10000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></label>
        <div className="task-form-grid">
          <label>Plan date<input type="date" value={draft.scheduled_date ?? ""} onChange={(event) => set("scheduled_date", event.target.value || null)} /></label>
          <label>Start time<input type="time" step={900} disabled={!draft.scheduled_date} value={minutesToTime(draft.start_minute)} onChange={(event) => set("start_minute", timeToMinutes(event.target.value))} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={saving || !draft.title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </footer>
      </form>
    </AccessibleDialog>
  );
}

export function TaskPlanner() {
  const { supabase, user, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const today = useMemo(() => localDate(), []);
  const [view, setView] = useState<PlannerView>("day");
  const [selectedDate, setSelectedDate] = useState(today);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadedOwnerId, setLoadedOwnerId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [message, setMessage] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [editing, setEditing] = useState<PlannerTask | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isAdmin) return;
    setLoadState("loading");
    setMessage("");
    const { data, error } = await supabase
      .from("tasks")
      .select("id,owner_id,title,notes,status,scheduled_date,start_minute,position,completed_at,created_at,updated_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) {
      setLoadState("error");
      setMessage("Could not load your tasks. Check the database migration and try again.");
      return;
    }
    setTasks((data ?? []) as PlannerTask[]);
    setLoadedOwnerId(user.id);
    setLoadState("ready");
  }, [isAdmin, supabase, user]);

  useEffect(() => {
    if (loading || !isAdmin || !user) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [loading, isAdmin, user, load]);

  function replaceTask(next: PlannerTask) {
    setTasks((current) => current.map((task) => task.id === next.id ? next : task));
  }

  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || !user || saving) return;
    setSaving(true);
    setMessage("");
    const { data, error } = await supabase.from("tasks").insert({
      owner_id: user.id,
      title,
      scheduled_date: view === "day" ? selectedDate : null,
      position: Date.now(),
    }).select("*").single();
    if (error) setMessage("Could not create the task. Try again.");
    else {
      setTasks((current) => [data as PlannerTask, ...current]);
      setQuickTitle("");
    }
    setSaving(false);
  }

  function openNew() {
    setEditing(null);
    setDraft(emptyDraft(view === "day" ? selectedDate : null));
    setDialogError("");
  }

  function openEdit(task: PlannerTask) {
    setEditing(task);
    setDraft(draftFromTask(task));
    setDialogError("");
  }

  async function saveDraft(nextDraft: TaskDraft) {
    if (!user || saving) return;
    setSaving(true);
    setDialogError("");
    const payload = {
      ...nextDraft,
      owner_id: user.id,
      position: editing?.position ?? Date.now(),
    };
    const query = editing
      ? supabase.from("tasks").update(payload).eq("id", editing.id).eq("owner_id", user.id)
      : supabase.from("tasks").insert(payload);
    const { data, error } = await query.select("*").single();
    if (error) setDialogError(error.message || "Could not save the task.");
    else {
      const next = data as PlannerTask;
      setTasks((current) => editing
        ? current.map((task) => task.id === next.id ? next : task)
        : [next, ...current]);
      setDraft(null);
      setEditing(null);
    }
    setSaving(false);
  }

  async function toggleComplete(task: PlannerTask) {
    if (!user || saving) return;
    setSaving(true);
    setMessage("");
    const completing = task.status === "open";
    const { data, error } = await supabase.from("tasks").update({
      status: completing ? "completed" : "open",
      completed_at: completing ? new Date().toISOString() : null,
    }).eq("id", task.id).eq("owner_id", user.id).select("*").single();
    if (error) setMessage("Could not update the task. Try again.");
    else replaceTask(data as PlannerTask);
    setSaving(false);
  }

  async function deleteTask(task: PlannerTask) {
    if (!user || saving || !window.confirm(`Permanently delete “${task.title}”?`)) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("tasks").delete().eq("id", task.id).eq("owner_id", user.id);
    if (error) setMessage("Could not delete the task. Try again.");
    else setTasks((current) => current.filter((item) => item.id !== task.id));
    setSaving(false);
  }

  if (loading) return <OwnerAccess icon={<ListTodo size={28} />} title="Tasks" description="Checking owner access…" />;
  if (authError) return <OwnerAccess icon={<ListTodo size={28} />} title="Tasks" description="The account check could not be completed." status={authError} action={<button className="account-control" type="button" onClick={retryAuth}>Retry account check</button>} />;
  if (!user || !isAdmin) return <OwnerAccess icon={<ListTodo size={28} />} title="Private Tasks" description="Only the site owner can view and plan private tasks. Use Sign in in the top toolbar to continue." />;
  if (loadState === "idle" || loadState === "loading" || loadedOwnerId !== user.id) return <OwnerAccess icon={<ListTodo size={28} />} title="Tasks" description="Loading your planner…" />;
  if (loadState === "error") return <OwnerAccess icon={<ListTodo size={28} />} title="Tasks" description="The planner could not be loaded." status={message} action={<button className="account-control" type="button" onClick={() => void load()}>Try again</button>} />;

  const inboxTasks = tasks.filter((task) => task.status === "open" && !task.scheduled_date).sort(compareTasks);
  const dayTasks = tasks.filter((task) => task.scheduled_date === selectedDate).sort(compareTasks);
  const anytimeTasks = dayTasks.filter((task) => task.start_minute === null);
  const timedTasks = dayTasks.filter((task) => task.start_minute !== null);
  const rowProps = { onEdit: openEdit, onToggle: toggleComplete, onDelete: deleteTask };

  return (
    <section className="tasks-layout">
      <aside className="tasks-sidebar" id="page-sidebar">
        <p className="tasks-sidebar-label">Plan</p>
        <nav>
          <button className={view === "inbox" ? "selected" : ""} type="button" onClick={() => setView("inbox")}><Inbox size={16} /> Inbox <span>{inboxTasks.length}</span></button>
          <button className={view === "day" && selectedDate === today ? "selected" : ""} type="button" onClick={() => { setSelectedDate(today); setView("day"); }}><Clock3 size={16} /> Today <span>{tasks.filter((task) => task.status === "open" && task.scheduled_date === today).length}</span></button>
        </nav>
        <p className="tasks-sidebar-label">Choose a day</p>
        <label className="tasks-date-picker"><CalendarClock size={16} /><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) { setSelectedDate(event.target.value); setView("day"); } }} /></label>
      </aside>

      <main className="tasks-main">
        <header className="tasks-header">
          <div>
            <p className="section-label">PERSONAL WORKSPACE / OWNER ONLY</p>
            <h1>{view === "inbox" ? "Inbox" : selectedDate === today ? "Today" : formatDate(selectedDate, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</h1>
            <p>{view === "inbox" ? "Capture first. Choose a day when you are ready." : `${formatDate(selectedDate, { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${dayTasks.filter((task) => task.status === "open").length} open`}</p>
          </div>
          <div className="tasks-header-actions">
            {view === "day" && <>
              <button type="button" onClick={() => setSelectedDate((date) => addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
              <button type="button" onClick={() => setSelectedDate(today)}>Today</button>
              <button type="button" onClick={() => setSelectedDate((date) => addDays(date, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
            </>}
            <button className="tasks-primary" type="button" onClick={openNew}><Plus size={16} /> New task</button>
          </div>
        </header>

        {message && <div className="tasks-message" role="alert">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss"><X size={14} /></button></div>}

        <form className="quick-task" onSubmit={quickAdd}>
          <Plus size={17} />
          <input aria-label="Quick task title" maxLength={300} placeholder={view === "inbox" ? "Capture a task…" : "Add a task for this day…"} value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} />
          <button type="submit" disabled={saving || !quickTitle.trim()}>Add</button>
        </form>

        {view === "inbox" ? <section className="task-list-view">
          {inboxTasks.length ? inboxTasks.map((task) => <TaskRow key={task.id} task={task} {...rowProps} />) : <div className="tasks-empty"><Inbox size={30} /><h2>Inbox clear</h2><p>Tasks without a planned day will appear here.</p></div>}
        </section> : <section className="day-planner">
          <div className="planner-section">
            <header><h2>Any time</h2><span>{anytimeTasks.length}</span></header>
            {anytimeTasks.length ? anytimeTasks.map((task) => <TaskRow key={task.id} task={task} {...rowProps} />) : <p className="planner-empty">No flexible tasks planned for this day.</p>}
          </div>
          <div className="planner-section planner-schedule">
            <header><h2>Schedule</h2><span>{timedTasks.length}</span></header>
            {timedTasks.length ? timedTasks.map((task) => <div className="planner-time-row" key={task.id}><time>{minutesToTime(task.start_minute)}</time><TaskRow task={task} {...rowProps} /></div>) : <p className="planner-empty">Add a start time to place a task on the schedule.</p>}
          </div>
        </section>}
      </main>

      {draft && <TaskDialog key={`${editing?.id ?? "new"}-${draft.scheduled_date ?? "inbox"}`} task={editing} initial={draft} saving={saving} error={dialogError} onClose={() => { if (!saving) { setDraft(null); setEditing(null); } }} onSave={saveDraft} />}
    </section>
  );
}
