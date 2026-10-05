import "server-only";

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { PersonalTask, TaskData, TaskProject } from "../tasks/task-types";

const DATA_FILE = "tasks.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const locks = new Map<string, Promise<void>>();

type ReadResult = { data: TaskData; migrated: boolean };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseProject(value: unknown): TaskProject {
  if (!object(value) || !UUID.test(String(value.id)) || typeof value.name !== "string" || !value.name || value.name.length > 80 ||
      !validIso(value.createdAt) || !validIso(value.updatedAt)) throw new Error("Stored task data is invalid.");
  return value as TaskProject;
}

function commonTask(value: unknown) {
  if (!object(value) || !UUID.test(String(value.id)) || typeof value.title !== "string" || !value.title || value.title.length > 200 ||
      typeof value.notes !== "string" || value.notes.length > 5000 ||
      !(value.projectId === null || (typeof value.projectId === "string" && UUID.test(value.projectId))) ||
      !validIso(value.createdAt) || !validIso(value.updatedAt)) throw new Error("Stored task data is invalid.");
  return value;
}

function parseTask(value: unknown): PersonalTask {
  const task = commonTask(value);
  const startDate = task.startDate;
  const endDate = task.endDate;
  if (!((startDate === null && endDate === null) || (validDate(startDate) && validDate(endDate) && startDate <= endDate))) {
    throw new Error("Stored task data is invalid.");
  }
  return task as PersonalTask;
}

function migrateLegacyTask(value: unknown): PersonalTask | null {
  const task = commonTask(value);
  if (!(task.completedAt === null || validIso(task.completedAt)) || !(task.date === null || validDate(task.date)) ||
      !(task.startMinute === null || (Number.isInteger(task.startMinute) && Number(task.startMinute) >= 0 && Number(task.startMinute) <= 1410 && Number(task.startMinute) % 30 === 0)) ||
      !Number.isInteger(task.durationMinutes) || Number(task.durationMinutes) < 30 || Number(task.durationMinutes) > 1440 || Number(task.durationMinutes) % 30 !== 0) {
    throw new Error("Stored task data is invalid.");
  }
  if (task.completedAt !== null) return null;
  return {
    id: String(task.id), title: String(task.title), notes: String(task.notes), projectId: task.projectId as string | null,
    startDate: task.date as string | null, endDate: task.date as string | null,
    createdAt: String(task.createdAt), updatedAt: String(task.updatedAt),
  };
}

function parseData(value: unknown): ReadResult {
  if (!object(value) || !Array.isArray(value.tasks) || !Array.isArray(value.projects) || (value.version !== 1 && value.version !== 2)) {
    throw new Error("Stored task data is invalid.");
  }
  const projects = value.projects.map(parseProject);
  const tasks = value.version === 1 ? value.tasks.map(migrateLegacyTask).filter((task): task is PersonalTask => task !== null) : value.tasks.map(parseTask);
  const projectIds = new Set(projects.map((project) => project.id));
  if (projectIds.size !== projects.length || new Set(tasks.map((task) => task.id)).size !== tasks.length || tasks.some((task) => task.projectId && !projectIds.has(task.projectId))) {
    throw new Error("Stored task data is invalid.");
  }
  return { data: { version: 2, tasks, projects }, migrated: value.version === 1 };
}

export async function tasksRoot() {
  const configured = process.env.TASKS_DATA_DIR;
  const root = configured || path.join(homedir(), ".local", "share", "labulubius", "tasks");
  if (!path.isAbsolute(root) || root === "/" || root === process.cwd() || root.startsWith(`${process.cwd()}${path.sep}`)) {
    throw new Error("TASKS_DATA_DIR must be an absolute directory outside the website.");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid task storage directory.");
  return root;
}

async function locked<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(root, next);
  await previous;
  try { return await task(); }
  finally { release(); if (locks.get(root) === next) locks.delete(root); }
}

async function readData(root: string): Promise<ReadResult> {
  let handle;
  try { handle = await open(path.join(root, DATA_FILE), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: { version: 2, tasks: [], projects: [] }, migrated: false };
    throw error;
  }
  try { return parseData(JSON.parse(await handle.readFile("utf8"))); }
  finally { await handle.close(); }
}

async function writeData(root: string, data: TaskData) {
  const temporary = path.join(root, `.tasks-${randomUUID()}.tmp`);
  let handle;
  let committed = false;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(data, null, 2));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path.join(root, DATA_FILE));
    committed = true;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!committed) await unlink(temporary).catch(() => {});
  }
}

export async function loadTaskData() {
  const root = await tasksRoot();
  return locked(root, async () => {
    const result = await readData(root);
    if (result.migrated) await writeData(root, result.data);
    return result.data;
  });
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maximum) throw new Error(`Invalid ${label}.`);
  return result;
}

function projectId(value: unknown, projects: TaskProject[]) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value) || !projects.some((project) => project.id === value)) throw new Error("Invalid project.");
  return value;
}

function optionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (!validDate(value)) throw new Error("Invalid task date.");
  return value;
}

function taskRange(startValue: unknown, endValue: unknown) {
  const startDate = optionalDate(startValue);
  const endDate = optionalDate(endValue);
  if ((startDate === null) !== (endDate === null) || (startDate && endDate && startDate > endDate)) throw new Error("Invalid task date range.");
  return { startDate, endDate };
}

export async function createTask(input: unknown) {
  if (!object(input)) throw new Error("Invalid task.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const range = taskRange(input.startDate, input.endDate);
    const now = new Date().toISOString();
    const task: PersonalTask = {
      id: randomUUID(), title: text(input.title, "task title", 200),
      notes: input.notes === undefined ? "" : text(input.notes, "task notes", 5000, true),
      projectId: projectId(input.projectId, data.projects), ...range, createdAt: now, updatedAt: now,
    };
    data.tasks.unshift(task);
    await writeData(root, data);
    return data;
  });
}

export async function updateTask(id: string, input: unknown) {
  if (!UUID.test(id) || !object(input) || "completed" in input) throw new Error("Invalid task.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const index = data.tasks.findIndex((task) => task.id === id);
    if (index < 0) throw new Error("Task not found.");
    const current = data.tasks[index];
    const range = "startDate" in input || "endDate" in input ? taskRange("startDate" in input ? input.startDate : current.startDate, "endDate" in input ? input.endDate : current.endDate) : { startDate: current.startDate, endDate: current.endDate };
    data.tasks[index] = {
      ...current,
      title: "title" in input ? text(input.title, "task title", 200) : current.title,
      notes: "notes" in input ? text(input.notes, "task notes", 5000, true) : current.notes,
      projectId: "projectId" in input ? projectId(input.projectId, data.projects) : current.projectId,
      ...range,
      updatedAt: new Date().toISOString(),
    };
    await writeData(root, data);
    return data;
  });
}

export async function deleteTask(id: string) {
  if (!UUID.test(id)) throw new Error("Invalid task.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const index = data.tasks.findIndex((task) => task.id === id);
    if (index < 0) throw new Error("Task not found.");
    data.tasks.splice(index, 1);
    await writeData(root, data);
    return data;
  });
}

export async function createProject(input: unknown) {
  if (!object(input)) throw new Error("Invalid project.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const name = text(input.name, "project name", 80);
    if (data.projects.some((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Project name already exists.");
    const now = new Date().toISOString();
    data.projects.push({ id: randomUUID(), name, createdAt: now, updatedAt: now });
    await writeData(root, data);
    return data;
  });
}

export async function updateProject(id: string, input: unknown) {
  if (!UUID.test(id) || !object(input)) throw new Error("Invalid project.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const project = data.projects.find((item) => item.id === id);
    if (!project) throw new Error("Project not found.");
    const name = text(input.name, "project name", 80);
    if (data.projects.some((item) => item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Project name already exists.");
    project.name = name; project.updatedAt = new Date().toISOString();
    await writeData(root, data);
    return data;
  });
}

export async function deleteProject(id: string) {
  if (!UUID.test(id)) throw new Error("Invalid project.");
  const root = await tasksRoot();
  return locked(root, async () => {
    const { data } = await readData(root);
    const index = data.projects.findIndex((project) => project.id === id);
    if (index < 0) throw new Error("Project not found.");
    data.projects.splice(index, 1);
    const now = new Date().toISOString();
    data.tasks = data.tasks.map((task) => task.projectId === id ? { ...task, projectId: null, updatedAt: now } : task);
    await writeData(root, data);
    return data;
  });
}

export async function requireTasksAdmin(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${match[1]}` } } });
  const { data: user, error: userError } = await client.auth.getUser(match[1]);
  if (userError || !user.user) return false;
  const { data, error } = await client.rpc("site_is_admin");
  return !error && data === true;
}

export async function taskRequestBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 16_384) throw new Error("Invalid request size.");
  const body = await request.text();
  if (body.length > 16_384) throw new Error("Invalid request size.");
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error("Invalid request."); }
}

export function tasksError(error: unknown) {
  const message = error instanceof Error ? error.message : "Task operation failed.";
  const code = (error as NodeJS.ErrnoException).code;
  const missing = message === "Task not found." || message === "Project not found." || code === "ENOENT";
  const conflict = message === "Project name already exists.";
  const known = message.startsWith("Invalid") || message.startsWith("TASKS_DATA_DIR");
  if (!missing && !conflict && !known) console.error("Task operation failed:", { code, name: error instanceof Error ? error.name : "UnknownError", message });
  return Response.json({ error: missing ? message : conflict ? message : known ? message : "Task operation failed." }, { status: missing ? 404 : conflict ? 409 : known ? 400 : 500, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export const taskPrivateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
