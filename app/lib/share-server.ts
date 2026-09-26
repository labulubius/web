import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const ORIGIN = "https://labulubius.com";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL = 5 * 1024 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ShareEntry = { id: string; name: string; size: number; type: "image" | "file"; created: string };

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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Share-Name",
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
  await Promise.all(["meta", "blobs", "thumbs", "tmp"].map((part) => mkdir(path.join(/* turbopackIgnore: true */ base, part), { recursive: true, mode: 0o700 })));
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

function nameFrom(request: Request) {
  const raw = request.headers.get("x-share-name");
  if (!raw || raw.length > 600) throw new Error("Invalid file name.");
  let name: string;
  try { name = decodeURIComponent(raw).trim(); } catch { throw new Error("Invalid file name."); }
  if (!name || name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(name) || name === "." || name === "..") throw new Error("Invalid file name.");
  return name;
}

export async function upload(request: Request) {
  const name = nameFrom(request);
  if (!request.body || Number(request.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("File exceeds 20 MB.");
  const base = await directories();
  const items = await list();
  const used = items.reduce((sum, item) => sum + item.size, 0);
  const disk = await statfs(base);
  if (used + MAX_BYTES > MAX_TOTAL || Number(disk.bavail) * Number(disk.bsize) < MAX_BYTES + 4 * 1024 ** 3) throw new Error("Share storage limit reached.");
  const id = randomUUID();
  const target = location(id);
  const temp = path.join(base, "tmp", id);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let length = 0;
  let committed = false;
  try {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error("File exceeds 20 MB.");
        await handle.writeFile(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    await handle.close();
    if (length === 0) throw new Error("Empty files are not supported.");

    let type: ShareEntry["type"] = "file";
    const declaredImage = /\.(png|jpe?g|webp)$/i.test(name);
    if (declaredImage) {
      // Only decoded, re-encoded images may ever be rendered inline.
      const image = sharp(temp, { limitInputPixels: 40_000_000, animated: false });
      const info = await image.metadata();
      const expected = name.toLowerCase().endsWith(".png") ? "png" : /\.jpe?g$/i.test(name) ? "jpeg" : "webp";
      if (info.format !== expected || (info.pages ?? 1) > 1) throw new Error("Invalid or animated image.");
      await image.rotate().webp({ quality: 82 }).toFile(target.blob);
      await sharp(target.blob).resize({ width: 320, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toFile(target.thumb);
      type = "image";
    } else {
      await rename(temp, target.blob);
    }
    const entry: ShareEntry = { id, name, size: length, type, created: new Date().toISOString() };
    // Metadata appears last: a partially uploaded file never gets a public link.
    const tempMeta = path.join(base, "tmp", `${id}.json`);
    const metadata = await open(/* turbopackIgnore: true */ tempMeta, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await metadata.writeFile(JSON.stringify(entry)); } finally { await metadata.close(); }
    try { await rename(tempMeta, target.meta); } finally { await unlink(tempMeta).catch(() => {}); }
    committed = true;
    return entry;
  } finally {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    if (!committed) await Promise.all([target.meta, target.blob, target.thumb].map((file) => unlink(file).catch(() => {})));
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
  if (!entry || (thumbnail && entry.type !== "image")) return new Response("Not found", { status: 404 });
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
  const known = /^(Invalid|File exceeds|Empty files|Share storage)/.test(message);
  if (!known) console.error("Share operation failed:", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: known ? message : "Share operation failed." }, { status: known ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}
