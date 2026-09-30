import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fitsStorageQuota, STORAGE_TOTAL_BYTES } from "../app/lib/storage-quota.ts";
import { GET as health } from "../app/api/health/route.ts";
import nextConfig from "../next.config.ts";

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
