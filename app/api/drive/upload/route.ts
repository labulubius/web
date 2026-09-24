import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, link, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { driveError, driveRoot, MAX_REQUEST_BYTES, MAX_UPLOAD_BYTES, privateHeaders, requireDriveAdmin, resolveDrivePath, segments, validateName } from "../../../lib/drive-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) throw new Error("Upload exceeds the 20 MB limit.");
    if (!request.body) throw new Error("Invalid upload.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("Upload exceeds the 20 MB limit."); }
      chunks.push(value);
    }
    const multipart = new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) });
    const form = await multipart.formData();
    const parts = segments(form.get("path"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Invalid upload.");
    validateName(file.name);
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Upload exceeds the 20 MB limit.");
    const parent = parts.length ? await resolveDrivePath(parts) : await driveRoot();
    if (!(await lstat(parent)).isDirectory()) throw new Error("Invalid drive path.");
    const temp = path.join(parent, `.drive-upload-${randomUUID()}`);
    const destination = path.join(parent, file.name);
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(Buffer.from(await file.arrayBuffer()));
      await handle.close();
      // Hard-link creation is atomic and fails if the destination already exists.
      await link(temp, destination);
    } finally {
      await handle.close().catch(() => {});
      await unlink(temp).catch(() => {});
    }
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return driveError(error); }
}
