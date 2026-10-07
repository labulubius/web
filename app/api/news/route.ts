import { newsAdmin, newsArticles, newsCategories, newsFeeds, privateNewsHeaders, validNewsCursor } from "../../lib/news-server";
import { InvalidNewsInput, manageNews } from "../../lib/news-management";
import { loadNewsSelection, loadPublicNewsSelection, saveNewsSelection } from "../../lib/news-settings";
import { loadWatchboards } from "../../lib/news-watchboards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const publicNewsHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "X-Content-Type-Options": "nosniff",
};

async function loadSidebarData() {
  const [feeds, categories] = await Promise.all([newsFeeds(), newsCategories()]);
  return { feeds, categories };
}

let sidebarCache: ReturnType<typeof loadSidebarData> | null = null;
let sidebarExpires = 0;

function invalidateSidebarData() { sidebarCache = null; sidebarExpires = 0; }

function sidebarData() {
  if (!sidebarCache || Date.now() >= sidebarExpires) {
    sidebarExpires = Date.now() + 30_000;
    sidebarCache = loadSidebarData().catch((error: unknown) => { sidebarCache = null; throw error; });
  }
  return sidebarCache;
}

function errorResponse() {
  return Response.json({ error: "News is temporarily unavailable." }, { status: 503, headers: privateNewsHeaders });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "sidebar") {
      const [{ feeds, categories }, selectedIds] = await Promise.all([sidebarData(), loadPublicNewsSelection()]);
      const selected = new Set(selectedIds);
      return Response.json({
        categories: categories.map(({ name }) => ({ name })),
        // Keep feed IDs/URLs private; checked state reflects the owner's selection.
        feeds: feeds.map(({ id, title, category }, key) => ({ key, title: title === id ? "Untitled source" : title, category, checked: selected.has(id) })),
      }, { headers: publicNewsHeaders });
    }
    if (url.searchParams.get("view") === "publicArticles") {
      const cursor = url.searchParams.get("cursor");
      if (cursor && !validNewsCursor(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400, headers: privateNewsHeaders });
      const [{ feeds }, selectedIds] = await Promise.all([sidebarData(), loadPublicNewsSelection()]);
      const selected = selectedIds.filter((id) => feeds.some((feed) => feed.id === id));
      return Response.json(await newsArticles(selected, cursor, feeds), { headers: publicNewsHeaders });
    }
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const feeds = await newsFeeds();
    const ids = new Set(feeds.map((feed) => feed.id));
    const selected = (await loadNewsSelection(auth.user.id)).filter((id) => ids.has(id));
    if (url.searchParams.get("view") === "feeds") return Response.json({ feeds, categories: await newsCategories(), selected }, { headers: privateNewsHeaders });
    if (url.searchParams.get("view") !== "articles") return Response.json({ error: "Invalid view." }, { status: 400, headers: privateNewsHeaders });
    const feed = url.searchParams.get("feed");
    const boardId = url.searchParams.get("board");
    if (feed && boardId) return Response.json({ error: "Choose a source or watchboard." }, { status: 400, headers: privateNewsHeaders });
    if (feed && !ids.has(feed)) return Response.json({ error: "Unknown source." }, { status: 400, headers: privateNewsHeaders });
    const cursor = url.searchParams.get("cursor");
    if (cursor && !validNewsCursor(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400, headers: privateNewsHeaders });
    let articleFeeds = feed ? [feed] : selected;
    if (boardId) {
      const state = await loadWatchboards(auth.user.id);
      const board = state.watchboards.find((item) => item.id === boardId);
      if (!board) return Response.json({ error: "Unknown watchboard." }, { status: 400, headers: privateNewsHeaders });
      articleFeeds = board.tagIds.length ? feeds.filter((source) => board.tagIds.every((tag) => (state.sourceTags[source.id] || []).includes(tag))).map((source) => source.id) : [];
    }
    return Response.json(await newsArticles(articleFeeds, cursor, feeds), { headers: privateNewsHeaders });
  } catch {
    console.error("News request failed (details withheld).");
    return errorResponse();
  }
}

export async function POST(request: Request) {
  try {
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const raw = await request.text();
    if (raw.length > 10000) return Response.json({ error: "Request too large." }, { status: 413, headers: privateNewsHeaders });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    const deleting = body !== null && typeof body === "object" && !Array.isArray(body) &&
      ["deleteFeed", "deleteCategory"].includes((body as { action?: string }).action || "");
    let result;
    try {
      result = await manageNews(body, auth.user.id);
    } finally {
      invalidateSidebarData();
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
    return Response.json({ feeds, categories: await newsCategories(), selected, ...result }, { headers: privateNewsHeaders });
  } catch (error) {
    if (error instanceof InvalidNewsInput) return Response.json({ error: error.message }, { status: 400, headers: privateNewsHeaders });
    console.error("News management failed (details withheld).");
    return errorResponse();
  }
}

export async function PUT(request: Request) {
  try {
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
