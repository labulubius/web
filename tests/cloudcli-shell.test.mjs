import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("CloudCLI uses the same frameless route pattern as Pi Web", async () => {
  for (const route of ["cloudcli", "pi-web"]) {
    const page = await read(`app/${route}/page.tsx`);
    assert.match(page, /return null;/);
    assert.doesNotMatch(page, /SiteShell|Viewport|<iframe|redirect\(/);
  }
  const cloudcli = await read("app/cloudcli/page.tsx");
  assert.match(cloudcli, /absolute: "CloudCLI"/);
  assert.match(cloudcli, /index: false, follow: false/);
});

test("CloudCLI fills the viewport like Pi Web without toolbar-height offsets", async () => {
  for (const [file, selector] of [["cloudcli/cloudcli.css", "cloudcli-page"], ["pi-web/agent.css", "agent-page"]]) {
    const styles = await read(`app/${file}`);
    const page = styles.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1];
    assert.ok(page);
    assert.match(page, /position: fixed;/);
    assert.match(page, /inset: 0;/);
    assert.match(page, /z-index: 1000;/);
    assert.match(page, /overflow: hidden;/);
  }
});

test("fullscreen CloudCLI has no stale content-slot sizing or extra iframe", async () => {
  for (const name of ["cloudcli-shell.css", "cloudcli-viewport.tsx", "frame-viewport.ts"]) {
    assert.equal(existsSync(new URL(`../app/cloudcli/${name}`, import.meta.url)), false);
  }
  const keeper = await read("app/persistent-cloudcli.tsx");
  assert.equal([...keeper.matchAll(/<CloudCLIFrame \/>/g)].length, 1);
  assert.match(keeper, /cloudcliMounted \|\| isCloudCLIRoute/);
  assert.match(keeper, /hidden=\{!isCloudCLIRoute\}/);
  assert.doesNotMatch(keeper, /SiteShell|ResizeObserver|cloudcli-slot|supabase/);
});
