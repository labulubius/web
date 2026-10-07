export type WebSourceItem = {
  id: string;
  title: string;
  url: string;
  published: number;
  summary: string;
};

export type ParsedWebSource = {
  title: string;
  description: string;
  items: WebSourceItem[];
};

const CSIS_ORIGIN = "https://www.csis.org";
const CSIS_TOPIC_PATH = /^\/topics\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CSIS_ITEM_PATH = /^\/(?:analysis|blogs|commentary|events|podcasts|reports)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/i;

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity; }
    catch { return entity; }
  });
}

function attribute(tag: string, name: string) {
  for (const match of tag.matchAll(/\b([a-z][\w:-]*)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return decodeEntities(match[3]);
  }
  return undefined;
}

function plainText(value: string, limit = 2_000) {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

function metaContent(html: string, attributeName: "name" | "property", value: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(match[0], attributeName)?.toLowerCase() === value.toLowerCase()) return attribute(match[0], "content") || "";
  }
  return "";
}

export function canonicalCsisTopicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  if (url.protocol !== "https:" || !["csis.org", "www.csis.org"].includes(hostname) || url.username || url.password ||
    url.hash || url.search || !CSIS_TOPIC_PATH.test(path)) return null;
  return `${CSIS_ORIGIN}${path}`;
}

function csisItemUrl(value: string, sourceUrl: string) {
  let url: URL;
  try { url = new URL(decodeEntities(value), sourceUrl); }
  catch { return null; }
  if (url.protocol !== "https:" || !["csis.org", "www.csis.org"].includes(url.hostname.toLowerCase()) ||
    url.username || url.password) return null;
  url.hostname = "www.csis.org";
  url.port = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/^\/index%2ephp\//i, "/").replace(/\/+$/, "");
  if (!CSIS_ITEM_PATH.test(url.pathname)) return null;
  return url.href;
}

function parseDate(value: string) {
  const match = /—\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/.exec(value);
  if (!match) return NaN;
  return Date.parse(`${match[1]} 12:00:00 UTC`);
}

export function parseCsisTopicPage(html: string, sourceUrl: string): ParsedWebSource {
  const canonicalUrl = canonicalCsisTopicUrl(sourceUrl);
  if (!canonicalUrl || !/content\s*=\s*(["'])Drupal\s+10\b/i.test(html) || html.length > 3_000_000) {
    throw new Error("Unsupported CSIS topic page.");
  }
  const title = plainText(metaContent(html, "property", "og:title") || "CSIS topic", 200);
  const description = plainText(metaContent(html, "name", "description"), 500);
  const items = new Map<string, WebSourceItem>();
  const rows = html.match(/<div\b[^>]*class\s*=\s*(["'])[^"']*\bviews-row\b[^"']*\1[^>]*>[\s\S]*?(?=<div\b[^>]*class\s*=\s*(["'])[^"']*\bviews-row\b|<nav\b|<\/main>)/gi) || [];
  for (const row of rows) {
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(row)?.[1];
    if (!heading) continue;
    let linkTag = "";
    for (const match of heading.matchAll(/<a\b[^>]*>/gi)) {
      if (/\bhocus-headline\b/i.test(attribute(match[0], "class") || "")) { linkTag = match[0]; break; }
    }
    const href = attribute(linkTag, "href");
    const url = href ? csisItemUrl(href, canonicalUrl) : null;
    const linkBody = linkTag ? heading.slice(heading.indexOf(linkTag) + linkTag.length).split(/<\/a>/i, 1)[0] : "";
    const itemTitle = plainText(linkBody, 300);
    const published = parseDate(plainText(row, 5_000));
    const teaser = /<div\b[^>]*class\s*=\s*(["'])[^"']*\bteaser\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[2] || "";
    const summary = plainText(teaser, 1_000);
    if (!url || !itemTitle || !Number.isFinite(published)) continue;
    items.set(url, { id: url, title: itemTitle, url, published, summary });
  }
  const ordered = [...items.values()].sort((left, right) => right.published - left.published || right.id.localeCompare(left.id));
  if (!ordered.length) throw new Error("CSIS topic page structure changed.");
  return { title, description, items: ordered.slice(0, 50) };
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function renderWebSourceRss(sourceUrl: string, source: ParsedWebSource, generatedAt = Date.now()) {
  const items = source.items.map((item) => `    <item>
      <title>${xml(item.title)}</title>
      <link>${xml(item.url)}</link>
      <guid isPermaLink="true">${xml(item.id)}</guid>
      <pubDate>${new Date(item.published).toUTCString()}</pubDate>
      <description>${xml(item.summary)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(source.title)}</title>
    <link>${xml(sourceUrl)}</link>
    <description>${xml(source.description || `Recent articles from ${source.title}`)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
