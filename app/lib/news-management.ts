import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { newsCategories, newsFeeds } from "./news-server";
import { newsReaderBackend } from "./news-reader-backend";
import { discoverPinnedNewsFeedDetails, fetchPinnedNewsResource, newsFeedProxyUrl, readLimitedNewsResource } from "./news-feed-proxy";
import { NewsFeedDiscoveryError, withNewsFeedFallback, type NewsFeedDiscovery, type NewsFeedDiscoveryMethod } from "./news-feed-discovery";
import { createPreparedWebSource, deleteWebSource, DuplicateWebSource, prepareWebSource, UnsupportedWebSource, type PreparedWebSource } from "./news-web-sources";
import { parseNewsFeedPreview, reviewWebSourcePreview, UnreliableNewsSource, type NewsSourceReview } from "./news-source-preview";
import { retainRecentWebSourceItems } from "./news-web-source-feed";
import { NewsSourceProbeStore } from "./news-source-probe-cache";

const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, bits, "ipv4");
// Only globally routable IPv6 unicast; exclude documentation, transition and special-use ranges.
for (const [network, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]] as const) {
  blocked.addSubnet(network, bits, "ipv6");
}

export class InvalidNewsInput extends Error {}
const invalid = (message: string): never => { throw new InvalidNewsInput(message); };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid request.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return invalid(`Invalid ${field}.`);
  return value.trim();
}
function categoryName(value: unknown): string {
  const name = text(value, "category name", 191);
  if (Buffer.byteLength(name, "utf8") > 191 || name === "Uncategorized") return invalid("Invalid category name.");
  return name;
}
function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}
function publicIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !blocked.check(ip, "ipv6");
}
async function verifiedPublicDns(host: string): Promise<string[]> {
  // On this host system DNS returns 198.18/15 proxy addresses for external
  // websites. Resolve the original hostname with a public DoH resolver rather
  // than accepting the proxy address as proof that the target is public.
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", host);
    url.searchParams.set("type", type);
    const response = await fetch(url, { headers: { Accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Public DNS lookup failed.");
    const data = await response.json() as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (data.Status !== 0 && data.Status !== 3) throw new Error("Public DNS lookup failed.");
    return (data.Answer || []).filter((answer) => answer.type === (type === "A" ? 1 : 28) && typeof answer.data === "string").map((answer) => answer.data!);
  }));
  return answers.flat();
}

async function publicURL(value: unknown): Promise<string> {
  const raw = text(value, "URL", 2048);
  let url: URL;
  try { url = new URL(raw); } catch { return invalid("Invalid URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.hash) return invalid("Invalid URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isIP(host) && (!host.includes(".") || host.endsWith(".") ||
    /\.(?:local|localhost|internal|test|invalid|example|onion|home|lan)$/i.test(host) ||
    !/^[a-z0-9.-]+$/.test(host) || host.split(".").some((part) => !part || part.startsWith("-") || part.endsWith("-")))) return invalid("Invalid public host.");
  let addresses: string[];
  try { addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address); }
  catch { return invalid("Host could not be resolved."); }
  if (!addresses.length) return invalid("URL must resolve to a public address.");
  const proxyNetwork = new BlockList();
  proxyNetwork.addSubnet("198.18.0.0", 15, "ipv4");
  if (!isIP(host) && addresses.every((address) => isIP(address) === 4 && proxyNetwork.check(address, "ipv4"))) {
    try { addresses = await verifiedPublicDns(host); }
    catch { return invalid("Could not verify the feed's public address."); }
  }
  if (!addresses.length || addresses.some((address) => !publicIP(address))) return invalid("URL must resolve to a public address.");
  return url.href;
}

async function category(value: unknown, allowDefault = true) {
  const id = text(value, "category ID");
  const found = (await newsCategories()).find((item) => item.id === id);
  if (!found || (!allowDefault && found.name === "Uncategorized")) return invalid("Unknown category.");
  return found;
}
async function feed(value: unknown) {
  const id = text(value, "feed ID");
  const found = (await newsFeeds()).find((item) => item.id === id);
  if (!found) return invalid("Unknown feed.");
  return found;
}

export type NewsSourceProbe = NewsSourceReview & {
  token: string;
  kind: "feed" | "web";
  method: NewsFeedDiscoveryMethod;
  url: string;
};
export type NewsManagementResult = { discovery?: { url: string; method: NewsFeedDiscoveryMethod }; probe?: NewsSourceProbe };

type PreparedNewsSource =
  | { kind: "feed"; found: NewsFeedDiscovery; review: NewsSourceReview }
  | { kind: "web"; web: PreparedWebSource; review: NewsSourceReview };
type AddNewsSource =
  | { kind: "feed"; found: NewsFeedDiscovery }
  | { kind: "web"; web: Awaited<ReturnType<typeof createPreparedWebSource>> };
const probeGlobal = globalThis as typeof globalThis & { __labulubiusNewsSourceProbesV1?: NewsSourceProbeStore<PreparedNewsSource> };
const pendingProbes = probeGlobal.__labulubiusNewsSourceProbesV1 ??= new NewsSourceProbeStore<PreparedNewsSource>();

function consumeProbe(ownerId: string, inputUrl: string, token: string) {
  return pendingProbes.consume(ownerId, inputUrl, token) ?? invalid("Source check expired or does not match this URL. Check the source again.");
}
async function inspectSource(ownerId: string, inputUrl: string): Promise<NewsSourceProbe> {
  let source: PreparedNewsSource;
  try {
    const located = await withNewsFeedFallback<{ kind: "feed"; found: NewsFeedDiscovery } | { kind: "web"; web: PreparedWebSource }>(
      async () => ({ kind: "feed", found: await discoverPinnedNewsFeedDetails(inputUrl) }),
      async () => ({ kind: "web", web: await prepareWebSource(inputUrl) }),
    );
    if (located.kind === "feed") {
      const fetched = await fetchPinnedNewsResource(located.found.url);
      if (!fetched.response.ok) { await fetched.response.body?.cancel(); return invalid("The discovered feed could not be inspected."); }
      const body = await readLimitedNewsResource(fetched.response);
      source = { ...located, review: parseNewsFeedPreview(body, located.found.url) };
    } else {
      source = { ...located, review: reviewWebSourcePreview(retainRecentWebSourceItems(located.web.source)) };
    }
  } catch (error) {
    if (error instanceof NewsFeedDiscoveryError || error instanceof UnsupportedWebSource || error instanceof UnreliableNewsSource) return invalid(error.message);
    return invalid("This page could not be inspected for reliable articles.");
  }
  const resolved = source.kind === "feed" ? source.found.url : source.web.data.url;
  if ((await newsFeeds()).some((item) => { try { return new URL(item.url).href === new URL(resolved).href; } catch { return item.url === resolved; } })) return invalid("Source already exists.");
  const token = pendingProbes.stage(ownerId, inputUrl, source);
  return { token, kind: source.kind, method: source.kind === "feed" ? source.found.method : "web", url: resolved, ...source.review };
}

export async function manageNews(input: unknown, userId: string): Promise<NewsManagementResult | void> {
  const body = object(input);
  const action = text(body.action, "action", 40);
  switch (action) {
    case "probeFeed": {
      const url = await publicURL(body.url);
      return { probe: await inspectSource(userId, url) };
    }
    case "createCategory": {
      const name = categoryName(body.name);
      if ((await newsCategories()).some((item) => item.name.toLowerCase() === name.toLowerCase())) return invalid("Category already exists.");
      await newsReaderBackend().createCategory(name);
      return;
    }
    case "renameCategory": {
      const old = await category(body.categoryId ?? body.category ?? body.id, false);
      const name = categoryName(body.name);
      if ((await newsCategories()).some((item) => item.name.toLowerCase() === name.toLowerCase())) return invalid("Category already exists.");
      await newsReaderBackend().renameCategory(old, name);
      return;
    }
    case "deleteCategory": {
      const old = await category(body.categoryId ?? body.category ?? body.id, false);
      await newsReaderBackend().deleteCategory(old);
      return;
    }
    case "addFeed": {
      const url = await publicURL(body.url);
      // The default category allows the first subscription before any
      // user-created folders exist.
      const dest = body.categoryId === undefined && body.category === undefined ? undefined : await category(body.categoryId ?? body.category);
      const title = optionalText(body.title, "title");
      const probeToken = text(body.probeToken, "source check", 100);
      const prepared = consumeProbe(userId, url, probeToken);
      let located: AddNewsSource;
      try {
        located = prepared.kind === "feed" ? { kind: "feed", found: prepared.found }
          : { kind: "web", web: await createPreparedWebSource(userId, prepared.web) };
      } catch (error) {
        if (error instanceof DuplicateWebSource || error instanceof UnsupportedWebSource) return invalid(error.message);
        return invalid("This page could not be converted into an article feed.");
      }
      let source: string;
      let resolved: string;
      let discovery: NonNullable<NewsManagementResult["discovery"]>;
      let webSourceCreated = false;
      if (located.kind === "feed") {
        source = newsFeedProxyUrl(located.found.url);
        resolved = located.found.url;
        discovery = located.found;
      } else {
        source = located.web.feedUrl;
        resolved = located.web.record.url;
        discovery = { url: resolved, method: "web" };
        webSourceCreated = true;
      }
      if ((await newsFeeds()).some((item) => {
        try { return new URL(item.url).href === new URL(resolved).href; }
        catch { return item.url === resolved; }
      })) {
        if (webSourceCreated) await deleteWebSource(userId, resolved);
        return invalid("Source already exists.");
      }
      try {
        await newsReaderBackend().subscribe(source, dest, title);
      } catch {
        if (webSourceCreated) await deleteWebSource(userId, resolved);
        return invalid("No usable RSS feed found at this URL.");
      }
      return discovery ? { discovery } : undefined;
    }
    case "editFeed": {
      const source = await feed(body.feedId ?? body.id);
      const title = optionalText(body.title, "title");
      const dest = body.categoryId === undefined && body.category === undefined ? undefined : await category(body.categoryId ?? body.category);
      if (!title && !dest) return invalid("No changes provided.");
      await newsReaderBackend().editFeed(source, title, dest);
      return;
    }
    case "deleteFeed": {
      const source = await feed(body.feedId ?? body.id);
      await newsReaderBackend().unsubscribe(source);
      await deleteWebSource(userId, source.url);
      return;
    }
    default: return invalid("Invalid action.");
  }
}
