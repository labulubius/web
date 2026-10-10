import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as normalizer from "../app/lib/news-html2rss-feed.ts";

function client(fetcher, env = { HTML2RSS_ACCESS_TOKEN: "test-only-html2rss-token-not-a-secret" }) {
  const timeouts = [];
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync("app/lib/news-html2rss.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (name) => {
    if (name === "server-only") return {};
    if (name === "./news-html2rss-feed") return normalizer;
    if (name === "./news-feed-proxy") return { readLimitedNewsResource: async (response) => new Uint8Array(await response.arrayBuffer()) };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  const signals = { timeout(ms) { timeouts.push(ms); return new AbortController().signal; } };
  new Function("require", "module", "exports", "fetch", "process", "AbortSignal", code)(require, compiledModule, compiledModule.exports, fetcher, { env }, signals);
  return { api: compiledModule.exports, timeouts };
}

const feedPath = "/api/v1/feeds/test-feed.json";
const payload = { title: "Source", items: [{ title: "Actual article", url: "https://example.org/article", content_text: "Actual description", date_published: "2026-10-08T00:00:00Z" }] };

test("actual html2rss client preserves filter URL, token boundary and browser timeout", async () => {
  const calls = [];
  const { api, timeouts } = client(async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(calls.length === 1 ? { success: true, data: { feed: { json_public_url: feedPath } } } : payload);
  });
  const sourceUrl = "https://example.org/news?type=Press+Release&lang=English";
  const result = await api.createHtml2rssSource(sourceUrl);
  assert.equal(JSON.parse(calls[0].options.body).url, sourceUrl);
  assert.equal(calls[0].url, "http://127.0.0.1:4000/api/v1/feeds");
  assert.equal(calls[1].url, `http://127.0.0.1:4000${feedPath}`);
  assert.deepEqual(timeouts, [43_000, 43_000]);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-only-html2rss-token-not-a-secret");
  assert.equal(calls[1].options.headers, undefined, "public feed reads do not carry the management credential");
  assert.equal(result.source.items[0].published, Date.parse("2026-10-08T00:00:00Z"));
  assert.equal(result.source.items[0].summary, "Actual description");
});

test("actual html2rss client rejects forged feed paths before a second request", async () => {
  for (const path of ["http://127.0.0.1:8083/v1/feeds", "/api/v1/feeds/../private.json", "/api/v1/feeds/test.json?token=unsafe"]) {
    let calls = 0;
    const { api } = client(async () => { calls++; return Response.json({ success: true, data: { feed: { json_public_url: path } } }); });
    await assert.rejects(api.createHtml2rssSource("https://example.org/news"), /invalid feed path/);
    assert.equal(calls, 1);
  }
});

test("actual html2rss refresh uses the same bounded browser-aware client", async () => {
  const { api, timeouts } = client(async () => Response.json(payload));
  const source = await api.refreshHtml2rssSource(feedPath, "https://example.org/news", { title: "Old", description: "", items: [] });
  assert.equal(source.items.length, 1);
  assert.deepEqual(timeouts, [43_000]);
});

test("actual html2rss client keeps management bound to configured loopback API", async () => {
  let calls = 0;
  for (const url of ["https://example.org/api/v1", "http://127.0.0.1:8083/v1", "http://localhost:4000/api/v1"]) {
    const { api } = client(async () => { calls++; return Response.json({}); }, { HTML2RSS_ACCESS_TOKEN: "test-only-html2rss-token-not-a-secret", HTML2RSS_API_URL: url });
    await assert.rejects(api.createHtml2rssSource("https://example.org/news"), /not configured/);
  }
  assert.equal(calls, 0);
});
