import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { bbcNewsFeed, discourseLatestFeed, type NewsFeedDiscoveryMethod } from "./news-feed-discovery";

const MAX_REDIRECTS = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, bits, "ipv4");
for (const [network, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]] as const) blocked.addSubnet(network, bits, "ipv6");

function secret() {
  const value = process.env.NEWS_FEED_PROXY_SECRET;
  if (!value || value.length < 32) throw new Error("News feed proxy secret is unavailable.");
  return value;
}
function signature(encoded: string) { return createHmac("sha256", secret()).update(encoded).digest("base64url"); }

export function newsFeedProxyUrl(url: string) {
  const encoded = Buffer.from(url).toString("base64url");
  const origin = process.env.NEWS_FEED_PROXY_ORIGIN || "https://drive.labulubius.com";
  return `${origin.replace(/\/$/, "")}/api/news/feed/${encoded}.${signature(encoded)}`;
}

export function originalNewsFeedUrl(value: string) {
  let path: string;
  try { path = new URL(value).pathname; } catch { return value; }
  const token = path.match(/^\/api\/news\/feed\/([^/]+)$/)?.[1];
  if (!token) return value;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return value;
  const encoded = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(signature(encoded));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return value;
  try { return Buffer.from(encoded, "base64url").toString("utf8"); } catch { return value; }
}

function publicIp(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, "ipv6");
}

async function publicDns(hostname: string) {
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname); url.searchParams.set("type", type);
    const response = await fetch(url, { headers: { Accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Public DNS lookup failed.");
    const data = await response.json() as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (data.Status !== 0 && data.Status !== 3) throw new Error("Public DNS lookup failed.");
    return (data.Answer || []).filter((answer) => answer.type === (type === "A" ? 1 : 28) && typeof answer.data === "string").map((answer) => answer.data!);
  }));
  return answers.flat();
}

async function target(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash ||
    (url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) throw new Error("Invalid feed URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  const fake = new BlockList(); fake.addSubnet("198.18.0.0", 15, "ipv4");
  if (!isIP(host) && addresses.length && addresses.every((address) => isIP(address) === 4 && fake.check(address, "ipv4"))) addresses = await publicDns(host);
  if (!addresses.length || addresses.some((address) => !publicIp(address))) throw new Error("Feed URL is not public.");
  return { url, address: addresses[0] };
}

function pinnedRequest(url: URL, address: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(url, {
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8", "User-Agent": "Labulubius-News-Feed-Proxy/1.0" },
      timeout: 15000,
      lookup: (_hostname, options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (typeof options !== "number" && options.all) callback(null, [{ address, family }]); else callback(null, address, family);
      },
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status: incoming.statusCode || 500, headers }));
    });
    request.on("timeout", () => request.destroy(new Error("Feed request timed out."))); request.on("error", reject);
  });
}

async function readLimited(response: Response) {
  if (Number(response.headers.get("content-length") || 0) > MAX_BYTES || !response.body) { await response.body?.cancel(); throw new Error("Feed response is too large."); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength; if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Feed response is too large."); }
    chunks.push(value);
  }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function fetchPinnedNewsResource(value: string) {
  let current = value;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const { url, address } = await target(current);
    const response = await pinnedRequest(url, address);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new Error("Feed redirect has no location."); current = new URL(location, url).href; continue;
    }
    return { response, finalUrl: url.href };
  }
  throw new Error("Too many redirects.");
}

function xmlFeed(body: Uint8Array) {
  const prefix = new TextDecoder().decode(body.slice(0, 4096));
  return /^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(prefix);
}

export type NewsFeedDiscovery = { url: string; method: Exclude<NewsFeedDiscoveryMethod, "rsshub"> };

export async function discoverPinnedNewsFeedDetails(value: string): Promise<NewsFeedDiscovery> {
  const first = await fetchPinnedNewsResource(value);
  if (!first.response.ok) { await first.response.body?.cancel(); throw new Error("Website unavailable."); }
  const body = await readLimited(first.response);
  if (xmlFeed(body)) return { url: first.finalUrl, method: "direct" };
  const html = new TextDecoder().decode(body);
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&");
    if (!href || !/(?:^|\s)alternate(?:\s|$)/i.test(rel) || !/(?:rss|atom|xml)/i.test(type)) continue;
    const candidate = new URL(href, first.finalUrl).href;
    const checked = await fetchPinnedNewsResource(candidate);
    if (!checked.response.ok) { await checked.response.body?.cancel(); continue; }
    const feed = await readLimited(checked.response);
    if (xmlFeed(feed)) return { url: checked.finalUrl, method: "html" };
  }
  const bbc = bbcNewsFeed(first.finalUrl);
  if (bbc) {
    const checked = await fetchPinnedNewsResource(bbc);
    if (checked.response.ok) {
      const feed = await readLimited(checked.response);
      if (xmlFeed(feed)) return { url: checked.finalUrl, method: "bbc" };
    } else await checked.response.body?.cancel();
  }
  const discourse = discourseLatestFeed(html, first.finalUrl);
  if (discourse) {
    const checked = await fetchPinnedNewsResource(discourse);
    if (checked.response.ok) {
      const feed = await readLimited(checked.response);
      if (xmlFeed(feed)) return { url: checked.finalUrl, method: "discourse" };
    } else await checked.response.body?.cancel();
  }
  throw new Error("No RSS or Atom feed was discovered.");
}

export async function discoverPinnedNewsFeed(value: string) {
  return (await discoverPinnedNewsFeedDetails(value)).url;
}

export async function proxyNewsFeed(token: string) {
  const separator = token.lastIndexOf(".");
  if (separator < 1 || token.length > 3500) return new Response("Not found", { status: 404 });
  const encoded = token.slice(0, separator); const supplied = Buffer.from(token.slice(separator + 1)); const expected = Buffer.from(signature(encoded));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response("Not found", { status: 404 });
  let current: string;
  try { current = Buffer.from(encoded, "base64url").toString("utf8"); new URL(current); } catch { return new Response("Not found", { status: 404 }); }
  const result = await fetchPinnedNewsResource(current);
  if (!result.response.ok) { await result.response.body?.cancel(); return new Response("Feed unavailable", { status: 502 }); }
  const body = await readLimited(result.response);
  if (!xmlFeed(body)) return new Response("Invalid feed", { status: 502 });
  return new Response(body, { headers: { "Content-Type": result.response.headers.get("content-type") || "application/xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
