import type { ParsedWebSource } from "./news-web-source-feed";

const MAX_ITEMS = 100;
const MIN_DATE = Date.UTC(1990, 0, 1);
const MAX_FUTURE_MS = 2 * 24 * 60 * 60 * 1000;

export type NewsSourcePreviewItem = { title: string; url: string; published: number | null; summary: string };
export type NewsSourceReview = { title: string; itemCount: number; items: NewsSourcePreviewItem[]; warnings: string[] };

export class UnreliableNewsSource extends Error {}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? entity;
    const hex = key[1]?.toLowerCase() === "x";
    const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    try { return Number.isFinite(point) ? String.fromCodePoint(point) : entity; } catch { return entity; }
  });
}
function plain(value: string, limit: number) {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
function tagContent(xml: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
    if (match) return match[1];
  }
  return "";
}
function attribute(tag: string, name: string) {
  for (const match of tag.matchAll(/\b([a-z][\w:-]*)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return decodeEntities(match[3]);
  }
  return "";
}
function safeUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}
function itemLink(item: string, base: string, atom: boolean) {
  if (atom) {
    for (const match of item.matchAll(/<link\b([^>]*)\/?\s*>/gi)) {
      const href = attribute(match[1], "href");
      const rel = attribute(match[1], "rel");
      if (href && (!rel || rel.toLowerCase() === "alternate")) return safeUrl(href, base);
    }
    const id = plain(tagContent(item, ["id"]), 2048);
    return id ? safeUrl(id, base) : null;
  }
  const link = plain(tagContent(item, ["link"]), 2048);
  if (link) return safeUrl(link, base);
  const guid = plain(tagContent(item, ["guid"]), 2048);
  return /^https?:\/\//i.test(guid) ? safeUrl(guid, base) : null;
}
function itemDate(item: string, now: number) {
  const raw = plain(tagContent(item, ["pubDate", "published", "updated", "dc:date", "date"]), 200);
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= MIN_DATE && parsed <= now + MAX_FUTURE_MS ? parsed : null;
}
function review(title: string, entries: NewsSourcePreviewItem[], reliableDates: number, now: number): NewsSourceReview {
  if (!entries.length) throw new UnreliableNewsSource("No usable article entries were found.");
  if (!reliableDates) throw new UnreliableNewsSource("No trustworthy publication dates were found. This source was not added.");
  if (reliableDates * 2 < entries.length) throw new UnreliableNewsSource("Most entries have no trustworthy publication date. This source was not added.");
  const warnings: string[] = [];
  const missingDates = entries.length - reliableDates;
  const weakSummaries = entries.filter((item) => !item.summary || item.summary.toLocaleLowerCase() === item.title.toLocaleLowerCase()).length;
  if (missingDates) warnings.push(`${missingDates} of ${entries.length} entries have no trustworthy publication date and may use first-seen time after import.`);
  if (weakSummaries) warnings.push(`${weakSummaries} of ${entries.length} entries have no independent summary; the original title may be shown alone.`);
  const dated = entries.map((item) => item.published).filter((value): value is number => value !== null);
  if (dated.length && Math.max(...dated) < now - 2 * 365 * 24 * 60 * 60 * 1000) warnings.push("The newest dated entry is more than two years old.");
  return { title, itemCount: entries.length, items: entries.slice(0, 5), warnings };
}

export function parseNewsFeedPreview(body: Uint8Array, sourceUrl: string, now = Date.now()): NewsSourceReview {
  const xml = new TextDecoder().decode(body);
  if (/<!DOCTYPE\b/i.test(xml)) throw new UnreliableNewsSource("Feeds with document type declarations are not supported.");
  const atom = /<(?:[a-z][\w.-]*:)?feed\b/i.test(xml);
  const rss = /<(?:rss|rdf:RDF)\b/i.test(xml);
  if (!atom && !rss) throw new UnreliableNewsSource("The discovered document is not a supported RSS or Atom feed.");
  const blockPattern = atom ? /<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi : /<item\b[^>]*>[\s\S]*?<\/item\s*>/gi;
  const blocks = [...xml.matchAll(blockPattern)].slice(0, MAX_ITEMS).map((match) => match[0]);
  const items = new Map<string, NewsSourcePreviewItem>();
  for (const item of blocks) {
    const title = plain(tagContent(item, ["title"]), 300);
    const url = itemLink(item, sourceUrl, atom);
    if (!title || !url) continue;
    items.set(url, { title, url, published: itemDate(item, now),
      summary: plain(tagContent(item, ["description", "summary", "content:encoded", "content"]), 1_000) });
  }
  const entries = [...items.values()];
  const feedWithoutItems = xml.replace(blockPattern, " ");
  return review(plain(tagContent(feedWithoutItems, ["title"]), 200) || new URL(sourceUrl).hostname,
    entries, entries.filter((item) => item.published !== null).length, now);
}

export function reviewWebSourcePreview(source: ParsedWebSource, now = Date.now()): NewsSourceReview {
  const entries = source.items.slice(0, MAX_ITEMS).map((item) => {
    const reliable = item.publishedReliable !== false && Number.isFinite(item.published) &&
      item.published >= MIN_DATE && item.published <= now + MAX_FUTURE_MS;
    return { title: item.title, url: item.url, published: reliable ? item.published : null, summary: item.summary };
  });
  return review(source.title, entries, entries.filter((item) => item.published !== null).length, now);
}
