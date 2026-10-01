import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fitsStorageQuota, STORAGE_TOTAL_BYTES } from "../app/lib/storage-quota.ts";
import { conciseSummary } from "../app/lib/concise-summary.ts";
import { normalizeNewsArticleUrl } from "../app/lib/news-article-url.ts";
import { cauLoginCipher, cauLoginSucceeded, parseCauLoginForm } from "../app/lib/cau-login-encryption.ts";
import { CAU_RETENTION_MS, normalizeCauNotices, parseCauNoticePage, renderCauRss, retainCauNotices } from "../app/lib/cau-news-feed.ts";
import { CIEE_RETENTION_MS, normalizeCieeNotices, parseCieeArticle, parseCieeListings, renderCieeRss, retainCieeNotices } from "../app/lib/ciee-news-feed.ts";
import { GET as health } from "../app/api/health/route.ts";
import nextConfig from "../next.config.ts";

test("CAU login encryption matches the university CAS implementation", () => {
  assert.equal(cauLoginCipher("abc"), "39644174795FB4D0");
  assert.equal(cauLoginCipher("12345678"), "C1BB5938DF9F2190B89172CB54C8C33A");
  assert.equal(cauLoginCipher("测试PassLT-123-tpass"), "964BAFACCEE9D0F8BBE41E1C36D7E4325B6830E26368DDFC568AB252F27C6846FD6A959843DC7E15");
});

test("CAU login and API changes fail closed", () => {
  const form = '<form id="loginForm" action="/tpass/login?service=x&amp;y=z"><input id="lt" value="LT-1234567890-tpass"></form>';
  assert.deepEqual(parseCauLoginForm(form), { action: "/tpass/login?service=x&y=z", lt: "LT-1234567890-tpass" });
  assert.throws(() => parseCauLoginForm('<form id="loginForm"></form>'), /login form changed/);
  assert.equal(cauLoginSucceeded("https://one.cau.edu.cn/tp_up/view", "<main>workspace</main>"), true);
  assert.equal(cauLoginSucceeded("https://onecas.cau.edu.cn/tpass/login", form), false);
  assert.deepEqual(parseCauNoticePage({ list: [], hasNextPage: false }), { list: [], hasNextPage: false });
  assert.throws(() => parseCauNoticePage({ items: [] }), /invalid notice page/);
});

test("CAU notices are sanitized, deduplicated, and retained for five days", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const records = [
    { RESOURCE_ID: "123", PIM_TITLE: "通知 &amp; 安排", PIM_CONTENT: "<p>第一句话。</p><script>bad()</script><p>第二句话！第三句话。</p>", BELONG_UNIT_NAME: "教务处", CREATE_TIME: now - 1000 },
    { RESOURCE_ID: "123", PIM_TITLE: "更新后的通知", PIM_CONTENT: "更新内容。", BELONG_UNIT_NAME: "教务处", CREATE_TIME: now - 500 },
    { RESOURCE_ID: "456", PIM_TITLE: "已过期", PIM_CONTENT: "不应保留。", CREATE_TIME: now - CAU_RETENTION_MS - 1 },
  ];
  const notices = normalizeCauNotices(records, now);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "更新后的通知");
  assert.equal(notices[0].summary, "更新内容。");
  assert.equal(retainCauNotices(notices, now + CAU_RETENTION_MS + 1).length, 0);
  const rss = renderCauRss(normalizeCauNotices(records.slice(0, 1), now), now);
  assert.match(rss, /通知 &amp; 安排/);
  assert.match(rss, /第一句话。第二句话！/);
  assert.doesNotMatch(rss, /bad\(\)|第三句话/);
});

test("news article URLs decode feed entities without allowing unsafe schemes", () => {
  const expected = "https://one.cau.edu.cn/tp_up/view?m=up#act=up/pim/showpim&id=8036284171743232";
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&amp;id=")), expected);
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&amp;amp;id=")), expected);
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&#38;id=")), expected);
  assert.equal(normalizeNewsArticleUrl("javascript:alert(1)"), "");
  assert.equal(normalizeNewsArticleUrl("not a URL"), "");
});

test("CIEE listings accept only the configured public notice column", () => {
  const html = `
    <a title="通知 &amp; 安排" href="/art/2026/9/30/art_50450_1139245.html">valid</a>
    <a href="https://evil.example/art/2026/9/30/art_50450_1.html" title="external">bad</a>
    <a href="/art/2026/9/30/art_50390_2.html" title="other column">bad</a>
    <a href="/art/2026/2/30/art_50450_3.html" title="invalid date">bad</a>`;
  const listings = parseCieeListings(html);
  assert.equal(listings.length, 1);
  assert.deepEqual(listings[0], {
    id: "1139245",
    title: "通知 & 安排",
    published: Date.UTC(2026, 8, 30, 4),
    url: "https://ciee.cau.edu.cn/art/2026/9/30/art_50450_1139245.html",
  });
});

test("CIEE articles are summarized without scripts or attachments", () => {
  const listing = parseCieeListings('<a href="/art/2026/9/30/art_50450_1139245.html" title="列表标题">notice</a>')[0];
  const html = `<meta name="i_columnid" content="50450">
    <meta content="1139245" name="i_articleid">
    <meta name="ArticleTitle" content="更新后的通知 &amp; 说明">
    <meta name="PubDate" content="2026-09-30 17:18">
    <!--ZJEG_RSS.content.begin--><p>第一句话。</p><script>secret()</script><p>第二句话！第三句话。</p>
    <a href="/module/download/downfile.jsp?filename=private.doc">附件中的个人材料.doc</a><!--ZJEG_RSS.content.end-->`;
  const notice = parseCieeArticle(html, listing);
  assert.equal(notice.title, "更新后的通知 & 说明");
  assert.equal(notice.published, Date.UTC(2026, 8, 30, 9, 18));
  assert.equal(notice.summary, "第一句话。第二句话！");
  assert.doesNotMatch(notice.summary, /secret|附件|个人材料/);
  assert.throws(() => parseCieeArticle(html.replace('content="50450"', 'content="50390"'), listing), /metadata changed/);
});

test("CIEE notices are deduplicated, retained for five days, and XML escaped", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const base = {
    id: "1139245", title: "旧标题", summary: "旧摘要", published: now - 1000,
    url: "https://ciee.cau.edu.cn/art/2026/9/30/art_50450_1139245.html",
  };
  const notices = normalizeCieeNotices([base, { ...base, title: "A & B", summary: "<更新>" }], now);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "A & B");
  assert.equal(retainCieeNotices(notices, now + CIEE_RETENTION_MS + 1).length, 0);
  const rss = renderCieeRss(notices, now);
  assert.match(rss, /<title>A &amp; B<\/title>/);
  assert.match(rss, /<description>&lt;更新&gt;<\/description>/);
  assert.match(rss, /<guid isPermaLink="false">ciee:1139245<\/guid>/);
});

test("news summaries contain no more than two short sentences", () => {
  assert.equal(conciseSummary("第一句话。第二句话！第三句话不应显示。"), "第一句话。第二句话！");
  assert.equal(conciseSummary("A short description of the article."), "A short description of the article.");
  const longChinese = conciseSummary(`这是一个没有句号的超长摘要${"内容".repeat(120)}`);
  assert.ok(longChinese.length <= 220);
  assert.match(longChinese, /…$/);
});

test("storage quota includes pending and converted output bytes", () => {
  assert.equal(fitsStorageQuota(80, 10, 10, 100), true);
  assert.equal(fitsStorageQuota(80, 10, 11, 100), false);
  assert.equal(fitsStorageQuota(STORAGE_TOTAL_BYTES, 0, 1), false);
  assert.equal(fitsStorageQuota(-1, 0, 0), false);
});

test("health response is minimal and not cached", async () => {
  const response = health();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("global headers include baseline browser protections", async () => {
  const rules = await nextConfig.headers();
  const headers = new Map(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(headers.get("content-security-policy"), /frame-src https:\/\/agent\.labulubius\.com/);
  assert.match(headers.get("content-security-policy"), /connect-src[^;]*https:\/\/agent\.labulubius\.com/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.ok(headers.has("referrer-policy"));
  assert.ok(headers.has("permissions-policy"));
});

test("agent page exchanges the Supabase bearer token without putting it in the iframe URL", async () => {
  const source = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/owner-auth/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /credentials: "include"/);
  assert.match(source, /src=\{AGENT_ORIGIN\}/);
  assert.doesNotMatch(source, /src=.*access_token/);
});

test("agent session restore and refresh keep the live iframe mounted", async () => {
  const source = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  const readyGate = source.indexOf('if (connection === "ready" && (loading || (user && isAdmin)))');
  const loadingGate = source.indexOf("if (loading)");

  assert.notEqual(readyGate, -1);
  assert.ok(readyGate < loadingGate, "the ready iframe must survive background auth loading");
  assert.match(source, /hasAgentSessionHint\(\) \? "ready" : "idle"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /rememberAgentSession\(true\)/);
  assert.match(source, /key=\{frameGeneration\}/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "connecting"\)/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "error"\)/);
});

test("agent sign-out clears both the hint and remote owner session", async () => {
  const source = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(loading \|\| user \|\| authError\) return;/);
  assert.match(source, /rememberAgentSession\(false\)/);
  assert.match(source, /method: "DELETE"/);
});

test("agent iframe stays mounted across workspace route changes", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const keeper = await readFile(new URL("../app/persistent-agent.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/agent/page.tsx", import.meta.url), "utf8");

  assert.match(layout, /<PersistentAgent>\{children\}<\/PersistentAgent>/);
  assert.match(keeper, /const shouldMountAgent = agentMounted \|\| isAgentRoute/);
  assert.match(keeper, /hidden=\{!isAgentRoute\}/);
  assert.match(keeper, /<AgentFrame \/>/);
  assert.doesNotMatch(page, /<AgentFrame \/>/);
});
