import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cauLoginCipher, cauLoginSucceeded, parseCauLoginForm } from "./cau-login-encryption";
import { type CauNotice, normalizeCauNotices, parseCauNoticePage, renderCauRss, retainCauNotices } from "./cau-news-feed";

const LOGIN_URL = "https://onecas.cau.edu.cn/tpass/login?service=https%3A%2F%2Fone.cau.edu.cn%2Ftp_up%2F";
const APP_ROOT = "https://one.cau.edu.cn/tp_up/";
const CACHE_TTL = 29 * 60 * 1000;
const USER_AGENT = "Labulubius-CAU-News/1.0";
const dataDirectory = process.env.NEWS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "news");
const cachePath = path.join(dataDirectory, "cau-feed.json");

type StoredCookie = { name: string; value: string; domain: string; path: string; secure: boolean; expires?: number };
type CauCache = { updatedAt: number; notices: CauNotice[] };

class CookieJar {
  private cookies = new Map<string, StoredCookie>();

  absorb(response: Response) {
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const combined = response.headers.get("set-cookie");
    const values = getSetCookie?.call(response.headers) || (combined ? [combined] : []);
    const source = allowedUrl(response.url);
    for (const value of values) {
      const parts = value.split(";").map((part) => part.trim());
      const separator = parts[0].indexOf("=");
      if (separator < 1) continue;
      const cookie: StoredCookie = {
        name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1), domain: source.hostname,
        path: source.pathname.slice(0, source.pathname.lastIndexOf("/") + 1) || "/", secure: false,
      };
      for (const attribute of parts.slice(1)) {
        const [rawName, ...rest] = attribute.split("=");
        const name = rawName.toLowerCase();
        const attributeValue = rest.join("=");
        if (name === "domain" && attributeValue) cookie.domain = attributeValue.replace(/^\./, "").toLowerCase();
        else if (name === "path" && attributeValue.startsWith("/")) cookie.path = attributeValue;
        else if (name === "secure") cookie.secure = true;
        else if (name === "max-age") cookie.expires = Date.now() + Number(attributeValue) * 1000;
        else if (name === "expires") cookie.expires = Date.parse(attributeValue);
      }
      const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
      if ((cookie.expires ?? Infinity) <= Date.now()) this.cookies.delete(key); else this.cookies.set(key, cookie);
    }
  }

  header(url: URL) {
    const now = Date.now();
    const selected: string[] = [];
    for (const [key, cookie] of this.cookies) {
      if ((cookie.expires ?? Infinity) <= now) { this.cookies.delete(key); continue; }
      const domainMatches = url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`);
      if (domainMatches && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === "https:")) selected.push(`${cookie.name}=${cookie.value}`);
    }
    return selected.join("; ");
  }
}

function allowedUrl(value: string, base?: URL | string) {
  let url: URL;
  try { url = base ? new URL(value, base) : new URL(value); }
  catch { throw new Error("CAU returned an invalid URL."); }
  if (url.protocol !== "https:" || !["one.cau.edu.cn", "onecas.cau.edu.cn"].includes(url.hostname) || url.username || url.password) {
    throw new Error("CAU returned an unsafe URL.");
  }
  return url;
}

async function fetchRetry(url: URL, init: RequestInit) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.status < 500 || attempt === 3) return response;
      await response.body?.cancel();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("CAU request failed.");
}

async function request(jar: CookieJar, value: string, init: RequestInit = {}) {
  let url = allowedUrl(value);
  let method = init.method || "GET";
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let redirect = 0; redirect <= 8; redirect++) {
    headers.set("Accept-Language", "zh-CN,zh;q=0.9");
    headers.set("User-Agent", USER_AGENT);
    const cookies = jar.header(url);
    if (cookies) headers.set("Cookie", cookies); else headers.delete("Cookie");
    const response = await fetchRetry(url, { ...init, method, body, headers });
    jar.absorb(response);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("CAU redirect has no destination.");
    url = allowedUrl(location, url);
    if (response.status === 303 || ([301, 302].includes(response.status) && method.toUpperCase() === "POST")) {
      method = "GET"; body = undefined; headers.delete("Content-Type"); headers.delete("Content-Length");
    }
  }
  throw new Error("Too many CAU redirects.");
}

function credential(name: string) {
  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (!directory) throw new Error("CAU credentials are unavailable.");
  return readFile(path.join(directory, name), "utf8").then((value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 512 || /[\r\n]/.test(trimmed)) throw new Error("Invalid CAU credential.");
    return trimmed;
  });
}

async function login() {
  const jar = new CookieJar();
  const response = await request(jar, LOGIN_URL);
  const loginPage = await response.text();
  const { action, lt } = parseCauLoginForm(loginPage);
  const [username, password] = await Promise.all([credential("cau-username"), credential("cau-password")]);
  const body = new URLSearchParams({
    rsa: cauLoginCipher(username + password + lt), ul: String(username.length), pl: String(password.length), sl: "0",
    lt, execution: "e1s1", _eventId: "submit",
  });
  const result = await request(jar, allowedUrl(action, response.url).href, {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://onecas.cau.edu.cn", Referer: response.url },
  });
  const page = await result.text();
  if (!cauLoginSucceeded(result.url, page)) throw new Error("CAU login was rejected.");
  return jar;
}

let session: CookieJar | undefined;
let loginPending: Promise<CookieJar> | undefined;

function activeSession() {
  if (session) return Promise.resolve(session);
  if (!loginPending) loginPending = login().then((jar) => (session = jar)).finally(() => { loginPending = undefined; });
  return loginPending;
}

async function postJson(pathname: string, payload: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const jar = await activeSession();
    const response = await request(jar, allowedUrl(pathname, APP_ROOT).href, {
      method: "POST", body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest", Referer: `${APP_ROOT}view?m=up` },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && /application\/json/i.test(contentType)) return response.json() as Promise<unknown>;
    await response.body?.cancel();
    session = undefined;
  }
  throw new Error("CAU session could not be renewed.");
}

async function fetchNotices(now: number) {
  const records: unknown[] = [];
  const cutoff = now - 5 * 24 * 60 * 60 * 1000;
  for (let pageNum = 1; pageNum <= 20; pageNum++) {
    const data = parseCauNoticePage(await postJson("up/pim/allpim/getAllPimList", { two: "yes", pageNum, pageSize: 500 }));
    records.push(...data.list);
    const times = data.list.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [Number((item as Record<string, unknown>).CREATE_TIME)] : []);
    if (!data.hasNextPage || (times.length > 0 && times.every((time) => Number.isFinite(time) && time < cutoff))) break;
  }
  return normalizeCauNotices(records, now);
}

function validCache(value: unknown): value is CauCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cache = value as CauCache;
  return Number.isFinite(cache.updatedAt) && Array.isArray(cache.notices) && cache.notices.every((notice) =>
    notice && typeof notice.id === "string" && typeof notice.title === "string" && typeof notice.summary === "string" &&
    typeof notice.unit === "string" && Number.isFinite(notice.published) && typeof notice.url === "string");
}

async function loadCache(): Promise<CauCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (!validCache(parsed)) throw new Error("Invalid CAU cache.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { updatedAt: 0, notices: [] };
    throw error;
  }
}

async function saveCache(cache: CauCache) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(dataDirectory, `.cau-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(cache), { mode: 0o600, flag: "wx" });
    await rename(temporary, cachePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

let cachePending: Promise<CauCache> | undefined;
let memoryCache: CauCache | undefined;

async function currentCache(now: number) {
  if (!memoryCache) memoryCache = await loadCache();
  const retained = retainCauNotices(memoryCache.notices, now);
  if (retained.length !== memoryCache.notices.length) {
    memoryCache = { ...memoryCache, notices: retained };
    await saveCache(memoryCache);
  }
  if (memoryCache.updatedAt + CACHE_TTL > now) return { cache: memoryCache, stale: false };
  if (!cachePending) cachePending = fetchNotices(now).then(async (notices) => {
    const fresh = { updatedAt: now, notices };
    await saveCache(fresh); memoryCache = fresh; return fresh;
  }).finally(() => { cachePending = undefined; });
  try { return { cache: await cachePending, stale: false }; }
  catch (error) {
    console.error("CAU notice refresh failed (details withheld).", error instanceof Error ? error.message : "Unknown error");
    if (!memoryCache.notices.length) throw error;
    return { cache: memoryCache, stale: true };
  }
}

function proxySecret() {
  const secret = process.env.NEWS_FEED_PROXY_SECRET;
  if (!secret || secret.length < 32) throw new Error("News feed secret is unavailable.");
  return secret;
}

export function cauFeedToken() {
  return createHmac("sha256", proxySecret()).update("cau-news-feed-v2").digest("base64url");
}

export function validCauFeedToken(token: string) {
  const supplied = Buffer.from(token);
  const expected = Buffer.from(cauFeedToken());
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function cauNewsFeed() {
  const now = Date.now();
  const { cache, stale } = await currentCache(now);
  return { body: renderCauRss(cache.notices, cache.updatedAt || now), stale, count: cache.notices.length };
}
