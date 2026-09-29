import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publicAddress } from "./public-network";

export type ForumCategory = { id: string; name: string };
export type ForumKind = "discourse" | "v2ex" | "hackernews" | "stackexchange" | "reddit" | "rss";
export type ForumSource = {
  id: string; name: string; kind: ForumKind; categoryId: string; selected: boolean;
  origin?: string; latest?: string; view?: "top" | "new" | "best" | "ask" | "show";
  site?: string; tags?: string; subreddit?: string; sort?: "hot" | "new" | "top"; feedUrl?: string;
};
export type ForumDirectory = { version: 2; categories: ForumCategory[]; sources: ForumSource[] };

const file = path.join(process.env.FORUMS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "forums"), "directory.json");
const initial: ForumDirectory = {
  version: 2,
  categories: [{ id: "communities", name: "Communities" }],
  sources: [
    { id: "linuxdo", name: "LinuxDo", kind: "discourse", origin: "https://linux.do", latest: "/latest.json", categoryId: "communities", selected: true },
    { id: "v2ex", name: "V2EX", kind: "v2ex", categoryId: "communities", selected: true },
    { id: "hackernews", name: "Hacker News", kind: "hackernews", view: "top", categoryId: "communities", selected: true },
    { id: "stackoverflow", name: "Stack Overflow", kind: "stackexchange", site: "stackoverflow", tags: "", categoryId: "communities", selected: true },
    { id: "obsidian", name: "Obsidian Forum", kind: "discourse", origin: "https://forum.obsidian.md", latest: "/latest.json", categoryId: "communities", selected: true },
  ],
};

export class InvalidForumInput extends Error {}

function validName(value: unknown, length: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > length || /[\x00-\x1f\x7f]/.test(value)) throw new InvalidForumInput("Invalid name.");
  return value.trim();
}

// DNS is checked both at save time and again when connecting (with the checked IP pinned).
export async function publicForumAddress(hostname: string): Promise<string> {
  try { return await publicAddress(hostname); }
  catch { throw new InvalidForumInput("Forum hostname must resolve only to public addresses."); }
}

export async function forumOrigin(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length > 300) throw new InvalidForumInput("Invalid forum URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new InvalidForumInput("Invalid forum URL."); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new InvalidForumInput("Enter a public HTTPS origin without a path, port or credentials.");
  }
  await publicForumAddress(url.hostname);
  return url.origin;
}

async function publicFeedUrl(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length > 500) throw new InvalidForumInput("Invalid feed URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new InvalidForumInput("Invalid feed URL."); }
  if (url.protocol !== "https:" || url.port || url.username || url.password) throw new InvalidForumInput("Use a public HTTPS feed URL.");
  await publicForumAddress(url.hostname);
  return url.href;
}

function normalizeDirectory(raw: unknown): ForumDirectory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid forum directory.");
  const input = raw as { categories?: unknown; sources?: unknown };
  if (!Array.isArray(input.categories) || !Array.isArray(input.sources)) throw new Error("Invalid forum directory.");
  const categories = input.categories.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid forum category.");
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string") throw new Error("Invalid forum category.");
    return { id: value.id, name: value.name };
  });
  const categoryIds = new Set(categories.map((item) => item.id));
  const kinds = new Set<ForumKind>(["discourse", "v2ex", "hackernews", "stackexchange", "reddit", "rss"]);
  const sources = input.sources.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid forum source.");
    const value = item as Record<string, unknown>;
    const kind = (typeof value.kind === "string" ? value.kind : "discourse") as ForumKind;
    if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.categoryId !== "string" || !categoryIds.has(value.categoryId) || !kinds.has(kind)) throw new Error("Invalid forum source.");
    const source: ForumSource = { id: value.id, name: value.name, categoryId: value.categoryId, selected: value.selected !== false, kind };
    for (const key of ["origin", "latest", "view", "site", "tags", "subreddit", "sort", "feedUrl"] as const) if (typeof value[key] === "string") Object.assign(source, { [key]: value[key] });
    if (kind === "discourse") { if (!source.origin) throw new Error("Invalid forum source."); if (!source.latest?.startsWith("/")) source.latest = "/latest.json"; }
    if (kind === "hackernews" && !["top", "new", "best", "ask", "show"].includes(source.view || "")) source.view = "top";
    if (kind === "stackexchange" && !source.site) throw new Error("Invalid forum source.");
    if (kind === "reddit" && !source.subreddit) throw new Error("Invalid forum source.");
    if (kind === "rss" && !source.feedUrl) throw new Error("Invalid forum source.");
    return source;
  });
  return { version: 2, categories, sources };
}

export async function loadForumDirectory(): Promise<ForumDirectory> {
  if (process.env.VERCEL) {
    const response = await fetch("https://drive.labulubius.com/api/forums", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Forum directory unavailable.");
    return normalizeDirectory(await response.json());
  }
  try { return normalizeDirectory(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(initial); throw error; }
}

let pending: Promise<unknown> = Promise.resolve();
async function changeDirectory(action: (directory: ForumDirectory) => Promise<void> | void): Promise<ForumDirectory> {
  const task = pending.catch(() => {}).then(async () => {
    const directory = await loadForumDirectory();
    await action(directory);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(directory), { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    return directory;
  });
  pending = task;
  return task;
}

async function sourceFields(body: Record<string, unknown>): Promise<Omit<ForumSource, "id" | "name" | "categoryId" | "selected">> {
  const kinds: ForumKind[] = ["discourse", "v2ex", "hackernews", "stackexchange", "reddit", "rss"];
  if (typeof body.kind !== "string" || !kinds.includes(body.kind as ForumKind)) throw new InvalidForumInput("Choose a source type.");
  const kind = body.kind as ForumKind;
  if (kind === "discourse") return { kind, origin: await forumOrigin(body.origin), latest: "/latest.json" };
  if (kind === "v2ex") return { kind };
  if (kind === "hackernews") {
    const view = typeof body.view === "string" && ["top", "new", "best", "ask", "show"].includes(body.view) ? body.view as ForumSource["view"] : "top";
    return { kind, view };
  }
  if (kind === "stackexchange") {
    if (typeof body.site !== "string" || !/^[a-z0-9.-]{2,80}$/i.test(body.site)) throw new InvalidForumInput("Invalid Stack Exchange site.");
    const tags = typeof body.tags === "string" ? body.tags.trim() : "";
    if (tags.length > 150 || (tags && !/^[^;\x00-\x1f]+(?:;[^;\x00-\x1f]+)*$/.test(tags))) throw new InvalidForumInput("Enter tags separated by semicolons.");
    return { kind, site: body.site.toLowerCase(), tags };
  }
  if (kind === "reddit") {
    if (typeof body.subreddit !== "string" || !/^[A-Za-z0-9_]{2,21}$/.test(body.subreddit)) throw new InvalidForumInput("Invalid subreddit.");
    const sort = typeof body.sort === "string" && ["hot", "new", "top"].includes(body.sort) ? body.sort as ForumSource["sort"] : "hot";
    return { kind, subreddit: body.subreddit, sort };
  }
  return { kind, feedUrl: await publicFeedUrl(body.feedUrl) };
}

function sourceKey(source: ForumSource): string {
  return `${source.kind}:${source.origin || source.view || source.site || source.subreddit || source.feedUrl || "default"}:${source.tags || ""}`.toLowerCase();
}

export async function manageForums(input: unknown): Promise<ForumDirectory> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidForumInput("Invalid request.");
  const body = input as Record<string, unknown>;
  return changeDirectory(async (directory) => {
    const category = directory.categories.find((item) => item.id === body.id);
    const source = directory.sources.find((item) => item.id === body.id);
    switch (body.action) {
      case "createCategory":
        if (directory.categories.length >= 100) throw new InvalidForumInput("Too many categories.");
        directory.categories.push({ id: randomUUID(), name: validName(body.name, 60) }); break;
      case "renameCategory":
        if (!category) throw new InvalidForumInput("Category not found.");
        category.name = validName(body.name, 60); break;
      case "deleteCategory":
        if (!category) throw new InvalidForumInput("Category not found.");
        directory.categories = directory.categories.filter((item) => item.id !== category.id);
        directory.sources = directory.sources.filter((item) => item.categoryId !== category.id); break;
      case "addSource":
      case "editSource": {
        if (body.action === "editSource" && !source) throw new InvalidForumInput("Source not found.");
        if (body.action === "addSource" && directory.sources.length >= 100) throw new InvalidForumInput("Too many sources.");
        const name = validName(body.name, 100);
        if (typeof body.categoryId !== "string" || !directory.categories.some((item) => item.id === body.categoryId)) throw new InvalidForumInput("Choose a category.");
        const fields = await sourceFields(body);
        if (source?.kind === "discourse" && fields.kind === "discourse" && source.origin === fields.origin) fields.latest = source.latest || fields.latest;
        const candidate: ForumSource = { id: source?.id || "new", name, categoryId: body.categoryId, selected: source?.selected ?? true, ...fields };
        if (directory.sources.some((item) => item.id !== source?.id && sourceKey(item) === sourceKey(candidate))) throw new InvalidForumInput("Community source already exists.");
        if (source) Object.keys(source).forEach((key) => { if (!["id", "selected"].includes(key)) delete (source as unknown as Record<string, unknown>)[key]; });
        if (source) Object.assign(source, candidate, { id: source.id }); else directory.sources.push({ ...candidate, id: randomUUID() });
        break;
      }
      case "deleteSource":
        if (!source) throw new InvalidForumInput("Source not found.");
        directory.sources = directory.sources.filter((item) => item.id !== source.id); break;
      case "selectSources": {
        if (!Array.isArray(body.selected) || body.selected.length > 100 || !body.selected.every((id) => typeof id === "string" && directory.sources.some((item) => item.id === id))) throw new InvalidForumInput("Invalid source selection.");
        const selected = new Set(body.selected); directory.sources.forEach((item) => { item.selected = selected.has(item.id); }); break;
      }
      default: throw new InvalidForumInput("Unknown action.");
    }
  });
}
