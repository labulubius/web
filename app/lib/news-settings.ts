import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
