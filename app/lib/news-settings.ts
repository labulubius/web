import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Persistent on the web server; never stored in the Vercel deployment filesystem.
const directory = process.env.NEWS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "news");

function preferencePath(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user ID.");
  return path.join(directory, `${userId}.json`);
}

export async function loadNewsSelection(userId: string): Promise<string[]> {
  try {
    const data: unknown = JSON.parse(await readFile(preferencePath(userId), "utf8"));
    return Array.isArray(data) && data.every((id) => typeof id === "string") ? data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// The site has one public, read-only News view backed by its owner's selection.
// If more than one admin preference exists, require an explicit owner ID rather
// than accidentally exposing another account's private preferences.
export async function loadPublicNewsSelection(): Promise<string[]> {
  let ownerId = process.env.NEWS_PUBLIC_OWNER_ID;
  if (!ownerId) {
    let files: string[];
    try { files = (await readdir(/* turbopackIgnore: true */ directory)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (files.length === 0) return [];
    if (files.length !== 1) throw new Error("NEWS_PUBLIC_OWNER_ID is required when multiple preferences exist.");
    ownerId = files[0].slice(0, -5);
  }
  return loadNewsSelection(ownerId);
}

export async function saveNewsSelection(userId: string, ids: string[]) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(ids), { mode: 0o600, flag: "wx" });
    await rename(temporary, preferencePath(userId));
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
    throw error;
  }
}
