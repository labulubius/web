#!/usr/bin/env node
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []));
if (!args.drive || !args.share || !args.news || !args.forums) {
  console.error("Usage: verify-backup.mjs --drive DIR --share DIR --news DIR --forums DIR [--freshrss-dump FILE]");
  process.exit(2);
}

async function directory(value, label) {
  const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} is not a real directory.`);
  return realpath(value);
}
async function rejectSymlinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Unsafe symlink: ${target}`);
    if (info.isDirectory()) await rejectSymlinks(target);
  }
}
async function json(file) { return JSON.parse(await readFile(file, "utf8")); }
async function jsonDirectory(root) {
  for (const name of await readdir(root)) if (name.endsWith(".json")) await json(path.join(root, name));
}

try {
  const drive = await directory(args.drive, "Drive backup");
  const share = await directory(args.share, "Share backup");
  const news = await directory(args.news, "News backup");
  const forums = await directory(args.forums, "Forums backup");
  if (drive === share || drive.startsWith(`${share}${path.sep}`) || share.startsWith(`${drive}${path.sep}`)) throw new Error("Drive and Share backups must be separate, non-nested directories.");
  await Promise.all([rejectSymlinks(drive), rejectSymlinks(share), rejectSymlinks(news), rejectSymlinks(forums)]);

  for (const required of ["meta", "folders", "blobs", "thumbs"]) await directory(path.join(share, required), `Share ${required}`);
  for (const name of await readdir(path.join(share, "meta"))) {
    if (!name.endsWith(".json")) continue;
    const entry = await json(path.join(share, "meta", name));
    if (!entry.id || `${entry.id}.json` !== name) throw new Error(`Invalid Share metadata: ${name}`);
    const blob = await lstat(path.join(share, "blobs", entry.id));
    if (!blob.isFile() || blob.isSymbolicLink()) throw new Error(`Missing Share blob: ${entry.id}`);
    if (entry.type === "image") {
      const thumb = await lstat(path.join(share, "thumbs", `${entry.id}.webp`));
      if (!thumb.isFile() || thumb.isSymbolicLink()) throw new Error(`Missing Share thumbnail: ${entry.id}`);
    }
  }
  await jsonDirectory(path.join(share, "folders"));
  await jsonDirectory(news);
  await json(path.join(forums, "directory.json"));

  if (args["freshrss-dump"]) {
    const result = spawnSync("pg_restore", ["--list", args["freshrss-dump"]], { stdio: "ignore" });
    if (result.error?.code === "ENOENT") throw new Error("pg_restore is required to verify the FreshRSS dump.");
    if (result.status !== 0) throw new Error("FreshRSS dump catalog is invalid.");
  } else console.warn("warning: no FreshRSS dump supplied; database restore was not verified");
  console.log("Backup structure verified successfully.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
