import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchPinnedNewsResource, readLimitedNewsResource } from "./news-feed-proxy";
import {
  createHtml2rssSource,
  Html2RssUnavailable,
  refreshHtml2rssSource,
} from "./news-html2rss";
import { canonicalHtml2rssSourceUrl } from "./news-html2rss-feed";
import {
  canonicalCsisTopicUrl,
  parseCsisTopicPage,
  renderWebSourceRss,
  retainRecentWebSourceItems,
  type ParsedWebSource,
  type WebSourceItem,
} from "./news-web-source-feed";
import { decodeWebSourceToken, webSourceFeedUrl, type WebSourceTokenData } from "./news-web-source-token";

const CACHE_TTL = 29 * 60 * 1000;
const directory = process.env.NEWS_DATA_DIR || path.join(os.homedir(), ".local", "share", "labulubius", "news");
const registryPath = path.join(directory, "web-sources.json");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const html2rssFeedPath = /^\/api\/v1\/feeds\/[A-Za-z0-9_.=-]+\.json$/;

type WebSourceRecord = {
  id: string;
  ownerId: string;
  adapter: "csis-topic-v1" | "html2rss-v1";
  url: string;
  title: string;
  createdAt: number;
  html2rssFeedPath?: string;
};

type WebSourceRegistry = { version: 1; sources: WebSourceRecord[] };
type WebSourceCache = { updatedAt: number; source: ParsedWebSource };

export type PreparedWebSource = { data: WebSourceTokenData; source: ParsedWebSource; feedPath?: string };

export type WebSourceProbe = {
  kind: "web";
  adapter: "csis-topic-v1" | "html2rss-v1";
  url: string;
  title: string;
  items: Pick<WebSourceItem, "title" | "url" | "published">[];
};

export class UnsupportedWebSource extends Error {}
export class DuplicateWebSource extends Error {}

function validUserId(value: string) {
  if (!uuid.test(value)) throw new Error("Invalid user ID.");
  return value;
}

function validItem(value: unknown): value is WebSourceItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WebSourceItem;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.url === "string" &&
    Number.isFinite(item.published) && (item.publishedReliable === undefined || typeof item.publishedReliable === "boolean") && typeof item.summary === "string";
}

function validParsedSource(value: unknown): value is ParsedWebSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as ParsedWebSource;
  return typeof source.title === "string" && typeof source.description === "string" &&
    Array.isArray(source.items) && source.items.every(validItem);
}

function validRecord(value: unknown): value is WebSourceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as WebSourceRecord;
  const validUrl = source.adapter === "csis-topic-v1"
    ? canonicalCsisTopicUrl(source.url) === source.url
    : source.adapter === "html2rss-v1" && canonicalHtml2rssSourceUrl(source.url) === source.url &&
      typeof source.html2rssFeedPath === "string" && html2rssFeedPath.test(source.html2rssFeedPath);
  return uuid.test(source.id) && uuid.test(source.ownerId) && validUrl &&
    typeof source.title === "string" && Number.isFinite(source.createdAt);
}

function cachePath(sourceId: string) {
  if (!uuid.test(sourceId)) throw new Error("Invalid web source ID.");
  return path.join(directory, `${sourceId}.web-source.json`);
}

async function atomicWrite(destination: string, value: unknown, prefix: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${prefix}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function loadRegistry(): Promise<WebSourceRegistry> {
  try {
    const parsed: unknown = JSON.parse(await readFile(registryPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as WebSourceRegistry).version !== 1 ||
      !Array.isArray((parsed as WebSourceRegistry).sources) || !(parsed as WebSourceRegistry).sources.every(validRecord)) {
      throw new Error("Invalid web source registry.");
    }
    return parsed as WebSourceRegistry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sources: [] };
    throw error;
  }
}

async function loadCache(sourceId: string): Promise<WebSourceCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(sourceId), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Number.isFinite((parsed as WebSourceCache).updatedAt) ||
      !validParsedSource((parsed as WebSourceCache).source)) throw new Error("Invalid web source cache.");
    return parsed as WebSourceCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { updatedAt: 0, source: { title: "", description: "", items: [] } };
    throw error;
  }
}

async function fetchCsisTopic(url: string) {
  const result = await fetchPinnedNewsResource(url);
  const type = result.response.headers.get("content-type") || "";
  if (!result.response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) {
    await result.response.body?.cancel();
    throw new Error("CSIS returned an invalid response.");
  }
  const body = await readLimitedNewsResource(result.response);
  return parseCsisTopicPage(new TextDecoder().decode(body), url);
}

function adapterFor(value: string): WebSourceTokenData | null {
  const csis = canonicalCsisTopicUrl(value);
  if (csis) return { adapter: "csis-topic-v1", url: csis };
  const generic = canonicalHtml2rssSourceUrl(value);
  return generic ? { adapter: "html2rss-v1", url: generic } : null;
}

async function initialSource(data: WebSourceTokenData, now = Date.now()): Promise<{ source: ParsedWebSource; feedPath?: string }> {
  if (data.adapter === "csis-topic-v1") return { source: await fetchCsisTopic(data.url) };
  try { return await createHtml2rssSource(data.url, now); }
  catch (error) {
    if (error instanceof Html2RssUnavailable) throw new UnsupportedWebSource("This page could not be converted into a reliable article feed.");
    throw error;
  }
}

async function refreshedSource(record: WebSourceRecord, previous: ParsedWebSource, now: number) {
  if (record.adapter === "csis-topic-v1") return fetchCsisTopic(record.url);
  if (!record.html2rssFeedPath) throw new UnsupportedWebSource("This webpage source is incomplete.");
  return refreshHtml2rssSource(record.html2rssFeedPath, record.url, previous, now);
}

function acceptableRefresh(previous: ParsedWebSource, next: ParsedWebSource) {
  if (previous.items.length >= 8 && next.items.length < Math.ceil(previous.items.length / 4)) {
    throw new Error("Web source refresh returned an abnormally small batch.");
  }
  return next;
}

export async function prepareWebSource(value: string): Promise<PreparedWebSource> {
  const data = adapterFor(value);
  if (!data) throw new UnsupportedWebSource("This page has no discoverable RSS feed and no supported article adapter.");
  const initial = await initialSource(data);
  return { data, source: initial.source, ...(initial.feedPath ? { feedPath: initial.feedPath } : {}) };
}

export async function probeWebSource(value: string): Promise<WebSourceProbe> {
  const prepared = await prepareWebSource(value);
  const source = retainRecentWebSourceItems(prepared.source);
  return { kind: "web", adapter: prepared.data.adapter, url: prepared.data.url, title: source.title,
    items: source.items.slice(0, 5).map(({ title, url, published }) => ({ title, url, published })) };
}

let registryPending: Promise<unknown> = Promise.resolve();

export async function createPreparedWebSource(ownerId: string, prepared: PreparedWebSource) {
  validUserId(ownerId);
  const { data, source: parsed } = prepared;
  const operation = registryPending.catch(() => {}).then(async () => {
    const registry = await loadRegistry();
    if (registry.sources.some((source) => source.url === data.url)) throw new DuplicateWebSource("Source already exists.");
    const record: WebSourceRecord = {
      id: randomUUID(), ownerId, adapter: data.adapter, url: data.url,
      title: parsed.title, createdAt: Date.now(),
      ...(prepared.feedPath ? { html2rssFeedPath: prepared.feedPath } : {}),
    };
    await atomicWrite(cachePath(record.id), { updatedAt: Date.now(), source: parsed } satisfies WebSourceCache, "web-cache");
    try {
      registry.sources.push(record);
      await atomicWrite(registryPath, registry, "web-sources");
    } catch (error) {
      await rm(cachePath(record.id), { force: true });
      throw error;
    }
    return { record, feedUrl: webSourceFeedUrl(data), parsed };
  });
  registryPending = operation;
  return operation;
}

export async function createWebSource(ownerId: string, value: string) {
  return createPreparedWebSource(ownerId, await prepareWebSource(value));
}

export async function deleteWebSource(ownerId: string, value: string) {
  validUserId(ownerId);
  const data = adapterFor(value);
  if (!data) return false;
  const operation = registryPending.catch(() => {}).then(async () => {
    const registry = await loadRegistry();
    const found = registry.sources.find((source) => source.ownerId === ownerId && source.adapter === data.adapter && source.url === data.url);
    if (!found) return false;
    registry.sources = registry.sources.filter((source) => source.id !== found.id);
    await atomicWrite(registryPath, registry, "web-sources");
    await rm(cachePath(found.id), { force: true });
    return true;
  });
  registryPending = operation;
  return operation;
}

const refreshPending = new Map<string, Promise<WebSourceCache>>();

async function currentCache(record: WebSourceRecord, now: number) {
  const cached = await loadCache(record.id);
  if (cached.updatedAt + CACHE_TTL > now && cached.source.items.length) return { cache: cached, stale: false };
  let pending = refreshPending.get(record.id);
  if (!pending) {
    pending = refreshedSource(record, cached.source, now).then((source) => acceptableRefresh(cached.source, source)).then(async (source) => {
      const fresh = { updatedAt: now, source } satisfies WebSourceCache;
      await atomicWrite(cachePath(record.id), fresh, "web-cache");
      return fresh;
    }).finally(() => { refreshPending.delete(record.id); });
    refreshPending.set(record.id, pending);
  }
  try { return { cache: await pending, stale: false }; }
  catch (error) {
    console.error("Web source refresh failed (details withheld).", error instanceof Error ? error.message : "Unknown error");
    if (!cached.updatedAt || !cached.source.items.length) throw error;
    return { cache: cached, stale: true };
  }
}

export async function webSourceFeed(token: string) {
  const data = decodeWebSourceToken(token);
  if (!data) return null;
  const registry = await loadRegistry();
  const record = registry.sources.find((source) => source.adapter === data.adapter && source.url === data.url);
  if (!record) return null;
  const now = Date.now();
  const { cache, stale } = await currentCache(record, now);
  const recent = retainRecentWebSourceItems(cache.source, now);
  return {
    body: renderWebSourceRss(record.url, recent, cache.updatedAt || now, now),
    stale,
    count: recent.items.length,
  };
}
