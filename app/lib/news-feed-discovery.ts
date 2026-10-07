export type NewsFeedDiscoveryMethod = "direct" | "html" | "bbc" | "discourse" | "native" | "web";

export type NewsFeedDiscovery = { url: string; method: Exclude<NewsFeedDiscoveryMethod, "web"> };
export type NewsFeedResource = { response: Response; finalUrl: string };
export type NewsFeedResourceFetcher = (url: string) => Promise<NewsFeedResource>;
export type NewsFeedResourceReader = (response: Response) => Promise<Uint8Array>;

const MAX_FEED_CANDIDATES = 16;
const BBC_NEWS_FEEDS: Record<string, string> = {
  "/news": "/news/rss.xml",
  "/news/us-canada": "/news/world/us_and_canada/rss.xml",
};
const REDDIT_SORTS = new Set(["hot", "new", "top", "rising", "controversial"]);
const REDDIT_TIME_FILTERS = new Set(["hour", "day", "week", "month", "year", "all"]);
const V2EX_TABS = new Set(["all", "apple", "city", "creative", "deals", "hot", "jobs", "play", "qna", "r2", "tech"]);

export class NewsFeedDiscoveryError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

function safeStatusError(status: number): NewsFeedDiscoveryError | null {
  if (status === 401 || status === 403) return new NewsFeedDiscoveryError("This source does not allow feed access.", status);
  if (status === 429) return new NewsFeedDiscoveryError("This source is rate limiting feed requests. Try again later.", status);
  return null;
}

function exactHttpsUrl(value: string, hostnames: Set<string>): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !hostnames.has(url.hostname.toLowerCase())) return null;
  return url;
}

function onlySearchParameter(url: URL, name: string, allowed: Set<string>): string | null {
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== name || !allowed.has(entries[0][1])) return null;
  return entries[0][1];
}

export function nativeCommunityFeed(value: string): string | null {
  const reddit = exactHttpsUrl(value, new Set(["reddit.com", "www.reddit.com"]));
  if (reddit) {
    const match = reddit.pathname.match(/^\/r\/([A-Za-z0-9_]+)(?:\/(hot|new|top|rising|controversial))?\/?$/);
    if (!match || (match[2] && !REDDIT_SORTS.has(match[2]))) return null;
    const sort = match[2];
    let query = "";
    if (reddit.search) {
      if (sort !== "top" && sort !== "controversial") return null;
      const period = onlySearchParameter(reddit, "t", REDDIT_TIME_FILTERS);
      if (!period) return null;
      query = `?t=${period}`;
    }
    const sortPath = sort ? `/${sort}` : "";
    return `https://www.reddit.com/r/${match[1]}${sortPath}/.rss${query}`;
  }

  const v2ex = exactHttpsUrl(value, new Set(["v2ex.com", "www.v2ex.com"]));
  if (v2ex) {
    if (v2ex.pathname === "/" && !v2ex.search) return "https://www.v2ex.com/index.xml";
    if (v2ex.pathname === "/" && v2ex.search) {
      const tab = onlySearchParameter(v2ex, "tab", V2EX_TABS);
      return tab ? `https://www.v2ex.com/feed/tab/${tab}.xml` : null;
    }
    if (v2ex.search) return null;
    const node = v2ex.pathname.match(/^\/go\/([a-z0-9][a-z0-9_-]*)\/?$/)?.[1];
    return node ? `https://www.v2ex.com/feed/${node}.xml` : null;
  }

  const linuxDo = exactHttpsUrl(value, new Set(["linux.do"]));
  if (linuxDo) {
    if (linuxDo.search) return null;
    if (linuxDo.pathname === "/" || /^\/latest\/?$/.test(linuxDo.pathname)) return "https://linux.do/latest.rss";
    if (/^\/c\/(?:[a-z0-9_-]+\/)+\d+\/?$/.test(linuxDo.pathname)) return `https://linux.do${linuxDo.pathname.replace(/\/$/, "")}.rss`;
    if (/^\/t\/[a-z0-9_-]+\/\d+\/?$/.test(linuxDo.pathname)) return `https://linux.do${linuxDo.pathname.replace(/\/$/, "")}.rss`;
  }
  return null;
}

export function bbcNewsFeed(pageUrl: string): string | null {
  const page = new URL(pageUrl);
  const hostname = page.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "bbc.com" && hostname !== "bbc.co.uk") return null;
  const path = page.pathname === "/" ? "/" : page.pathname.replace(/\/+$/, "");
  const feedPath = BBC_NEWS_FEEDS[path];
  return feedPath ? `https://feeds.bbci.co.uk${feedPath}` : null;
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

export function xmlFeed(body: Uint8Array) {
  const prefix = new TextDecoder().decode(body.slice(0, 4096));
  return /^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(prefix);
}

function htmlFeedCandidates(html: string, pageUrl: string) {
  const candidates: NewsFeedDiscovery[] = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&");
    if (!href || !/(?:^|\s)alternate(?:\s|$)/i.test(rel) || !/(?:rss|atom|xml)/i.test(type)) continue;
    try { candidates.push({ url: new URL(href, pageUrl).href, method: "html" }); } catch { /* Ignore malformed declarations. */ }
  }
  const bbc = bbcNewsFeed(pageUrl);
  if (bbc) candidates.push({ url: bbc, method: "bbc" });
  const discourse = discourseLatestFeed(html, pageUrl);
  if (discourse) candidates.push({ url: discourse, method: "discourse" });
  return candidates;
}

async function checkedCandidate(
  candidates: NewsFeedDiscovery[], fetchResource: NewsFeedResourceFetcher, readResource: NewsFeedResourceReader,
): Promise<{ found: NewsFeedDiscovery | null; protectedError: NewsFeedDiscoveryError | null }> {
  const seen = new Set<string>();
  let protectedError: NewsFeedDiscoveryError | null = null;
  for (const candidate of candidates) {
    let key: string;
    try { key = new URL(candidate.url).href; } catch { continue; }
    if (seen.has(key) || seen.size >= MAX_FEED_CANDIDATES) continue;
    seen.add(key);
    try {
      const checked = await fetchResource(key);
      if (!checked.response.ok) {
        protectedError ||= safeStatusError(checked.response.status);
        await checked.response.body?.cancel();
        continue;
      }
      const feed = await readResource(checked.response);
      if (xmlFeed(feed)) return { found: { url: checked.finalUrl, method: candidate.method }, protectedError };
    } catch { /* A bad candidate must not prevent checking the remaining declarations. */ }
  }
  return { found: null, protectedError };
}

export async function discoverNewsFeedDetails(
  value: string, fetchResource: NewsFeedResourceFetcher, readResource: NewsFeedResourceReader,
): Promise<NewsFeedDiscovery> {
  const native = nativeCommunityFeed(value);
  if (native) {
    const result = await checkedCandidate([{ url: native, method: "native" }], fetchResource, readResource);
    if (result.found) return result.found;
    if (result.protectedError) throw result.protectedError;
    throw new NewsFeedDiscoveryError("This community's native feed is unavailable.");
  }

  const first = await fetchResource(value);
  if (!first.response.ok) {
    const protectedError = safeStatusError(first.response.status);
    await first.response.body?.cancel();
    if (protectedError) throw protectedError;
    throw new Error("Website unavailable.");
  }
  const body = await readResource(first.response);
  if (xmlFeed(body)) return { url: first.finalUrl, method: "direct" };
  const html = new TextDecoder().decode(body);
  const result = await checkedCandidate(htmlFeedCandidates(html, first.finalUrl), fetchResource, readResource);
  if (result.found) return result.found;
  if (result.protectedError) throw result.protectedError;
  throw new Error("No RSS or Atom feed was discovered.");
}

export async function withNewsFeedFallback<T>(discover: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await discover(); }
  catch (error) {
    if (error instanceof NewsFeedDiscoveryError) throw error;
    return fallback();
  }
}
