import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolvePublicDriveFile } from "../../../../lib/drive-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

async function serve(request: Request, context: RouteContext<"/drive/file/[id]/download">) {
  try {
    const { id } = await context.params;
    const resolved = await resolvePublicDriveFile(id);
    if (!resolved) return new Response(null, { status: 404, headers: publicHeaders });
    const handle = await open(resolved.target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("Not found");
      const name = resolved.share.name;
      const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      const headers = new Headers({
        ...publicHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Accept-Ranges": "bytes",
      });
      let start = 0, end = stat.size - 1, status = 200;
      const range = request.headers.get("range");
      if (range && stat.size) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          await handle.close();
          return new Response(null, { status: 416, headers: { ...publicHeaders, "Content-Range": `bytes */${stat.size}` } });
        }
        if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
        else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          await handle.close();
          return new Response(null, { status: 416, headers: { ...publicHeaders, "Content-Range": `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        headers.set("Content-Length", String(end - start + 1));
        headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        status = 206;
      }
      if (request.method === "HEAD" || !stat.size) {
        await handle.close();
        return new Response(null, { status, headers });
      }
      return new Response(Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream, { status, headers });
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  } catch {
    return new Response(null, { status: 404, headers: publicHeaders });
  }
}

export const GET = serve;
export const HEAD = serve;
