import "server-only";

import { conciseSummary } from "./concise-summary";
import { fetchPinnedNewsResource } from "./news-feed-proxy";

const MAX_BYTES = 256 * 1024;
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 15 * 60 * 1000;
const cache = new Map<string, { expires: number; value: string }>();
const pending = new Map<string, Promise<string>>();

export function isFeedMetadata(value: string) {
  return /^Article URL:\s*https?:\/\/.*\sComments URL:\s*https?:\/\/.*\sPoints:\s*\d+/i.test(value);
}

function decodeEntities(value: string) {
  return value.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi, (entity) => {
    const key = entity.toLowerCase();
    const named: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
    if (named[key]) return named[key];
    const radix = key.startsWith("&#x") ? 16 : 10;
    const codePoint = Number.parseInt(key.slice(radix === 16 ? 3 : 2, -1), radix);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity; } catch { return entity; }
  });
}

function cleanText(value: string) {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 360);
}

async function readText(response: Response) {
  if (!response.body || Number(response.headers.get("content-length") || 0) > MAX_BYTES) {
    await response.body?.cancel();
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) { await reader.cancel(); return ""; }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

function metaDescription(html: string) {
  const descriptions = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    const name = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
    const content = attributes.get("content");
    if (content && ["og:description", "description", "twitter:description"].includes(name)) descriptions.set(name, content);
  }
  for (const name of ["og:description", "description", "twitter:description"]) {
    const value = cleanText(descriptions.get(name) || "");
    if (value && !isFeedMetadata(value)) return value;
  }
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const value = cleanText(match[1]);
    if (value.length >= 80 && !isFeedMetadata(value)) return value;
  }
  return "";
}

function socialStatus(url: URL) {
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return null;
  return url.pathname.match(/\/status\/(\d{1,20})(?:\/|$)/)?.[1] || null;
}

async function fetchSummary(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  const status = socialStatus(url);
  if (status) {
    const result = await fetchPinnedNewsResource(`https://api.fxtwitter.com/status/${status}`);
    if (!result.response.ok) { await result.response.body?.cancel(); return ""; }
    const body = await readText(result.response);
    try { return cleanText((JSON.parse(body) as { tweet?: { text?: string } }).tweet?.text || ""); } catch { return ""; }
  }
  const result = await fetchPinnedNewsResource(url.href);
  if (!result.response.ok || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(result.response.headers.get("content-type") || "")) {
    await result.response.body?.cancel();
    return "";
  }
  return metaDescription(await readText(result.response));
}

export async function articleSummary(url: string, summary: string) {
  if (!isFeedMetadata(summary)) return conciseSummary(summary);
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const existing = pending.get(url);
  if (existing) return existing;
  const request = fetchSummary(url).catch(() => "").then((value) => {
    value = conciseSummary(value);
    cache.set(url, { value, expires: Date.now() + (value ? SUCCESS_TTL : FAILURE_TTL) });
    pending.delete(url);
    return value;
  });
  pending.set(url, request);
  return request;
}
