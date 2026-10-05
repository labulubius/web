"use client";

import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Circle, Folder, Home, Inbox, Pencil, Plus, RefreshCw } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import { addDays, daysBetween, monthLabel, monthStart, shiftMonth } from "./task-calendar";
import { ProjectDialog, TaskDialog, type TaskDialogValue } from "./task-dialogs";
import { GanttView } from "./gantt-view";
import type { PersonalTask, TaskData, TaskDraft, TaskProject } from "./task-types";

type View = "gantt" | "inbox" | "project";

function HomeAccess({ description, status, action }: { description: string; status?: string; action?: ReactNode }) {
  return <section className="owner-access">
    <span className="owner-access-icon" aria-hidden="true"><Home size={28} /></span>
    <p className="section-label">LABULUBIUS WORKSPACE</p>
    <h1>Home</h1>
    <p>{description}</p>
    {status && <p className="owner-access-status" role="alert">{status}</p>}
    {action && <div className="owner-access-actions">{action}</div>}
  </section>;
}

function TaskList({ tasks, empty, projects, onOpen, onComplete }: {
  tasks: PersonalTask[];
  empty: string;
  projects: TaskProject[];
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
}) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (!tasks.length) return <div className="task-empty"><CheckCircle2 size={30} /><strong>Nothing here</strong><span>{empty}</span></div>;
  return <ul className="task-list">{tasks.map((task) => <li key={task.id}>
    <button className="task-check" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" onClick={() => onComplete(task)}><Circle size={15} /></button>
    <button className="task-list-main" type="button" onClick={() => onOpen({ task })}>
      <strong>{task.title}</strong><span>{task.projectId && projectNames.get(task.projectId) ? projectNames.get(task.projectId) : "Inbox"}</span>
    </button>
  </li>)}</ul>;
}

export function TaskManager() {
  const { supabase, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [data, setData] = useState<TaskData | null>(null);
  const [view, setView] = useState<View>("gantt");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [timelineStart, setTimelineStart] = useState(() => monthStart());
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
    const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${sessionData.session.access_token}` }, cache: "no-store" });
    const body = await response.json().catch(() => null) as { data?: TaskData; error?: string } | null;
    if (!response.ok) throw new Error(`${body?.error ?? "Task request failed."} (HTTP ${response.status})`);
    if (!body?.data) throw new Error("Task response was incomplete.");
    return body.data;
  }, [supabase]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const generation = ++requestGeneration.current;
    setLoadingData(true); setError("");
    try { const next = await api("/api/tasks"); if (generation === requestGeneration.current) setData(next); }
    catch (failure) { if (generation === requestGeneration.current) setError(failure instanceof Error ? failure.message : "Could not load tasks."); }
    finally { if (generation === requestGeneration.current) setLoadingData(false); }
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

  async function patchTask(task: PersonalTask, patch: Partial<TaskDraft>, success = "Task updated.") {
    const before = data;
    if (data) setData({ ...data, tasks: data.tasks.map((item) => item.id === task.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) });
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }, success);
    if (!ok && before) setData(before);
    return ok;
  }

  async function saveTask(draft: TaskDraft) {
    if (taskDialog?.task) { if (await patchTask(taskDialog.task, draft)) setTaskDialog(null); }
    else await createTask(draft);
  }

  async function completeTask(task: PersonalTask) {
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" }, "Task completed and removed.");
    if (ok) setTaskDialog(null);
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
    if (ok) { setProjectDialog(null); if (projectId === project.id) { setProjectId(null); setView("gantt"); } }
  }

  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    if (!title) return;
    const body = { title, projectId: view === "project" ? projectId : null };
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Task added to Inbox.");
    if (ok) form.reset();
  }

  function select(next: View, selectedProject: string | null = null) { setView(next); setProjectId(selectedProject); setError(""); setMessage(""); }

  function dragEnd(event: DragEndEvent) {
    if (!data || !event.over || saving) return;
    const id = String(event.active.id).replace(/^task:/, "");
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return;
    const destination = String(event.over.id);
    if (destination === "inbox") { void patchTask(task, { startDate: null, endDate: null }, "Task returned to Inbox."); return; }
    const match = destination.match(/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return;
    const length = task.startDate && task.endDate ? daysBetween(task.startDate, task.endDate) : 0;
    void patchTask(task, { startDate: match[1], endDate: addDays(match[1], length) }, "Task dates updated.");
  }

  const inboxTasks = useMemo(() => data?.tasks.filter((task) => !task.startDate) ?? [], [data]);
  const selectedProject = data?.projects.find((project) => project.id === projectId) ?? null;
  const visibleTasks = view === "project" ? data?.tasks.filter((task) => task.projectId === projectId) ?? [] : data?.tasks ?? [];
  const title = view === "inbox" ? "Inbox" : view === "project" ? selectedProject?.name ?? "Project" : "Gantt";
  const description = view === "inbox" ? "Tasks that have not been assigned a date range." : monthLabel(timelineStart);

  if (loading) return <HomeAccess description="Opening home…" />;
  if (authError) return <HomeAccess description="Home is temporarily unavailable." status={authError} action={<button className="account-control" type="button" onClick={retryAuth}>Retry</button>} />;
  if (!isAdmin) return <HomeAccess description="Sign in to continue." />;
  if (loadingData && !data) return <section className="task-loading" role="status"><RefreshCw size={20} /> Loading tasks…</section>;
  if (!data) return <section className="task-loading"><p role="alert">{error || "Could not load tasks."}</p><button type="button" onClick={() => void load()}>Retry</button></section>;

  return <DndContext sensors={sensors} onDragEnd={dragEnd}>
    <div className="task-layout">
      <aside id="page-sidebar" className="places-sidebar tasks-sidebar" aria-label="Task views">
        <div className="tasks-sidebar-heading"><h2>Tasks</h2><button type="button" onClick={() => setTaskDialog({})} aria-label="Create task" title="Create task"><Plus size={14} /></button></div>
        <nav aria-label="Task navigation">
          <button className={view === "gantt" ? "selected" : ""} aria-current={view === "gantt" ? "page" : undefined} type="button" onClick={() => select("gantt")}><CalendarRange size={16} /><span>Gantt</span></button>
          <button className={view === "inbox" ? "selected" : ""} aria-current={view === "inbox" ? "page" : undefined} type="button" onClick={() => select("inbox")}><Inbox size={16} /><span>Inbox</span><small>{inboxTasks.length}</small></button>
        </nav>
        <div className="tasks-project-heading"><h2>Projects</h2><button type="button" onClick={() => setProjectDialog("new")} aria-label="Create project" title="Create project"><Plus size={14} /></button></div>
        <div className="tasks-project-list">{data.projects.length === 0 ? <p>No projects yet</p> : data.projects.map((project) => <div key={project.id} className={view === "project" && projectId === project.id ? "selected" : ""}><button type="button" onClick={() => select("project", project.id)} aria-current={view === "project" && projectId === project.id ? "page" : undefined}><Folder size={15} /><span title={project.name}>{project.name}</span></button><button className="tasks-project-edit" type="button" onClick={() => setProjectDialog(project)} aria-label={`Edit ${project.name}`} title="Edit project"><Pencil size={12} /></button></div>)}</div>
      </aside>

      <main className="task-main">
        <header className="task-header">
          <div><p>PERSONAL WORKSPACE / OWNER ONLY</p><h1>{title}</h1><span>{description}</span></div>
          {view !== "inbox" && <div className="task-month-controls"><button type="button" onClick={() => setTimelineStart(shiftMonth(timelineStart, -1))} aria-label="Previous month" title="Previous month"><ChevronLeft size={17} /></button><button type="button" onClick={() => setTimelineStart(monthStart())}>This month</button><button type="button" onClick={() => setTimelineStart(shiftMonth(timelineStart, 1))} aria-label="Next month" title="Next month"><ChevronRight size={17} /></button></div>}
        </header>
        <form className="task-quick-add" onSubmit={(event) => void quickAdd(event)}><Plus size={17} /><label className="sr-only" htmlFor="quick-task-title">Quick add task</label><input id="quick-task-title" name="title" maxLength={200} placeholder="Add a task to Inbox…" autoComplete="off" /><button type="submit" disabled={saving}>Add task</button></form>
        {message && <p className="task-message" role="status">{message}</p>}
        {error && <p className="task-error" role="alert">{error}</p>}
        {view === "inbox" ? <TaskList tasks={inboxTasks} empty="Your Inbox is clear." projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} /> : <GanttView timelineStart={timelineStart} tasks={visibleTasks} projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onResize={(task, startDate, endDate) => void patchTask(task, { startDate, endDate }, "Task dates updated.")} />}
      </main>
    </div>
    {taskDialog && <TaskDialog value={taskDialog} projects={data.projects} busy={saving} onClose={() => setTaskDialog(null)} onSave={saveTask} onComplete={completeTask} onDelete={deleteTask} />}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} busy={saving} onClose={() => setProjectDialog(null)} onSave={saveProject} onDelete={deleteProject} />}
  </DndContext>;
}
