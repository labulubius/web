import { createDriveShare, listDriveShares, resolvePublicDriveFile } from "../../../lib/drive-shares";
import { driveError, drivePreflight, privateHeaders, requireDriveAdmin, withDriveCors } from "../../../lib/drive-server";
import { smallJson } from "../../../lib/upload-sessions";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return drivePreflight(request); }

async function respond(request: Request, task: () => Promise<Response>) {
  return withDriveCors(request, async () => {
    try {
      if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
      return await task();
    } catch (error) { return driveError(error); }
  });
}

export function GET(request: Request) {
  return respond(request, async () => {
    const shares = (await Promise.all((await listDriveShares()).map(async (share) => {
      const resolved = await resolvePublicDriveFile(share.id);
      if (!resolved) return null;
      return { name: share.name, type: "file" as const, size: resolved.stat.size, modified: resolved.stat.mtime.toISOString(), shareId: share.id, path: share.path };
    }))).filter((share) => share !== null);
    return Response.json({ shares }, { headers: privateHeaders });
  });
}

export function POST(request: Request) {
  return respond(request, async () => {
    const body = await smallJson(request);
    const share = await createDriveShare(body.path);
    return Response.json({ share, url: `/drive/file/${share.id}` }, { headers: privateHeaders });
  });
}
