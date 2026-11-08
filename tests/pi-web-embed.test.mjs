import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("/pi-web keeps the embedded agent mounted across main-site navigation", async () => {
  const layout = await read("app/layout.tsx");
  const keeper = await read("app/persistent-agent.tsx");
  const page = await read("app/pi-web/page.tsx");
  assert.match(layout, /<PersistentAgent>\{children\}<\/PersistentAgent>/);
  assert.match(keeper, /from "\.\/pi-web\/agent-frame"/);
  assert.match(keeper, /pathname === "\/pi-web"/);
  assert.match(keeper, /const shouldMountAgent = agentMounted \|\| isAgentRoute/);
  assert.match(keeper, /hidden=\{!isAgentRoute\}/);
  assert.match(keeper, /<AgentFrame \/>/);
  assert.doesNotMatch(page, /<AgentFrame \/>|redirect\(/);
});

test("owner authentication uses the backend hostname without exposing the bearer token in the frame URL", async () => {
  const source = await read("app/pi-web/agent-frame.tsx");
  assert.match(source, /const AGENT_ORIGIN = "https:\/\/pi-web\.labulubius\.com"/);
  assert.doesNotMatch(source, /https:\/\/pi\.labulubius\.com/);
  assert.match(source, /\/api\/owner-auth/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /credentials: "include"/);
  assert.match(source, /src=\{frameUrl\}/);
  assert.doesNotMatch(source, /src=.*access_token/);
  assert.match(source, /if \(loading \|\| !user \|\| !isAdmin\) return;/);
});

test("owner-session restoration and background refresh do not unmount an active frame", async () => {
  const source = await read("app/pi-web/agent-frame.tsx");
  const ready = source.indexOf('if (connection === "ready" && user && isAdmin)');
  const checking = source.indexOf("if (loading || authError || !user || !isAdmin)");
  assert.notEqual(ready, -1);
  assert.ok(ready < checking);
  assert.match(source, /hasAgentSessionHint\(\) \? "ready" : "idle"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /rememberAgentSession\(true\)/);
  assert.match(source, /<PiWebFrame generation=\{frameGeneration\} src=\{frameUrl\} \/>/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "connecting"\)/);
  assert.match(source, /setConnection\(\(current\) => current === "ready" \? current : "error"\)/);
});

test("main-site sign-out clears the hint and remote owner session", async () => {
  const source = await read("app/pi-web/agent-frame.tsx");
  assert.match(source, /if \(loading \|\| user \|\| authError \|\| !hasAgentSessionHint\(\)\) return;/);
  assert.match(source, /rememberAgentSession\(false\)/);
  assert.match(source, /method: "DELETE"/);
});

test("handoffs stay inside the frame and permission failures stay on /pi-web", async () => {
  const source = await read("app/pi-web/agent-frame.tsx");
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("handoff"\)/);
  assert.match(source, /prompt=\$\{encodeURIComponent\(handoff\)\}/);
  assert.match(source, /if \(loading \|\| authError \|\| !user \|\| !isAdmin\)/);
  assert.match(source, /return <PiWebFrame \/>/);
  assert.match(source, /<SiteShell active="\/pi-web" title="Pi Web"/);
  assert.doesNotMatch(source, /window\.location\.(?:href|assign|replace)/);
});
