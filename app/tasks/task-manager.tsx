"use client";

import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, CheckCircle2, Circle, Folder, Home, ListTodo, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import { addDays, daysBetween, monthEnd, monthStart, shortDate, validTimelineRange } from "./task-calendar";
import { ProjectDialog, TaskDialog, type TaskDialogValue } from "./task-dialogs";
import { GanttView } from "./gantt-view";
import { TASK_ARCHIVE_PROJECT_ID, isArchivedTask, type PersonalTask, type TaskData, type TaskDraft, type TaskProject } from "./task-types";

const LOCATION_KEY = "site-tasks-location-v1";
type View = "gantt" | "all" | "important" | "project";
type NavigationView = Exclude<View, "project">;
type StoredLocation = { version: 1; view: View; projectId: string | null; timelineStart: string; timelineEnd: string };
type TaskPatch = Partial<TaskDraft> & { isImportant?: boolean };

const DEFAULT_NAVIGATION_ORDER: NavigationView[] = ["all", "important", "gantt"];
const NAVIGATION_VIEWS = {
  all: { label: "All tasks", icon: ListTodo },
  important: { label: "Important", icon: Star },
  gantt: { label: "Gantt", icon: CalendarRange },
} satisfies Record<NavigationView, { label: string; icon: typeof ListTodo }>;

function validNavigationOrder(value: unknown): value is NavigationView[] {
  return Array.isArray(value) && value.length === DEFAULT_NAVIGATION_ORDER.length &&
    value.every((id) => typeof id === "string" && DEFAULT_NAVIGATION_ORDER.includes(id as NavigationView)) &&
    new Set(value).size === DEFAULT_NAVIGATION_ORDER.length;
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

function SortableNavigationRow({ id, active, disabled, onSelect }: {
  id: NavigationView;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `view:${id}`, disabled });
  const { label, icon: Icon } = NAVIGATION_VIEWS[id];
  return <div ref={setNodeRef} className={`reorderable${disabled ? " disabled" : ""}${isDragging ? " dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}>
    <button ref={setActivatorNodeRef} className={active ? "selected" : ""} aria-current={active ? "page" : undefined} type="button" onClick={onSelect} {...attributes} {...listeners}>
      <Icon size={16} fill={id === "important" && active ? "currentColor" : "none"} /><span>{label}</span>
    </button>
  </div>;
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
    <button className="task-check" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" onPointerDown={stopDragStart} onTouchStart={stopDragStart} onKeyDown={stopDragStart} onClick={onComplete}><Circle size={15} /></button>
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

function TaskList({ tasks, empty, projects, disabled, onOpen, onComplete, onImportant, onDelete }: {
  tasks: PersonalTask[];
  empty: string;
  projects: TaskProject[];
  disabled: boolean;
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
  onImportant: (task: PersonalTask) => void;
  onDelete: (task: PersonalTask) => void;
}) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (!tasks.length) return <div className="task-empty"><CheckCircle2 size={30} /><strong>Nothing here</strong><span>{empty}</span></div>;
  return <SortableContext items={tasks.map((task) => `list:${task.id}`)} strategy={verticalListSortingStrategy}>
    <ul className="task-list">{tasks.map((task) => <SortableTaskRow
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
    const value = JSON.parse(window.localStorage.getItem(LOCATION_KEY) ?? "null") as (Partial<StoredLocation> & { view?: View | "archive" | "inbox" }) | null;
    const storedView = String(value?.view);
    if (!value || value.version !== 1 || !["gantt", "all", "important", "archive", "inbox", "project"].includes(storedView) || !validTimelineRange(value.timelineStart, value.timelineEnd)) return null;
    const savedView: View = storedView === "inbox" ? "all" : storedView === "archive" ? "project" : storedView as View;
    const savedProjectId = storedView === "archive" ? TASK_ARCHIVE_PROJECT_ID : value.projectId ?? null;
    if (savedView === "project" && (!savedProjectId || !projects.some((project) => project.id === savedProjectId))) return { ...value, view: "all", projectId: null } as StoredLocation;
    return { version: 1, view: savedView, projectId: savedView === "project" ? savedProjectId : null, timelineStart: String(value.timelineStart), timelineEnd: String(value.timelineEnd) };
  } catch {
    return null;
  }
}

export function TaskManager() {
  const { supabase, user, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const accountId = user?.id ?? null;
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
  const [navigationOrder, setNavigationOrder] = useState<NavigationView[]>(DEFAULT_NAVIGATION_ORDER);
  const [navigationReadyAccountId, setNavigationReadyAccountId] = useState<string | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [navigationStatus, setNavigationStatus] = useState("");
  const [error, setError] = useState("");
  const accountIdRef = useRef(accountId);
  const requestGeneration = useRef(0);
  const navigationLoadGeneration = useRef(0);
  const navigationSaveGeneration = useRef(0);
  const navigationSaveInFlight = useRef(false);
  const navigationLoadAbort = useRef<AbortController | null>(null);
  const navigationSaveAbort = useRef<AbortController | null>(null);
  const navigationStatusTimer = useRef<number | null>(null);
  const locationRestored = useRef(false);
  const navigationReady = Boolean(accountId && navigationReadyAccountId === accountId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const authenticatedRequest = useCallback(async <T,>(url: string, options: RequestInit = {}, expectedAccountId?: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Session expired. Please sign in again.");
    if (expectedAccountId && sessionData.session.user.id !== expectedAccountId) throw new Error("Account changed before the request started.");
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

  const navigationApi = useCallback(async (expectedAccountId: string, options: RequestInit = {}) => {
    const body = await authenticatedRequest<{ order?: unknown }>("/api/tasks/navigation-order", options, expectedAccountId);
    if (!validNavigationOrder(body.order)) throw new Error("Task navigation response was incomplete.");
    return body.order;
  }, [authenticatedRequest]);

  const loadNavigationPreference = useCallback(async (requestedAccountId = accountId) => {
    if (!isAdmin || !requestedAccountId) return false;
    const generation = ++navigationLoadGeneration.current;
    navigationLoadAbort.current?.abort();
    const controller = new AbortController();
    navigationLoadAbort.current = controller;
    setNavigationLoading(true);
    setNavigationError("");
    try {
      const order = await navigationApi(requestedAccountId, { signal: controller.signal });
      if (generation !== navigationLoadGeneration.current || accountIdRef.current !== requestedAccountId) return false;
      setNavigationOrder(order);
      setNavigationReadyAccountId(requestedAccountId);
      return true;
    } catch {
      if (generation !== navigationLoadGeneration.current || accountIdRef.current !== requestedAccountId) return false;
      setNavigationReadyAccountId(null);
      setNavigationError("Could not load task view order. The current order is shown, but sorting is unavailable.");
      return false;
    } finally {
      if (generation === navigationLoadGeneration.current && accountIdRef.current === requestedAccountId) {
        setNavigationLoading(false);
        if (navigationLoadAbort.current === controller) navigationLoadAbort.current = null;
      }
    }
  }, [accountId, isAdmin, navigationApi]);

  const load = useCallback(async () => {
    if (!isAdmin || !accountId) return;
    const requestedAccountId = accountId;
    const generation = ++requestGeneration.current;
    setLoadingData(true); setError("");
    try {
      const [taskResult] = await Promise.allSettled([api("/api/tasks"), loadNavigationPreference(requestedAccountId)]);
      if (taskResult.status === "rejected") throw taskResult.reason;
      if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) {
        const next = taskResult.value;
        setData(next);
        if (!locationRestored.current) {
          locationRestored.current = true;
          const saved = readLocation(next.projects);
          if (saved) { setView(saved.view); setProjectId(saved.projectId); setTimelineStart(saved.timelineStart); setTimelineEnd(saved.timelineEnd); }
          setLocationReady(true);
        }
      }
    }
    catch (failure) { if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) setError(failure instanceof Error ? failure.message : "Could not load tasks."); }
    finally { if (generation === requestGeneration.current && accountIdRef.current === requestedAccountId) setLoadingData(false); }
  }, [accountId, api, isAdmin, loadNavigationPreference]);

  useLayoutEffect(() => {
    accountIdRef.current = accountId;
    requestGeneration.current++;
    navigationLoadGeneration.current++;
    navigationSaveGeneration.current++;
    navigationLoadAbort.current?.abort();
    navigationSaveAbort.current?.abort();
    navigationLoadAbort.current = null;
    navigationSaveAbort.current = null;
    navigationSaveInFlight.current = false;
    if (navigationStatusTimer.current !== null) window.clearTimeout(navigationStatusTimer.current);
    navigationStatusTimer.current = null;
    const reset = window.setTimeout(() => {
      if (accountIdRef.current !== accountId) return;
      setNavigationOrder(DEFAULT_NAVIGATION_ORDER);
      setNavigationReadyAccountId(null);
      setNavigationLoading(false);
      setNavigationSaving(false);
      setNavigationError("");
      setNavigationStatus("");
    }, 0);
    return () => window.clearTimeout(reset);
  }, [accountId]);

  useEffect(() => {
    const generation = requestGeneration;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [load]);

  useEffect(() => () => {
    navigationLoadAbort.current?.abort();
    navigationSaveAbort.current?.abort();
    if (navigationStatusTimer.current !== null) window.clearTimeout(navigationStatusTimer.current);
  }, []);

  useEffect(() => {
    if (!locationReady) return;
    try { window.localStorage.setItem(LOCATION_KEY, JSON.stringify({ version: 1, view, projectId, timelineStart, timelineEnd } satisfies StoredLocation)); }
    catch { /* Task navigation still works when browser storage is unavailable. */ }
  }, [locationReady, projectId, timelineEnd, timelineStart, view]);

  async function mutate(url: string, options: RequestInit) {
    setSaving(true); setError("");
    try { setData(await api(url, options)); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save changes."); return false; }
    finally { setSaving(false); }
  }

  async function createTask(draft: TaskDraft) {
    const ok = await mutate("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (ok) setTaskDialog(null);
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

  async function saveTask(draft: TaskDraft) {
    if (taskDialog?.task) { if (await patchTask(taskDialog.task, draft)) setTaskDialog(null); }
    else await createTask(draft);
  }

  async function completeTask(task: PersonalTask) {
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (ok) setTaskDialog(null);
  }

  async function deleteTask(task: PersonalTask) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    const ok = await mutate(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (ok) setTaskDialog(null);
  }

  async function saveProject(name: string) {
    const editing = projectDialog !== "new" && projectDialog;
    const url = editing ? `/api/tasks/projects/${editing.id}` : "/api/tasks/projects";
    const ok = await mutate(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (ok) setProjectDialog(null);
  }

  async function deleteProject(project: TaskProject) {
    if (!window.confirm(`Delete project “${project.name}”? Its tasks will become Uncategorized and keep their dates.`)) return;
    const ok = await mutate(`/api/tasks/projects/${project.id}`, { method: "DELETE" });
    if (ok) { setProjectDialog(null); if (projectId === project.id) { setProjectId(null); setView("all"); } }
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

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = String(form.get("timelineStart") ?? "");
    const endDate = String(form.get("timelineEnd") ?? "");
    if (!validTimelineRange(startDate, endDate)) { setError("Choose an ordered date range of no more than two months."); return; }
    setTimelineStart(startDate); setTimelineEnd(endDate); setError("");
  }

  async function navigationDragEnd(event: DragEndEvent) {
    if (!navigationReady || navigationLoading || !accountId || !event.over || event.active.id === event.over.id || navigationSaveInFlight.current) return;
    const requestedAccountId = accountId;
    const sourceId = String(event.active.id).replace(/^view:/, "") as NavigationView;
    const targetId = String(event.over.id).replace(/^view:/, "") as NavigationView;
    const sourceIndex = navigationOrder.indexOf(sourceId);
    const targetIndex = navigationOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const before = navigationOrder;
    const next = arrayMove(navigationOrder, sourceIndex, targetIndex);
    const generation = ++navigationSaveGeneration.current;
    navigationSaveAbort.current?.abort();
    const controller = new AbortController();
    navigationSaveAbort.current = controller;
    navigationSaveInFlight.current = true;
    if (navigationStatusTimer.current !== null) window.clearTimeout(navigationStatusTimer.current);
    navigationStatusTimer.current = null;
    setNavigationOrder(next);
    setNavigationSaving(true);
    setNavigationError("");
    setNavigationStatus("Saving task view order…");
    try {
      const saved = await navigationApi(requestedAccountId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: next }), signal: controller.signal });
      if (generation === navigationSaveGeneration.current && accountIdRef.current === requestedAccountId) {
        setNavigationOrder(saved);
        setNavigationStatus("Task view order saved.");
        navigationStatusTimer.current = window.setTimeout(() => {
          if (generation === navigationSaveGeneration.current && accountIdRef.current === requestedAccountId) setNavigationStatus("");
          navigationStatusTimer.current = null;
        }, 2400);
      }
    } catch {
      if (generation === navigationSaveGeneration.current && accountIdRef.current === requestedAccountId) {
        setNavigationOrder(before);
        setNavigationError("Could not save task view order. The previous order was restored.");
        setNavigationStatus("");
      }
    } finally {
      if (generation === navigationSaveGeneration.current && accountIdRef.current === requestedAccountId) {
        navigationSaveInFlight.current = false;
        setNavigationSaving(false);
        if (navigationSaveAbort.current === controller) navigationSaveAbort.current = null;
      }
    }
  }

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

  const allTasks = useMemo(() => data?.tasks.filter((task) => !isArchivedTask(task)) ?? [], [data]);
  const importantTasks = useMemo(() => {
    const baseOrder = new Map((data?.tasks ?? []).map((task, index) => [task.id, index]));
    return (data?.tasks.filter((task) => task.isImportant) ?? []).sort((a, b) =>
      (a.importantSortOrder ?? Number.MAX_SAFE_INTEGER) - (b.importantSortOrder ?? Number.MAX_SAFE_INTEGER) ||
      (baseOrder.get(a.id) ?? 0) - (baseOrder.get(b.id) ?? 0),
    );
  }, [data]);
  const selectedProject = data?.projects.find((project) => project.id === projectId) ?? null;
  const projectTasks = selectedProject ? data?.tasks.filter((task) => task.projectId === selectedProject.id) ?? [] : [];
  const visibleTasks = view === "all" ? allTasks : view === "important" ? importantTasks : projectTasks;

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

  function dragEnd(event: DragEndEvent) {
    if (String(event.active.id).startsWith("list:")) { void taskListDragEnd(event); return; }
    if (!data || !event.over || saving) return;
    const id = String(event.active.id).replace(/^task:/, "");
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return;
    const match = String(event.over.id).match(/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return;
    const length = task.startDate && task.endDate ? daysBetween(task.startDate, task.endDate) : 0;
    void patchTask(task, { startDate: match[1], endDate: addDays(match[1], length) });
  }

  const title = view === "all" ? "All tasks" : view === "important" ? "Important" : view === "project" ? selectedProject?.name ?? "Project" : "Gantt";
  const description = view === "all" ? "All active project and uncategorized tasks." : view === "important" ? "Starred tasks from every project, including Archive." : "Scheduled and unscheduled tasks in this project.";

  if (loading) return <HomeAccess description="Opening home…" />;
  if (authError) return <HomeAccess description="Home is temporarily unavailable." status={authError} action={<button className="account-control" type="button" onClick={retryAuth}>Retry</button>} />;
  if (!isAdmin) return <HomeAccess description="Sign in to continue." />;
  if (loadingData && !data) return <section className="task-loading" role="status"><RefreshCw size={20} /> Loading tasks…</section>;
  if (!data) return <section className="task-loading"><p role="alert">{error || "Could not load tasks."}</p><button type="button" onClick={() => void load()}>Retry</button></section>;

  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
    <div className="task-layout">
      <aside id="page-sidebar" className="places-sidebar tasks-sidebar" aria-label="Task views">
        <div className="tasks-sidebar-heading"><h2>Tasks</h2><button type="button" onClick={() => setTaskDialog({})} aria-label="Create task" title="Create task"><Plus size={14} /></button></div>
        <nav aria-label="Task navigation">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void navigationDragEnd(event)}>
            <SortableContext items={navigationOrder.map((id) => `view:${id}`)} strategy={verticalListSortingStrategy}>
              <div className="tasks-navigation-list">{navigationOrder.map((id) => <SortableNavigationRow key={id} id={id} active={view === id} disabled={!navigationReady || navigationLoading || navigationSaving} onSelect={() => select(id)} />)}</div>
            </SortableContext>
          </DndContext>
        </nav>
        {navigationError && <div className="task-navigation-error" role="alert"><span>{navigationError}</span><button type="button" disabled={navigationLoading} onClick={() => void loadNavigationPreference()}>{navigationLoading ? "Retrying…" : "Retry"}</button></div>}
        <p className="sr-only" role="status" aria-live="polite">{navigationStatus}</p>
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
        <form className="task-quick-add" onSubmit={(event) => void quickAdd(event)}><Plus size={17} /><label className="sr-only" htmlFor="quick-task-title">Quick add task</label><input id="quick-task-title" name="title" maxLength={200} placeholder={view === "project" ? `Add a task to ${selectedProject?.name ?? "project"}…` : view === "important" ? "Add an important task…" : "Add a task…"} autoComplete="off" /><button type="submit" disabled={saving}>Add task</button></form>
        {error && <p className="task-error" role="alert">{error}</p>}
        {view === "gantt" ? <GanttView timelineStart={timelineStart} timelineEnd={timelineEnd} tasks={allTasks} projects={data.projects} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onResize={(task, startDate, endDate) => void patchTask(task, { startDate, endDate })} /> : <TaskList tasks={visibleTasks} empty={view === "all" ? "There are no active tasks yet." : view === "important" ? "No tasks are marked Important." : "This project has no tasks."} projects={data.projects} disabled={saving} onOpen={setTaskDialog} onComplete={(task) => void completeTask(task)} onImportant={(task) => void toggleImportant(task)} onDelete={(task) => void deleteTask(task)} />}
      </main>
    </div>
    {taskDialog && <TaskDialog value={taskDialog} projects={data.projects} busy={saving} error={error} onClose={() => setTaskDialog(null)} onSave={saveTask} />}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} busy={saving} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
  </DndContext>;
}
