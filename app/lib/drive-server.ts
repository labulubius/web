import "server-only";

import { createClient } from "@supabase/supabase-js";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export async function requireDriveAdmin(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });
  const { data: user, error: userError } = await client.auth.getUser(match[1]);
  if (userError || !user.user) return false;
  const { data, error } = await client.rpc("site_is_admin");
  return !error && data === true;
}

export function segments(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid path.");
  if (!value) return [];
  const parts = value.split("/");
  for (const part of parts) validateName(part);
  return parts;
}

export function validateName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !name || name === "." || name === ".." ||
      name.length > 255 || /[/\\\x00-\x1f\x7f]/.test(name) || name.startsWith(".drive-upload-")) {
    throw new Error("Invalid file or folder name.");
  }
}

export async function driveRoot() {
  const root = process.env.DRIVE_DATA_DIR;
  if (!root || !path.isAbsolute(root) || root === "/") throw new Error("DRIVE_DATA_DIR must be an absolute directory outside the website.");
  // Never create inside the repository, which may be cleaned during deployments.
  if (root === process.cwd() || root.startsWith(`${process.cwd()}${path.sep}`)) throw new Error("Drive storage must be outside the project.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid drive storage directory.");
  return root;
}

export async function resolveDrivePath(parts: string[], includeLast = true) {
  let current = await driveRoot();
  for (const [index, part] of parts.entries()) {
    validateName(part);
    current = path.join(current, part);
    if (index === parts.length - 1 && !includeLast) break;
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new Error("Invalid drive path.");
  }
  return current;
}

export function driveError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  const message = error instanceof Error ? error.message : "Drive operation failed.";
  const known = message.startsWith("Invalid") || message.startsWith("File") || message.startsWith("Folder") || message.startsWith("Upload") || message.startsWith("Name") || message.startsWith("Cannot");
  return Response.json({ error: code === "ENOENT" ? "File or folder not found." : code === "EEXIST" ? "Name already exists." : known ? message : "Drive operation failed." }, {
    status: code === "ENOENT" ? 404 : code === "EEXIST" ? 409 : known ? 400 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
