import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.ok(headers.has("referrer-policy"));
  assert.ok(headers.has("permissions-policy"));
});
