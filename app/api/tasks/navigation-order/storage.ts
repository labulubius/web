import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const NAVIGATION_IDS = ["all", "important", "gantt"] as const;
export type NavigationId = typeof NAVIGATION_IDS[number];
export const DEFAULT_NAVIGATION_ORDER: NavigationId[] = [...NAVIGATION_IDS];
export const navigationPrivateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREFERENCE_BYTES = 1024;
const pendingWrites = new Map<string, Promise<void>>();

export class InvalidNavigationOrder extends Error {}

function isOutside(root: string, checkout: string) {
  return root !== checkout && !root.startsWith(`${checkout}${path.sep}`);
}

async function storageDirectories() {
  const configured = process.env.TASKS_DATA_DIR;
  const requestedRoot = path.resolve(/* turbopackIgnore: true */ configured || path.join(homedir(), ".local", "share", "labulubius", "tasks"));
  const checkout = await realpath(process.cwd());
  if (!path.isAbsolute(configured || requestedRoot) || requestedRoot === "/" || !isOutside(requestedRoot, checkout)) {
    throw new Error("Invalid task preference storage directory.");
  }
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(requestedRoot);
  const root = await realpath(/* turbopackIgnore: true */ requestedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o077) !== 0 || root !== requestedRoot || !isOutside(root, checkout)) {
    throw new Error("Invalid task preference storage directory.");
  }

  const requestedPreferences = path.join(root, "preferences");
  await mkdir(requestedPreferences, { recursive: true, mode: 0o700 });
  const preferenceInfo = await lstat(requestedPreferences);
  const preferences = await realpath(requestedPreferences);
  if (!preferenceInfo.isDirectory() || preferenceInfo.isSymbolicLink() || (preferenceInfo.mode & 0o077) !== 0 || preferences !== requestedPreferences) {
    throw new Error("Invalid task preference storage directory.");
  }
  return preferences;
}

function preferenceFile(preferences: string, userId: string) {
  if (!UUID.test(userId)) throw new Error("Invalid authenticated user ID.");
  return path.join(preferences, `${userId}.navigation.json`);
}

export function parseNavigationOrder(value: unknown): NavigationId[] {
  if (!Array.isArray(value) || value.length !== NAVIGATION_IDS.length ||
      value.some((id) => typeof id !== "string" || !NAVIGATION_IDS.includes(id as NavigationId)) ||
      new Set(value).size !== NAVIGATION_IDS.length) {
    throw new InvalidNavigationOrder("Invalid task navigation order.");
  }
  return [...value] as NavigationId[];
}

function parseStoredPreference(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    throw new Error("Stored task navigation preference is invalid.");
  }
  try { return parseNavigationOrder((value as { order?: unknown }).order); }
  catch { throw new Error("Stored task navigation preference is invalid."); }
}

export async function loadNavigationOrder(userId: string): Promise<NavigationId[]> {
  const preferences = await storageDirectories();
  let handle;
  try {
    handle = await open(preferenceFile(preferences, userId), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [...DEFAULT_NAVIGATION_ORDER];
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_PREFERENCE_BYTES || (info.mode & 0o077) !== 0) {
      throw new Error("Stored task navigation preference is invalid.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(await handle.readFile("utf8")); }
    catch { throw new Error("Stored task navigation preference is invalid."); }
    return parseStoredPreference(parsed);
  } finally {
    await handle.close();
  }
}

async function writeNavigationOrder(preferences: string, userId: string, order: NavigationId[]) {
  const destination = preferenceFile(preferences, userId);
  try {
    const destinationInfo = await lstat(destination);
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isFile()) throw new Error("Invalid task navigation preference file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(preferences, `.${userId}.${randomUUID()}.tmp`);
  let handle;
  let committed = false;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, order })}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
    const directoryHandle = await open(preferences, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    committed = true;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!committed) await unlink(temporary).catch(() => {});
  }
}

export async function saveNavigationOrder(userId: string, value: unknown): Promise<NavigationId[]> {
  const order = parseNavigationOrder(value);
  const preferences = await storageDirectories();
  const key = preferenceFile(preferences, userId);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => writeNavigationOrder(preferences, userId, order));
  pendingWrites.set(key, operation);
  try {
    await operation;
    return order;
  } finally {
    if (pendingWrites.get(key) === operation) pendingWrites.delete(key);
  }
}
