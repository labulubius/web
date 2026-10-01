import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CIEE_RETENTION_MS,
  type CieeListing,
  type CieeNotice,
  normalizeCieeNotices,
  parseCieeArticle,
  parseCieeListings,
  renderCieeRss,
  retainCieeNotices,
} from "./ciee-news-feed.ts";

const ORIGIN = "https://ciee.cau.edu.cn";
const LIST_URL = `${ORIGIN}/col/col50450/index.html`;
const CACHE_TTL = 29 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "Labulubius-CIEE-News/1.0";
const dataDirectory = process.env.NEWS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "news");
const cachePath = path.join(dataDirectory, "ciee-feed.json");

type CieeCache = { updatedAt: number; notices: CieeNotice[] };

function allowedUrl(value: string, base?: URL | string) {
  let url: URL;
  try { url = base ? new URL(value, base) : new URL(value); }
  catch { throw new Error("CIEE returned an invalid URL."); }
  const allowedPath = url.pathname === "/col/col50450/index.html" ||
    url.pathname === "/module/web/jpage/dataproxy.jsp" ||
    /^\/art\/\d{4}\/\d{1,2}\/\d{1,2}\/art_50450_\d{1,16}\.html$/.test(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "ciee.cau.edu.cn" || url.username || url.password || url.hash || !allowedPath) {
    throw new Error("CIEE returned an unsafe URL.");
  }
  return url;
}

async function fetchRetry(url: URL) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        headers: { "Accept-Language": "zh-CN,zh;q=0.9", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status < 500 || attempt === 3) return response;
      await response.body?.cancel();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("CIEE request failed.");
}

async function request(value: string) {
  let url = allowedUrl(value);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const response = await fetchRetry(url);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("CIEE redirect has no destination.");
    url = allowedUrl(location, url);
  }
  throw new Error("Too many CIEE redirects.");
}

async function responseText(url: string) {
  const response = await request(url);
  if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) {
    await response.body?.cancel();
    throw new Error("CIEE returned an invalid response.");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("CIEE response is too large.");
  }
  if (!response.body) throw new Error("CIEE returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("CIEE response is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function paginationUrl(group: number) {
  const url = new URL("/module/web/jpage/dataproxy.jsp", ORIGIN);
  for (const [key, value] of Object.entries({
    page: String(group), appid: "1", webid: "107", path: "/", columnid: "50450", unitid: "86254",
    webname: "信息与电气工程学院", permissiontype: "0",
  })) url.searchParams.set(key, value);
  return url.href;
}

function mergeListings(target: Map<string, CieeListing>, listings: CieeListing[]) {
  for (const listing of listings) target.set(listing.id, listing);
}

async function fetchListings(now: number) {
  const listings = new Map<string, CieeListing>();
  mergeListings(listings, parseCieeListings(await responseText(LIST_URL)));
  if (!listings.size) throw new Error("CIEE listing structure changed.");

  const oldestAllowedListing = now - CIEE_RETENTION_MS - 24 * 60 * 60 * 1000;
  let ordered = [...listings.values()].sort((left, right) => right.published - left.published);
  for (let group = 1; group <= 5 && ordered.every((item) => item.published >= oldestAllowedListing); group++) {
    const page = parseCieeListings(await responseText(paginationUrl(group)));
    if (!page.length) throw new Error("CIEE pagination structure changed.");
    const previousSize = listings.size;
    mergeListings(listings, page);
    ordered = [...listings.values()].sort((left, right) => right.published - left.published);
    if (listings.size === previousSize) break;
  }
  return ordered.filter((item) => item.published >= oldestAllowedListing);
}

async function fetchNotices(now: number) {
  const listings = await fetchListings(now);
  const notices: CieeNotice[] = [];
  for (let offset = 0; offset < listings.length; offset += 4) {
    notices.push(...await Promise.all(listings.slice(offset, offset + 4).map(async (listing) =>
      parseCieeArticle(await responseText(listing.url), listing))));
  }
  return normalizeCieeNotices(notices, now);
}

function validNotice(value: unknown): value is CieeNotice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const notice = value as CieeNotice;
  let url: URL;
  try { url = new URL(notice.url); }
  catch { return false; }
  const pathMatch = /^\/art\/\d{4}\/\d{1,2}\/\d{1,2}\/art_50450_(\d{1,16})\.html$/.exec(url.pathname);
  return /^\d{1,16}$/.test(notice.id) && typeof notice.title === "string" && typeof notice.summary === "string" &&
    Number.isFinite(notice.published) && url.origin === ORIGIN && pathMatch?.[1] === notice.id && !url.search && !url.hash;
}

function validCache(value: unknown): value is CieeCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cache = value as CieeCache;
  return Number.isFinite(cache.updatedAt) && Array.isArray(cache.notices) && cache.notices.every(validNotice);
}

async function loadCache(): Promise<CieeCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (!validCache(parsed)) throw new Error("Invalid CIEE cache.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { updatedAt: 0, notices: [] };
    throw error;
  }
}

async function saveCache(cache: CieeCache) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(dataDirectory, `.ciee-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(cache), { mode: 0o600, flag: "wx" });
    await rename(temporary, cachePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

let cachePending: Promise<CieeCache> | undefined;
let memoryCache: CieeCache | undefined;

async function currentCache(now: number) {
  if (!memoryCache) memoryCache = await loadCache();
  const retained = retainCieeNotices(memoryCache.notices, now);
  if (retained.length !== memoryCache.notices.length) {
    memoryCache = { ...memoryCache, notices: retained };
    await saveCache(memoryCache);
  }
  if (memoryCache.updatedAt + CACHE_TTL > now) return { cache: memoryCache, stale: false };
  if (!cachePending) cachePending = fetchNotices(now).then(async (notices) => {
    const fresh = { updatedAt: now, notices };
    await saveCache(fresh);
    memoryCache = fresh;
    return fresh;
  }).finally(() => { cachePending = undefined; });
  try { return { cache: await cachePending, stale: false }; }
  catch (error) {
    console.error("CIEE notice refresh failed (details withheld).", error instanceof Error ? error.message : "Unknown error");
    if (!memoryCache.updatedAt) throw error;
    return { cache: memoryCache, stale: true };
  }
}

function proxySecret() {
  const secret = process.env.NEWS_FEED_PROXY_SECRET;
  if (!secret || secret.length < 32) throw new Error("News feed secret is unavailable.");
  return secret;
}

export function cieeFeedToken() {
  return createHmac("sha256", proxySecret()).update("ciee-news-feed-v1").digest("base64url");
}

export function validCieeFeedToken(token: string) {
  const supplied = Buffer.from(token);
  const expected = Buffer.from(cieeFeedToken());
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function cieeNewsFeed() {
  const now = Date.now();
  const { cache, stale } = await currentCache(now);
  return { body: renderCieeRss(cache.notices, cache.updatedAt || now), stale, count: cache.notices.length };
}
