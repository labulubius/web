import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { agentHandoffPath, pdfToEpubHandoff } from "../app/lib/agent-handoff.ts";
import { conciseSummary } from "../app/lib/concise-summary.ts";
import { normalizeNewsArticleUrl } from "../app/lib/news-article-url.ts";
import { discourseLatestFeed } from "../app/lib/news-feed-discovery.ts";
import { forumSourceUrl } from "../scripts/migrate-forums-to-news.mjs";
import { cauLoginCipher, cauLoginSucceeded, parseCauLoginForm } from "../app/lib/cau-login-encryption.ts";
import { CAU_RETENTION_MS, normalizeCauNotices, parseCauNoticePage, renderCauRss, retainCauNotices } from "../app/lib/cau-news-feed.ts";
import { CIEE_RETENTION_MS, normalizeCieeNotices, parseCieeArticle, parseCieeListings, renderCieeRss, retainCieeNotices } from "../app/lib/ciee-news-feed.ts";
import { GET as health } from "../app/api/health/route.ts";
import { addDays, dateRange, daysBetween, maximumRangeEnd, monthEnd, monthStart, shiftMonth, validTimelineRange } from "../app/tasks/task-calendar.ts";
import { reorderTaskProjects } from "../app/tasks/project-order.ts";
import nextConfig from "../next.config.ts";

test("PDF handoff carries a private structured reference into Agent", () => {
  const prompt = pdfToEpubHandoff("drive", "Books/中文扫描.pdf", "中文扫描.pdf", 1234);
  assert.match(prompt, /^\/skill:pdf-to-epub/);
  assert.match(prompt, /<pi-file-reference>/);
  assert.match(prompt, /"source":"drive"/);
  assert.match(prompt, /"remote":"Books\/中文扫描.pdf"/);
  const path = agentHandoffPath(prompt);
  assert.ok(path.startsWith("/agent?handoff="));
  assert.equal(decodeURIComponent(path.split("=", 2)[1]), prompt);
  assert.throws(() => pdfToEpubHandoff("drive", "", "book.pdf", 1), /Invalid/);
});

test("Drive shares use opaque metadata and protected path resolution", async () => {
  const shares = await readFile(new URL("../app/lib/drive-shares.ts", import.meta.url), "utf8");
  const publicRoute = await readFile(new URL("../app/api/share/[id]/route.ts", import.meta.url), "utf8");
  assert.match(shares, /const SHARE_DIRECTORY = "\.drive-shares"/);
  assert.match(shares, /randomUUID\(\)/);
  assert.match(shares, /resolveDrivePath/);
  assert.match(shares, /O_NOFOLLOW/);
  assert.match(publicRoute, /Content-Disposition/);
  assert.match(publicRoute, /Cache-Control": "no-store"/);
});

test("personal tasks keep private atomic storage and owner-only APIs", async () => {
  const server = await readFile(new URL("../app/lib/tasks-server.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8");
  const manager = await readFile(new URL("../app/tasks/task-manager.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../app/tasks/task-dialogs.tsx", import.meta.url), "utf8");
  const gantt = await readFile(new URL("../app/tasks/gantt-view.tsx", import.meta.url), "utf8");
  const types = await readFile(new URL("../app/tasks/task-types.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/tasks/tasks.css", import.meta.url), "utf8");
  const projectsApi = await readFile(new URL("../app/api/tasks/projects/route.ts", import.meta.url), "utf8");
  assert.match(server, /TASKS_DATA_DIR/);
  assert.match(server, /O_NOFOLLOW/);
  assert.match(server, /await handle\.sync\(\)/);
  assert.match(server, /await rename\(/);
  assert.match(server, /site_is_admin/);
  assert.match(api, /requireTasksAdmin/);
  assert.match(api, /taskPrivateHeaders/);
  assert.match(server, /Cache-Control/);
  assert.match(manager, /<HomeAccess/);
  assert.match(manager, /Session expired/);
  assert.match(manager, /method: "DELETE"/);
  assert.match(server, /data\.tasks\.splice\(index, 1\)/);
  assert.doesNotMatch(manager, /task-message|setMessage|Task added to project|Task completed and removed|Permanently delete/);
  assert.doesNotMatch(styles, /\.task-message/);
  assert.match(manager, /Delete project .*Its tasks will become Uncategorized and lose their dates/);
  assert.match(manager, /site-tasks-location-v1/);
  assert.ok(manager.indexOf("<span>All tasks</span>") < manager.indexOf("<span>Gantt</span>"));
  assert.match(manager, /String\(value\.view\) === "inbox" \? "all"/);
  assert.match(manager, /aria-label={`Edit \$\{task\.title\}`}/);
  assert.match(manager, /aria-label={`Delete \$\{task\.title\}`}/);
  assert.doesNotMatch(manager, /completedAt|view === "completed"/);
  assert.doesNotMatch(dialog, /textarea|name="notes"|task-dialog-secondary/);
  assert.match(dialog, /Uncategorized/);
  assert.match(dialog, /task-form-primary/);
  assert.doesNotMatch(manager, /task-range-shift|This month|moveRange/);
  assert.doesNotMatch(types, /notes:/);
  assert.doesNotMatch(gantt, /No tasks this month|gantt-empty-row/);
  assert.match(gantt, /scheduled\.map/);
  assert.match(styles, /task-gantt-view\.is-empty/);
  assert.match(manager, /SortableProjectRow/);
  assert.doesNotMatch(manager, /allTasks.length/);
  assert.match(manager, /view !== "gantt"/);
  assert.match(projectsApi, /reorderProjects/);
  assert.match(server, /value\.version === 1/);
  assert.match(server, /value\.version === 2/);
  assert.match(server, /version: 3/);
  assert.match(server, /startDate: null, endDate: null/);
});

test("task projects reorder only with an exact opaque-ID set", () => {
  const first = { id: "11111111-1111-4111-8111-111111111111", name: "First", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" };
  const second = { id: "22222222-2222-4222-8222-222222222222", name: "Second", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" };
  assert.deepEqual(reorderTaskProjects([first, second], [second.id, first.id]), [second, first]);
  assert.throws(() => reorderTaskProjects([first, second], [first.id, first.id]), /Invalid project order/);
  assert.throws(() => reorderTaskProjects([first, second], [first.id]), /Invalid project order/);
  assert.throws(() => reorderTaskProjects([first, second], [first.id, "33333333-3333-4333-8333-333333333333"]), /Invalid project order/);
});

test("task Gantt calendar supports inclusive custom ranges across months", () => {
  const october = monthStart("2026-10-19");
  assert.equal(october, "2026-10-01");
  assert.equal(monthEnd(october), "2026-10-31");
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(daysBetween("2026-10-05", "2026-11-05"), 31);
  assert.deepEqual(dateRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.equal(maximumRangeEnd("2026-10-05"), "2026-12-04");
  assert.equal(validTimelineRange("2026-10-05", "2026-12-04"), true);
  assert.equal(validTimelineRange("2026-10-05", "2026-12-05"), false);
});

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

test("CAU notice titles decode Chinese punctuation entities before RSS rendering", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const notices = normalizeCauNotices([{
    RESOURCE_ID: "789",
    PIM_TITLE: "关于开展&ldquo;第十二届&rdquo;&mdash;&mdash;先锋&middot;领航评选工作的通知",
    PIM_CONTENT: "通知&ensp;内容。",
    CREATE_TIME: now - 1000,
  }], now);

  assert.equal(notices[0].title, "关于开展“第十二届”——先锋·领航评选工作的通知");
  assert.equal(notices[0].summary, "通知 内容。");
  const rss = renderCauRss(notices, now);
  assert.match(rss, /<title>关于开展“第十二届”——先锋·领航评选工作的通知<\/title>/);
  assert.doesNotMatch(rss, /&amp;(?:ensp|ldquo|rdquo|mdash|middot);/);
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
  assert.doesNotMatch(headers.get("content-security-policy"), /share\.labulubius\.com/);
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
  assert.match(source, /function PiWebFrame/);
  assert.match(source, /src=\{src\}/);
  assert.match(source, /src=\{frameUrl\}/);
  assert.doesNotMatch(source, /src=.*access_token/);
  assert.match(source, /if \(loading \|\| !user \|\| !isAdmin\) return;/);
});

test("agent session restore and refresh keep the live iframe mounted", async () => {
  const source = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  const readyGate = source.indexOf('if (connection === "ready" && user && isAdmin)');
  const loadingGate = source.indexOf("if (loading || authError || !user || !isAdmin)");

  assert.notEqual(readyGate, -1);
  assert.ok(readyGate < loadingGate, "the ready iframe must survive background auth loading");
  assert.match(source, /hasAgentSessionHint\(\) \? "ready" : "idle"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /if \(loading \|\| !user \|\| !isAdmin\) return;/);
  assert.match(source, /rememberAgentSession\(true\)/);
  assert.match(source, /<PiWebFrame generation=\{frameGeneration\} src=\{frameUrl\} \/>/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "connecting"\)/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "error"\)/);
});

test("agent sign-out clears both the hint and remote owner session", async () => {
  const source = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(loading \|\| user \|\| authError \|\| !hasAgentSessionHint\(\)\) return;/);
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

test("owner-only destinations remain visible and show access guidance", async () => {
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");
  const drive = await readFile(new URL("../app/drive/drive-manager.tsx", import.meta.url), "utf8");
  const agent = await readFile(new URL("../app/agent/agent-frame.tsx", import.meta.url), "utf8");
  const access = await readFile(new URL("../app/owner-access.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /href="\/drive"/);
  assert.doesNotMatch(sidebar, /href="\/share"/);
  assert.match(sidebar, /href="\/agent"/);
  assert.doesNotMatch(sidebar, /href="\/note"/);
  assert.doesNotMatch(sidebar, /isAdmin && <Link href="\/(?:drive|share|agent)"/);
  assert.match(drive, /<OwnerAccess/);
  assert.match(agent, /if \(loading \|\| authError \|\| !user \|\| !isAdmin\)/);
  assert.match(agent, /return <PiWebFrame \/>/);
  assert.doesNotMatch(agent, /Use Sign in in the top toolbar/);
  assert.match(agent, /<SiteShell active="\/agent"/);
  assert.doesNotMatch(access, /AccountControl/);
  assert.match(shell, /<AccountControl \/>/);
  assert.doesNotMatch(shell, /href: "\/(?:share|note)"/);
});

test("Feeds replaces the retired News page while preserving News APIs", async () => {
  const page = await readFile(new URL("../app/feeds/page.tsx", import.meta.url), "utf8");
  const reader = await readFile(new URL("../app/feeds/feeds-reader.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/feeds/feeds.css", import.meta.url), "utf8");
  const newsTypes = await readFile(new URL("../app/lib/news-server-types.ts", import.meta.url), "utf8");
  const newsServer = await readFile(new URL("../app/lib/news-server.ts", import.meta.url), "utf8");
  const newsApi = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");

  await assert.rejects(access(new URL("../app/news/page.tsx", import.meta.url)), { code: "ENOENT" });
  await access(new URL("../app/api/news/route.ts", import.meta.url));
  assert.match(page, /title: "Feeds"/);
  assert.match(page, /active="\/feeds" title="Feeds"/);
  assert.match(shell, /href: "\/feeds", label: "Feeds", icon: Rss/);
  assert.doesNotMatch(shell, /href: "\/news"|label: "News"|Newspaper/);
  assert.match(sidebar, /href="\/feeds"><Rss size=\{16\} \/> Feeds/);
  assert.doesNotMatch(sidebar, /href="\/news"|> News</);
  assert.match(reader, /aria-label="Feeds navigation"/);
  assert.doesNotMatch(reader, /<span>All items<\/span>|board\.name} \(\{matches\(board\)\}\)/);
  assert.match(reader, /site-news-location/);
  assert.match(reader, /source:\$\{id\}/);
  assert.match(reader, /showFallbackSidebar/);
  assert.match(reader, /title=\{article\.source\}>\{article\.source\}/);
  assert.ok(reader.indexOf("title={article.source}") < reader.indexOf("<time dateTime="), "source must precede the published date");
  assert.match(reader, /className="news-article-copy"/);
  assert.match(styles, /\.news-article-content \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(90px, 24%\)/);
  assert.match(styles, /\.news-article-meta \{[^}]*flex-direction: column[^}]*text-align: right/);
  assert.match(styles, /\.news-article-meta span \{[^}]*max-width: 100%[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.news-article-content \{ gap: 10px; grid-template-columns: minmax\(0, 1fr\) clamp\(78px, 24vw, 108px\)/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(newsTypes, /summary: string; source: string/);
  assert.match(newsServer, /'sourceId', e\.id_feed/);
  assert.match(newsApi, /newsArticles\(selected, cursor, feeds\)/);
  assert.match(reader, /Items are temporarily unavailable\./);
  assert.match(reader, /No items here yet\./);
  assert.match(reader, /<th>In All items<\/th>/);
  assert.doesNotMatch(reader, /News navigation|<span>All articles<\/span>|Articles are temporarily unavailable|No articles here yet|<th>In Articles<\/th>/);
});

test("retired Note route and navigation stay absent", async () => {
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");

  await assert.rejects(access(new URL("../app/note/page.tsx", import.meta.url)), { code: "ENOENT" });
  assert.doesNotMatch(shell, /href: "\/note"|StickyNote/);
  assert.doesNotMatch(sidebar, /href="\/note"|StickyNote/);
});

test("sidebar controls render for the configured workspace pages", async () => {
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const drive = await readFile(new URL("../app/drive/page.tsx", import.meta.url), "utf8");
  const share = await readFile(new URL("../app/share/page.tsx", import.meta.url), "utf8");

  assert.match(shell, /hasSidebar && <button/);
  assert.match(home, /title="Home" hasSidebar/);
  assert.match(drive, /title="Private Drive" hasSidebar/);
  assert.match(share, /redirect\("\/drive"\)/);
});

test("sidebar create and delete actions share a trailing axis", async () => {
  const tasks = await readFile(new URL("../app/tasks/tasks.css", import.meta.url), "utf8");
  const navigator = await readFile(new URL("../app/nav/nav.css", import.meta.url), "utf8");
  const news = await readFile(new URL("../app/feeds/feeds.css", import.meta.url), "utf8");
  const directory = await readFile(new URL("../app/nav/nav-directory.tsx", import.meta.url), "utf8");

  for (const stylesheet of [tasks, navigator, news]) assert.match(stylesheet, /margin: 8px 4px 5px 9px/);
  assert.match(tasks, /\.tasks-project-list > div \{[^}]*min-width: 0/);
  assert.match(navigator, /\.category-row \{[^}]*min-width: 0/);
  assert.match(news, /\.news-category-row \{[^}]*min-width: 0/);
  assert.match(directory, /isAdmin \? <Folder size=\{16\}/);
  assert.doesNotMatch(directory, /GripVertical/);
});

test("Feeds resolves Discourse homepages to latest-topic feeds", async () => {
  const html = '<meta name="generator" content="Discourse 3.4.0 - https://github.com/discourse/discourse">';
  assert.equal(discourseLatestFeed(html, "https://forum.obsidian.md/"), "https://forum.obsidian.md/latest.rss");
  assert.equal(discourseLatestFeed(html, "https://example.com/community/"), "https://example.com/community/latest.rss");
  assert.equal(discourseLatestFeed("<title>ordinary site</title>", "https://example.com/"), null);

  const proxy = await readFile(new URL("../app/lib/news-feed-proxy.ts", import.meta.url), "utf8");
  const management = await readFile(new URL("../app/lib/news-management.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../app/feeds/feeds-reader.tsx", import.meta.url), "utf8");
  assert.match(proxy, /fetchPinnedNewsResource\(discourse\)/);
  assert.match(management, /Source already exists\./);
  assert.match(api, /selected, \.\.\.result/);
  assert.match(reader, /Detected a Discourse forum and subscribed to/);
});

test("legacy forum sources map idempotently to independent News feeds", () => {
  assert.equal(forumSourceUrl({ kind: "discourse", name: "Obsidian", origin: "https://forum.obsidian.md", latest: "/latest.json" }), "https://forum.obsidian.md/latest.rss");
  assert.equal(forumSourceUrl({ kind: "discourse", name: "OpenAI", origin: "https://community.openai.com", latest: "/latest.json?status=open" }), "https://community.openai.com/latest.rss?status=open");
  assert.equal(forumSourceUrl({ kind: "v2ex", name: "V2EX" }), "https://www.v2ex.com/index.xml");
  assert.equal(forumSourceUrl({ kind: "hackernews", name: "HN", view: "top" }), "https://hnrss.org/frontpage");
  assert.equal(forumSourceUrl({ kind: "stackexchange", name: "SO", site: "stackoverflow", tags: "" }), "https://stackoverflow.com/feeds");
  assert.equal(forumSourceUrl({ kind: "rss", name: "Feed", feedUrl: "https://example.com/feed.xml" }), "https://example.com/feed.xml");
  assert.throws(() => forumSourceUrl({ kind: "hackernews", name: "HN", view: "new" }), /Unsupported/);
});

test("retired Forums route, API, navigation, and parser stay absent", async () => {
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  await assert.rejects(access(new URL("../app/forums/page.tsx", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/api/forums/route.ts", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/lib/forums.ts", import.meta.url)), { code: "ENOENT" });
  assert.doesNotMatch(shell, /\/forums|MessagesSquare/);
  assert.doesNotMatch(sidebar, /\/forums|MessagesSquare/);
  assert.doesNotMatch(globals, /forums-/);
  assert.doesNotMatch(packageJson, /fast-xml-parser/);
});
