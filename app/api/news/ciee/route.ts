import { cieeNewsFeed, validCieeFeedToken } from "@/app/lib/ciee-news.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const header = request.headers.get("authorization") || "";
  const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header)?.[1];
  if (!encoded || encoded.length > 256) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  return separator > 0 && decoded.slice(0, separator) === "ciee" && validCieeFeedToken(decoded.slice(separator + 1));
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) return new Response("Not found", { status: 404 });
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
