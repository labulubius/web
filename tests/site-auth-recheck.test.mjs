import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/site-auth.tsx", import.meta.url), "utf8");
const require = createRequire(new URL("../app/site-auth.tsx", import.meta.url));
const compiled = ts.transpileModule(source, {
  fileName: "site-auth.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

// Run the real SiteAuthProvider once with minimal hooks, timers and an in-memory Supabase
// client, so auth events can be replayed without a browser or network.
function mount({ rpc = async () => ({ data: true, error: null }) } = {}) {
  const state = [];
  const loadingLog = [];
  const effects = [];
  const timers = [];
  let listener = null;
  let index = 0;
  const react = {
    createContext: () => ({ Provider: () => null }),
    useContext: () => null,
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => { effects.push(effect); },
    useState: (initial) => {
      const slot = index++;
      state[slot] = initial;
      return [initial, (next) => {
        state[slot] = typeof next === "function" ? next(state[slot]) : next;
        if (slot === 2) loadingLog.push(state[slot]);
      }];
    },
  };
  const auth = {
    rpc: (name) => { assert.equal(name, "site_is_admin"); return rpc(); },
    auth: {
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
      onAuthStateChange: (callback) => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
    },
  };
  const localRequire = (name) => {
    if (name === "react") return react;
    if (name === "./accessible-dialog") return { AccessibleDialog: () => null };
    if (name === "./lib/session-idle") return { clearActivity() {}, isIdleExpired: () => false, markActive() {}, readLastActive: () => null };
    if (name === "./lib/supabase") return { getSupabaseBrowserClient: () => auth };
    return require(name);
  };
  const window = {
    setTimeout: (callback) => timers.push(callback),
    clearTimeout() {}, setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  };
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", compiled)(localRequire, loaded, loaded.exports, window, document);
  loaded.exports.SiteAuthProvider({ children: null });
  for (const effect of effects) effect();

  async function settle() {
    for (let round = 0; round < 10; round++) {
      while (timers.length) timers.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  const view = () => ({ user: state[0], isAdmin: state[1], loading: state[2], authError: state[3] });
  return { settle, view, loadingLog, emit: (event, session) => listener(event, session) };
}

test("returning to the tab rechecks the same owner without showing the loading screen", async () => {
  const site = mount();
  await site.settle();
  const owner = site.view().user;
  assert.deepEqual(site.view(), { user: { id: "owner" }, isAdmin: true, loading: false, authError: "" });

  // Supabase emits these with a fresh session object when the tab becomes visible again.
  site.loadingLog.length = 0;
  site.emit("SIGNED_IN", { user: { id: "owner" } });
  site.emit("TOKEN_REFRESHED", { user: { id: "owner" } });
  await site.settle();
  assert.ok(!site.loadingLog.includes(true), "a recheck must not unmount pages such as Nav's open editor");
  assert.equal(site.view().user, owner, "the same user object keeps user-keyed effects still");
  assert.equal(site.view().isAdmin, true);
});

test("a failed background recheck keeps the owner signed in", async () => {
  let fail = false;
  const site = mount({ rpc: async () => fail ? { data: null, error: new Error("offline") } : { data: true, error: null } });
  await site.settle();
  fail = true;
  site.loadingLog.length = 0;
  site.emit("SIGNED_IN", { user: { id: "owner" } });
  await site.settle();
  assert.ok(!site.loadingLog.includes(true));
  assert.deepEqual(site.view(), { user: { id: "owner" }, isAdmin: true, loading: false, authError: "" });
});

// Render the real OwnerGate against a chosen auth state.
const gateSource = readFileSync(new URL("../app/owner-access.tsx", import.meta.url), "utf8");
const gateCompiled = ts.transpileModule(gateSource, {
  fileName: "owner-access.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function gate(auth) {
  const loaded = { exports: {} };
  const localRequire = (name) => name === "./site-auth"
    ? { useSiteAuth: () => ({ isAdmin: false, loading: false, authError: "", retryAuth() {}, ...auth }) }
    : require(name);
  new Function("require", "module", "exports", gateCompiled)(localRequire, loaded, loaded.exports);
  const { OwnerGate } = loaded.exports;
  return renderToStaticMarkup(createElement(OwnerGate, { icon: null, title: "Nav" }, createElement("form", { id: "editor" })));
}

test("OwnerGate is the shared gate: children only for a verified owner", () => {
  assert.match(gate({ isAdmin: true }), /<form id="editor">/);
  assert.match(gate({ loading: true }), /Checking your account…/);
  assert.match(gate({ authError: "Account permissions could not be verified." }), /Nav is temporarily unavailable\.[\s\S]*Retry/);
  assert.match(gate({}), /Sign in to continue\./);
  for (const auth of [{ loading: true }, { authError: "x", isAdmin: true }, {}]) assert.doesNotMatch(gate(auth), /<form id="editor">/);
});

test("every owner-only page uses OwnerGate instead of its own auth branches", () => {
  for (const path of ["../app/nav/nav-directory.tsx", "../app/tasks/task-manager.tsx"]) {
    const page = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(page, /<OwnerGate /, path);
    assert.doesNotMatch(page, /loading: authLoading|authError|retryAuth|<OwnerAccess |HomeAccess/, path);
  }
});

test("a recheck still applies revoked admin rights, a different user and sign-out", async () => {
  let admin = true;
  const site = mount({ rpc: async () => ({ data: admin, error: null }) });
  await site.settle();

  admin = false;
  site.emit("TOKEN_REFRESHED", { user: { id: "owner" } });
  await site.settle();
  assert.equal(site.view().isAdmin, false);

  admin = true;
  site.loadingLog.length = 0;
  site.emit("SIGNED_IN", { user: { id: "someone-else" } });
  await site.settle();
  assert.ok(site.loadingLog.includes(true), "a different account gets a full check");
  assert.deepEqual(site.view().user, { id: "someone-else" });

  site.emit("SIGNED_OUT", null);
  await site.settle();
  assert.deepEqual(site.view(), { user: null, isAdmin: false, loading: false, authError: "" });
});
