import { link, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { driveError, drivePreflight, driveRoot, privateHeaders, requireDriveAdmin, resolveDrivePath, segments, validateName, withDriveCors } from "../../../lib/drive-server";
import { appendChunk, createSession, discard, loadSession, locked, offset, smallJson, tempPath, TOTAL_BYTES } from "../../../lib/upload-sessions";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return drivePreflight(request); }

async function driveUsed(root: string): Promise<number> {
  let total = 0;
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === ".upload-sessions") continue;
    const file = path.join(root, item.name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) total += await driveUsed(file);
    else if (stat.isFile()) total += stat.size;
  }
  return total;
}
function idFrom(request: Request) { return new URL(request.url).searchParams.get("id") ?? ""; }
function respond(request: Request, task: () => Promise<Response>) {
  return withDriveCors(request, async () => {
    try {
      if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
      return await task();
    } catch (error) { return driveError(error); }
  });
}
export function GET(request: Request) {
  return respond(request, async () => {
    const root = await driveRoot();
    const id = idFrom(request);
    const session = await loadSession(root, id);
    return Response.json({ offset: await offset(root, session.id), size: session.size }, { headers: privateHeaders });
  });
}
export function POST(request: Request) {
  return respond(request, async () => {
    const root = await driveRoot();
    const data = await smallJson(request);
    if (data.action === "start") {
      validateName(data.name);
      const parts = segments(data.path);
      const parent = parts.length ? await resolveDrivePath(parts) : root;
      if (!(await lstat(parent)).isDirectory()) throw new Error("Invalid drive path.");
      try { await lstat(path.join(parent, data.name)); throw new Error("Name already exists."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const session = await locked(root, async () => createSession(root, await driveUsed(root), data.name as string, data.size as number, data.path as string));
      return Response.json({ id: session.id, offset: 0 }, { headers: privateHeaders });
    }
    if (data.action === "finish") {
      if (typeof data.id !== "string") throw new Error("Invalid upload session.");
      return locked(root, async () => {
        const session = await loadSession(root, data.id as string);
        if (await offset(root, session.id) !== session.size) throw new Error("Upload incomplete.");
        const parts = segments(session.context);
        const parent = parts.length ? await resolveDrivePath(parts) : root;
        if (!(await lstat(parent)).isDirectory()) throw new Error("Invalid drive path.");
        if (await driveUsed(root) + session.size > TOTAL_BYTES) throw new Error("Storage limit reached (5 GB total).");
        // Hard link fails atomically if a file with this name appeared during upload.
        await link(tempPath(root, session.id), path.join(parent, session.name));
        await discard(root, session.id);
        return Response.json({ ok: true }, { headers: privateHeaders });
      });
    }
    throw new Error("Invalid upload action.");
  });
}
export function PUT(request: Request) {
  return respond(request, async () => {
    const root = await driveRoot();
    const id = idFrom(request);
    const expected = Number(new URL(request.url).searchParams.get("offset"));
    return locked(root, async () => {
      const session = await loadSession(root, id);
      const next = await appendChunk(root, session, expected, request);
      return Response.json({ offset: next }, { headers: privateHeaders });
    });
  });
}
export function DELETE(request: Request) {
  return respond(request, async () => {
    const root = await driveRoot();
    return locked(root, async () => {
      const session = await loadSession(root, idFrom(request));
      await discard(root, session.id);
      return Response.json({ ok: true }, { headers: privateHeaders });
    });
  });
}
