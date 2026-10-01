import { cieeNewsFeed, validCieeFeedToken } from "@/app/lib/ciee-news.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!validCieeFeedToken(token)) return new Response("Not found", { status: 404 });
    const feed = await cieeNewsFeed();
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/rss+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-CIEE-Feed-Items": String(feed.count),
    };
    if (feed.stale) headers.Warning = '110 - "Stale CIEE notices"';
    return new Response(feed.body, { headers });
  } catch {
    console.error("CIEE News feed request failed (details withheld).");
    return new Response("Feed unavailable", {
      status: 502,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
