import { cauNewsFeed, validCauFeedToken } from "../../../../lib/cau-news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!validCauFeedToken((await params).token)) return new Response("Not found", { status: 404 });
    const feed = await cauNewsFeed();
    return new Response(feed.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/rss+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-CAU-Feed-Items": String(feed.count),
        ...(feed.stale ? { Warning: '110 - "Stale CAU notices"' } : {}),
      },
    });
  } catch {
    console.error("CAU News feed request failed (details withheld).");
    return new Response("Feed unavailable", {
      status: 502,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
