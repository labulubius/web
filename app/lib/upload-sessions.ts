import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, statfs, unlink } from "node:fs/promises";
import path from "node:path";

export const TOTAL_BYTES = 5 * 1024 ** 3;
export const CHUNK_BYTES = 8 * 1024 ** 2;
const RESERVE_BYTES = 4 * 1024 ** 3;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGE_MS = 7 * 24 * 60 * 60 * 1000;
export type Session = { id: string; name: string; size: number; context: string; created: number };
const locks = new Map<string, Promise<void>>();

// Serialize quota checks and writes within this web process; session files survive restarts.
export async function locked<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(root, next);
  await previous;
  try { return await task(); } finally { release(); if (locks.get(root) === next) locks.delete(root); }
}

export function sessionDir(root: string) { return path.join(root, ".upload-sessions"); }
function paths(root: string, id: string) {
  if (!ID.test(id)) throw new Error("Invalid upload session.");
  const dir = sessionDir(root);
  return { meta: path.join(dir, `${id}.json`), temp: path.join(dir, `${id}.part`) };
}
export async function loadSession(root: string, id: string): Promise<Session> {
  const { meta } = paths(root, id);
  let text: string;
  try { text = await (await import("node:fs/promises")).readFile(meta, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Upload session expired. Select the file again."); throw error; }
  const data: Session = JSON.parse(text);
  if (data.id !== id || !Number.isSafeInteger(data.size) || data.size <= 0 || !data.name || typeof data.context !== "string") throw new Error("Invalid upload session.");
  return data;
}
export async function offset(root: string, id: string) {
  const handle = await open(paths(root, id).temp, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return (await handle.stat()).size; } finally { await handle.close(); }
}
async function activeSessions(root: string) {
  const dir = sessionDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const sessions: Session[] = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json") || !ID.test(file.slice(0, -5))) continue;
    const id = file.slice(0, -5);
    const session = await loadSession(root, id);
    if (Date.now() - session.created > AGE_MS) { await discard(root, id); continue; }
    sessions.push(session);
  }
  return sessions;
}
export async function createSession(root: string, used: number, name: string, size: number, context: string) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > TOTAL_BYTES) throw new Error("Upload exceeds available space.");
  const pending = (await activeSessions(root)).reduce((sum, item) => sum + item.size, 0);
  if (used + pending + size > TOTAL_BYTES) throw new Error("Storage limit reached (5 GB total). Delete files or unfinished uploads first.");
  const disk = await statfs(root);
  if (Number(disk.bavail) * Number(disk.bsize) < size + RESERVE_BYTES) throw new Error("Not enough free disk space for upload.");
  const session: Session = { id: randomUUID(), name, size, context, created: Date.now() };
  const { meta, temp } = paths(root, session.id);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  await handle.close();
  try { const metadata = await open(meta, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await metadata.writeFile(JSON.stringify(session)); } finally { await metadata.close(); }
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  return session;
}
export async function appendChunk(root: string, session: Session, expected: number, request: Request) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("Invalid upload offset.");
  const { temp } = paths(root, session.id);
  const handle = await open(temp, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const current = (await handle.stat()).size;
    if (expected !== current) throw new Error(`Upload offset mismatch; current offset is ${current}.`);
    if (!request.body) throw new Error("Invalid upload chunk.");
    const reader = request.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > CHUNK_BYTES || current + received > session.size) throw new Error("Invalid upload chunk.");
        await handle.writeFile(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    if (!received) throw new Error("Invalid upload chunk.");
    await handle.sync();
    return current + received;
  } finally { await handle.close(); }
}
export function tempPath(root: string, id: string) { return paths(root, id).temp; }
export async function discard(root: string, id: string) {
  const { meta, temp } = paths(root, id);
  await unlink(meta).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
export async function smallJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 4096) throw new Error("Invalid request size.");
  const text = await request.text();
  if (text.length > 4096) throw new Error("Invalid request size.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request.");
  return value as Record<string, unknown>;
}
