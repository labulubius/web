import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { driveError, drivePreflight, privateHeaders, requireDriveAdmin, resolveDrivePath, segments, withDriveCors } from "../../../lib/drive-server";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return drivePreflight(request); }

export async function GET(request: Request) {
  return withDriveCors(request, async () => {
    try {
      if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
      const parts = segments(new URL(request.url).searchParams.get("path") ?? "");
      if (!parts.length) throw new Error("Invalid file path.");
      const target = await resolveDrivePath(parts);
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("Invalid file path.");
        const name = parts.at(-1)!;
        const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
        const headers = new Headers({
          ...privateHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Accept-Ranges": "bytes",
        });
        let start = 0, end = stat.size - 1, status = 200;
        const range = request.headers.get("range");
        if (range && stat.size) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) { await handle.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } }); }
          if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
          else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { await handle.close(); return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } }); }
          end = Math.min(end, stat.size - 1);
          status = 206;
          headers.set("Content-Length", String(end - start + 1));
          headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        }
        if (!stat.size) { await handle.close(); return new Response(null, { headers }); }
        const stream = handle.createReadStream({ start, end, autoClose: true });
        return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
      } catch (error) { await handle.close().catch(() => {}); throw error; }
    } catch (error) { return driveError(error); }
  });
}
