import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../app/lib/session-idle.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../app/site-auth.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const loaded = { exports: {} };
new Function("module", "exports", compiled.outputText)(loaded, loaded.exports);
const idle = loaded.exports;

const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("sign-in idles out after exactly seven days without use, like CloudCLI", () => {
  assert.equal(idle.SESSION_IDLE_LIMIT_MS, 7 * DAY);
  const now = 1_800_000_000_000;
  assert.equal(idle.isIdleExpired(now - 7 * DAY, now), false);
  assert.equal(idle.isIdleExpired(now - 7 * DAY - 1, now), true);
  assert.equal(idle.isIdleExpired(null, now), false, "a missing marker never signs the owner out");
});

test("activity marker round-trips and tolerates broken or missing storage", () => {
  const storage = memoryStorage();
  assert.equal(idle.readLastActive(storage), null);
  idle.markActive(123456, storage);
  assert.equal(idle.readLastActive(storage), 123456);
  storage.setItem(idle.SESSION_ACTIVITY_KEY, "garbage");
  assert.equal(idle.readLastActive(storage), null);
  idle.clearActivity(storage);
  assert.equal(storage.getItem(idle.SESSION_ACTIVITY_KEY), null);

  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(idle.readLastActive(throwing), null);
  assert.doesNotThrow(() => idle.markActive(1, throwing));
  assert.doesNotThrow(() => idle.clearActivity(throwing));
  assert.equal(idle.readLastActive(null), null);
});

test("site auth checks the idle limit before refreshing activity and revokes expired sessions", () => {
  const syncStart = auth.indexOf("const syncUser = useCallback");
  const check = auth.indexOf("isIdleExpired(readLastActive())", syncStart);
  const mark = auth.indexOf("markActive(); signedIn.current = true;", syncStart);
  assert.ok(check > syncStart && mark > check, "the idle check must run before the marker is refreshed");
  assert.match(auth, /await supabase\.auth\.signOut\(\)/);
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/, "offline sign-out still clears this device");
  assert.match(auth, /document\.visibilityState !== "visible"/, "hidden tabs must not keep the session alive");
  assert.match(auth, /markActive\(\); \/\/ a fresh sign-in/);
});
