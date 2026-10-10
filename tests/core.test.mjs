import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { agentHandoffPath, pdfToEpubHandoff } from "../app/lib/agent-handoff.ts";
import { conciseSummary } from "../app/lib/concise-summary.ts";
import { normalizeNewsArticleUrl } from "../app/lib/news-article-url.ts";
import {
  bbcNewsFeed,
  discoverNewsFeedDetails,
  discourseLatestFeed,
  nativeCommunityFeed,
  NewsFeedDiscoveryError,
  withNewsFeedFallback,
} from "../app/lib/news-feed-discovery.ts";
import { GET as health } from "../app/api/health/route.ts";
import { addDays, dateRange, daysBetween, maximumRangeEnd, monthEnd, monthStart, shiftMonth, validTimelineRange } from "../app/tasks/task-calendar.ts";
import { reorderTaskProjects } from "../app/tasks/project-order.ts";
import { reorderByExactIds } from "../app/lib/watchboard-order.ts";
import { orderSourcesByWatchboards, orderTagsBySourceCount, sourceWatchboardCount } from "../app/feeds/feed-order.ts";
import { canonicalCsisTopicUrl, filterFutureWebSourceItems, parseCsisTopicPage, renderWebSourceRss, retainRecentWebSourceItems } from "../app/lib/news-web-source-feed.ts";
import { canonicalHtml2rssSourceUrl, normalizeHtml2rssFeed } from "../app/lib/news-html2rss-feed.ts";
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

test("Drive public links are opaque, file-only, versioned, and protected", async () => {
  const shares = await readFile(new URL("../app/lib/drive-shares.ts", import.meta.url), "utf8");
  const publicRoute = await readFile(new URL("../app/drive/file/[id]/route.ts", import.meta.url), "utf8");
  const legacyDownloadRoute = await readFile(new URL("../app/drive/file/[id]/download/route.ts", import.meta.url), "utf8");
  const downloadResponse = await readFile(new URL("../app/drive/file/[id]/download-response.ts", import.meta.url), "utf8");
  const shareApi = await readFile(new URL("../app/api/drive/shares/route.ts", import.meta.url), "utf8");
  assert.match(shares, /const SHARE_DIRECTORY = "\.drive-shares"/);
  assert.match(shares, /const SHARE_VERSION = 2/);
  assert.match(shares, /const SHARE_SCOPE = "file-download"/);
  assert.match(shares, /value\.version !== SHARE_VERSION \|\| value\.scope !== SHARE_SCOPE/);
  assert.match(shares, /randomUUID\(\)/);
  assert.match(shares, /resolveDrivePath/);
  assert.match(shares, /O_NOFOLLOW/);
  assert.match(shares, /if \(!stat\.isFile\(\)\) throw new Error\("Only files can have public links\."\)/);
  assert.match(shareApi, /url: `\/drive\/file\/\$\{share\.id\}`/);
  assert.doesNotMatch(shareApi, /`\/share\//);
  assert.match(publicRoute, /servePublicDriveFile\(request, id\)/);
  assert.match(publicRoute, /export const GET = serve/);
  assert.match(publicRoute, /export const HEAD = serve/);
  assert.match(legacyDownloadRoute, /servePublicDriveFile\(request, id\)/);
  assert.match(downloadResponse, /resolvePublicDriveFile/);
  assert.match(downloadResponse, /Content-Disposition/);
  assert.match(downloadResponse, /Cache-Control": "no-store"/);
  assert.match(downloadResponse, /Referrer-Policy": "no-referrer"/);
  assert.match(downloadResponse, /X-Content-Type-Options": "nosniff"/);
  assert.match(downloadResponse, /request\.method === "HEAD"/);
  assert.match(downloadResponse, /status: 416/);
  await assert.rejects(access(new URL("../app/drive/file/[id]/page.tsx", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/drive/file/[id]/public-download.tsx", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/api/share/[id]/route.ts", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/share/[id]/page.tsx", import.meta.url)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../app/share/page.tsx", import.meta.url)), { code: "ENOENT" });
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
  assert.match(manager, /Delete project .*Its tasks will become Uncategorized and keep their dates/);
  assert.match(manager, /site-tasks-location-v1/);
  assert.ok(manager.indexOf("<span>All tasks</span>") < manager.indexOf("<span>Gantt</span>"));
  assert.match(manager, /String\(value\.view\) === "inbox" \? "all"/);
  assert.match(manager, /aria-label={`Edit \$\{task\.title\}`}/);
  assert.match(manager, /aria-label={`Delete \$\{task\.title\}`}/);
  assert.doesNotMatch(manager, /completedAt|view === "completed"/);
  assert.doesNotMatch(dialog, /name="notes"|task-dialog-secondary/);
  assert.match(dialog, /<textarea name="description" maxLength=\{300\} rows=\{3\}/);
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
  assert.match(server, /version: 4/);
  assert.match(server, /projectId: null, updatedAt: now/);
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

test("news article URLs decode feed entities without allowing unsafe schemes", () => {
  const expected = "https://example.com/article?view=full&id=8036284171743232";
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&amp;id=")), expected);
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&amp;amp;id=")), expected);
  assert.equal(normalizeNewsArticleUrl(expected.replace("&id=", "&#38;id=")), expected);
  assert.equal(normalizeNewsArticleUrl("javascript:alert(1)"), "");
  assert.equal(normalizeNewsArticleUrl("not a URL"), "");
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

test("production health checks exclude the retired reader hostname", async () => {
  const script = await readFile(new URL("../scripts/health-check.sh", import.meta.url), "utf8");
  assert.match(script, /MAIN_ORIGIN:-https:\/\/labulubius\.com/);
  assert.match(script, /DRIVE_ORIGIN:-https:\/\/drive\.labulubius\.com/);
  assert.match(script, /AGENT_ORIGIN:-https:\/\/agent\.labulubius\.com/);
  assert.doesNotMatch(script, /FEEDS_ORIGIN/);
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
  const minifluxBackend = await readFile(new URL("../app/lib/news-miniflux-backend.ts", import.meta.url), "utf8");
  const newsApi = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");

  await assert.rejects(access(new URL("../app/news/page.tsx", import.meta.url)), { code: "ENOENT" });
  await access(new URL("../app/api/news/route.ts", import.meta.url));
  assert.match(page, /title: \{ absolute: "Feeds" \}/);
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
  assert.match(minifluxBackend, /entry\.feed_id/);
  assert.match(newsApi, /newsArticles\(selected, cursor, feeds\)/);
  assert.match(newsApi, /const publicNewsHeaders = \{/);
  assert.match(newsApi, /public, max-age=0, s-maxage=30, stale-while-revalidate=60/);
  assert.equal((newsApi.match(/headers: publicNewsHeaders/g) || []).length, 2);
  assert.match(newsApi, /headers: privateNewsHeaders/);
  assert.doesNotMatch(reader, /publicArticles.*cache: "no-store"/);
  assert.doesNotMatch(reader, /className=\"news-(?:error|success)\"/);
  assert.doesNotMatch(styles, /\.news-error|\.news-success/);
  assert.match(reader, /className=\"form-error\" role=\"alert\"/);
  assert.match(reader, /Loading items…|Loading your subscriptions…/);
  assert.match(reader, /No items here yet\./);
  assert.match(reader, /<th>In All items<\/th>/);
  assert.ok(reader.indexOf('className="news-heading-search"') < reader.indexOf('className="news-add-action"'), "source search must precede the add button");
  assert.match(reader, /aria-label="Search sources"/);
  assert.doesNotMatch(reader, /<label>Search sources|news-table-controls/);
  assert.match(styles, /\.news-heading-search/);
  assert.doesNotMatch(reader, /News navigation|<span>All articles<\/span>|Articles are temporarily unavailable|No articles here yet|<th>In Articles<\/th>/);
});

test("Drive uses a responsive Dolphin-style browser without broadening owner access", async () => {
  const manager = await readFile(new URL("../app/drive/drive-manager.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/drive/drive.css", import.meta.url), "utf8");
  const driveApi = await readFile(new URL("../app/api/drive/route.ts", import.meta.url), "utf8");
  const sharesApi = await readFile(new URL("../app/api/drive/shares/route.ts", import.meta.url), "utf8");
  assert.match(manager, /<OwnerAccess/);
  assert.match(manager, /className="drive-sidebar" id="page-sidebar"/);
  assert.match(manager, /My Drive/);
  assert.match(manager, /Public links/);
  assert.match(manager, /site-drive-view/);
  assert.match(manager, /Details view/);
  assert.match(manager, /Grid view/);
  assert.match(manager, /drive-info/);
  assert.match(manager, /<AccessibleDialog/);
  assert.match(manager, /Create public link/);
  assert.match(manager, /Revoke public link/);
  assert.doesNotMatch(manager, /drive-storage|5 GB total/);
  assert.doesNotMatch(styles, /\.drive-storage|drive-public-card|drive-download-dialog/);
  assert.doesNotMatch(manager, /new URL\(`\/share|href=[{`"']\/share/);
  assert.match(styles, /grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.drive-browser\.has-info \.drive-content/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /data-mobile-sidebar-open="true"/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(driveApi, /requireDriveAdmin/);
  assert.match(sharesApi, /requireDriveAdmin/);
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

  assert.match(shell, /hasSidebar && <button/);
  assert.match(home, /title="Home" hasSidebar/);
  assert.match(drive, /title="Drive" hasSidebar/);
  await assert.rejects(access(new URL("../app/share/page.tsx", import.meta.url)), { code: "ENOENT" });
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
  assert.match(directory, /onDragStart=\{\(\) => \{ blockSiteOpen\.current = true; \}\}/);
  assert.match(directory, /onPointerDownCapture=\{\(\) => \{ blockSiteOpen\.current = false; \}\}/);
  assert.match(directory, /onClickCapture=\{\(event\) => \{/);
  assert.match(directory, /event\.target\.closest\(\"\.site-card-link\"\)/);
  assert.match(directory, /event\.preventDefault\(\);/);
  assert.doesNotMatch(directory, /blockSiteOpenUntil|didDrag|onPointerInteraction|shouldBlockOpen|GripVertical/);
});

test("Feeds watchboards persist only exact drag orders", async () => {
  const boards = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  assert.deepEqual(reorderByExactIds(boards, ["c", "a", "b"]), [boards[2], boards[0], boards[1]]);
  assert.equal(reorderByExactIds(boards, ["a", "a", "b"]), null);
  assert.equal(reorderByExactIds(boards, ["a", "b"]), null);
  assert.equal(reorderByExactIds(boards, ["a", "b", "unknown"]), null);

  const reader = await readFile(new URL("../app/feeds/feeds-reader.tsx", import.meta.url), "utf8");
  const watchboards = await readFile(new URL("../app/lib/news-watchboards.ts", import.meta.url), "utf8");
  assert.match(reader, /KeyboardSensor/);
  assert.match(reader, /PointerSensor/);
  assert.match(reader, /TouchSensor/);
  assert.match(reader, /<Folder size=\{16\}/);
  assert.match(reader, /SortableWatchboardRow/);
  assert.match(reader, /className=\{`news-watchboard-select/);
  assert.doesNotMatch(reader, /news-watchboard-drag|GripVertical|setActivatorNodeRef/);
  assert.match(reader, /action: "reorderWatchboards"/);
  assert.match(watchboards, /case "reorderWatchboards"/);
});

test("Feeds Sources rank by matching Watchboards then subscription creation order", () => {
  const boards = [{ tagIds: ["news"] }, { tagIds: ["news", "world"] }, { tagIds: ["tech"] }, { tagIds: [] }];
  const sourceTags = {
    "feed/10": ["news", "world"],
    "feed/11": ["news"],
    "feed/12": ["news", "news"],
    "feed/13": [],
  };
  const sources = ["feed/10", "feed/11", "feed/12", "feed/13"].map((id) => ({ id }));

  assert.equal(sourceWatchboardCount("feed/10", boards, sourceTags), 2);
  assert.equal(sourceWatchboardCount("feed/13", boards, sourceTags), 0);
  assert.deepEqual(orderSourcesByWatchboards(sources, boards, sourceTags).map(({ id }) => id), [
    "feed/10", "feed/12", "feed/11", "feed/13",
  ]);
  assert.deepEqual(orderSourcesByWatchboards([sources[1], sources[2]], boards, sourceTags).map(({ id }) => id), ["feed/12", "feed/11"]);
});

test("Feeds Tags rank by distinct Source count then creation order", () => {
  const tags = ["old", "middle", "new"].map((id) => ({ id }));
  const ranked = orderTagsBySourceCount(tags, {
    first: ["old", "middle", "middle"],
    second: ["old", "new"],
  });

  assert.deepEqual(ranked.map(({ tag, count }) => [tag.id, count]), [
    ["old", 2], ["new", 1], ["middle", 1],
  ]);
  assert.deepEqual(orderTagsBySourceCount(tags, {}).map(({ tag }) => tag.id), ["new", "middle", "old"]);
});

test("Feeds resolves BBC News pages to their published feeds", () => {
  assert.equal(bbcNewsFeed("https://www.bbc.com/news/us-canada"), "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml");
  assert.equal(bbcNewsFeed("https://bbc.co.uk/news/us-canada/?ref=nav"), "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml");
  assert.equal(bbcNewsFeed("https://www.bbc.com/news"), "https://feeds.bbci.co.uk/news/rss.xml");
  assert.equal(bbcNewsFeed("https://example.com/news/us-canada"), null);
  assert.equal(bbcNewsFeed("https://www.bbc.com/news/europe"), null);
});

test("Feeds resolves Discourse homepages to latest-topic feeds", async () => {
  const html = '<meta name="generator" content="Discourse 3.4.0 - https://github.com/discourse/discourse">';
  assert.equal(discourseLatestFeed(html, "https://forum.obsidian.md/"), "https://forum.obsidian.md/latest.rss");
  assert.equal(discourseLatestFeed(html, "https://example.com/community/"), "https://example.com/community/latest.rss");
  assert.equal(discourseLatestFeed("<title>ordinary site</title>", "https://example.com/"), null);

  const proxy = await readFile(new URL("../app/lib/news-feed-proxy.ts", import.meta.url), "utf8");
  const management = await readFile(new URL("../app/lib/news-management.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  assert.match(proxy, /discoverNewsFeedDetails\(value, fetchPinnedNewsResource, readLimitedNewsResource\)/);
  assert.match(management, /Source already exists\./);
  assert.match(api, /selected, \.\.\.result/);
});

const testFeedBody = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title></feed>';
const testResourceReader = async (response) => new Uint8Array(await response.arrayBuffer());
const testResource = (body, finalUrl, status = 200) => ({ response: new Response(body, { status }), finalUrl });

test("Feeds maps only explicit native community pages", () => {
  assert.equal(nativeCommunityFeed("https://www.reddit.com/r/German/"), "https://www.reddit.com/r/German/.rss");
  assert.equal(nativeCommunityFeed("https://reddit.com/r/German/new"), "https://www.reddit.com/r/German/new/.rss");
  assert.equal(nativeCommunityFeed("https://www.reddit.com/r/German/top/?t=week"), "https://www.reddit.com/r/German/top/.rss?t=week");
  assert.equal(nativeCommunityFeed("https://www.reddit.com/r/German/controversial?t=month"), "https://www.reddit.com/r/German/controversial/.rss?t=month");
  assert.equal(nativeCommunityFeed("https://www.v2ex.com/"), "https://www.v2ex.com/index.xml");
  assert.equal(nativeCommunityFeed("https://www.v2ex.com/?tab=tech"), "https://www.v2ex.com/feed/tab/tech.xml");
  assert.equal(nativeCommunityFeed("https://www.v2ex.com/go/python"), "https://www.v2ex.com/feed/python.xml");
  assert.equal(nativeCommunityFeed("https://linux.do/"), "https://linux.do/latest.rss");
  assert.equal(nativeCommunityFeed("https://linux.do/latest/"), "https://linux.do/latest.rss");
  assert.equal(nativeCommunityFeed("https://linux.do/c/develop/4"), "https://linux.do/c/develop/4.rss");
  assert.equal(nativeCommunityFeed("https://linux.do/t/example-topic/123"), "https://linux.do/t/example-topic/123.rss");

  for (const value of [
    "https://www.reddit.com/r/German/.rss",
    "https://www.v2ex.com/index.xml",
    "https://www.v2ex.com/feed/tab/tech.xml",
    "https://linux.do/latest.rss",
    "https://www.reddit.com/r/German/comments/123/post",
    "https://www.reddit.com/search?q=German",
    "https://www.reddit.com/r/German?sort=new",
    "https://www.reddit.com/r/German/top?t=week&after=token",
    "https://www.v2ex.com/t/123",
    "https://www.v2ex.com/?q=python",
    "https://linux.do/latest?order=created",
    "https://old.reddit.com/r/German/",
    "https://community.linux.do/",
    "http://www.v2ex.com/",
    "https://user:pass@www.v2ex.com/",
    "https://www.v2ex.com:444/",
  ]) assert.equal(nativeCommunityFeed(value), null, value);
});

test("Feeds tries native mappings before an unavailable community page", async () => {
  const calls = [];
  const found = await discoverNewsFeedDetails("https://www.reddit.com/r/German/", async (url) => {
    calls.push(url);
    if (url.endsWith("/.rss")) return testResource(testFeedBody, url);
    return testResource("blocked", url, 403);
  }, testResourceReader);
  assert.deepEqual(found, { url: "https://www.reddit.com/r/German/.rss", method: "native" });
  assert.deepEqual(calls, ["https://www.reddit.com/r/German/.rss"]);
});

test("Feeds leaves already-feed URLs direct", async () => {
  const url = "https://www.reddit.com/r/German/.rss";
  const calls = [];
  const found = await discoverNewsFeedDetails(url, async (value) => {
    calls.push(value);
    return testResource(testFeedBody, value);
  }, testResourceReader);
  assert.deepEqual(found, { url, method: "direct" });
  assert.deepEqual(calls, [url]);
});

test("Feeds continues past malformed and failed declared feed candidates", async () => {
  const page = "https://example.org/news";
  const html = [
    '<link rel="alternate" type="application/rss+xml" href="http://[invalid">',
    '<link rel="alternate" type="application/rss+xml" href="/failed.xml">',
    '<link rel="alternate" type="application/atom+xml" href="/valid.xml">',
  ].join("");
  const calls = [];
  const found = await discoverNewsFeedDetails(page, async (url) => {
    calls.push(url);
    if (url === page) return testResource(html, url);
    if (url.endsWith("failed.xml")) return testResource("unavailable", url, 500);
    return testResource(testFeedBody, url);
  }, testResourceReader);
  assert.deepEqual(found, { url: "https://example.org/valid.xml", method: "html" });
  assert.deepEqual(calls, [page, "https://example.org/failed.xml", "https://example.org/valid.xml"]);
});

test("Feeds deduplicates and caps declared feed candidates", async () => {
  const page = "https://example.org/news";
  const links = ["/feed-0.xml", "/feed-0.xml", ...Array.from({ length: 20 }, (_, index) => `/feed-${index + 1}.xml`)];
  const html = links.map((href) => `<link rel="alternate" type="application/rss+xml" href="${href}">`).join("");
  const calls = [];
  await assert.rejects(() => discoverNewsFeedDetails(page, async (url) => {
    calls.push(url);
    return testResource(url === page ? html : "not a feed", url);
  }, testResourceReader), /No RSS or Atom feed/);
  assert.equal(calls.filter((url) => url.endsWith("feed-0.xml")).length, 1);
  assert.equal(calls.length, 17, "one page plus at most sixteen candidates");
});

test("Feeds preserves safe protected-source errors and skips webpage fallback", async () => {
  for (const [status, message] of [
    [403, "This source does not allow feed access."],
    [429, "This source is rate limiting feed requests. Try again later."],
  ]) {
    let fallbackCalled = false;
    await assert.rejects(
      () => withNewsFeedFallback(
        () => discoverNewsFeedDetails("https://linux.do/", async (url) => testResource("blocked", url, status), testResourceReader),
        async () => { fallbackCalled = true; return null; },
      ),
      (error) => error instanceof NewsFeedDiscoveryError && error.status === status && error.message === message,
    );
    assert.equal(fallbackCalled, false);
  }

  let fallbackCalled = false;
  await assert.rejects(
    () => withNewsFeedFallback(
      () => discoverNewsFeedDetails("https://www.v2ex.com/", async (url) => testResource("unavailable", url, 500), testResourceReader),
      async () => { fallbackCalled = true; return null; },
    ),
    (error) => error instanceof NewsFeedDiscoveryError && error.message === "This community's native feed is unavailable.",
  );
  assert.equal(fallbackCalled, false);
  assert.equal(await withNewsFeedFallback(async () => { throw new Error("ordinary discovery failure"); }, async () => "fallback"), "fallback");
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


test("Feeds converts supported CSIS topic pages into stable RSS items", async () => {
  const html = await readFile(new URL("./fixtures/csis-topic.html", import.meta.url), "utf8");
  const url = "https://www.csis.org/topics/artificial-intelligence";
  const source = parseCsisTopicPage(html, url);

  assert.equal(canonicalCsisTopicUrl("https://csis.org/topics/artificial-intelligence/"), url);
  assert.equal(canonicalCsisTopicUrl(`${url}?page=1`), null);
  assert.equal(canonicalCsisTopicUrl("https://example.com/topics/artificial-intelligence"), null);
  assert.equal(source.title, "Artificial Intelligence & Policy | CSIS");
  assert.equal(source.description, "Research & analysis about AI.");
  assert.deepEqual(source.items.map(({ title, url: itemUrl }) => [title, itemUrl]), [
    ["AI & Public Policy", "https://www.csis.org/analysis/example-ai-report"],
    ["Podcast episode", "https://www.csis.org/podcasts/ai-policy-podcast/example-episode"],
  ]);
  assert.equal(source.items[0].summary, "A concise & useful summary.");
  assert.equal(source.items[0].published, Date.parse("October 7, 2026 12:00:00 UTC"));

  const rss = renderWebSourceRss(
    url, source, Date.parse("October 8, 2026 12:00:00 UTC"), Date.parse("October 7, 2026 23:59:59 UTC"),
  );
  assert.match(rss, /<rss version="2.0">/);
  assert.match(rss, /Artificial Intelligence &amp; Policy/);
  assert.match(rss, /<guid isPermaLink="true">https:\/\/www\.csis\.org\/analysis\/example-ai-report<\/guid>/);
  assert.equal((rss.match(/<item>/g) || []).length, 2);
});

test("Feeds excludes future web-source items after the current UTC day", () => {
  const now = Date.parse("October 7, 2026 10:30:00 UTC");
  const item = (id, published) => ({ id, title: id, url: `https://example.com/${id}`, published, summary: "Summary" });
  const source = {
    title: "Example",
    description: "Example articles",
    items: [
      item("tomorrow", Date.parse("October 8, 2026 00:00:00 UTC")),
      item("today-end", Date.parse("October 7, 2026 23:59:59.999 UTC")),
      item("today-start", Date.parse("October 7, 2026 00:00:00 UTC")),
    ],
  };

  assert.deepEqual(filterFutureWebSourceItems(source, now).items.map(({ id }) => id), ["today-end", "today-start"]);
  const rss = renderWebSourceRss("https://example.com/articles", source, now, now);
  assert.doesNotMatch(rss, /tomorrow/);
  assert.equal((rss.match(/<item>/g) || []).length, 2);
});

test("Feeds web sources stay private, cached, revocable, and Miniflux-backed", async () => {
  const management = await readFile(new URL("../app/lib/news-management.ts", import.meta.url), "utf8");
  const sources = await readFile(new URL("../app/lib/news-web-sources.ts", import.meta.url), "utf8");
  const token = await readFile(new URL("../app/lib/news-web-source-token.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/news/generated/[token]/route.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../app/lib/news-server.ts", import.meta.url), "utf8");
  const minifluxBackend = await readFile(new URL("../app/lib/news-miniflux-backend.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../app/feeds/feeds-reader.tsx", import.meta.url), "utf8");

  assert.match(management, /case "probeFeed"/);
  assert.match(management, /createWebSource\(userId, url\)/);
  assert.match(minifluxBackend, /feed_url:url/);
  assert.match(management, /deleteWebSource\(userId, source\.url\)/);
  assert.match(sources, /fetchPinnedNewsResource\(url\)/);
  assert.match(sources, /CACHE_TTL = 29 \* 60 \* 1000/);
  assert.match(sources, /if \(!cached\.updatedAt \|\| !cached\.source\.items\.length\) throw error/);
  assert.match(sources, /mode: 0o600/);
  assert.match(token, /createHmac\("sha256"/);
  assert.match(token, /timingSafeEqual/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(server, /newsReaderBackend\(\)\.feeds/);
  assert.match(minifluxBackend, /originalWebSourceUrl\(originalNewsFeedUrl/);
  assert.match(reader, /Check source/);
  assert.match(reader, /Supported webpage/);
  assert.match(reader, /sourceProbe\.items\.map/);
});

test("Feeds normalizes generic html2rss items with stable first-seen dates", () => {
  const now = Date.parse("October 7, 2026 10:30:00 UTC");
  const url = "https://example.org/articles/";
  const payload = {
    title: "Example &amp; updates",
    description: "Recent entries",
    items: [
      { id: "backend-id", url: "/first#fragment", title: "First <b>entry</b>", summary: "A &amp; B" },
      { id: "dated", url: "https://example.org/dated", title: "Dated", date_published: "2026-10-06T12:00:00Z" },
      { id: "unsafe", url: "javascript:alert(1)", title: "Unsafe" },
    ],
  };
  const first = normalizeHtml2rssFeed(payload, url, now);
  assert.equal(canonicalHtml2rssSourceUrl("https://EXAMPLE.org/articles#x"), null);
  assert.equal(canonicalHtml2rssSourceUrl("https://EXAMPLE.org/articles"), "https://example.org/articles");
  assert.deepEqual(first.items.map(({ id, title, published }) => [id, title, published]), [
    ["https://example.org/first", "First entry", now],
    ["https://example.org/dated", "Dated", Date.parse("2026-10-06T12:00:00Z")],
  ]);
  assert.equal(first.items[0].summary, "A & B");
  const refreshed = normalizeHtml2rssFeed(payload, url, now + 60_000, first);
  assert.equal(refreshed.items[0].published, now);
});

test("Feeds retains generated webpage items for exactly five days and rejects future UTC dates", () => {
  const now = Date.parse("October 7, 2026 10:30:00 UTC");
  const item = (id, published) => ({ id, title: id, url: `https://example.com/${id}`, published, summary: "" });
  const source = { title: "Example", description: "", items: [
    item("expired", now - 5 * 24 * 60 * 60 * 1000 - 1),
    item("boundary", now - 5 * 24 * 60 * 60 * 1000),
    item("today", now),
    item("tomorrow", Date.parse("October 8, 2026 00:00:00 UTC")),
  ] };
  assert.deepEqual(retainRecentWebSourceItems(source, now).items.map(({ id }) => id), ["boundary", "today"]);
});

test("Feeds keeps html2rss private and behind higher-precision discovery", async () => {
  const client = await readFile(new URL("../app/lib/news-html2rss.ts", import.meta.url), "utf8");
  const sources = await readFile(new URL("../app/lib/news-web-sources.ts", import.meta.url), "utf8");
  assert.match(client, /HTML2RSS_ACCESS_TOKEN/);
  assert.match(client, /api\.hostname !== "127\.0\.0\.1"/);
  assert.match(client, /AbortSignal\.timeout\(HTML2RSS_REQUEST_TIMEOUT_MS\)/);
  assert.match(sources, /adapter: "csis-topic-v1" \| "html2rss-v1"/);
  assert.ok(sources.indexOf("canonicalCsisTopicUrl(value)") < sources.indexOf("canonicalHtml2rssSourceUrl(value)"));
  assert.match(sources, /abnormally small batch/);
});

test("Feeds routes reader operations through a backend boundary", async () => {
  const boundary = await readFile(new URL("../app/lib/news-reader-backend.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../app/lib/news-server.ts", import.meta.url), "utf8");
  const management = await readFile(new URL("../app/lib/news-management.ts", import.meta.url), "utf8");
  assert.match(boundary, /interface NewsReaderBackend/);
  for (const operation of ["categories", "feeds", "articles", "createCategory", "renameCategory", "deleteCategory", "subscribe", "editFeed", "unsubscribe"]) {
    assert.match(boundary, new RegExp(`${operation}\\(`));
  }
  assert.match(server, /newsReaderBackend\(\)\.articles/);
  assert.match(management, /newsReaderBackend\(\)\.subscribe/);
  assert.match(boundary, /return minifluxReaderBackend/);
});

test("Miniflux backend keeps the five-day dashboard contract", async () => {
  const backend = await readFile(new URL("../app/lib/news-miniflux-backend.ts", import.meta.url), "utf8");
  assert.match(backend, /api\.hostname !== "127\.0\.0\.1"/);
  assert.match(backend, /published_after=\$\{cutoff\}/);
  assert.match(backend, /published_before=\$\{tomorrow\}/);
  assert.match(backend, /X-Auth-Token/);
  assert.doesNotMatch(backend, /is_read|starred|notification/);
  assert.match(backend, /id: `feed\/\$\{feed\.id\}`/);
});
