import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { driveRoot, resolveDrivePath, segments } from "./drive-server";
import { locked } from "./upload-sessions";

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARE_DIRECTORY = ".drive-shares";
const SHARE_VERSION = 2;
const SHARE_SCOPE = "file-download";

export type DriveShare = {
  version: typeof SHARE_VERSION;
  scope: typeof SHARE_SCOPE;
  id: string;
  path: string;
  type: "file";
  name: string;
  created: string;
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
      const value = JSON.parse(await handle.readFile({ encoding: "utf8" })) as Partial<DriveShare>;
      const parts = segments(value.path);
      if (value.version !== SHARE_VERSION || value.scope !== SHARE_SCOPE ||
          value.id !== id || !parts.length || parts.join("/") !== value.path ||
          typeof value.name !== "string" || value.name !== parts.at(-1) ||
          value.type !== "file" || typeof value.created !== "string" ||
          !Number.isFinite(Date.parse(value.created))) return null;
      return value as DriveShare;
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
    if (!stat.isFile()) throw new Error("Only files can have public links.");
    const canonicalPath = parts.join("/");
    const existing = (await scanDriveShares(root)).find((share) => share.path === canonicalPath);
    if (existing) return existing;

    const directory = await ensureMetadataDirectory(root);
    const id = randomUUID();
    const share: DriveShare = {
      version: SHARE_VERSION,
      scope: SHARE_SCOPE,
      id,
      path: canonicalPath,
      type: "file",
      name: parts.at(-1)!,
      created: new Date().toISOString(),
    };
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

export async function resolvePublicDriveFile(id: string) {
  const share = await loadDriveShare(id);
  if (!share) return null;
  try {
    const target = await resolveDrivePath(segments(share.path));
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return { share, target, stat };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
