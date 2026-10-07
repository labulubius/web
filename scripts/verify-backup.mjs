#!/usr/bin/env node
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []));
if (!args.tasks || !args.drive || !args.news) {
  console.error("Usage: verify-backup.mjs --tasks DIR --drive DIR --news DIR");
  process.exit(2);
}
async function directory(value, label) { const info = await lstat(value); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} is not a real directory.`); return realpath(value); }
async function rejectSymlinks(root) { for (const entry of await readdir(root, { withFileTypes: true })) { const target=path.join(root,entry.name); const info=await lstat(target); if (info.isSymbolicLink()) throw new Error(`Unsafe symlink: ${target}`); if (info.isDirectory()) await rejectSymlinks(target); } }
async function json(file) { return JSON.parse(await readFile(file, "utf8")); }
async function jsonDirectory(root) { for (const name of await readdir(root)) if (name.endsWith(".json")) await json(path.join(root,name)); }
try {
  const tasks=await directory(args.tasks,"Tasks backup"); const drive=await directory(args.drive,"Drive backup"); const news=await directory(args.news,"News backup");
  await Promise.all([rejectSymlinks(tasks),rejectSymlinks(drive),rejectSymlinks(news)]);
  try { const taskData=await json(path.join(tasks,"tasks.json")); if (![1,2,3].includes(taskData?.version)||!Array.isArray(taskData.tasks)||!Array.isArray(taskData.projects)) throw new Error("Tasks backup has an invalid data structure."); } catch(error) { if (error?.code!=="ENOENT") throw error; }
  try { await jsonDirectory(path.join(drive,".drive-shares")); } catch(error) { if (error.code!=="ENOENT") throw error; }
  await jsonDirectory(news); console.log("Backup structure verified successfully.");
} catch(error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
