import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { agentHandoffPath, pdfToEpubHandoff } from "../app/lib/agent-handoff.ts";
import { GET as health } from "../app/api/health/route.ts";
import { addDays, dateRange, daysBetween, maximumRangeEnd, monthEnd, monthStart, shiftMonth, validTimelineRange } from "../app/tasks/task-calendar.ts";
import { reorderTaskProjects } from "../app/tasks/project-order.ts";
import nextConfig from "../next.config.ts";

test("Tasks uses a prerendered client shell like Navigator while private data stays behind its API", async () => {
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /force-dynamic/);
  assert.match(home, /<TaskManager \/>/);
});

test("PDF handoff carries a private structured reference into Agent", () => {
  const prompt = pdfToEpubHandoff("drive", "Books/中文扫描.pdf", "中文扫描.pdf", 1234);
  assert.match(prompt, /^\/skill:pdf-to-epub/);
  assert.match(prompt, /<pi-file-reference>/);
  assert.match(prompt, /"source":"drive"/);
  assert.match(prompt, /"remote":"Books\/中文扫描.pdf"/);
  const path = agentHandoffPath(prompt);
  assert.ok(path.startsWith("/pi?handoff="));
  assert.equal(decodeURIComponent(path.split("=", 2)[1]), prompt);
  assert.throws(() => pdfToEpubHandoff("drive", "", "book.pdf", 1), /Invalid/);
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
  assert.ok(manager.indexOf('label: "All tasks"') < manager.indexOf('label: "Gantt"'));
  assert.doesNotMatch(manager, /<span>Archive<\/span>|ArchiveIcon/);
  assert.match(server, /id === TASK_ARCHIVE_PROJECT_ID/);
  assert.match(manager, /storedView === "inbox" \? "all"/);
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
  assert.match(server, /version: 5/);
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

test("health response is minimal and not cached", async () => {
  const response = health();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("production health checks distinguish retired Drive from live services", async () => {
  const script = await readFile(new URL("../scripts/health-check.sh", import.meta.url), "utf8");
  assert.match(script, /MAIN_ORIGIN:-https:\/\/labulubius\.com/);
  assert.doesNotMatch(script, /\$\{DRIVE_ORIGIN:/);
  assert.match(script, /RETIRED_DRIVE_HOSTNAME/);
  assert.doesNotMatch(script, /RETIRED_DRIVE_ORIGIN/);
  assert.match(script, /NXDOMAIN/);
  assert.match(script, /status.*404/);
  assert.match(script, /AGENT_ORIGIN:-https:\/\/pi\.labulubius\.com/);
  assert.match(script, /\$main_origin\/feeds/);
  assert.match(script, /\$main_origin\/api\/news/);
  assert.doesNotMatch(script, /FEEDS_ORIGIN/);
});

test("global headers include baseline browser protections", async () => {
  const rules = await nextConfig.headers();
  const headers = new Map(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(headers.get("content-security-policy"), /frame-src https:\/\/pi\.labulubius\.com/);
  assert.match(headers.get("content-security-policy"), /connect-src[^;]*https:\/\/pi\.labulubius\.com/);
  assert.doesNotMatch(headers.get("content-security-policy"), /share\.labulubius\.com/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.ok(headers.has("referrer-policy"));
  assert.ok(headers.has("permissions-policy"));
  const cacheResetRule = rules.find(({ source, has }) => source === "/" && has?.some(({ type, key }) => type === "query" && key === "v"));
  const homeHeaders = new Map(cacheResetRule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(homeHeaders.get("clear-site-data"), '"cache"');
});

test("agent page exchanges the Supabase bearer token without putting it in the iframe URL", async () => {
  const source = await readFile(new URL("../app/pi/agent-frame.tsx", import.meta.url), "utf8");
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
  const source = await readFile(new URL("../app/pi/agent-frame.tsx", import.meta.url), "utf8");
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
  const source = await readFile(new URL("../app/pi/agent-frame.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(loading \|\| user \|\| authError \|\| !hasAgentSessionHint\(\)\) return;/);
  assert.match(source, /rememberAgentSession\(false\)/);
  assert.match(source, /method: "DELETE"/);
});

test("agent iframe stays mounted across workspace route changes", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const keeper = await readFile(new URL("../app/persistent-agent.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/pi/page.tsx", import.meta.url), "utf8");

  assert.match(layout, /<PersistentAgent>\{children\}<\/PersistentAgent>/);
  assert.match(keeper, /const shouldMountAgent = agentMounted \|\| isAgentRoute/);
  assert.match(keeper, /hidden=\{!isAgentRoute\}/);
  assert.match(keeper, /<AgentFrame \/>/);
  assert.doesNotMatch(page, /<AgentFrame \/>/);
});

test("owner-only destinations remain visible and show access guidance", async () => {
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");
  const agent = await readFile(new URL("../app/pi/agent-frame.tsx", import.meta.url), "utf8");
  const access = await readFile(new URL("../app/owner-access.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(sidebar, /href="\/drive"/);
  assert.doesNotMatch(sidebar, /href="\/share"/);
  assert.match(sidebar, /href="\/pi"/);
  assert.doesNotMatch(sidebar, /href="\/note"/);
  assert.doesNotMatch(sidebar, /isAdmin && <Link href="\/(?:drive|share|agent)"/);
  assert.match(agent, /if \(loading \|\| authError \|\| !user \|\| !isAdmin\)/);
  assert.match(agent, /return <PiWebFrame \/>/);
  assert.doesNotMatch(agent, /Use Sign in in the top toolbar/);
  assert.match(agent, /<SiteShell active="\/pi"/);
  assert.doesNotMatch(access, /AccountControl/);
  assert.match(shell, /<AccountControl \/>/);
  assert.doesNotMatch(shell, /href: "\/(?:share|note)"/);
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

  assert.match(shell, /hasSidebar && <button/);
  assert.match(home, /title="Home" hasSidebar/);
  await assert.rejects(access(new URL("../app/share/page.tsx", import.meta.url)), { code: "ENOENT" });
});

test("Navigator is owner-only and has no obsolete guest visibility controls", async () => {
  const directory = await readFile(new URL("../app/nav/nav-directory.tsx", import.meta.url), "utf8");
  const types = await readFile(new URL("../app/nav/sites.ts", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/nav/layout.tsx", import.meta.url), "utf8");
  const privateMigration = await readFile(new URL("../supabase/migrations/202610220001_private_navigator.sql", import.meta.url), "utf8");
  const cleanupMigration = await readFile(new URL("../supabase/migrations/202610300001_remove_navigator_visibility.sql", import.meta.url), "utf8");

  assert.match(directory, /if \(authLoading \|\| !isAdmin\) return;/);
  assert.match(directory, /<OwnerAccess icon=\{<Compass size=\{32\} \/>\} title="Navigator"/);
  assert.doesNotMatch(directory, /Visible to guests|supportsCategoryVisibility|is_published/);
  assert.doesNotMatch(types, /is_published/);
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
  assert.match(privateMigration, /drop policy if exists "published navigator categories are public"/);
  assert.match(privateMigration, /drop policy if exists "published navigator sites are public"/);
  assert.doesNotMatch(privateMigration, /create policy/);
  assert.match(cleanupMigration, /alter table public\.navigator_categories\s+drop column if exists is_published/);
  assert.match(cleanupMigration, /alter table public\.navigator_sites\s+drop column if exists is_published/);
});

test("Navigator icon imports use a public fallback without exposing managed URLs as custom sources", async () => {
  const directory = await readFile(new URL("../app/nav/nav-directory.tsx", import.meta.url), "utf8");
  const iconRoute = await readFile(new URL("../app/api/nav/icon/route.ts", import.meta.url), "utf8");

  assert.match(iconRoute, /https:\/\/icons\.duckduckgo\.com\/ip3\/\$\{new URL\(finalSiteUrl\)\.hostname\}\.ico/);
  assert.match(directory, /Custom icon source URL/);
  assert.doesNotMatch(directory, /name="icon_url"[^>]*defaultValue=/);
});

test("sidebar create and delete actions share a trailing axis", async () => {
  const tasks = await readFile(new URL("../app/tasks/tasks.css", import.meta.url), "utf8");
  const navigator = await readFile(new URL("../app/nav/nav.css", import.meta.url), "utf8");
  const directory = await readFile(new URL("../app/nav/nav-directory.tsx", import.meta.url), "utf8");

  for (const stylesheet of [tasks, navigator]) assert.match(stylesheet, /margin: 8px 4px 5px 9px/);
  assert.match(tasks, /\.tasks-project-list > div \{[^}]*min-width: 0/);
  assert.match(navigator, /\.category-row \{[^}]*min-width: 0/);
  assert.match(directory, /isAdmin \? <Folder size=\{16\}/);
  assert.match(directory, /onDragStart=\{\(\) => \{ blockSiteOpen\.current = true; \}\}/);
  assert.match(directory, /onPointerDownCapture=\{\(\) => \{ blockSiteOpen\.current = false; \}\}/);
  assert.match(directory, /onClickCapture=\{\(event\) => \{/);
  assert.match(directory, /event\.target\.closest\(\"\.site-card-link\"\)/);
  assert.match(directory, /event\.preventDefault\(\);/);
  assert.doesNotMatch(directory, /blockSiteOpenUntil|didDrag|onPointerInteraction|shouldBlockOpen|GripVertical/);
});

test("retired Feeds route, API, navigation, and modules stay absent", async () => {
  const shell = await readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../app/places-sidebar.tsx", import.meta.url), "utf8");
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  for (const name of ["app/feeds", "app/api/news", "app/lib/news-server.ts", "app/lib/news-watchboards.ts", "app/lib/concise-summary.ts", "app/lib/watchboard-order.ts", "NEWS.md", "deploy/miniflux", "deploy/html2rss"]) {
    await assert.rejects(access(new URL(`../${name}`, import.meta.url)), { code: "ENOENT" });
  }
  assert.doesNotMatch(shell, /\/feeds|Rss/);
  assert.doesNotMatch(sidebar, /\/feeds|Rss/);
  assert.doesNotMatch(globals, /news-/);
  assert.doesNotMatch(proxy, /retired-drive|isRetiredDriveRequest/);
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
