import { newsAdmin, newsArticles, newsFeeds, privateNewsHeaders } from "../../lib/news-server";
import { loadNewsSelection, saveNewsSelection } from "../../lib/news-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel hosts the UI. Forward same-origin News requests over the existing
// Cloudflare Tunnel to the web server; only the web server contacts FreshRSS.
async function relay(request: Request) {
  const incoming = new URL(request.url);
  const target = new URL(`/api/news${incoming.search}`, "https://drive.labulubius.com");
  const response = await fetch(target, {
    method: request.method,
    headers: {
      ...(request.headers.get("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
      ...(request.method === "PUT" ? { "Content-Type": "application/json" } : {}),
    },
    ...(request.method === "PUT" ? { body: await request.text() } : {}),
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { ...privateNewsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse() {
  return Response.json({ error: "News is temporarily unavailable." }, { status: 503, headers: privateNewsHeaders });
}

export async function GET(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const url = new URL(request.url);
    const feeds = await newsFeeds();
    const ids = new Set(feeds.map((feed) => feed.id));
    const selected = (await loadNewsSelection(auth.user.id)).filter((id) => ids.has(id));
    if (url.searchParams.get("view") === "feeds") return Response.json({ feeds, selected }, { headers: privateNewsHeaders });
    if (url.searchParams.get("view") !== "articles") return Response.json({ error: "Invalid view." }, { status: 400, headers: privateNewsHeaders });
    const cursor = url.searchParams.get("cursor");
    if (cursor && !/^\d{1,24}$/.test(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400, headers: privateNewsHeaders });
    return Response.json(await newsArticles(selected, cursor), { headers: privateNewsHeaders });
  } catch (error) {
    console.error("News request failed:", error instanceof Error ? error.message : "Unknown error");
    return errorResponse();
  }
}

export async function PUT(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const body = await request.text();
    if (body.length > 20000) return Response.json({ error: "Too many sources." }, { status: 413, headers: privateNewsHeaders });
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    const selected = (parsed as { selected?: unknown })?.selected;
    if (!Array.isArray(selected) || selected.length > 500 || !selected.every((id) => typeof id === "string")) {
      return Response.json({ error: "Invalid sources." }, { status: 400, headers: privateNewsHeaders });
    }
    const ids = new Set((await newsFeeds()).map((feed) => feed.id));
    if (selected.some((id) => !ids.has(id))) return Response.json({ error: "Unknown source." }, { status: 400, headers: privateNewsHeaders });
    const feedIds = [...new Set(selected as string[])];
    await saveNewsSelection(auth.user.id, feedIds);
    return Response.json({ selected: feedIds }, { headers: privateNewsHeaders });
  } catch (error) {
    console.error("News update failed:", error instanceof Error ? error.message : "Unknown error");
    return errorResponse();
  }
}
