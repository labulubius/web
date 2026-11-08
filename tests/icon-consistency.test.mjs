import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inbox } from "lucide-react";
import ts from "typescript";

const require = createRequire(new URL("../app/site-shell.tsx", import.meta.url));
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// Render the real icon-bearing components with isolated navigation/account
// boundaries. Hydration is simulated to cover both persisted sidebar states;
// no Supabase requests, task mutations or real browser credentials are used.
function load(name) {
  const compiled = ts.transpileModule(source(name), {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loaded = { exports: {} };
  const localRequire = (id) => {
    if (id === "react") return { ...require(id), useSyncExternalStore: () => true };
    if (id === "next/link") return function TestLink({ children, ...props }) { return createElement("a", props, children); };
    if (id === "./site-auth") return { AccountControl: () => null };
    return require(id);
  };
  new Function("require", "module", "exports", compiled.outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const { SiteShell } = load("app/site-shell.tsx");
const { PlacesSidebar } = load("app/places-sidebar.tsx");

function shell(collapsed = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key) => key === "site-sidebar-collapsed:/about" ? String(collapsed) : null } },
  });
  try {
    return renderToStaticMarkup(createElement(SiteShell, { active: "/about", title: "About", hasSidebar: true }));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

function links(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
}

function sizedIcon(html, name, size) {
  assert.match(html, new RegExp(`lucide-${name}(?:[" ])`));
  const svg = html.match(/<svg\b[^>]*>/)?.[0];
  assert.ok(svg);
  assert.match(svg, new RegExp(`width="${size}"`));
  assert.match(svg, new RegExp(`height="${size}"`));
  assert.match(svg, /stroke-width="2"/);
}

test("main navigation and Places render the same five icons, labels and destinations", () => {
  const expected = [
    ["/", "Home", "house"], ["/nav", "Nav", "compass"],
    ["/pi-web", "Pi Web", "message-square-code"],
    ["/cloudcli", "CloudCLI", "panels-top-left"], ["/about", "About", "info"],
  ];
  for (const [html, size] of [[shell(), 18], [renderToStaticMarkup(createElement(PlacesSidebar, { active: "/about" })), 16]]) {
    const entries = links(html).slice(0, expected.length);
    assert.deepEqual(entries.map((match) => match[1]), expected.map(([href]) => href));
    entries.forEach((match, index) => {
      const [, label, icon] = expected[index];
      assert.ok(match[2].includes(label));
      sizedIcon(match[2], icon, size);
    });
  }
});

for (const collapsed of [false, true]) {
  test(`desktop sidebar icon matches its ${collapsed ? "collapsed" : "expanded"} state without changing mobile Menu`, () => {
    const html = shell(collapsed);
    const desktop = html.match(/<button\b[^>]*class="sidebar-toggle"[^>]*>[\s\S]*?<\/button>/)?.[0];
    const mobile = html.match(/<button\b[^>]*class="sidebar-toggle mobile-sidebar-toggle"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(desktop && mobile);
    sizedIcon(desktop, collapsed ? "panel-left-open" : "panel-left-close", 18);
    assert.match(desktop, new RegExp(`aria-expanded="${!collapsed}"`));
    assert.match(desktop, new RegExp(`aria-label="${collapsed ? "Show" : "Hide"} sidebar"`));
    assert.match(desktop, /aria-controls="page-sidebar"/);
    assert.match(desktop, /title="(?:Show|Hide) sidebar"/);
    sizedIcon(mobile, "menu", 18);
    assert.match(mobile, /aria-label="Show sidebar"/);
  });
}

test("task navigation uses Important and Uncategorized icons", () => {
  const tasks = source("app/tasks/task-manager.tsx");
  assert.match(tasks, /important: \{ label: "Important", icon: Star \}/);
  assert.match(tasks, /uncategorized: \{ label: "Uncategorized", icon: Inbox \}/);
  assert.doesNotMatch(tasks, /ChartGantt|label: "All tasks"/);
  sizedIcon(renderToStaticMarkup(createElement(Inbox, { size: 16 })), "inbox", 16);
});
