import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const configured = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key" };

// Load the real helper with an in-memory Supabase client so no network is used.
function load({ user = { id: "admin" }, userError = null, role = true, roleError = null, env = configured } = {}) {
  const calls = [];
  const supabase = {
    auth: { getUser: async (token) => { calls.push(["getUser", token]); return { data: { user: userError ? null : user }, error: userError }; } },
    rpc: async (name) => { calls.push(["rpc", name]); return { data: roleError ? null : role, error: roleError }; },
  };
  const imports = {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (url, key, options) => { calls.push(["createClient", url, key, options.global.headers.Authorization]); return supabase; } },
  };
  const code = ts.transpileModule(readFileSync("app/lib/admin-auth.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", code)((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), exports, { env });
  return { ...exports, calls, supabase };
}

const request = (authorization) => new Request("https://example.test/api", authorization ? { headers: { authorization } } : {});

test("site admin check accepts a verified administrator token and returns a caller-scoped client", async () => {
  const auth = load();
  const result = await auth.requireSiteAdmin(request("Bearer token-1"));
  assert.deepEqual(result.user, { id: "admin" });
  assert.equal(result.supabase, auth.supabase);
  assert.deepEqual(auth.calls, [
    ["createClient", configured.NEXT_PUBLIC_SUPABASE_URL, configured.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Bearer token-1"],
    ["getUser", "token-1"],
    ["rpc", "site_is_admin"],
  ]);
});

test("site admin check rejects missing, malformed, invalid and non-admin credentials", async () => {
  for (const header of [undefined, "token-1", "Basic token-1", "Bearer "]) {
    const auth = load();
    assert.equal(await auth.requireSiteAdmin(request(header)), null, String(header));
    assert.deepEqual(auth.calls, [], "no Supabase call without a bearer token");
  }
  assert.equal(await load({ userError: new Error("expired") }).requireSiteAdmin(request("Bearer t")), null);
  assert.equal(await load({ user: null }).requireSiteAdmin(request("Bearer t")), null);
  assert.equal(await load({ role: false }).requireSiteAdmin(request("Bearer t")), null);
  assert.equal(await load({ role: "true" }).requireSiteAdmin(request("Bearer t")), null);
  assert.equal(await load({ roleError: new Error("rpc failed") }).requireSiteAdmin(request("Bearer t")), null);
});

test("site admin check fails loudly when Supabase is not configured", async () => {
  await assert.rejects(load({ env: {} }).requireSiteAdmin(request("Bearer t")), /Supabase is not configured/);
});

test("every management API uses the shared site admin check", () => {
  for (const file of [
    "app/api/tasks/route.ts", "app/api/tasks/[id]/route.ts", "app/api/tasks/projects/route.ts",
    "app/api/tasks/projects/[id]/route.ts", "app/api/tasks/navigation-order/route.ts", "app/api/nav/icon/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /import \{ requireSiteAdmin \} from "(?:\.\.\/)+lib\/admin-auth"/, file);
    assert.doesNotMatch(source, /createClient\(|site_is_admin/, `${file} must not re-implement the check`);
  }
});
