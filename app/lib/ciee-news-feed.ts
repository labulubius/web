import { conciseSummary } from "./concise-summary.ts";

export const CIEE_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const CIEE_ORIGIN = "https://ciee.cau.edu.cn";
const ARTICLE_PATH = /^\/art\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/art_50450_(\d{1,16})\.html$/;

export type CieeListing = {
  id: string;
  title: string;
  published: number;
  url: string;
};

export type CieeNotice = CieeListing & { summary: string };

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
    if (match[1].toLowerCase() === name.toLowerCase()) return match[3];
  }
  return undefined;
}

export function cieePlainText(value: unknown, maxLength = 50_000) {
  if (typeof value !== "string") return "";
  const source = value.slice(0, maxLength)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<a\b[^>]*href\s*=\s*(["'])[^"']*\/module\/download\/[^"']*\1[^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(source).replace(/\s+/g, " ").trim();
}

function shanghaiTime(year: number, month: number, day: number, hour = 12, minute = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute);
  const local = new Date(timestamp + 8 * 60 * 60 * 1000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return NaN;
  return timestamp;
}

export function parseCieeListings(html: string): CieeListing[] {
  const listings = new Map<string, CieeListing>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(match[0], "href");
    const titleValue = attribute(match[0], "title");
    if (!href || !titleValue) continue;
    let url: URL;
    try { url = new URL(decodeEntities(href), CIEE_ORIGIN); }
    catch { continue; }
    if (url.origin !== CIEE_ORIGIN || url.search || url.hash || url.username || url.password) continue;
    const pathMatch = ARTICLE_PATH.exec(url.pathname);
    if (!pathMatch) continue;
    const published = shanghaiTime(Number(pathMatch[1]), Number(pathMatch[2]), Number(pathMatch[3]));
    const title = cieePlainText(decodeEntities(titleValue), 1000).slice(0, 300);
    if (!title || !Number.isFinite(published)) continue;
    listings.set(pathMatch[4], { id: pathMatch[4], title, published, url: url.href });
  }
  return [...listings.values()].sort((left, right) => right.published - left.published || right.id.localeCompare(left.id));
}

function meta(html: string, name: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(match[0], "name")?.toLowerCase() === name.toLowerCase()) return decodeEntities(attribute(match[0], "content") || "");
  }
  return "";
}

function articleBody(html: string) {
  const marked = /<!--ZJEG_RSS\.content\.begin-->([\s\S]*?)<!--ZJEG_RSS\.content\.end-->/i.exec(html)?.[1];
  if (marked !== undefined) return marked;
  const container = /<div\b[^>]*id\s*=\s*(["'])vsb_content_4\1[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html)?.[2];
  if (container !== undefined) return container;
  throw new Error("CIEE article structure changed.");
}

export function parseCieeArticle(html: string, expected: CieeListing): CieeNotice {
  const column = meta(html, "i_columnid");
  const articleId = meta(html, "i_articleid");
  const title = cieePlainText(meta(html, "ArticleTitle"), 1000).slice(0, 300);
  const date = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(meta(html, "PubDate").trim());
  const published = date ? shanghaiTime(Number(date[1]), Number(date[2]), Number(date[3]), Number(date[4] ?? 12), Number(date[5] ?? 0)) : NaN;
  let expectedPath: RegExpExecArray | null = null;
  try { expectedPath = ARTICLE_PATH.exec(new URL(expected.url).pathname); }
  catch { /* Rejected by the metadata check below. */ }
  if (column !== "50450" || articleId !== expected.id || expectedPath?.[4] !== expected.id || !title || !Number.isFinite(published)) {
    throw new Error("CIEE article metadata changed.");
  }
  const summary = conciseSummary(cieePlainText(articleBody(html)));
  return { id: expected.id, title, published, url: expected.url, summary };
}

export function normalizeCieeNotices(notices: CieeNotice[], now = Date.now()) {
  const cutoff = now - CIEE_RETENTION_MS;
  const normalized = new Map<string, CieeNotice>();
  for (const notice of notices) {
    if (!/^\d{1,16}$/.test(notice.id) || !notice.title || !notice.url.startsWith(`${CIEE_ORIGIN}/art/`) ||
      !Number.isFinite(notice.published) || notice.published < cutoff || notice.published > now + 24 * 60 * 60 * 1000) continue;
    normalized.set(notice.id, { ...notice, summary: notice.summary || "查看原通知了解详情。" });
  }
  return [...normalized.values()].sort((left, right) => right.published - left.published || right.id.localeCompare(left.id));
}

export function retainCieeNotices(notices: CieeNotice[], now = Date.now()) {
  return normalizeCieeNotices(notices, now);
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function renderCieeRss(notices: CieeNotice[], generatedAt = Date.now()) {
  const items = notices.map((notice) => `    <item>
      <title>${xml(notice.title)}</title>
      <link>${xml(notice.url)}</link>
      <guid isPermaLink="false">ciee:${xml(notice.id)}</guid>
      <pubDate>${new Date(notice.published).toUTCString()}</pubDate>
      <description>${xml(notice.summary)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>信电学院通知公告</title>
    <link>${CIEE_ORIGIN}/col/col50450/index.html</link>
    <description>最近五天的中国农业大学信息与电气工程学院通知公告</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
