import "server-only";

import type { NewsFeedResource, NewsFeedResourceFetcher, NewsFeedResourceReader } from "./news-feed-discovery";
import { xmlFeed } from "./news-feed-discovery";

export const FEED_CACHE_TTL = 60_000;
export const FEED_CACHE_MAX_ENTRIES = 64;
export const FEED_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const FEED_CACHE_MAX_INFLIGHT = 16;
const MAX_URL_LENGTH = 4096;
type Snapshot = { body: Uint8Array; status: number; contentType: string; finalUrl: string; retryAt?: number };
type Entry = { value: Snapshot; expires: number };
type State = { entries: Map<string, Entry>; pending: Map<string, Promise<Snapshot>>; bytes: number };
// Next bundles management and capability routes separately. A versioned process-global
// store shares bytes, not Response streams, across those module instances.
const globals = globalThis as typeof globalThis & { __labulubiusFeedCacheV1?: State };
const state = globals.__labulubiusFeedCacheV1 ??= { entries: new Map(), pending: new Map(), bytes: 0 };

export function feedRetryDelay(value: string | null, now = Date.now()) {
  const raw = value?.trim() || "";
  let seconds = 30;
  if (/^\d+$/.test(raw)) seconds = Number(raw);
  else if (/^[A-Za-z]{3}, /.test(raw)) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) seconds = Math.ceil((date - now) / 1000);
  }
  return Math.max(1, Math.min(300, seconds));
}

function remove(key: string) {
  const old = state.entries.get(key);
  if (old) state.bytes -= old.value.body.byteLength;
  state.entries.delete(key);
}
function prune(now: number) {
  for (const [key, entry] of state.entries) if (entry.expires <= now) remove(key);
}
function remember(key: string, value: Snapshot, expires: number) {
  if (key.length > MAX_URL_LENGTH || value.body.byteLength > FEED_CACHE_MAX_BYTES) return;
  remove(key);
  while (state.entries.size >= FEED_CACHE_MAX_ENTRIES || state.bytes + value.body.byteLength > FEED_CACHE_MAX_BYTES) {
    remove(state.entries.keys().next().value!);
  }
  state.entries.set(key, { value, expires });
  // Aliases count toward both limits (conservatively count shared bytes twice).
  state.bytes += value.body.byteLength;
}
function resource(value: Snapshot): NewsFeedResource {
  const headers = new Headers({ "Content-Type": value.contentType, "Cache-Control": "private, no-store" });
  if (value.retryAt) headers.set("Retry-After", String(Math.max(1, Math.ceil((value.retryAt - Date.now()) / 1000))));
  return { finalUrl: value.finalUrl, response: new Response(
    [204, 205, 304].includes(value.status) ? null : new Uint8Array(value.body), { status: value.status, headers },
  ) };
}

export async function cachedNewsFeedResource(value: string, fetchResource: NewsFeedResourceFetcher, readResource: NewsFeedResourceReader): Promise<NewsFeedResource> {
  const key = new URL(value).href;
  if (key.length > MAX_URL_LENGTH) throw new Error("Feed URL is too long.");
  prune(Date.now());
  const hit = state.entries.get(key);
  if (hit) return resource(hit.value);
  const pending = state.pending.get(key);
  if (pending) return resource(await pending);
  // Do not start untracked requests when saturated.
  if (state.pending.size >= FEED_CACHE_MAX_INFLIGHT) return {
    finalUrl: key, response: new Response("Feed requests busy", { status: 503, headers: { "Retry-After": "1" } }),
  };
  const work = (async (): Promise<Snapshot> => {
    const { response, finalUrl } = await fetchResource(key);
    const status = response.status;
    const contentType = response.headers.get("content-type") || "application/xml; charset=utf-8";
    if (status === 429) {
      const retryAt = Date.now() + feedRetryDelay(response.headers.get("retry-after")) * 1000;
      await response.body?.cancel();
      const limited: Snapshot = { body: new Uint8Array(), status, contentType: "text/plain", finalUrl, retryAt };
      remember(key, limited, retryAt); remember(finalUrl, limited, retryAt);
      return limited;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { body: new Uint8Array(), status, contentType: "text/plain", finalUrl };
    }
    const body = await readResource(response);
    const snapshot = { body, status, contentType, finalUrl };
    if (xmlFeed(body)) {
      const expires = Date.now() + FEED_CACHE_TTL;
      remember(key, snapshot, expires); remember(finalUrl, snapshot, expires);
    }
    return snapshot;
  })();
  state.pending.set(key, work);
  try { return resource(await work); }
  finally { state.pending.delete(key); }
}
