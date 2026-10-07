import { webSourceFeed } from "../../../../lib/news-web-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: RouteContext<"/api/news/generated/[token]">) {
  try {
    const feed = await webSourceFeed((await params).token);
    if (!feed) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/rss+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Web-Source-Items": String(feed.count),
    };
    if (feed.stale) headers.Warning = '110 - "Stale web source"';
    return new Response(feed.body, { headers });
  } catch {
    console.error("Generated web source request failed (details withheld).");
    return new Response("Feed unavailable", {
      status: 502,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
