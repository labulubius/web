import { admin, cors, createFolder, failure, folderContents, preflight, shareHost } from "../../lib/share-server";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return preflight(request); }

export async function GET(request: Request) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try {
    const folder = new URL(request.url).searchParams.get("folder");
    return cors(request, Response.json(await folderContents(folder), { headers: { "Cache-Control": "no-store" } }));
  }
  catch (error) { return cors(request, failure(error)); }
}

export async function POST(request: Request) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      if (Number(request.headers.get("content-length") || 0) > 2048) throw new Error("Invalid request size.");
      const text = await request.text();
      if (text.length > 2048) throw new Error("Invalid request size.");
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid folder request.");
      const values = body as { name?: unknown; parentId?: unknown };
      return cors(request, Response.json({ folder: await createFolder(values.name, values.parentId) }, { status: 201, headers: { "Cache-Control": "no-store" } }));
    }
    throw new Error("Invalid upload request. Use chunked upload.");
  }
  catch (error) { return cors(request, failure(error)); }
}
