import { admin, cors, failure, list, preflight, shareHost, upload } from "../../lib/share-server";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return preflight(request); }

export async function GET(request: Request) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try { return cors(request, Response.json({ entries: await list() }, { headers: { "Cache-Control": "no-store" } })); }
  catch (error) { return cors(request, failure(error)); }
}

export async function POST(request: Request) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try { return cors(request, Response.json({ entry: await upload(request) }, { status: 201, headers: { "Cache-Control": "no-store" } })); }
  catch (error) { return cors(request, failure(error)); }
}
