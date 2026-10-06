import { servePublicDriveFile } from "./download-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: Request, context: RouteContext<"/drive/file/[id]">) {
  const { id } = await context.params;
  return servePublicDriveFile(request, id);
}

export const GET = serve;
export const HEAD = serve;
