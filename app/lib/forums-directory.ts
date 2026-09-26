import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ForumCategory = { id: string; name: string };
export type ForumSource = { id: string; name: string; origin: string; categoryId: string; selected: boolean; latest: string };
export type ForumDirectory = { categories: ForumCategory[]; sources: ForumSource[] };

const file = path.join(process.env.FORUMS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "forums"), "directory.json");
const initial: ForumDirectory = {
  categories: [{ id: "communities", name: "Communities" }],
  sources: [
    { id: "openai", name: "OpenAI Community", origin: "https://community.openai.com", categoryId: "communities", selected: true, latest: "/latest.json?status=open" },
    { id: "python", name: "Python Discussions", origin: "https://discuss.python.org", categoryId: "communities", selected: true, latest: "/latest.json" },
    { id: "discourse", name: "Discourse Meta", origin: "https://meta.discourse.org", categoryId: "communities", selected: true, latest: "/latest.json" },
  ],
};

export class InvalidForumInput extends Error {}

function validName(value: unknown, length: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > length || /[\x00-\x1f\x7f]/.test(value)) throw new InvalidForumInput("Invalid name.");
  return value.trim();
}

// DNS is checked both at save time and again when connecting (with the checked IP pinned).
export async function publicForumAddress(hostname: string): Promise<string> {
  if (isIP(hostname) || !/^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostname) || hostname.toLowerCase().endsWith(".local")) {
    throw new InvalidForumInput("Use a public DNS hostname, not an IP address.");
  }
  const addresses = await lookup(hostname, { all: true });
  const safe = addresses.filter(({ address, family }) => {
    if (family === 4) {
      const [a, b] = address.split(".").map(Number);
      return a !== 0 && a !== 10 && a !== 127 && a !== 169 && a !== 192 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 172 && b >= 16 && b <= 31);
    }
    const ip = address.toLowerCase();
    return family === 6 && !/^(::|::1|::ffff:|fc|fd|fe[89ab]|ff)/.test(ip) && !ip.startsWith("2001:db8:");
  });
  if (!addresses.length || safe.length !== addresses.length) throw new InvalidForumInput("Forum hostname must resolve only to public addresses.");
  return safe[0].address;
}

export async function forumOrigin(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length > 300) throw new InvalidForumInput("Invalid forum URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new InvalidForumInput("Invalid forum URL."); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new InvalidForumInput("Enter a public HTTPS forum origin (without a path, port or credentials).");
  }
  await publicForumAddress(url.hostname);
  return url.origin;
}

export async function loadForumDirectory(): Promise<ForumDirectory> {
  if (process.env.VERCEL) {
    const response = await fetch("https://drive.labulubius.com/api/forums", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Forum directory unavailable.");
    return response.json() as Promise<ForumDirectory>;
  }
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as ForumDirectory;
    if (!Array.isArray(data.categories) || !Array.isArray(data.sources)) throw new Error("Invalid forum directory.");
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(initial);
    throw error;
  }
}

let pending: Promise<unknown> = Promise.resolve();
async function changeDirectory(action: (directory: ForumDirectory) => Promise<void> | void): Promise<ForumDirectory> {
  const task = pending.catch(() => {}).then(async () => {
    const directory = await loadForumDirectory();
    await action(directory);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(directory), { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    return directory;
  });
  pending = task;
  return task;
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
        directory.categories.push({ id: randomUUID(), name: validName(body.name, 60) });
        break;
      case "renameCategory":
        if (!category) throw new InvalidForumInput("Category not found.");
        category.name = validName(body.name, 60);
        break;
      case "deleteCategory":
        if (!category) throw new InvalidForumInput("Category not found.");
        directory.categories = directory.categories.filter((item) => item.id !== category.id);
        directory.sources = directory.sources.filter((item) => item.categoryId !== category.id);
        break;
      case "addSource":
      case "editSource": {
        if (body.action === "editSource" && !source) throw new InvalidForumInput("Source not found.");
        if (body.action === "addSource" && directory.sources.length >= 100) throw new InvalidForumInput("Too many sources.");
        const name = validName(body.name, 100);
        const origin = await forumOrigin(body.origin);
        if (typeof body.categoryId !== "string" || !directory.categories.some((item) => item.id === body.categoryId)) throw new InvalidForumInput("Choose a category.");
        if (directory.sources.some((item) => item.origin === origin && item.id !== source?.id)) throw new InvalidForumInput("Forum already exists.");
        if (source) Object.assign(source, { name, origin, categoryId: body.categoryId });
        else directory.sources.push({ id: randomUUID(), name, origin, categoryId: body.categoryId, selected: true, latest: "/latest.json" });
        break;
      }
      case "deleteSource":
        if (!source) throw new InvalidForumInput("Source not found.");
        directory.sources = directory.sources.filter((item) => item.id !== source.id);
        break;
      case "selectSources": {
        if (!Array.isArray(body.selected) || body.selected.length > 100 || !body.selected.every((id) => typeof id === "string" && directory.sources.some((item) => item.id === id))) throw new InvalidForumInput("Invalid source selection.");
        const selected = new Set(body.selected);
        directory.sources.forEach((item) => { item.selected = selected.has(item.id); });
        break;
      }
      default: throw new InvalidForumInput("Unknown action.");
    }
  });
}
