import { readdir, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { driveError, driveRoot, privateHeaders, requireDriveAdmin, resolveDrivePath, segments, validateName } from "../../lib/drive-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const parts = segments(new URL(request.url).searchParams.get("path") ?? "");
    const dir = parts.length ? await resolveDrivePath(parts) : await driveRoot();
    if (!(await lstat(dir)).isDirectory()) throw new Error("Invalid drive path.");
    const entries = await Promise.all((await readdir(dir, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith(".drive-upload-") && (entry.isFile() || entry.isDirectory()))
      .map(async (entry) => {
        const stat = await lstat(path.join(dir, entry.name));
        return { name: entry.name, type: entry.isDirectory() ? "folder" : "file", size: stat.size, modified: stat.mtime.toISOString() };
      }));
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
    return Response.json({ entries }, { headers: privateHeaders });
  } catch (error) { return driveError(error); }
}

export async function POST(request: Request) {
  try {
    if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const body = await request.json() as { path?: unknown; name?: unknown };
    const parts = segments(body.path);
    validateName(body.name);
    const parent = parts.length ? await resolveDrivePath(parts) : await driveRoot();
    if (!(await lstat(parent)).isDirectory()) throw new Error("Invalid drive path.");
    await mkdir(path.join(parent, body.name));
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return driveError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const body = await request.json() as { path?: unknown };
    const parts = segments(body.path);
    if (!parts.length) throw new Error("Cannot delete the drive root.");
    const target = await resolveDrivePath(parts);
    // rm does not follow symlinks inside a directory, but reject symlinks at the target.
    await rm(target, { recursive: true });
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return driveError(error); }
}
