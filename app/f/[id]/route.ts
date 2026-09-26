import { publicFile, shareHost } from "../../lib/share-server";

export const runtime = "nodejs";

async function serve(request: Request, context: RouteContext<"/f/[id]">) {
  if (!shareHost(request)) return new Response(null, { status: 404 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  try { return await publicFile(id, request, new URL(request.url).searchParams.has("thumb")); }
  catch { return new Response(null, { status: 404 }); }
}

export const GET = serve;
export const HEAD = serve;
