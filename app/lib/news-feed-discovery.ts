export type NewsFeedDiscoveryMethod = "direct" | "html" | "discourse" | "rsshub";

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
