import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import ts from "typescript";

const require = createRequire(import.meta.url);
const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Test</title></feed>';
// Real modules, independent bundle caches, one server global. Mock only external boundaries.
function bundle(shared, overrides = {}) {
  const modules = new Map();
  function load(name, base = process.cwd()) {
    if (name === "server-only") return {};
    if (name in overrides) return overrides[name];
    if (!name.startsWith(".")) return require(name);
    const path = resolve(base, name.endsWith(".ts") ? name : `${name}.ts`);
    if (modules.has(path)) return modules.get(path).exports;
    const loaded = { exports: {} }; modules.set(path, loaded);
    const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", "globalThis", output)((next) => load(next, dirname(path)), loaded, loaded.exports, shared);
    return loaded.exports;
  }
  return (name) => load(`./app/lib/${name}`);
}
const reader = async (response) => new Uint8Array(await response.arrayBuffer());
const good = async (url) => ({ response: new Response(xml), finalUrl: url });
function network(handler) {
  return { get(url, options, callback) {
    const request = new EventEmitter();
    request.destroy = (error) => request.emit("error", error);
    queueMicrotask(() => {
      assert.equal(typeof options.lookup, "function");
      const result = handler(url);
      const stream = Readable.from([Buffer.from(result.body ?? xml)]);
      stream.statusCode = result.status || 200;
      stream.rawHeaders = Object.entries(result.headers || { "Content-Type": "application/atom+xml" }).flat();
      callback(stream);
    });
    return request;
  } };
}
test("real probe/add/signed proxy reuse across route bundles and redirect aliases", async () => {
  const shared = {}; let requests = 0; let proxy;
  const transport = network((url) => {
    requests++;
    return url.pathname === "/start" ? { status: 302, headers: { Location: "/feed" }, body: "" } : {};
  });
  const overrides = {
    "node:dns/promises": { lookup: async () => [{ address: "93.184.216.34" }] },
    "node:https": transport,
    "./news-server": { newsCategories: async () => [], newsFeeds: async () => [] },
    "./news-reader-backend": { newsReaderBackend: () => ({ subscribe: async (url) => {
      const response = await proxy.proxyNewsFeed(new URL(url).pathname.split("/").at(-1));
      assert.equal(response.status, 200); assert.equal(await response.text(), xml);
    } }) },
    "./news-web-sources": { probeWebSource: () => { throw new Error("Unexpected fallback"); } },
  };
  const old = process.env.NEWS_FEED_PROXY_SECRET;
  process.env.NEWS_FEED_PROXY_SECRET = "test-only-not-a-production-secret-123456";
  try {
    const management = bundle(shared, overrides)("news-management");
    proxy = bundle(shared, overrides)("news-feed-proxy");
    const input = { url: "https://example.org/start" };
    assert.equal((await management.manageNews({ ...input, action: "probeFeed" }, "test")).probe.kind, "feed");
    await management.manageNews({ ...input, action: "addFeed" }, "test");
    assert.equal(requests, 2, "only initial request plus validated redirect");
    assert.equal((await proxy.proxyNewsFeed("invalid.signature")).status, 404);
    assert.equal(requests, 2);
  } finally {
    if (old === undefined) delete process.env.NEWS_FEED_PROXY_SECRET; else process.env.NEWS_FEED_PROXY_SECRET = old;
  }
});
test("concurrent requests merge and each consumer owns its Response", async () => {
  const shared = {}; const a = bundle(shared)("news-feed-cache"); const b = bundle(shared)("news-feed-cache");
  let count = 0; let release;
  const fetcher = async (url) => { count++; await new Promise((done) => { release = done; }); return good(url); };
  const first = a.cachedNewsFeedResource("https://example.org/feed", fetcher, reader);
  const second = b.cachedNewsFeedResource("https://example.org/feed", fetcher, reader);
  release();
  const [x, y] = await Promise.all([first, second]);
  assert.equal(count, 1); assert.notEqual(x.response, y.response);
  assert.deepEqual(await Promise.all([x.response.text(), y.response.text()]), [xml, xml]);
});
test("expiry, count/byte bounds, bounded in-flight work and cleanup", async () => {
  const shared = {}; const cache = bundle(shared)("news-feed-cache");
  const state = shared.__labulubiusFeedCacheV1;
  let count = 0;
  const fetcher = async (url) => { count++; return good(url); };
  await cache.cachedNewsFeedResource("https://example.org/expiry", fetcher, reader);
  for (const entry of state.entries.values()) entry.expires = 0;
  await cache.cachedNewsFeedResource("https://example.org/expiry", fetcher, reader);
  assert.equal(count, 2);
  for (let i = 0; i < 80; i++) await cache.cachedNewsFeedResource(`https://example.org/${i}`, good, reader);
  assert.equal(state.entries.size, cache.FEED_CACHE_MAX_ENTRIES);
  assert.ok(!state.entries.has("https://example.org/0"));
  const large = "<rss>" + " ".repeat(4 * 1024 * 1024) + "</rss>";
  for (let i = 0; i < 8; i++) await cache.cachedNewsFeedResource(`https://example.org/large/${i}`, async (url) => ({ response: new Response(large), finalUrl: url }), reader);
  assert.ok(state.bytes <= cache.FEED_CACHE_MAX_BYTES);
  const releases = [];
  const pending = Array.from({ length: cache.FEED_CACHE_MAX_INFLIGHT }, (_, i) => cache.cachedNewsFeedResource(`https://example.org/pending/${i}`, async (url) => {
    await new Promise((done) => releases.push(done)); return good(url);
  }, reader));
  let extra = false;
  const busy = await cache.cachedNewsFeedResource("https://example.org/overflow", async (url) => { extra = true; return good(url); }, reader);
  assert.equal(busy.response.status, 503); assert.equal(extra, false);
  assert.equal(state.pending.size, cache.FEED_CACHE_MAX_INFLIGHT);
  releases.forEach((done) => done()); await Promise.all(pending);
  assert.equal(state.pending.size, 0);
});
test("429 cooldown is shared with proxy, conveys Retry-After and recovers", async () => {
  const shared = {}; let count = 0; let limited = true;
  const transport = network(() => { count++; return limited ? { status: 429, headers: { "Retry-After": "42" }, body: "private upstream error" } : {}; });
  const overrides = { "node:https": transport, "node:dns/promises": { lookup: async () => [{ address: "93.184.216.34" }] } };
  const discovery = bundle(shared, overrides)("news-feed-proxy");
  const proxy = bundle(shared, overrides)("news-feed-proxy");
  const old = process.env.NEWS_FEED_PROXY_SECRET;
  process.env.NEWS_FEED_PROXY_SECRET = "test-only-not-a-production-secret-123456";
  try {
    const url = "https://example.org/limited";
    await assert.rejects(discovery.discoverPinnedNewsFeedDetails(url), /rate limiting/);
    const token = new URL(proxy.newsFeedProxyUrl(url)).pathname.split("/").at(-1);
    const response = await proxy.proxyNewsFeed(token);
    assert.equal(response.status, 429); assert.equal(response.headers.get("Retry-After"), "42");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(count, 1); assert.doesNotMatch(await response.text(), /private upstream/);
    for (const entry of shared.__labulubiusFeedCacheV1.entries.values()) entry.expires = 0;
    limited = false;
    assert.equal((await proxy.proxyNewsFeed(token)).status, 200); assert.equal(count, 2);
  } finally {
    if (old === undefined) delete process.env.NEWS_FEED_PROXY_SECRET; else process.env.NEWS_FEED_PROXY_SECRET = old;
  }
  const { feedRetryDelay } = bundle({})("news-feed-cache");
  const now = Date.parse("Wed, 07 Oct 2026 00:00:00 GMT");
  assert.equal(feedRetryDelay("Wed, 07 Oct 2026 00:01:00 GMT", now), 60);
  for (const value of [null, "garbage", "-2", "NaN", "1.2"]) assert.equal(feedRetryDelay(value, now), 30);
  assert.equal(feedRetryDelay("9".repeat(400), now), 300);
  assert.equal(feedRetryDelay("0", now), 1);
  assert.equal(feedRetryDelay("Wed, 07 Oct 2020 00:00:00 GMT", now), 1);
});
test("non-feeds, HTTP failures and rejected promises never poison success cache", async () => {
  const shared = {}; const { cachedNewsFeedResource } = bundle(shared)("news-feed-cache");
  const url = "https://example.org/not-feed"; let count = 0;
  for (const body of ["<html>not a feed</html>", "plain text"]) {
    const fetcher = async () => { count++; return { response: new Response(body), finalUrl: url }; };
    for (let i = 0; i < 2; i++) assert.equal(await (await cachedNewsFeedResource(url, fetcher, reader)).response.text(), body);
  }
  assert.equal(count, 4); assert.equal(shared.__labulubiusFeedCacheV1.entries.size, 0);
  await cachedNewsFeedResource(url, async () => ({ response: new Response(xml, { status: 500 }), finalUrl: url }), reader);
  assert.equal(shared.__labulubiusFeedCacheV1.entries.size, 0);
  await assert.rejects(cachedNewsFeedResource(url, async () => { throw new Error("network failed"); }, reader), /network failed/);
  await assert.rejects(cachedNewsFeedResource(url, good, async () => { throw new Error("body failed"); }), /body failed/);
  assert.equal(shared.__labulubiusFeedCacheV1.pending.size, 0);
  assert.equal(await (await cachedNewsFeedResource(url, good, reader)).response.text(), xml);
});
test("actual submit clears failed-create preview, preserves inputs/tags and partial-save behavior", async () => {
  const source = readFileSync("app/feeds/feeds-reader.tsx", "utf8");
  const parsed = ts.createSourceFile("feeds-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submit = node.getText(parsed); ts.forEachChild(node, visit); }
  visit(parsed); assert.ok(submit);
  const code = ts.transpileModule(submit, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const partial of [false, true]) {
    let preview = { inputUrl: "https://example.org/feed", kind: "feed" }; let closed = false; let error = "";
    const tags = ["tag-1"]; const url = "https://example.org/feed";
    const env = {
      dialog: { kind: "feed" }, sourceUrl: url, sourceProbe: preview, draftTags: tags,
      feeds: [], watchboards: { sourceTags: {} }, selected: [], boardFilter: null,
      FormData: class { get(key) { return key === "title" ? "Preserved name" : url; } },
      setSaving() {}, setError(value) { error = value; }, setSourceProbe(value) { preview = value; },
      setFeeds() {}, setSelected() {}, setSaved() {}, closeDialog() { closed = true; },
      api: async (path) => { if (!partial || path) throw new Error("Save failed"); return { feeds: [{ id: "new" }], selected: [] }; },
    };
    const handler = new Function(...Object.keys(env), `${code}; return submit;`)(...Object.values(env));
    await handler({ preventDefault() {}, currentTarget: {} });
    assert.equal(closed, partial);
    if (!partial) assert.equal(preview, null);
    assert.deepEqual(tags, ["tag-1"]); assert.equal(env.sourceUrl, url);
    assert.match(error, partial ? /Source was added, but setup was incomplete/ : /^Save failed$/);
  }
  assert.doesNotMatch(source, /This source is ready to subscribe/);
  assert.match(source, /sourceProbe && <div className="news-source-preview" role="status"/);
});
