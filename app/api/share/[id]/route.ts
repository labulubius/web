import { admin, cors, failure, preflight, remove, shareHost } from "../../../lib/share-server";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return preflight(request); }

export async function DELETE(request: Request, context: RouteContext<"/api/share/[id]">) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try {
    const { id } = await context.params;
    return cors(request, Response.json({ ok: await remove(id) }, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) { return cors(request, failure(error)); }
}
