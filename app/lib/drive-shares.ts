import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { driveRoot, isDriveInternalName, resolveDrivePath, segments } from "./drive-server";
import { locked } from "./upload-sessions";

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARE_DIRECTORY = ".drive-shares";

export type DriveShare = {
  id: string;
  path: string;
  type: "file" | "folder";
  name: string;
  created: string;
};

export type PublicDriveEntry = {
  name: string;
  type: "file" | "folder";
  size: number;
};

function metadataDirectory(root: string) { return path.join(root, SHARE_DIRECTORY); }
function metadataPath(root: string, id: string) {
  if (!SHARE_ID.test(id)) throw new Error("Invalid share ID.");
  return path.join(metadataDirectory(root), `${id}.json`);
}
async function ensureMetadataDirectory(root: string) {
  const directory = metadataDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid share metadata directory.");
  return directory;
}

async function loadFromRoot(root: string, id: string): Promise<DriveShare | null> {
  if (!SHARE_ID.test(id)) return null;
  try {
    const handle = await open(metadataPath(root, id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const value = JSON.parse(await handle.readFile({ encoding: "utf8" })) as DriveShare;
      const parts = segments(value.path);
      if (value.id !== id || !parts.length || parts.join("/") !== value.path ||
          typeof value.name !== "string" || value.name !== parts.at(-1) ||
          (value.type !== "file" && value.type !== "folder") ||
          typeof value.created !== "string" || !Number.isFinite(Date.parse(value.created))) return null;
      return value;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function scanDriveShares(root: string) {
  const directory = await ensureMetadataDirectory(root);
  const names = await readdir(directory);
  const shares = await Promise.all(names
    .filter((name) => name.endsWith(".json") && SHARE_ID.test(name.slice(0, -5)))
    .map((name) => loadFromRoot(root, name.slice(0, -5))));
  return shares.filter((share): share is DriveShare => share !== null)
    .sort((a, b) => b.created.localeCompare(a.created));
}

export async function loadDriveShare(id: string) {
  return loadFromRoot(await driveRoot(), id);
}

export async function listDriveShares() {
  return scanDriveShares(await driveRoot());
}

export async function createDriveShare(value: unknown) {
  const parts = segments(value);
  if (!parts.length) throw new Error("Cannot share the Drive root.");
  const root = await driveRoot();
  return locked(root, async () => {
    const target = await resolveDrivePath(parts);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error("Invalid drive path.");
    const type = stat.isDirectory() ? "folder" : stat.isFile() ? "file" : null;
    if (!type) throw new Error("Only files and folders can be shared.");
    const canonicalPath = parts.join("/");
    const existing = (await scanDriveShares(root)).find((share) => share.path === canonicalPath);
    if (existing) return existing;

    const directory = await ensureMetadataDirectory(root);
    const id = randomUUID();
    const share: DriveShare = { id, path: canonicalPath, type, name: parts.at(-1)!, created: new Date().toISOString() };
    const temporary = path.join(directory, `.${id}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let committed = false;
    try {
      try { await handle.writeFile(JSON.stringify(share)); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, metadataPath(root, id));
      committed = true;
      return share;
    } finally {
      if (!committed) await unlink(temporary).catch(() => {});
    }
  });
}

export async function revokeDriveShare(id: string) {
  if (!SHARE_ID.test(id)) throw new Error("Invalid share ID.");
  const root = await driveRoot();
  return locked(root, async () => {
    try { await unlink(metadataPath(root, id)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
}

export async function revokeDriveSharesForPath(value: unknown) {
  const parts = segments(value);
  if (!parts.length) throw new Error("Cannot revoke the Drive root.");
  const removedPath = parts.join("/");
  const root = await driveRoot();
  return locked(root, async () => {
    const affected = (await scanDriveShares(root)).filter((share) => share.path === removedPath || share.path.startsWith(`${removedPath}/`));
    await Promise.all(affected.map((share) => unlink(metadataPath(root, share.id))));
    return affected.length;
  });
}

export async function resolvePublicDriveTarget(id: string, relativeValue: unknown = "") {
  const share = await loadDriveShare(id);
  if (!share) return null;
  let relative: string[];
  try { relative = segments(relativeValue); } catch { return null; }
  if (share.type === "file" && relative.length) return null;
  try {
    const target = await resolveDrivePath([...segments(share.path), ...relative]);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return null;
    return { share, relative, target, stat };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function publicDriveFolder(id: string, relativeValue: unknown = "") {
  const resolved = await resolvePublicDriveTarget(id, relativeValue);
  if (!resolved?.stat.isDirectory()) return null;
  const names = await readdir(resolved.target, { withFileTypes: true });
  const entries = (await Promise.all(names
    .filter((entry) => !isDriveInternalName(entry.name) && (entry.isFile() || entry.isDirectory()))
    .map(async (entry): Promise<PublicDriveEntry | null> => {
      const stat = await lstat(path.join(resolved.target, entry.name));
      if (stat.isSymbolicLink()) return null;
      return { name: entry.name, type: stat.isDirectory() ? "folder" : "file", size: stat.size };
    }))).filter((entry): entry is PublicDriveEntry => entry !== null);
  entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
  return { share: resolved.share, relative: resolved.relative, entries };
}
