"use client";

import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Folder, Inbox, ListTodo, Pencil, Plus, RefreshCw, Sun } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OwnerAccess } from "../owner-access";
import { useSiteAuth } from "../site-auth";
import { addDays, localDate, longDate, mondayOf, shortDate, timeLabel } from "./task-calendar";
import { ProjectDialog, TaskDialog, type TaskDialogValue } from "./task-dialogs";
import type { PersonalTask, TaskData, TaskDraft, TaskProject } from "./task-types";
import { WeekView } from "./week-view";

type View = "week" | "inbox" | "today" | "completed" | "project";

function TaskList({ tasks, empty, projects, onOpen, onComplete }: {
  tasks: PersonalTask[];
  empty: string;
  projects: TaskProject[];
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
}) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (!tasks.length) return <div className="task-empty"><CheckCircle2 size={30} /><strong>Nothing here</strong><span>{empty}</span></div>;
  return <ul className="task-list">{tasks.map((task) => <li key={task.id} className={task.completedAt ? "is-completed" : ""}>
    <button className="task-check" type="button" aria-label={`${task.completedAt ? "Restore" : "Complete"} ${task.title}`} title={task.completedAt ? "Restore task" : "Complete task"} onClick={() => onComplete(task)}>{task.completedAt ? <Check size={15} /> : <Circle size={15} />}</button>
    <button className="task-list-main" type="button" onClick={() => onOpen({ task })}>
      <strong>{task.title}</strong>
      <span>{task.date ? `${shortDate(task.date)}${task.startMinute === null ? " · All day" : ` · ${timeLabel(task.startMinute)}–${timeLabel(task.startMinute + task.durationMinutes)}`}` : "Inbox"}{task.projectId && projectNames.get(task.projectId) ? ` · ${projectNames.get(task.projectId)}` : ""}</span>
    </button>
  </li>)}</ul>;
}

export function TaskManager() {
  const { supabase, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [data, setData] = useState<TaskData | null>(null);
  const [view, setView] = useState<View>("week");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => mondayOf());
  const [taskDialog, setTaskDialog] = useState<TaskDialogValue | null>(null);
  const [projectDialog, setProjectDialog] = useState<TaskProject | "new" | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestGeneration = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${sessionData.session.access_token}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as { data?: TaskData; error?: string } | null;
    if (!response.ok) throw new Error(`${body?.error ?? "Task request failed."} (HTTP ${response.status})`);
    if (!body?.data) throw new Error("Task response was incomplete.");
    return body.data;
  }, [supabase]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const generation = ++requestGeneration.current;
    setLoadingData(true); setError("");
    try {
      const next = await api("/api/tasks");
      if (generation === requestGeneration.current) setData(next);
    } catch (failure) {
      if (generation === requestGeneration.current) setError(failure instanceof Error ? failure.message : "Could not load tasks.");
    } finally { if (generation === requestGeneration.current) setLoadingData(false); }
  }, [api, isAdmin]);

  useEffect(() => {
    const generation = requestGeneration;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [load]);

  async function mutate(url: string, options: RequestInit, success: string) {
    setSaving(true); setError(""); setMessage("");
    try { setData(await api(url, options)); setMessage(success); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Task operation failed."); return false; }
    finally { setSaving(false); }
  }

  async function createTask(draft: TaskDraft) {
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }, "Task created.");
    if (ok) setTaskDialog(null);
  }

  async function patchTask(task: PersonalTask, patch: Record<string, unknown>, success = "Task updated.") {
    const before = data;
    if (data) setData({ ...data, tasks: data.tasks.map((item) => item.id === task.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } as PersonalTask : item) });
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }, success);
    if (!ok && before) setData(before);
    return ok;
  }

  async function saveTask(draft: TaskDraft) {
    if (taskDialog?.task) {
      if (await patchTask(taskDialog.task, draft)) setTaskDialog(null);
    } else await createTask(draft);
  }

  async function completeTask(task: PersonalTask, completed = !task.completedAt) {
    if (await patchTask(task, { completed }, completed ? "Task completed." : "Task restored.")) setTaskDialog(null);
  }

  async function deleteTask(task: PersonalTask) {
    if (!window.confirm(`Permanently delete “${task.title}”? This cannot be undone.`)) return;
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" }, "Task deleted.");
    if (ok) setTaskDialog(null);
  }

  async function saveProject(name: string) {
    const editing = projectDialog !== "new" && projectDialog;
    const url = editing ? `/api/tasks/projects/${editing.id}` : "/api/tasks/projects";
    const ok = await mutate(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, editing ? "Project renamed." : "Project created.");
    if (ok) setProjectDialog(null);
  }

  async function deleteProject(project: TaskProject) {
    if (!window.confirm(`Delete project “${project.name}”? Its tasks will be kept without a project.`)) return;
    const ok = await mutate(`/api/tasks/projects/${project.id}`, { method: "DELETE" }, "Project deleted. Its tasks were kept.");
    if (ok) { setProjectDialog(null); if (projectId === project.id) { setProjectId(null); setView("inbox"); } }
  }

  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form).get("title");
    const title = String(input ?? "").trim();
    if (!title) return;
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }, "Task added to Inbox.");
    if (ok) form.reset();
  }

  function select(next: View, selectedProject: string | null = null) { setView(next); setProjectId(selectedProject); setError(""); setMessage(""); }

  function dragEnd(event: DragEndEvent) {
    if (!data || !event.over || saving) return;
    const id = String(event.active.id).replace(/^task:/, "");
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return;
    const destination = String(event.over.id);
    if (destination === "inbox") { void patchTask(task, { date: null, startMinute: null }, "Task returned to Inbox."); return; }
    const match = destination.match(/^slot:(\d{4}-\d{2}-\d{2}):(all|\d+)$/);
    if (!match) return;
    const startMinute = match[2] === "all" ? null : Number(match[2]);
    const durationMinutes = startMinute === null ? task.durationMinutes : Math.min(task.durationMinutes, 1440 - startMinute);
    void patchTask(task, { date: match[1], startMinute, durationMinutes }, "Task scheduled.");
  }

  const activeTasks = useMemo(() => data?.tasks.filter((task) => !task.completedAt) ?? [], [data]);
  const today = localDate();
  const selectedProject = data?.projects.find((project) => project.id === projectId) ?? null;
  let title = "Week";
  let description = `${longDate(weekStart)} – ${longDate(addDays(weekStart, 6))}`;
  let listTasks: PersonalTask[] | null = null;
  let empty = "Create a task to get started.";
  if (view === "inbox") { title = "Inbox"; description = "Tasks you have captured but not scheduled."; listTasks = activeTasks.filter((task) => !task.date); empty = "Your Inbox is clear."; }
  if (view === "today") { title = "Today"; description = longDate(today); listTasks = activeTasks.filter((task) => task.date === today).sort((a, b) => (a.startMinute ?? -1) - (b.startMinute ?? -1)); empty = "Nothing is scheduled for today."; }
  if (view === "completed") { title = "Completed"; description = "Recently completed tasks."; listTasks = [...(data?.tasks.filter((task) => task.completedAt) ?? [])].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))); empty = "Completed tasks will appear here."; }
  if (view === "project") { title = selectedProject?.name ?? "Project"; description = "Open tasks in this project."; listTasks = activeTasks.filter((task) => task.projectId === projectId); empty = "This project has no open tasks."; }

  if (loading) return <OwnerAccess icon={<ListTodo size={28} />} title="Personal Tasks" description="Checking owner access…" />;
  if (authError) return <OwnerAccess icon={<ListTodo size={28} />} title="Personal Tasks" description="The account check could not be completed." status={authError} action={<button className="account-control" type="button" onClick={retryAuth}>Retry account check</button>} />;
  if (!isAdmin) return <OwnerAccess icon={<ListTodo size={28} />} title="Personal Tasks" description="Only the site owner can view and manage this private schedule. Use Sign in in the top toolbar to continue." />;
  if (loadingData && !data) return <section className="task-loading" role="status"><RefreshCw size={20} /> Loading tasks…</section>;
  if (!data) return <section className="task-loading"><p role="alert">{error || "Could not load tasks."}</p><button type="button" onClick={() => void load()}>Retry</button></section>;

  return <DndContext sensors={sensors} onDragEnd={dragEnd}>
    <div className="task-layout">
      <aside id="page-sidebar" className="places-sidebar tasks-sidebar" aria-label="Task views">
        <div className="tasks-sidebar-heading"><span>Tasks</span><button type="button" onClick={() => setTaskDialog({})} aria-label="Create task" title="Create task"><Plus size={15} /></button></div>
        <nav aria-label="Task navigation">
          <button className={view === "inbox" ? "selected" : ""} aria-current={view === "inbox" ? "page" : undefined} type="button" onClick={() => select("inbox")}><Inbox size={16} /><span>Inbox</span><small>{activeTasks.filter((task) => !task.date).length}</small></button>
          <button className={view === "today" ? "selected" : ""} aria-current={view === "today" ? "page" : undefined} type="button" onClick={() => select("today")}><Sun size={16} /><span>Today</span><small>{activeTasks.filter((task) => task.date === today).length}</small></button>
          <button className={view === "week" ? "selected" : ""} aria-current={view === "week" ? "page" : undefined} type="button" onClick={() => select("week")}><CalendarDays size={16} /><span>Week</span></button>
          <button className={view === "completed" ? "selected" : ""} aria-current={view === "completed" ? "page" : undefined} type="button" onClick={() => select("completed")}><CheckCircle2 size={16} /><span>Completed</span></button>
        </nav>
        <div className="tasks-project-heading"><span>Projects</span><button type="button" onClick={() => setProjectDialog("new")} aria-label="Create project" title="Create project"><Plus size={14} /></button></div>
        <div className="tasks-project-list">{data.projects.length === 0 ? <p>No projects yet</p> : data.projects.map((project) => <div key={project.id} className={view === "project" && projectId === project.id ? "selected" : ""}><button type="button" onClick={() => select("project", project.id)} aria-current={view === "project" && projectId === project.id ? "page" : undefined}><Folder size={15} /><span title={project.name}>{project.name}</span></button><button className="tasks-project-edit" type="button" onClick={() => setProjectDialog(project)} aria-label={`Edit ${project.name}`} title="Edit project"><Pencil size={12} /></button></div>)}</div>
      </aside>

      <main className="task-main">
        <header className="task-header">
          <div><p>PERSONAL WORKSPACE / OWNER ONLY</p><h1>{title}</h1><span>{description}</span></div>
          {view === "week" && <div className="task-week-controls"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" title="Previous week"><ChevronLeft size={17} /></button><button type="button" onClick={() => setWeekStart(mondayOf())}>This week</button><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" title="Next week"><ChevronRight size={17} /></button></div>}
        </header>
        <form className="task-quick-add" onSubmit={(event) => void quickAdd(event)}><Plus size={17} /><label className="sr-only" htmlFor="quick-task-title">Quick add task</label><input id="quick-task-title" name="title" maxLength={200} placeholder="Add a task to Inbox…" autoComplete="off" /><button type="submit" disabled={saving}>Add task</button></form>
        {message && <p className="task-message" role="status">{message}</p>}
        {error && <p className="task-error" role="alert">{error}</p>}
        {view === "week" ? <WeekView weekStart={weekStart} tasks={data.tasks} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onResize={(task, durationMinutes) => void patchTask(task, { durationMinutes }, "Task duration updated.")} /> : <TaskList tasks={listTasks ?? []} empty={empty} projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} />}
      </main>
    </div>
    {taskDialog && <TaskDialog value={taskDialog} projects={data.projects} busy={saving} onClose={() => setTaskDialog(null)} onSave={saveTask} onComplete={completeTask} onDelete={deleteTask} />}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} busy={saving} onClose={() => setProjectDialog(null)} onSave={saveProject} onDelete={deleteProject} />}
  </DndContext>;
}
