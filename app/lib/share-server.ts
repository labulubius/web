import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { Session, tempPath, TOTAL_BYTES } from "./upload-sessions";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const ORIGIN = "https://labulubius.com";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ShareEntry = { id: string; name: string; size: number; type: "image" | "file"; created: string; folderId?: string | null };
export type ShareFolder = { id: string; name: string; parentId: string | null; created: string };

export function shareHost(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "share.labulubius.com" || host === "localhost" || host === "127.0.0.1";
}

export function cors(request: Request, response: Response) {
  if (request.headers.get("origin") === ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", ORIGIN);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export function preflight(request: Request) {
  if (!shareHost(request) || request.headers.get("origin") !== ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Share-Name, X-Share-Folder",
    "Access-Control-Max-Age": "600", "Vary": "Origin",
  } });
}

export async function admin(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return false;
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user.user) return false;
  const role = await client.rpc("site_is_admin");
  return !role.error && role.data === true;
}

function root() {
  const dir = process.env.SHARE_DATA_DIR;
  if (!dir || !path.isAbsolute(dir) || dir === "/" || dir === process.cwd() || dir.startsWith(`${process.cwd()}${path.sep}`)) {
    throw new Error("SHARE_DATA_DIR must be an absolute directory outside the repository.");
  }
  return dir;
}

function location(id: string) {
  if (!ID.test(id)) throw new Error("Invalid share ID.");
  const base = root();
  return { meta: path.join(base, "meta", `${id}.json`), blob: path.join(base, "blobs", id), thumb: path.join(base, "thumbs", `${id}.webp`) };
}

async function directories() {
  const base = root();
  await Promise.all(["meta", "blobs", "thumbs", "tmp", "folders"].map((part) => mkdir(path.join(/* turbopackIgnore: true */ base, part), { recursive: true, mode: 0o700 })));
  return base;
}

async function load(id: string): Promise<ShareEntry | null> {
  try {
    const file = location(id).meta;
    const handle = await open(/* turbopackIgnore: true */ file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const value = JSON.parse(await handle.readFile({ encoding: "utf8" })) as ShareEntry;
      return value.id === id ? value : null;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function list() {
  const base = await directories();
  const names = await readdir(path.join(base, "meta"));
  const entries = (await Promise.all(names.filter((name) => ID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
    .map((name) => load(name.slice(0, -5))))).filter((item): item is ShareEntry => item !== null);
  entries.sort((a, b) => b.created.localeCompare(a.created));
  return entries;
}

function folderPath(id: string) {
  if (!ID.test(id)) throw new Error("Invalid folder ID.");
  return path.join(root(), "folders", `${id}.json`);
}

async function loadFolder(id: string): Promise<ShareFolder | null> {
  try {
    const handle = await open(/* turbopackIgnore: true */ folderPath(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const value = JSON.parse(await handle.readFile({ encoding: "utf8" })) as ShareFolder;
      return value.id === id ? value : null;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function activeFolder(id: string): Promise<ShareFolder | null> {
  const seen = new Set<string>();
  let current: string | null = id;
  let result: ShareFolder | null = null;
  while (current) {
    if (seen.has(current) || seen.size > 100) return null;
    seen.add(current);
    const folder = await loadFolder(current);
    if (!folder) return null;
    result ??= folder;
    current = folder.parentId;
  }
  return result;
}

async function allFolders(): Promise<ShareFolder[]> {
  const base = await directories();
  const names = await readdir(path.join(base, "folders"));
  return (await Promise.all(names.filter((name) => name.endsWith(".json") && ID.test(name.slice(0, -5)))
    .map((name) => loadFolder(name.slice(0, -5))))).filter((folder): folder is ShareFolder => folder !== null);
}

export async function folderContents(folderId: string | null) {
  const current = folderId ? await activeFolder(folderId) : null;
  if (folderId && !current) throw new Error("Folder not found.");
  const [entries, folders] = await Promise.all([list(), allFolders()]);
  const breadcrumbs: ShareFolder[] = [];
  let parent = current;
  while (parent) {
    breadcrumbs.unshift(parent);
    parent = parent.parentId ? folders.find((item) => item.id === parent!.parentId) ?? null : null;
  }
  return {
    entries: entries.filter((entry) => (entry.folderId ?? null) === folderId),
    folders: folders.filter((folder) => folder.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name)),
    breadcrumbs, used: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

export async function publicFolder(id: string) {
  if (!ID.test(id) || !await activeFolder(id)) return null;
  const contents = await folderContents(id);
  return { folder: contents.breadcrumbs.at(-1)!, entries: contents.entries, folders: contents.folders };
}

export async function createFolder(value: unknown, parentValue: unknown): Promise<ShareFolder> {
  if (typeof value !== "string") throw new Error("Invalid folder name.");
  const name = value.trim();
  if (!name || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name) || name === "." || name === "..") throw new Error("Invalid folder name.");
  if (parentValue !== null && (typeof parentValue !== "string" || !ID.test(parentValue))) throw new Error("Invalid parent folder.");
  const parentId = parentValue as string | null;
  if (parentId && !await activeFolder(parentId)) throw new Error("Parent folder not found.");
  const siblings = (await allFolders()).filter((folder) => folder.parentId === parentId);
  if (siblings.some((folder) => folder.name === name)) throw new Error("Folder already exists here.");
  const folder: ShareFolder = { id: randomUUID(), name, parentId, created: new Date().toISOString() };
  const base = await directories();
  const temporary = path.join(base, "tmp", `${folder.id}.json`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(JSON.stringify(folder));
    await handle.close();
    if (parentId && !await activeFolder(parentId)) throw new Error("Parent folder no longer exists.");
    await rename(temporary, folderPath(folder.id));
    return folder;
  } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

export async function removeFolder(id: string) {
  if (!ID.test(id) || !await activeFolder(id)) return false;
  const [folders, files] = await Promise.all([allFolders(), list()]);
  const ids = new Set([id]);
  for (let index = 0; index <= folders.length; index++) {
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId)) ids.add(folder.id);
  }
  // Revoke the folder and its descendants first; public file downloads also
  // check the whole ancestor chain, so a partial cleanup cannot keep links live.
  await unlink(folderPath(id));
  for (const folder of folders) if (folder.id !== id && ids.has(folder.id)) await unlink(folderPath(folder.id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  for (const file of files) if (file.folderId && ids.has(file.folderId)) await remove(file.id);
  return true;
}

export async function shareRoot() { return directories(); }
export async function validateShareTarget(name: unknown, folderId: unknown) {
  if (typeof name !== "string" || !name || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name) || name === "." || name === "..") throw new Error("Invalid file name.");
  if (folderId !== null && (typeof folderId !== "string" || !ID.test(folderId))) throw new Error("Invalid folder ID.");
  if (folderId && !await activeFolder(folderId as string)) throw new Error("Folder not found.");
}

export async function finishShareUpload(session: Session): Promise<ShareEntry> {
  const name = session.name;
  const folderId = session.context || null;
  await validateShareTarget(name, folderId);
  const base = await directories();
  const used = (await list()).reduce((sum, item) => sum + item.size, 0);
  if (used + session.size > TOTAL_BYTES) throw new Error("Share storage limit reached (5 GB total).");
  const id = session.id;
  const target = location(id);
  const temp = tempPath(base, id);
  let committed = false;
  try {
    let type: ShareEntry["type"] = "file";
    if (/\.(png|jpe?g|webp)$/i.test(name)) {
      // Only decoded, re-encoded images may ever be rendered inline.
      const image = sharp(temp, { limitInputPixels: 40_000_000, animated: false });
      const info = await image.metadata();
      const expected = name.toLowerCase().endsWith(".png") ? "png" : /\.jpe?g$/i.test(name) ? "jpeg" : "webp";
      if (info.format !== expected || (info.pages ?? 1) > 1) throw new Error("Invalid or animated image.");
      await image.rotate().webp({ quality: 82 }).toFile(target.blob);
      await sharp(target.blob).resize({ width: 320, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toFile(target.thumb);
      type = "image";
    } else {
      await link(temp, target.blob);
    }
    if (folderId && !await activeFolder(folderId)) throw new Error("Folder no longer exists.");
    const entry: ShareEntry = { id, name, size: session.size, type, created: new Date().toISOString(), folderId };
    // Metadata appears last: a partially uploaded file never gets a public link.
    const tempMeta = path.join(base, "tmp", `${id}.json`);
    const metadata = await open(/* turbopackIgnore: true */ tempMeta, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await metadata.writeFile(JSON.stringify(entry)); } finally { await metadata.close(); }
    try { await rename(tempMeta, target.meta); } finally { await unlink(tempMeta).catch(() => {}); }
    committed = true;
    return entry;
  } finally {
    if (!committed) await Promise.all([target.blob, target.thumb].map((file) => unlink(file).catch(() => {})));
  }
}

export async function remove(id: string) {
  const entry = await load(id);
  if (!entry) return false;
  const paths = location(id);
  // Revoke at origin first. Remaining files can be cleaned after a partial failure.
  await unlink(paths.meta);
  await Promise.all([paths.blob, paths.thumb].map((file) => unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") console.error("Share file cleanup failed:", error.code);
  })));
  return true;
}

export async function publicFile(id: string, request: Request, thumbnail = false) {
  const entry = await load(id);
  if (!entry || (thumbnail && entry.type !== "image") || (entry.folderId && !await activeFolder(entry.folderId))) return new Response("Not found", { status: 404 });
  const file = thumbnail ? location(id).thumb : location(id).blob;
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 }); throw error; }
  const stat = await handle.stat();
  if (!stat.isFile()) { await handle.close(); return new Response("Not found", { status: 404 }); }
  const type = entry.type === "image" ? "image/webp" : "application/octet-stream";
  const filename = entry.type === "image" ? entry.name.replace(/\.[^.]+$/, ".webp") : entry.name;
  const disposition = entry.type === "image" ? "inline" : "attachment";
  const headers = new Headers({
    "Content-Type": type, "Content-Length": String(stat.size), "Accept-Ranges": "bytes",
    "Content-Disposition": `${disposition}; filename="download"; filename*=UTF-8''${encodeURIComponent(thumbnail ? "thumbnail.webp" : filename)}`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
    "Cache-Control": "no-store",
  });
  const range = request.headers.get("range");
  let start = 0, end = stat.size - 1, status = 200;
  if (range && !thumbnail) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      await handle.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    if (!match[1]) { start = Math.max(0, stat.size - Number(match[2])); }
    else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      await handle.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    end = Math.min(end, stat.size - 1);
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    headers.set("Content-Length", String(end - start + 1));
    status = 206;
  }
  if (request.method === "HEAD") { await handle.close(); return new Response(null, { status, headers }); }
  // Keep the descriptor opened with O_NOFOLLOW; avoid a symlink swap between checking and streaming.
  const stream = handle.createReadStream({ start, end, autoClose: true });
  const { Readable } = await import("node:stream");
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Share operation failed.";
  const known = /^(Invalid|File exceeds|Empty files|Share storage|Storage limit|Upload |Not enough|Folder (not found|already exists)|Parent folder (not found|no longer exists))/.test(message);
  if (!known) console.error("Share operation failed:", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: known ? message : "Share operation failed." }, { status: known ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}
