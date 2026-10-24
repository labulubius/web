import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(file, imports, environment = process) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", code)((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), exports, environment);
  return exports;
}

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const defaults = ["all", "important", "gantt"];

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "task-navigation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = compile("app/api/tasks/navigation-order/storage.ts", { "server-only": {} }, {
    env: { TASKS_DATA_DIR: root }, cwd: () => process.cwd(),
  });
  return { root, ...storage };
}

test("task navigation preferences default and persist independently per account", async (t) => {
  const api = await fixture(t);
  assert.deepEqual(await api.loadNavigationOrder(userA), defaults);
  const orderA = ["gantt", "all", "important"];
  const orderB = ["important", "gantt", "all"];
  await api.saveNavigationOrder(userA, orderA);
  await api.saveNavigationOrder(userB, orderB);
  assert.deepEqual(await api.loadNavigationOrder(userA), orderA);
  assert.deepEqual(await api.loadNavigationOrder(userB), orderB);
  const directory = path.join(api.root, "preferences");
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  const file = path.join(directory, `${userA}.navigation.json`);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, order: orderA });
});

test("task navigation order validation requires the stable exact ID set", async (t) => {
  const api = await fixture(t);
  for (const value of [
    ["all", "important"],
    ["all", "important", "important"],
    ["all", "important", "calendar"],
    ["all", "important", "gantt", "unknown"],
    { all: true },
  ]) {
    assert.throws(() => api.parseNavigationOrder(value), /Invalid task navigation order/);
    await assert.rejects(api.saveNavigationOrder(userA, value), /Invalid task navigation order/);
  }
  assert.deepEqual(api.parseNavigationOrder(["gantt", "important", "all"]), ["gantt", "important", "all"]);
});

test("malformed, oversized, permissive, and symlinked preference files fail safely", async (t) => {
  const api = await fixture(t);
  await api.loadNavigationOrder(userA);
  const directory = path.join(api.root, "preferences");
  const file = path.join(directory, `${userA}.navigation.json`);
  for (const contents of ["not json", JSON.stringify({ version: 1, order: ["all", "all", "gantt"] }), "x".repeat(1025)]) {
    await writeFile(file, contents, { mode: 0o600 });
    await assert.rejects(api.loadNavigationOrder(userA), /Stored task navigation preference is invalid/);
  }
  await writeFile(file, JSON.stringify({ version: 1, order: defaults }), { mode: 0o600 });
  await chmod(file, 0o644);
  await assert.rejects(api.loadNavigationOrder(userA), /Stored task navigation preference is invalid/);
  await rm(file);
  await symlink(path.join(directory, "missing.json"), file);
  await assert.rejects(api.loadNavigationOrder(userA));
  await assert.rejects(api.saveNavigationOrder(userA, defaults), /Invalid task navigation preference file/);
});

test("serialized writes leave one complete atomic preference", async (t) => {
  const api = await fixture(t);
  const first = ["gantt", "all", "important"];
  const second = ["important", "all", "gantt"];
  await Promise.all([api.saveNavigationOrder(userA, first), api.saveNavigationOrder(userA, second)]);
  assert.deepEqual(await api.loadNavigationOrder(userA), second);
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(api.root, "preferences")));
  assert.deepEqual(entries, [`${userA}.navigation.json`]);
});

test("task preference storage rejects a symlink directory", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "task-navigation-link-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const target = path.join(parent, "target");
  const linked = path.join(parent, "linked");
  await mkdir(target);
  await symlink(target, linked);
  const storage = compile("app/api/tasks/navigation-order/storage.ts", { "server-only": {} }, {
    env: { TASKS_DATA_DIR: linked }, cwd: () => process.cwd(),
  });
  await assert.rejects(storage.loadNavigationOrder(userA), /Invalid task preference storage directory/);
});

test("navigation API uses verified account identity, bounded bodies, and private responses", async () => {
  const calls = [];
  class InvalidNavigationOrder extends Error {}
  let authenticated = { user: { id: userA } };
  const route = compile("app/api/tasks/navigation-order/route.ts", {
    "./auth": { requireNavigationAdmin: async () => authenticated },
    "./storage": {
      InvalidNavigationOrder,
      navigationPrivateHeaders: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      loadNavigationOrder: async (id) => { calls.push(["load", id]); return defaults; },
      saveNavigationOrder: async (id, order) => { calls.push(["save", id, order]); if (!Array.isArray(order)) throw new InvalidNavigationOrder("Invalid task navigation order."); return order; },
    },
  });
  const get = await route.GET(new Request("https://example.test/api/tasks/navigation-order"));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await get.json(), { order: defaults });
  const put = await route.PUT(new Request("https://example.test/api/tasks/navigation-order", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: ["gantt", "all", "important"], userId: userB }),
  }));
  assert.equal(put.status, 200);
  assert.deepEqual(calls, [["load", userA], ["save", userA, ["gantt", "all", "important"]]]);
  const tooLarge = await route.PUT(new Request("https://example.test/api/tasks/navigation-order", {
    method: "PUT", headers: { "content-length": "1025" }, body: "{}",
  }));
  assert.equal(tooLarge.status, 413);
  authenticated = null;
  assert.equal((await route.GET(new Request("https://example.test/api/tasks/navigation-order"))).status, 401);
});

test("navigation route owns Supabase verification and secure filesystem persistence", async () => {
  const auth = await readFile("app/api/tasks/navigation-order/auth.ts", "utf8");
  const route = await readFile("app/api/tasks/navigation-order/route.ts", "utf8");
  const storage = await readFile("app/api/tasks/navigation-order/storage.ts", "utf8");
  assert.match(auth, /auth\.getUser\(token\)/);
  assert.match(auth, /rpc\("site_is_admin"\)/);
  assert.match(route, /auth\.user\.id/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /MAX_BODY_BYTES/);
  assert.match(storage, /TASKS_DATA_DIR/);
  assert.match(storage, /preferences/);
  assert.match(storage, /O_NOFOLLOW/);
  assert.match(storage, /O_EXCL/);
  assert.match(storage, /await handle\.sync\(\)/);
  assert.match(storage, /await rename\(/);
  assert.match(storage, /pendingWrites/);
  assert.doesNotMatch(route, /userId/);
});
