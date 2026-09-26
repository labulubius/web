import { admin, cors, failure, finishShareUpload, list, shareHost, shareRoot, validateShareTarget } from "../../../lib/share-server";
import { appendChunk, createSession, discard, loadSession, locked, offset, smallJson } from "../../../lib/upload-sessions";

export const runtime = "nodejs";
export function OPTIONS(request: Request) {
  if (!shareHost(request) || request.headers.get("origin") !== "https://labulubius.com") return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "https://labulubius.com", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin",
  } });
}
function idFrom(request: Request) { return new URL(request.url).searchParams.get("id") ?? ""; }
function respond(request: Request, task: () => Promise<Response>) {
  if (!shareHost(request)) return Promise.resolve(new Response(null, { status: 404 }));
  return (async () => {
    if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
    try { return cors(request, await task()); } catch (error) { return cors(request, failure(error)); }
  })();
}
export function GET(request: Request) {
  return respond(request, async () => {
    const root = await shareRoot();
    const session = await loadSession(root, idFrom(request));
    return Response.json({ offset: await offset(root, session.id), size: session.size }, { headers: { "Cache-Control": "no-store" } });
  });
}
export function POST(request: Request) {
  return respond(request, async () => {
    const root = await shareRoot();
    const data = await smallJson(request);
    if (data.action === "start") {
      await validateShareTarget(data.name, data.folderId ?? null);
      const session = await locked(root, async () => createSession(root, (await list()).reduce((sum, item) => sum + item.size, 0), data.name as string, data.size as number, (data.folderId as string | null) ?? ""));
      return Response.json({ id: session.id, offset: 0 }, { headers: { "Cache-Control": "no-store" } });
    }
    if (data.action === "finish") {
      if (typeof data.id !== "string") throw new Error("Invalid upload session.");
      return locked(root, async () => {
        const session = await loadSession(root, data.id as string);
        if (await offset(root, session.id) !== session.size) throw new Error("Upload incomplete.");
        const entry = await finishShareUpload(session);
        await discard(root, session.id);
        return Response.json({ entry }, { status: 201, headers: { "Cache-Control": "no-store" } });
      });
    }
    throw new Error("Invalid upload action.");
  });
}
export function PUT(request: Request) {
  return respond(request, async () => {
    const root = await shareRoot();
    return locked(root, async () => {
      const session = await loadSession(root, idFrom(request));
      const expected = Number(new URL(request.url).searchParams.get("offset"));
      return Response.json({ offset: await appendChunk(root, session, expected, request) }, { headers: { "Cache-Control": "no-store" } });
    });
  });
}
export function DELETE(request: Request) {
  return respond(request, async () => {
    const root = await shareRoot();
    return locked(root, async () => {
      const session = await loadSession(root, idFrom(request));
      await discard(root, session.id);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
  });
}
