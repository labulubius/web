"use client";

import { closestCenter, DndContext, DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, CheckCircle2, Circle, Folder, Home, ListTodo, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import { addDays, daysBetween, monthEnd, monthStart, shortDate, validTimelineRange } from "./task-calendar";
import { ProjectDialog, TaskDialog, type TaskDialogValue } from "./task-dialogs";
import { GanttView } from "./gantt-view";
import type { PersonalTask, TaskData, TaskDraft, TaskProject } from "./task-types";

const LOCATION_KEY = "site-tasks-location-v1";
type View = "gantt" | "all" | "project";
type StoredLocation = { version: 1; view: View; projectId: string | null; timelineStart: string; timelineEnd: string };

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

function TaskList({ tasks, empty, projects, onOpen, onComplete, onDelete }: {
  tasks: PersonalTask[];
  empty: string;
  projects: TaskProject[];
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
  onDelete: (task: PersonalTask) => void;
}) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (!tasks.length) return <div className="task-empty"><CheckCircle2 size={30} /><strong>Nothing here</strong><span>{empty}</span></div>;
  return <ul className="task-list">{tasks.map((task) => <li key={task.id}>
    <button className="task-check" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" onClick={() => onComplete(task)}><Circle size={15} /></button>
    <button className="task-list-main" type="button" onClick={() => onOpen({ task })}>
      <strong>{task.title}</strong><span>{task.projectId ? task.startDate && task.endDate ? `${projectNames.get(task.projectId) ?? "Project"} · ${shortDate(task.startDate)} – ${shortDate(task.endDate)}` : `${projectNames.get(task.projectId) ?? "Project"} · Not scheduled` : "Uncategorized"}</span>
    </button>
    <span className="task-list-actions">
      <button type="button" onClick={() => onOpen({ task })} aria-label={`Edit ${task.title}`} title="Edit task"><Pencil size={14} /></button>
      <button type="button" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`} title="Delete task"><Trash2 size={14} /></button>
    </span>
  </li>)}</ul>;
}

function SortableProjectRow({ project, active, disabled, onSelect, onEdit, onDelete }: {
  project: TaskProject;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled });
  return <div className={`${active ? "selected" : ""} reorderable${isDragging ? " dragging" : ""}`} ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}>
    <button type="button" onClick={onSelect} aria-current={active ? "page" : undefined} {...attributes} {...listeners}><Folder size={15} /><span title={project.name}>{project.name}</span></button>
    <span className="tasks-project-actions" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={onEdit} aria-label={`Edit ${project.name}`} title="Edit project"><Pencil size={12} /></button>
      <button type="button" onClick={onDelete} aria-label={`Delete ${project.name}`} title="Delete project"><Trash2 size={12} /></button>
    </span>
  </div>;
}

function readLocation(projects: TaskProject[]): StoredLocation | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCATION_KEY) ?? "null") as Partial<StoredLocation> | null;
    if (!value || value.version !== 1 || !["gantt", "all", "inbox", "project"].includes(String(value.view)) || !validTimelineRange(value.timelineStart, value.timelineEnd)) return null;
    const savedView: View = String(value.view) === "inbox" ? "all" : value.view as View;
    if (savedView === "project" && (!value.projectId || !projects.some((project) => project.id === value.projectId))) return { ...value, view: "all", projectId: null } as StoredLocation;
    return { version: 1, view: savedView, projectId: savedView === "project" ? value.projectId ?? null : null, timelineStart: String(value.timelineStart), timelineEnd: String(value.timelineEnd) };
  } catch {
    return null;
  }
}

export function TaskManager() {
  const { supabase, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [data, setData] = useState<TaskData | null>(null);
  const [view, setView] = useState<View>("gantt");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [timelineStart, setTimelineStart] = useState(() => monthStart());
  const [timelineEnd, setTimelineEnd] = useState(() => monthEnd());
  const [locationReady, setLocationReady] = useState(false);
  const [taskDialog, setTaskDialog] = useState<TaskDialogValue | null>(null);
  const [projectDialog, setProjectDialog] = useState<TaskProject | "new" | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestGeneration = useRef(0);
  const locationRestored = useRef(false);
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
    try {
      const next = await api("/api/tasks");
      if (generation === requestGeneration.current) {
        setData(next);
        if (!locationRestored.current) {
          locationRestored.current = true;
          const saved = readLocation(next.projects);
          if (saved) { setView(saved.view); setProjectId(saved.projectId); setTimelineStart(saved.timelineStart); setTimelineEnd(saved.timelineEnd); }
          setLocationReady(true);
        }
      }
    }
    catch (failure) { if (generation === requestGeneration.current) setError(failure instanceof Error ? failure.message : "Could not load tasks."); }
    finally { if (generation === requestGeneration.current) setLoadingData(false); }
  }, [api, isAdmin]);

  useEffect(() => {
    const generation = requestGeneration;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [load]);

  useEffect(() => {
    if (!locationReady) return;
    try { window.localStorage.setItem(LOCATION_KEY, JSON.stringify({ version: 1, view, projectId, timelineStart, timelineEnd } satisfies StoredLocation)); }
    catch { /* Task navigation still works when browser storage is unavailable. */ }
  }, [locationReady, projectId, timelineEnd, timelineStart, view]);

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
    if (!window.confirm(`Delete project “${project.name}”? Its tasks will become Uncategorized and lose their dates.`)) return;
    const ok = await mutate(`/api/tasks/projects/${project.id}`, { method: "DELETE" }, "Project deleted. Its tasks are now Uncategorized.");
    if (ok) { setProjectDialog(null); if (projectId === project.id) { setProjectId(null); setView("all"); } }
  }

  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    if (!title) return;
    const selectedProject = view === "project" ? projectId : null;
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, projectId: selectedProject }) }, selectedProject ? "Task added to project." : "Task added.");
    if (ok) form.reset();
  }

  function select(next: View, selectedProject: string | null = null) { setView(next); setProjectId(selectedProject); setError(""); setMessage(""); }

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = String(form.get("timelineStart") ?? "");
    const endDate = String(form.get("timelineEnd") ?? "");
    if (!validTimelineRange(startDate, endDate)) { setError("Choose an ordered date range of no more than two months."); return; }
    setTimelineStart(startDate); setTimelineEnd(endDate); setError(""); setMessage("");
  }

  async function projectDragEnd(event: DragEndEvent) {
    if (!data || !event.over || event.active.id === event.over.id || saving) return;
    const sourceIndex = data.projects.findIndex((project) => project.id === event.active.id);
    const targetIndex = data.projects.findIndex((project) => project.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const before = data;
    const projects = arrayMove(data.projects, sourceIndex, targetIndex);
    setData({ ...data, projects });
    const ok = await mutate("/api/tasks/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectIds: projects.map((project) => project.id) }) }, "Projects reordered.");
    if (!ok) setData(before);
  }

  function dragEnd(event: DragEndEvent) {
    if (!data || !event.over || saving) return;
    const id = String(event.active.id).replace(/^task:/, "");
    const task = data.tasks.find((item) => item.id === id);
    if (!task?.projectId) return;
    const match = String(event.over.id).match(/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return;
    const length = task.startDate && task.endDate ? daysBetween(task.startDate, task.endDate) : 0;
    void patchTask(task, { startDate: match[1], endDate: addDays(match[1], length) }, "Task dates updated.");
  }

  const allTasks = useMemo(() => data?.tasks ?? [], [data]);
  const selectedProject = data?.projects.find((project) => project.id === projectId) ?? null;
  const projectTasks = selectedProject ? data?.tasks.filter((task) => task.projectId === selectedProject.id) ?? [] : [];
  const title = view === "all" ? "All tasks" : view === "project" ? selectedProject?.name ?? "Project" : "Gantt";
  const description = view === "all" ? "All project and uncategorized tasks." : "Scheduled and unscheduled tasks in this project.";

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
          <button className={view === "all" ? "selected" : ""} aria-current={view === "all" ? "page" : undefined} type="button" onClick={() => select("all")}><ListTodo size={16} /><span>All tasks</span></button>
          <button className={view === "gantt" ? "selected" : ""} aria-current={view === "gantt" ? "page" : undefined} type="button" onClick={() => select("gantt")}><CalendarRange size={16} /><span>Gantt</span></button>
        </nav>
        <div className="tasks-project-heading"><h2>Projects</h2><button type="button" onClick={() => setProjectDialog("new")} aria-label="Create project" title="Create project"><Plus size={14} /></button></div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void projectDragEnd(event)}>
          <SortableContext items={data.projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
            <div className="tasks-project-list">{data.projects.length === 0 ? <p>No projects yet</p> : data.projects.map((project) => <SortableProjectRow key={project.id} project={project} active={view === "project" && projectId === project.id} disabled={saving} onSelect={() => select("project", project.id)} onEdit={() => setProjectDialog(project)} onDelete={() => void deleteProject(project)} />)}</div>
          </SortableContext>
        </DndContext>
      </aside>

      <main className="task-main">
        <header className="task-header">
          <div><p>PERSONAL WORKSPACE / OWNER ONLY</p><h1>{title}</h1>{view !== "gantt" && <span>{description}</span>}</div>
          {view === "gantt" && <form key={`${timelineStart}:${timelineEnd}`} className="task-range-form" onSubmit={applyRange}><label>From<input name="timelineStart" type="date" defaultValue={timelineStart} required /></label><span aria-hidden="true">–</span><label>To<input name="timelineEnd" type="date" defaultValue={timelineEnd} required /></label><button type="submit">Apply</button></form>}
        </header>
        <form className="task-quick-add" onSubmit={(event) => void quickAdd(event)}><Plus size={17} /><label className="sr-only" htmlFor="quick-task-title">Quick add task</label><input id="quick-task-title" name="title" maxLength={200} placeholder={view === "project" ? `Add a task to ${selectedProject?.name ?? "project"}…` : "Add a task…"} autoComplete="off" /><button type="submit" disabled={saving}>Add task</button></form>
        {message && <p className="task-message" role="status">{message}</p>}
        {error && <p className="task-error" role="alert">{error}</p>}
        {view === "gantt" ? <GanttView timelineStart={timelineStart} timelineEnd={timelineEnd} tasks={data.tasks} projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onResize={(task, startDate, endDate) => void patchTask(task, { startDate, endDate }, "Task dates updated.")} /> : <TaskList tasks={view === "all" ? allTasks : projectTasks} empty={view === "all" ? "There are no tasks yet." : "This project has no tasks."} projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onDelete={(task) => void deleteTask(task)} />}
      </main>
    </div>
    {taskDialog && <TaskDialog value={taskDialog} projects={data.projects} busy={saving} onClose={() => setTaskDialog(null)} onSave={saveTask} />}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} busy={saving} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
  </DndContext>;
}
