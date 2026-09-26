import { newsAdmin, newsArticles, newsCategories, newsFeeds, privateNewsHeaders } from "../../lib/news-server";
import { InvalidNewsInput, manageNews } from "../../lib/news-management";
import { loadNewsSelection, saveNewsSelection } from "../../lib/news-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel hosts the UI. Forward same-origin News requests over the existing
// Cloudflare Tunnel to the web server; only the web server contacts FreshRSS.
async function relay(request: Request) {
  const incoming = new URL(request.url);
  const target = new URL(`/api/news${incoming.search}`, "https://drive.labulubius.com");
  const response = await fetch(target, {
    method: request.method,
    headers: {
      ...(request.headers.get("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
      ...(["PUT", "POST"].includes(request.method) ? { "Content-Type": "application/json" } : {}),
    },
    ...(["PUT", "POST"].includes(request.method) ? { body: await request.text() } : {}),
    cache: "no-store", signal: AbortSignal.timeout(55000),
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
    if (url.searchParams.get("view") === "feeds") return Response.json({ feeds, categories: await newsCategories(), selected }, { headers: privateNewsHeaders });
    if (url.searchParams.get("view") !== "articles") return Response.json({ error: "Invalid view." }, { status: 400, headers: privateNewsHeaders });
    const cursor = url.searchParams.get("cursor");
    if (cursor && !/^\d{1,24}$/.test(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400, headers: privateNewsHeaders });
    return Response.json(await newsArticles(selected, cursor), { headers: privateNewsHeaders });
  } catch {
    console.error("News request failed (details withheld).");
    return errorResponse();
  }
}

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const raw = await request.text();
    if (raw.length > 10000) return Response.json({ error: "Request too large." }, { status: 413, headers: privateNewsHeaders });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    const deleting = body !== null && typeof body === "object" && !Array.isArray(body) &&
      ["deleteFeed", "deleteCategory"].includes((body as { action?: string }).action || "");
    try {
      await manageNews(body);
    } finally {
      // Also reconcile after a partially completed category deletion.
      if (deleting) {
        const ids = new Set((await newsFeeds()).map((feed) => feed.id));
        const previous = await loadNewsSelection(auth.user.id);
        const selected = previous.filter((id) => ids.has(id));
        if (selected.length !== previous.length) await saveNewsSelection(auth.user.id, selected);
      }
    }
    const feeds = await newsFeeds();
    const selected = (await loadNewsSelection(auth.user.id)).filter((id) => feeds.some((feed) => feed.id === id));
    return Response.json({ feeds, categories: await newsCategories(), selected }, { headers: privateNewsHeaders });
  } catch (error) {
    if (error instanceof InvalidNewsInput) return Response.json({ error: error.message }, { status: 400, headers: privateNewsHeaders });
    console.error("News management failed (details withheld).");
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
  } catch {
    console.error("News update failed (details withheld).");
    return errorResponse();
  }
}
