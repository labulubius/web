import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reorderByExactIds } from "./watchboard-order";

export type SourceTag = { id: string; name: string };
export type Watchboard = { id: string; name: string; tagIds: string[] };
export type WatchboardState = { tags: SourceTag[]; watchboards: Watchboard[]; sourceTags: Record<string, string[]> };
export class InvalidWatchboardInput extends Error {}
const invalid = (message: string): never => { throw new InvalidWatchboardInput(message); };
const directory = process.env.NEWS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "news");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function file(userId: string) {
  if (!uuid.test(userId)) throw new Error("Invalid user ID.");
  return path.join(directory, `${userId}.watchboards.json`);
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) return invalid("Invalid name.");
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return invalid("Invalid ID.");
  return value;
}
function ids(value: unknown, known: Set<string>): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || !known.has(item))) return invalid("Invalid tag IDs.");
  return [...new Set(value as string[])];
}
function uniqueName(name: string, entries: { id: string; name: string }[], except?: string) {
  if (entries.some((item) => item.id !== except && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) invalid("Name already exists.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid request.");
  return value as Record<string, unknown>;
}
export async function loadWatchboards(userId: string): Promise<WatchboardState> {
  try {
    const state: unknown = JSON.parse(await readFile(file(userId), "utf8"));
    if (!state || typeof state !== "object" || !Array.isArray((state as WatchboardState).tags) ||
      !Array.isArray((state as WatchboardState).watchboards) ||
      !(state as WatchboardState).sourceTags || typeof (state as WatchboardState).sourceTags !== "object" ||
      Array.isArray((state as WatchboardState).sourceTags)) throw new Error("Invalid watchboards data.");
    return state as WatchboardState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tags: [], watchboards: [], sourceTags: {} };
    throw error;
  }
}
async function save(userId: string, state: WatchboardState) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temp, file(userId));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
// Serialize updates in this server process to avoid lost writes from concurrent requests.
const pending = new Map<string, Promise<unknown>>();
export async function updateWatchboards(userId: string, input: unknown, feedIds: Set<string>): Promise<WatchboardState> {
  const previous = pending.get(userId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const body = object(input);
    const state = await loadWatchboards(userId);
    const tags = new Set(state.tags.map((tag) => tag.id));
    switch (body.action) {
      case "createTag": {
        if (state.tags.length >= 100) invalid("Too many tags.");
        const name = label(body.name);
        uniqueName(name, state.tags);
        state.tags.push({ id: randomUUID(), name });
        break;
      }
      case "renameTag": {
        const tag = state.tags.find((item) => item.id === id(body.id));
        if (!tag) return invalid("Unknown tag.");
        const name = label(body.name);
        uniqueName(name, state.tags, tag.id);
        tag.name = name;
        break;
      }
      case "deleteTag": {
        const tagId = id(body.id);
        if (!tags.has(tagId)) invalid("Unknown tag.");
        state.tags = state.tags.filter((tag) => tag.id !== tagId);
        for (const source of Object.keys(state.sourceTags)) state.sourceTags[source] = state.sourceTags[source].filter((tag) => tag !== tagId);
        for (const board of state.watchboards) board.tagIds = board.tagIds.filter((tag) => tag !== tagId);
        break;
      }
      case "setSourceTags": {
        const feedId = body.feedId;
        if (typeof feedId !== "string" || !feedIds.has(feedId)) return invalid("Unknown source.");
        const chosen = ids(body.tagIds, tags);
        if (chosen.length) state.sourceTags[feedId] = chosen;
        else delete state.sourceTags[feedId];
        break;
      }
      case "createWatchboard": {
        if (state.watchboards.length >= 100) invalid("Too many watchboards.");
        const name = label(body.name);
        uniqueName(name, state.watchboards);
        state.watchboards.push({ id: randomUUID(), name, tagIds: ids(body.tagIds, tags) });
        break;
      }
      case "reorderWatchboards": {
        const ordered = reorderByExactIds(state.watchboards, body.ids);
        state.watchboards = ordered ?? invalid("Invalid watchboard order.");
        break;
      }
      case "updateWatchboard": {
        const board = state.watchboards.find((item) => item.id === id(body.id));
        if (!board) return invalid("Unknown watchboard.");
        if (body.name === undefined && body.tagIds === undefined) invalid("No changes provided.");
        if (body.name !== undefined) { const name = label(body.name); uniqueName(name, state.watchboards, board.id); board.name = name; }
        if (body.tagIds !== undefined) board.tagIds = ids(body.tagIds, tags);
        break;
      }
      case "deleteWatchboard": {
        const boardId = id(body.id);
        if (!state.watchboards.some((item) => item.id === boardId)) invalid("Unknown watchboard.");
        state.watchboards = state.watchboards.filter((item) => item.id !== boardId);
        break;
      }
      default: invalid("Invalid action.");
    }
    await save(userId, state);
    return state;
  });
  pending.set(userId, operation);
  try { return await operation; } finally { if (pending.get(userId) === operation) pending.delete(userId); }
}

export function visibleWatchboards(state: WatchboardState, feedIds: Set<string>): WatchboardState {
  return { ...state, sourceTags: Object.fromEntries(Object.entries(state.sourceTags).filter(([feedId]) => feedIds.has(feedId))) };
}
