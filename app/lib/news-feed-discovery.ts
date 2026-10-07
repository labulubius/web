export type NewsFeedDiscoveryMethod = "direct" | "html" | "bbc" | "discourse" | "rsshub" | "web";

const BBC_NEWS_FEEDS: Record<string, string> = {
  "/news": "/news/rss.xml",
  "/news/us-canada": "/news/world/us_and_canada/rss.xml",
};

export function bbcNewsFeed(pageUrl: string): string | null {
  const page = new URL(pageUrl);
  const hostname = page.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "bbc.com" && hostname !== "bbc.co.uk") return null;
  const path = page.pathname === "/" ? "/" : page.pathname.replace(/\/+$/, "");
  const feedPath = BBC_NEWS_FEEDS[path];
  return feedPath ? `https://feeds.bbci.co.uk${feedPath}` : null;
}

export function normalizeRssHubRoute(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

export function discourseLatestFeed(html: string, pageUrl: string): string | null {
  if (!/<meta\b[^>]*\bname\s*=\s*["\']generator["\'][^>]*\bcontent\s*=\s*["\'][^"\']*\bDiscourse\b/i.test(html) &&
      !/<meta\b[^>]*\bcontent\s*=\s*["\'][^"\']*\bDiscourse\b[^"\']*["\'][^>]*\bname\s*=\s*["\']generator["\']/i.test(html)) return null;
  const url = new URL(pageUrl);
  url.pathname = `${url.pathname.replace(/\/?$/, "")}/latest.rss`;
  url.search = "";
  url.hash = "";
  return url.href;
}
