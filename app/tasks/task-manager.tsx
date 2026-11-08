"use client";

import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, type Modifier, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Circle, Folder, Home, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { FormEvent, ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import { shortDate } from "./task-calendar";
import { ProjectDialog, TaskDialog, type TaskDialogValue } from "./task-dialogs";
import { TASK_ARCHIVE_PROJECT_ID, type PersonalTask, type TaskData, type TaskDraft, type TaskProject } from "./task-types";

const LOCATION_KEY = "site-tasks-location-v1";
type View = "important" | "project";
type StoredLocation = { version: 2; view: View; projectId: string | null };
type TaskPatch = Partial<TaskDraft> & { isImportant?: boolean };

const NAVIGATION_VIEWS = {
  important: { label: "Important", icon: Star },
} as const;

function restrictTaskListDrag(list: HTMLUListElement | null, { active, draggingNodeRect, transform }: Parameters<Modifier>[0]) {
  if (!String(active?.id).startsWith("list:") || !draggingNodeRect || !list) return transform;
  const bounds = list.getBoundingClientRect();
  return {
    ...transform,
    x: 0,
    y: Math.min(
      Math.max(transform.y, bounds.top - draggingNodeRect.top),
      bounds.bottom - draggingNodeRect.bottom,
    ),
  };
}

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

function SortableTaskRow({ task, projectName, disabled, onOpen, onComplete, onImportant, onDelete }: {
  task: PersonalTask;
  projectName: string;
  disabled: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onImportant: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `list:${task.id}`, disabled });
  const stopDragStart = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return <li ref={setNodeRef} className={`reorderable${disabled ? " disabled" : ""}${isDragging ? " dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }} {...listeners}>
    <button className="task-check" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" disabled={disabled} onPointerDown={stopDragStart} onTouchStart={stopDragStart} onKeyDown={stopDragStart} onClick={onComplete}><Circle size={15} /></button>
    <div ref={setActivatorNodeRef} className="task-list-main" aria-label={`Reorder ${task.title}`} {...attributes}>
      <strong>{task.title}</strong><span>{projectName} · {task.startDate && task.endDate ? `${shortDate(task.startDate)} – ${shortDate(task.endDate)}` : "Not scheduled"}</span>
    </div>
    <span className="task-list-actions" onPointerDown={stopDragStart} onTouchStart={stopDragStart} onKeyDown={stopDragStart}>
      <button className={task.isImportant ? "task-important active" : "task-important"} type="button" disabled={disabled} onClick={onImportant} aria-label={`${task.isImportant ? "Remove" : "Add"} ${task.title} ${task.isImportant ? "from" : "to"} Important`} title={task.isImportant ? "Remove from Important" : "Add to Important"}><Star size={14} fill={task.isImportant ? "currentColor" : "none"} /></button>
      <button type="button" disabled={disabled} onClick={onOpen} aria-label={`Edit ${task.title}`} title="Edit task"><Pencil size={14} /></button>
      <button type="button" disabled={disabled} onClick={onDelete} aria-label={`Delete ${task.title}`} title="Delete task"><Trash2 size={14} /></button>
    </span>
  </li>;
}

function TaskList({ tasks, empty, projects, disabled, listRef, onOpen, onComplete, onImportant, onDelete }: {
  tasks: PersonalTask[];
  empty: string;
  projects: TaskProject[];
  disabled: boolean;
  listRef: RefObject<HTMLUListElement | null>;
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
  onImportant: (task: PersonalTask) => void;
  onDelete: (task: PersonalTask) => void;
}) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (!tasks.length) return <div className="task-empty"><CheckCircle2 size={30} /><strong>Nothing here</strong><span>{empty}</span></div>;
  return <SortableContext items={tasks.map((task) => `list:${task.id}`)} strategy={verticalListSortingStrategy}>
    <ul ref={listRef} className="task-list">{tasks.map((task) => <SortableTaskRow
      key={task.id}
      task={task}
      projectName={task.projectId ? projectNames.get(task.projectId) ?? "Project" : "Uncategorized"}
      disabled={disabled}
      onOpen={() => onOpen({ task })}
      onComplete={() => onComplete(task)}
      onImportant={() => onImportant(task)}
      onDelete={() => onDelete(task)}
    />)}</ul>
  </SortableContext>;
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
    const value = JSON.parse(window.localStorage.getItem(LOCATION_KEY) ?? "null") as
      { version?: number; view?: string; projectId?: string | null } | null;
    if (!value || ![1, 2].includes(value.version ?? -1)) return null;
    const projectId = value.view === "archive" ? TASK_ARCHIVE_PROJECT_ID : value.projectId ?? null;
    if ((value.view === "project" || value.view === "archive") && projectId && projects.some((project) => project.id === projectId)) {
      return { version: 2, view: "project", projectId };
    }
    if (["all", "inbox", "uncategorized", "project", "archive", "important", "gantt"].includes(value.view ?? "")) {
      return { version: 2, view: "important", projectId: null };
    }
    return null;
  } catch {
    return null;
  }
}

export function TaskManager() {
  const { supabase, user, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const accountId = user?.id ?? null;
  const [data, setData] = useState<TaskData | null>(null);
  const [dataAccountId, setDataAccountId] = useState<string | null>(null);
  const [view, setView] = useState<View>("important");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const [taskDialog, setTaskDialog] = useState<TaskDialogValue | null>(null);
  const [projectDialog, setProjectDialog] = useState<TaskProject | "new" | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const accountIdRef = useRef(accountId);
  const requestGeneration = useRef(0);
  const locationRestored = useRef(false);
  const taskListRef = useRef<HTMLUListElement | null>(null);
  const taskListModifier = useCallback<Modifier>((args) => restrictTaskListDrag(taskListRef.current, args), []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const authenticatedRequest = useCallback(async <T,>(url: string, options: RequestInit = {}) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${sessionData.session.access_token}` }, cache: "no-store" });
    const body = await response.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!response.ok) throw new Error(`${body?.error ?? "Task request failed."} (HTTP ${response.status})`);
    if (!body) throw new Error("Task response was incomplete.");
    return body;
  }, [supabase]);

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const body = await authenticatedRequest<{ data?: TaskData }>(url, options);
    if (!body.data) throw new Error("Task response was incomplete.");
    return body.data;
  }, [authenticatedRequest]);

  const load = useCallback(async () => {
    if (!isAdmin || !accountId) return;
    const requestedAccountId = accountId;
    const generation = ++requestGeneration.current;
    setLoadingData(true); setError("");
    try {
      const next = await api("/api/tasks");
      if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) {
        setData(next);
        setDataAccountId(requestedAccountId);
        if (!locationRestored.current) {
          locationRestored.current = true;
          const saved = readLocation(next.projects);
          if (saved) { setView(saved.view); setProjectId(saved.projectId); }
          setLocationReady(true);
        }
      }
    }
    catch (failure) { if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) setError(failure instanceof Error ? failure.message : "Could not load tasks."); }
    finally { if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) setLoadingData(false); }
  }, [accountId, api, isAdmin]);

  useLayoutEffect(() => {
    accountIdRef.current = accountId;
    requestGeneration.current++;
    const reset = window.setTimeout(() => {
      if (accountIdRef.current !== accountId) return;
      setData(null);
      setDataAccountId(null);
      setLoadingData(true);
      setTaskDialog(null);
      setProjectDialog(null);
      setLocationReady(false);
      locationRestored.current = false;
    }, 0);
    return () => window.clearTimeout(reset);
  }, [accountId]);

  useEffect(() => {
    const generation = requestGeneration;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [load]);

  useEffect(() => {
    if (!locationReady) return;
    try { window.localStorage.setItem(LOCATION_KEY, JSON.stringify({ version: 2, view, projectId } satisfies StoredLocation)); }
    catch { /* Task navigation still works when browser storage is unavailable. */ }
  }, [locationReady, projectId, view]);

  async function mutate(url: string, options: RequestInit) {
    setSaving(true); setError("");
    try { setData(await api(url, options)); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save changes."); return false; }
    finally { setSaving(false); }
  }

  async function createTask(draft: TaskDraft) {
    return mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
  }

  async function patchTask(task: PersonalTask, patch: TaskPatch) {
    const before = data;
    if (data) setData({ ...data, tasks: data.tasks.map((item) => item.id === task.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) });
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!ok && before) setData(before);
    return ok;
  }

  async function toggleImportant(task: PersonalTask) {
    if (!data) return;
    const before = data;
    const isImportant = !task.isImportant;
    const importantSortOrder = isImportant
      ? Math.max(-1, ...data.tasks.filter((item) => item.isImportant).map((item) => item.importantSortOrder ?? -1)) + 1
      : null;
    setData({ ...data, tasks: data.tasks.map((item) => item.id === task.id ? { ...item, isImportant, importantSortOrder } : item) });
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isImportant }) });
    if (!ok) setData(before);
  }

  function closeTaskDialog() {
    setTaskDialog(null);
  }

  const rememberTaskDraft = useCallback((draft: TaskDraft) => {
    // SiteAuth may briefly unmount TaskDialog while rechecking a resumed tab;
    // keep the uncontrolled form values in this still-mounted parent state.
    setTaskDialog((current) => {
      if (!current || current.draft &&
        current.draft.title === draft.title && current.draft.description === draft.description &&
        current.draft.projectId === draft.projectId && current.draft.startDate === draft.startDate &&
        current.draft.endDate === draft.endDate) return current;
      return { ...current, draft };
    });
  }, []);

  async function saveTask(draft: TaskDraft) {
    const ok = taskDialog?.task ? await patchTask(taskDialog.task, draft) : await createTask(draft);
    if (ok) closeTaskDialog();
  }

  async function completeTask(task: PersonalTask) {
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (ok) closeTaskDialog();
  }

  async function deleteTask(task: PersonalTask) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (ok) closeTaskDialog();
  }

  async function saveProject(name: string) {
    const editing = projectDialog !== "new" && projectDialog;
    const url = editing ? `/api/tasks/projects/${editing.id}` : "/api/tasks/projects";
    const ok = await mutate(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (ok) setProjectDialog(null);
  }

  async function deleteProject(project: TaskProject) {
    if (!window.confirm(`Delete project “${project.name}”? Its tasks will become Uncategorized and keep their dates. Tasks not marked Important will no longer appear in the sidebar.`)) return;
    const ok = await mutate(`/api/tasks/projects/${project.id}`, { method: "DELETE" });
    if (ok) { setProjectDialog(null); if (projectId === project.id) { setProjectId(null); setView("important"); } }
  }

  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    if (!title) return;
    const selectedProject = view === "project" ? projectId : null;
    const values = { title, projectId: selectedProject, ...(view === "important" ? { isImportant: true } : {}) };
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (ok) form.reset();
  }

  function select(next: View, selectedProject: string | null = null) { setView(next); setProjectId(selectedProject); setError(""); }

  async function projectDragEnd(event: DragEndEvent) {
    if (!data || !event.over || event.active.id === event.over.id || saving) return;
    const sourceIndex = data.projects.findIndex((project) => project.id === event.active.id);
    const targetIndex = data.projects.findIndex((project) => project.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const before = data;
    const projects = arrayMove(data.projects, sourceIndex, targetIndex);
    setData({ ...data, projects });
    const ok = await mutate("/api/tasks/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectIds: projects.map((project) => project.id) }) });
    if (!ok) setData(before);
  }

  const importantTasks = useMemo(() => {
    const baseOrder = new Map((data?.tasks ?? []).map((task, index) => [task.id, index]));
    return (data?.tasks.filter((task) => task.isImportant) ?? []).sort((a, b) =>
      (a.importantSortOrder ?? Number.MAX_SAFE_INTEGER) - (b.importantSortOrder ?? Number.MAX_SAFE_INTEGER) ||
      (baseOrder.get(a.id) ?? 0) - (baseOrder.get(b.id) ?? 0),
    );
  }, [data]);
  const selectedProject = data?.projects.find((project) => project.id === projectId) ?? null;
  const projectTasks = selectedProject ? data?.tasks.filter((task) => task.projectId === selectedProject.id) ?? [] : [];
  const visibleTasks = view === "important" ? importantTasks : projectTasks;

  async function taskListDragEnd(event: DragEndEvent) {
    if (!data || !event.over || event.active.id === event.over.id || saving) return;
    const sourceId = String(event.active.id).replace(/^list:/, "");
    const targetId = String(event.over.id).replace(/^list:/, "");
    const sourceIndex = visibleTasks.findIndex((task) => task.id === sourceId);
    const targetIndex = visibleTasks.findIndex((task) => task.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const before = data;
    const moved = arrayMove(visibleTasks, sourceIndex, targetIndex);
    if (view === "important") {
      const orderById = new Map(moved.map((task, index) => [task.id, index]));
      const tasks = data.tasks.map((task) => task.isImportant ? { ...task, importantSortOrder: orderById.get(task.id)! } : task);
      setData({ ...data, tasks });
      const ok = await mutate("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "important", taskIds: moved.map((task) => task.id) }) });
      if (!ok) setData(before);
      return;
    }
    const visibleIds = new Set(moved.map((task) => task.id));
    let cursor = 0;
    const tasks = data.tasks.map((task) => visibleIds.has(task.id) ? moved[cursor++] : task);
    setData({ ...data, tasks });
    const ok = await mutate("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "base", taskIds: tasks.map((task) => task.id) }) });
    if (!ok) setData(before);
  }

  const title = view === "important" ? "Important" : selectedProject?.name ?? "Project";
  const description = view === "important" ? "Starred tasks from every project." : "Scheduled and unscheduled tasks in this project.";

  const readyForAccount = Boolean(data && accountId && dataAccountId === accountId && isAdmin);
  if (loading && !readyForAccount) return <HomeAccess description="Opening home…" />;
  if (authError) return <HomeAccess description="Home is temporarily unavailable." status={authError} action={<button className="account-control" type="button" onClick={retryAuth}>Retry</button>} />;
  if (!isAdmin) return <HomeAccess description="Sign in to continue." />;
  if (loadingData && (!data || dataAccountId !== accountId)) return <section className="task-loading" role="status"><RefreshCw size={20} /> Loading tasks…</section>;
  if (!data || dataAccountId !== accountId) return <section className="task-loading"><p role="alert">{error || "Could not load tasks."}</p><button type="button" onClick={() => void load()}>Retry</button></section>;

  return <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[taskListModifier]} onDragEnd={(event) => void taskListDragEnd(event)}>
    <div className="task-layout">
      <aside id="page-sidebar" className="places-sidebar tasks-sidebar" aria-label="Task views">
        <div className="tasks-sidebar-heading"><h2>Tasks</h2><button type="button" onClick={() => setTaskDialog({})} aria-label="Create task" title="Create task"><Plus size={14} /></button></div>
        <nav aria-label="Task navigation">
          <div className="tasks-navigation-list">{Object.entries(NAVIGATION_VIEWS).map(([id, { label, icon: Icon }]) =>
            <button key={id} className={view === id ? "selected" : ""} aria-current={view === id ? "page" : undefined} type="button" onClick={() => select(id as Exclude<View, "project">)}>
              <Icon size={16} fill={id === "important" && view === id ? "currentColor" : "none"} /><span>{label}</span>
            </button>)}</div>
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
          <div><p>PERSONAL WORKSPACE / OWNER ONLY</p><h1>{title}</h1><span>{description}</span></div>
        </header>
        <form className="task-quick-add" onSubmit={(event) => void quickAdd(event)}><Plus size={17} /><label className="sr-only" htmlFor="quick-task-title">Quick add task</label><input id="quick-task-title" name="title" maxLength={200} placeholder={view === "project" ? `Add a task to ${selectedProject?.name ?? "project"}…` : view === "important" ? "Add an important task…" : "Add a task…"} autoComplete="off" /><button type="submit" disabled={saving}>Add task</button></form>
        {error && <p className="task-error" role="alert">{error}</p>}
        <TaskList tasks={visibleTasks} empty={view === "important" ? "No tasks are marked Important." : "This project has no tasks."} projects={data.projects} disabled={saving} listRef={taskListRef} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onImportant={(task) => void toggleImportant(task)} onDelete={(task) => void deleteTask(task)} />
      </main>
    </div>
    {taskDialog && <TaskDialog value={taskDialog} projects={data.projects} busy={saving} error={error} onClose={closeTaskDialog} onDraftChange={rememberTaskDraft} onSave={saveTask} />}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} busy={saving} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
  </DndContext>;
}
