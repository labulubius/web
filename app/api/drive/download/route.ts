import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { driveError, MAX_UPLOAD_BYTES, privateHeaders, requireDriveAdmin, resolveDrivePath, segments } from "../../../lib/drive-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const parts = segments(new URL(request.url).searchParams.get("path") ?? "");
    if (!parts.length) throw new Error("Invalid file path.");
    const target = await resolveDrivePath(parts);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("Invalid file path.");
      if (stat.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the download limit.");
      const bytes = await handle.readFile();
      const name = parts.at(-1)!;
      const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      return new Response(bytes, {
        headers: {
          ...privateHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    } finally { await handle.close(); }
  } catch (error) { return driveError(error); }
}
