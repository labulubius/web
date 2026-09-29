import { proxyNewsFeed } from "../../../../lib/news-feed-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: RouteContext<"/api/news/feed/[token]">) {
  try { return await proxyNewsFeed((await params).token); }
  catch {
    console.error("News feed proxy request failed (details withheld).");
    return new Response("Feed unavailable", { status: 502, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
