import { admin, cors, failure, preflight, remove, shareHost, shareRoot } from "../../../lib/share-server";
import { locked } from "../../../lib/upload-sessions";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return preflight(request); }

export async function DELETE(request: Request, context: RouteContext<"/api/share/[id]">) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  if (!await admin(request)) return cors(request, Response.json({ error: "Unauthorized." }, { status: 401 }));
  try {
    const { id } = await context.params;
    const root = await shareRoot();
    return cors(request, await locked(root, async () => Response.json({ ok: await remove(id) }, { headers: { "Cache-Control": "no-store" } })));
  } catch (error) { return cors(request, failure(error)); }
}
