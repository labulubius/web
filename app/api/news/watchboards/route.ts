import { newsAdmin, newsFeeds, privateNewsHeaders } from "../../../lib/news-server";
import { InvalidWatchboardInput, loadWatchboards, updateWatchboards, visibleWatchboards } from "../../../lib/news-watchboards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = () => Response.json({ error: "News is temporarily unavailable." }, { status: 503, headers: privateNewsHeaders });

export async function GET(request: Request) {
  try {
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const [state, feeds] = await Promise.all([loadWatchboards(auth.user.id), newsFeeds()]);
    return Response.json(visibleWatchboards(state, new Set(feeds.map((feed) => feed.id))), { headers: privateNewsHeaders });
  } catch { console.error("News watchboards read failed (details withheld)."); return unavailable(); }
}

export async function POST(request: Request) {
  try {
    const auth = await newsAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const raw = await request.text();
    if (raw.length > 20000) return Response.json({ error: "Request too large." }, { status: 413, headers: privateNewsHeaders });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    const feeds = await newsFeeds();
    const feedIds = new Set(feeds.map((feed) => feed.id));
    const state = await updateWatchboards(auth.user.id, body, feedIds);
    return Response.json(visibleWatchboards(state, feedIds), { headers: privateNewsHeaders });
  } catch (error) {
    if (error instanceof InvalidWatchboardInput) return Response.json({ error: error.message }, { status: 400, headers: privateNewsHeaders });
    console.error("News watchboards update failed (details withheld).");
    return unavailable();
  }
}
