import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const shell = readFileSync(new URL("../app/site-shell.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../app/site-auth.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const require = createRequire(new URL("../app/site-auth.tsx", import.meta.url));

// Render the real AccountControl with an in-memory auth context, without calling
// Supabase or adding test-only exports to the production component.
const compiled = ts.transpileModule(`${auth}\nexport { SiteAuthContext };`, {
  fileName: "site-auth.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});
const loaded = { exports: {} };
const localRequire = (name) => {
  if (name === "./accessible-dialog") return { AccessibleDialog: () => null };
  if (name === "./lib/supabase") return { getSupabaseBrowserClient: () => { throw new Error("Unexpected network client"); } };
  return require(name);
};
new Function("require", "module", "exports", compiled.outputText)(localRequire, loaded, loaded.exports);
const { AccountControl, SiteAuthContext } = loaded.exports;

function account(value) {
  return renderToStaticMarkup(createElement(SiteAuthContext.Provider, {
    value: { supabase: {}, user: null, isAdmin: false, loading: false, authError: "", retryAuth() {}, ...value },
  }, createElement(AccountControl)));
}

test("toolbar shell icons share an 18px size without changing navigation", () => {
  const sizes = [...shell.matchAll(/size=\{(\d+)\}/g)].map((match) => Number(match[1]));
  assert.equal(sizes.length, 4);
  assert.ok(sizes.every((size) => size === 18));
  for (const route of ["/", "/nav", "/feeds", "/agent", "/about"]) assert.ok(shell.includes(`href: "${route}"`));
  assert.match(shell, /aria-current=\{active === href \? "page" : undefined\}/);
});

for (const [name, value, label, iconCount, disabled] of [
  ["signed out", {}, "Sign in", 1, false],
  ["initial loading", { loading: true }, "Checking account", 1, true],
  ["owner", { user: {}, isAdmin: true }, "Sign out", 2, false],
  ["read-only user", { user: {}, isAdmin: false }, "Sign out", 2, false],
  ["owner rechecking", { user: {}, isAdmin: true, loading: true }, "Checking account", 2, true],
  ["auth error", { authError: "Account service is temporarily unavailable." }, "Sign in", 1, false],
]) {
  test(`account toolbar: ${name} retains a name, tooltip and uniform icons`, () => {
    const html = account(value);
    assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.match(html, /title="[^"]+"/);
    const icons = [...html.matchAll(/<svg\b[^>]*>/g)].map(([tag]) => tag);
    assert.equal(icons.length, iconCount);
    for (const tag of icons) {
      assert.match(tag, /width="18"/);
      assert.match(tag, /height="18"/);
      assert.match(tag, /stroke-width="2"/);
    }
    assert.equal(/disabled=""/.test(html), disabled);
    if (value.user) assert.match(html, value.isAdmin ? /Owner|Checking…/ : /Read only/);
  });
}

test("toolbar dimensions preserve the frame and center mobile controls", () => {
  const desktop = styles.split("@media (max-width: 760px)")[0];
  const mobile = styles.split("@media (max-width: 760px)")[1].split("@media (prefers-reduced-motion")[0];
  assert.match(desktop, /\.tool-bar \{[^}]*min-height: 48px/);
  assert.match(desktop, /\.tool-bar svg \{ flex: none; \}/);
  assert.match(desktop, /\.sidebar-toggle \{[^}]*align-self: center[^}]*justify-content: center[^}]*min-height: 47px/);
  for (const selector of ["account-control", "theme-control"]) {
    assert.match(desktop, new RegExp(`\\.${selector} \\{[^}]*gap: 6px; height: 32px;`));
  }
  assert.match(mobile, /\.tool-bar \{ height: 43px; min-height: 43px; \}/);
  assert.match(mobile, /\.tool-bar nav a \{[^}]*height: 34px; justify-content: center; min-width: 43px/);
  assert.match(mobile, /\.mobile-sidebar-toggle \{[^}]*height: 34px; min-height: 34px; min-width: 43px; width: 43px/);
  assert.match(mobile, /\.account-control, \.theme-control \{[^}]*height: 34px; justify-content: center; padding: 0; width: 34px/);
  assert.match(mobile, /\.account-control > svg:last-child:not\(:first-child\) \{ display: none; \}/);
});
