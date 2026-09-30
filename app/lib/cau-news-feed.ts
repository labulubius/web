import { conciseSummary } from "./concise-summary.ts";

export const CAU_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;

export type CauNotice = {
  id: string;
  title: string;
  summary: string;
  unit: string;
  published: number;
  url: string;
};

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

export function cauPlainText(value: unknown, maxLength = 20_000) {
  if (typeof value !== "string") return "";
  return decodeEntities(value.slice(0, maxLength)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function normalizeCauNotices(records: unknown, now = Date.now()): CauNotice[] {
  if (!Array.isArray(records)) return [];
  const cutoff = now - CAU_RETENTION_MS;
  const notices = new Map<string, CauNotice>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.RESOURCE_ID === "string" ? item.RESOURCE_ID : "";
    const published = Number(item.CREATE_TIME);
    const title = cauPlainText(item.PIM_TITLE, 1000).slice(0, 300);
    if (!/^\d{1,32}$/.test(id) || !title || !Number.isFinite(published) || published < cutoff || published > now + 24 * 60 * 60 * 1000) continue;
    const unit = cauPlainText(item.BELONG_UNIT_NAME || item.CREATE_USER_UNIT_NAME, 1000).slice(0, 200);
    const summary = conciseSummary(cauPlainText(item.PIM_CONTENT));
    notices.set(id, {
      id, title, summary: summary || (unit ? `发布单位：${unit}` : ""), unit, published,
      url: `https://one.cau.edu.cn/tp_up/view?m=up#act=up/pim/showpim&id=${id}`,
    });
  }
  return [...notices.values()].sort((left, right) => right.published - left.published || right.id.localeCompare(left.id));
}

export function retainCauNotices(notices: CauNotice[], now = Date.now()) {
  const cutoff = now - CAU_RETENTION_MS;
  return notices.filter((notice) => notice.published >= cutoff && notice.published <= now + 24 * 60 * 60 * 1000);
}

export function renderCauRss(notices: CauNotice[], generatedAt = Date.now()) {
  const items = notices.map((notice) => `    <item>
      <title>${xml(notice.title)}</title>
      <link>${xml(notice.url)}</link>
      <guid isPermaLink="false">cau:${xml(notice.id)}</guid>
      <pubDate>${new Date(notice.published).toUTCString()}</pubDate>${notice.unit ? `
      <category>${xml(notice.unit)}</category>` : ""}
      <description>${xml(notice.summary)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>中国农业大学校内通知</title>
    <link>https://one.cau.edu.cn/tp_up/view?m=up</link>
    <description>最近五天的中国农业大学校内通知</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
