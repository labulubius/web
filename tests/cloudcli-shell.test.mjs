import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { attachCloudCLIViewport } from "../app/cloudcli/frame-viewport.ts";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

function fixture({ frameAvailable = true } = {}) {
  const old = new Map(["window", "document", "ResizeObserver", "MutationObserver"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const properties = new Map();
  const iframeIdentity = {};
  const frame = { id: "", iframeIdentity, style: {
    setProperty: (key, value) => properties.set(key, value),
    removeProperty: (key) => properties.delete(key),
  } };
  let available = frameAvailable;
  let bounds = { top: 57, left: 0, width: 1440, height: 819 };
  const viewport = { dataset: {}, getBoundingClientRect: () => bounds };
  const observers = [];
  const listeners = new Map();
  const visualListeners = new Map();
  const timers = new Map();
  let sequence = 0;
  function observer(kind) {
    return class {
      constructor(callback) { this.callback = callback; this.kind = kind; this.disconnected = false; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    };
  }
  const env = {
    document: { body: {}, querySelector(selector) { assert.equal(selector, ".cloudcli-page"); return available ? frame : null; } },
    ResizeObserver: observer("resize"),
    MutationObserver: observer("discovery"),
    window: {
      requestAnimationFrame(callback) { const id = ++sequence; timers.set(id, callback); return id; },
      cancelAnimationFrame(id) { timers.delete(id); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
      visualViewport: {
        addEventListener(name, callback) { visualListeners.set(name, callback); },
        removeEventListener(name, callback) { assert.equal(visualListeners.get(name), callback); visualListeners.delete(name); },
      },
    },
  };
  for (const [key, value] of Object.entries(env)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return {
    viewport, frame, properties, observers, listeners, visualListeners, timers, iframeIdentity,
    setBounds(value) { bounds = value; },
    makeFrameAvailable() { available = true; },
    flush() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); },
    restore() {
      for (const [key, value] of old) {
        if (value) Object.defineProperty(globalThis, key, value);
        else delete globalThis[key];
      }
    },
  };
}

test("CloudCLI route reuses the existing shell without rendering a second iframe or changing shared components", async () => {
  const page = await read("app/cloudcli/page.tsx");
  const slot = await read("app/cloudcli/cloudcli-viewport.tsx");
  const styles = await read("app/cloudcli/cloudcli-shell.css");
  assert.match(page, /from "\.\.\/site-shell"/);
  assert.match(page, /<SiteShell active="\/cloudcli" title="CloudCLI">/);
  assert.match(page, /<CloudCLIViewport \/>/);
  assert.doesNotMatch(page + slot, /<iframe|<CloudCLIFrame|redirect\(|getSession|Authorization/);
  assert.match(slot, /aria-owns="cloudcli-persistent-workspace"/);
  assert.match(slot, /role="status"/);
  assert.match(styles, /html:has\(\.cloudcli-viewport\) \.cloudcli-page/);
  assert.match(styles, /z-index: 1/);
  assert.doesNotMatch(styles, /\.agent-|\.tool-bar|\.status-bar|48px|43px|24px.*(?:top|bottom)/);
});

test("persistent frame follows measured content bounds instead of covering toolbar and status bar", () => {
  const f = fixture();
  try {
    const cleanup = attachCloudCLIViewport(f.viewport);
    assert.equal(f.frame.id, "cloudcli-persistent-workspace");
    assert.equal(f.properties.get("--cloudcli-slot-top"), "57px");
    assert.equal(f.properties.get("--cloudcli-slot-width"), "1440px");
    assert.equal(f.properties.get("--cloudcli-slot-height"), "819px");
    assert.equal(f.properties.get("--cloudcli-slot-visibility"), "visible");
    assert.equal(f.viewport.dataset.cloudcliReady, "true");
    assert.equal(f.frame.iframeIdentity, f.iframeIdentity);
    cleanup();
  } finally { f.restore(); }
});

test("resize and visual-viewport events coalesce while preserving the same frame", () => {
  const f = fixture();
  try {
    const cleanup = attachCloudCLIViewport(f.viewport);
    f.setBounds({ top: 43, left: 0, width: 390, height: 777 });
    f.listeners.get("resize")();
    f.visualListeners.get("resize")();
    f.visualListeners.get("scroll")();
    f.observers.find((item) => item.kind === "resize").callback();
    assert.equal(f.timers.size, 1);
    f.flush();
    assert.equal(f.properties.get("--cloudcli-slot-top"), "43px");
    assert.equal(f.properties.get("--cloudcli-slot-width"), "390px");
    assert.equal(f.properties.get("--cloudcli-slot-height"), "777px");
    assert.equal(f.frame.iframeIdentity, f.iframeIdentity);
    cleanup();
  } finally { f.restore(); }
});

test("slot can mount before the persistent frame during client-side navigation", () => {
  const f = fixture({ frameAvailable: false });
  try {
    const cleanup = attachCloudCLIViewport(f.viewport);
    assert.equal(f.properties.size, 0);
    const discovery = f.observers.find((item) => item.kind === "discovery");
    assert.equal(discovery.disconnected, false);
    f.makeFrameAvailable();
    discovery.callback();
    f.flush();
    assert.equal(discovery.disconnected, true);
    assert.equal(f.properties.get("--cloudcli-slot-visibility"), "visible");
    cleanup();
  } finally { f.restore(); }
});

test("zero-sized content slots never expose a fullscreen frame", () => {
  const f = fixture();
  try {
    f.setBounds({ top: 57, left: 0, width: 0, height: -1 });
    const cleanup = attachCloudCLIViewport(f.viewport);
    assert.equal(f.properties.get("--cloudcli-slot-visibility"), "hidden");
    assert.equal(f.properties.get("--cloudcli-slot-height"), "0px");
    assert.equal(f.viewport.dataset.cloudcliReady, "false");
    cleanup();
  } finally { f.restore(); }
});

test("leaving the route cancels observers, pending work and only its own geometry", () => {
  const f = fixture();
  try {
    f.properties.set("unrelated-property", "untouched");
    const cleanup = attachCloudCLIViewport(f.viewport);
    f.listeners.get("resize")();
    assert.equal(f.timers.size, 1);
    cleanup();
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.visualListeners.size, 0);
    assert.ok(f.observers.every((item) => item.disconnected));
    assert.deepEqual([...f.properties], [["unrelated-property", "untouched"]]);
    assert.equal(f.frame.iframeIdentity, f.iframeIdentity);
    assert.equal(f.viewport.dataset.cloudcliReady, undefined);
  } finally { f.restore(); }
});
