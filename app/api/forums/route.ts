import { forumTopicPage, invalidateForumCaches, latestTopics } from "../../lib/forums";
import { InvalidForumInput, loadForumDirectory, manageForums } from "../../lib/forums-directory";
import { newsAdmin, privateNewsHeaders } from "../../lib/news-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function relay(request: Request) {
  const incoming = new URL(request.url);
  const response = await fetch(`https://drive.labulubius.com/api/forums${incoming.search}`, {
    method: request.method,
    headers: {
      ...(request.headers.get("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
      ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(request.method === "POST" ? { body: await request.text() } : {}),
    cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  const cacheControl = response.headers.get("cache-control");
  return new Response(response.body, { status: response.status, headers: { ...privateNewsHeaders, ...(cacheControl ? { "Cache-Control": cacheControl } : {}), "Content-Type": "application/json" } });
}

export async function GET(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    const url = new URL(request.url);
    const directory = await loadForumDirectory();
    const view = url.searchParams.get("view");
    if (!view) return Response.json(directory, { headers: privateNewsHeaders });
    const sourceId = url.searchParams.get("source");
    const source = directory.sources.find((item) => item.id === sourceId);
    if (view === "aggregate") {
      const categoryId = sourceId ? null : url.searchParams.get("category");
      if (sourceId && !source) return Response.json({ error: "Unknown community source." }, { status: 404, headers: privateNewsHeaders });
      if (categoryId && !directory.categories.some((item) => item.id === categoryId)) return Response.json({ error: "Unknown community category." }, { status: 404, headers: privateNewsHeaders });
      const cursor = url.searchParams.get("cursor");
      if (cursor && !/^[0-9a-f-]{36}\.\d{1,6}$/.test(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400, headers: privateNewsHeaders });
      return Response.json(await forumTopicPage(sourceId, categoryId, cursor), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=240" } });
    }
    if (!source) return Response.json({ error: "Unknown community source." }, { status: 404, headers: privateNewsHeaders });
    if (view === "topics") return Response.json(await latestTopics(source), { headers: privateNewsHeaders });
    return Response.json({ error: "Invalid view." }, { status: 400, headers: privateNewsHeaders });
  } catch {
    return Response.json({ error: "Community source unavailable." }, { status: 503, headers: privateNewsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    if (!await newsAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const raw = await request.text();
    if (raw.length > 5000) return Response.json({ error: "Request too large." }, { status: 413, headers: privateNewsHeaders });
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    const result = await manageForums(data);
    invalidateForumCaches();
    return Response.json(result, { headers: privateNewsHeaders });
  } catch (error) {
    if (error instanceof InvalidForumInput) return Response.json({ error: error.message }, { status: 400, headers: privateNewsHeaders });
    console.error("Forum management failed (details withheld).", error);
    return Response.json({ error: "Could not update communities." }, { status: 503, headers: privateNewsHeaders });
  }
}
