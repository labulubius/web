import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual reader's initialization effect and navigation handlers.
// Mock auth/data/storage boundaries, not the navigation implementation.
const source = readFileSync("app/feeds/feeds-reader.tsx", "utf8");
const parsed = ts.createSourceFile("reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "FeedsReader");
const selected = reader.body.statements.filter((node) => {
  if (ts.isFunctionDeclaration(node)) return ["chooseFeed", "chooseBoard", "choosePanel", "showFallbackSidebar"].includes(node.name?.text);
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((item) => ["sidebarLocationRef", "saveSidebarLocation"].includes(item.name.getText(parsed)));
  return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === "useEffect" && node.getText(parsed).includes('api("?view=feeds")');
});
const persistence = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "persistSidebarLocation");
assert.ok(persistence);
assert.equal(selected.length, 7);
const code = ts.transpileModule([persistence, ...selected].map((node) => node.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const directory = { feeds: [{ id: "feed/26" }, { id: "feed/27" }], selected: [] };
const boards = { tags: [], sourceTags: {}, watchboards: [{ id: "tech", tagIds: ["Tech", "Forum"] }] };

function harness(initialSidebarLocation = "sources", storageFails = false) {
  const state = {}; const timers = []; let effect; let stored = initialSidebarLocation;
  let response = async (path) => path === "?view=feeds" ? directory : boards;
  const env = {
    initialSidebarLocation, loading: false, isAdmin: true, watchboards: boards,
    useRef: (current) => ({ current }), useCallback: (fn) => fn,
    useEffect: (fn) => { effect = fn; }, api: (path) => response(path),
    window: { setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout: (fn) => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
      localStorage: { setItem: (_key, value) => { if (storageFails) throw new Error("Storage blocked"); stored = value; } } },
  };
  for (const key of ["Feeds", "Selected", "Saved", "Ready", "Watchboards", "WatchReady", "BoardFilter", "FeedFilter", "Panel", "Error"]) env[`set${key}`] = (value) => { state[key] = value; };
  const handlers = new Function(...Object.keys(env), `${code}; return { chooseFeed, chooseBoard, choosePanel, showFallbackSidebar };`)(...Object.values(env));
  const settle = async () => { await new Promise((done) => setImmediate(done)); };
  return { ...handlers, state, settle, get stored() { return stored; },
    respond: (fn) => { response = fn; },
    start: () => { const cleanup = effect(); timers.shift()?.(); return cleanup; },
    reload: async () => { const cleanup = effect(); timers.shift()?.(); await settle(); return cleanup; },
  };
}

for (const storageFails of [false, true]) {
  test(`source and board navigation survive repeated auth rechecks (storage blocked: ${storageFails})`, async () => {
    const app = harness("sources", storageFails);
    await app.reload(); assert.equal(app.state.Panel, "sources");
    app.chooseFeed("feed/26");
    for (let i = 0; i < 3; i++) {
      await app.reload();
      assert.equal(app.state.Panel, "articles"); assert.equal(app.state.FeedFilter, "feed/26"); assert.equal(app.state.BoardFilter, null);
    }
    app.chooseBoard("tech"); await app.reload();
    assert.equal(app.state.BoardFilter, "tech"); assert.equal(app.state.FeedFilter, null);
    app.choosePanel("tags"); await app.reload(); assert.equal(app.state.Panel, "tags");
    app.choosePanel("sources"); await app.reload(); assert.equal(app.state.Panel, "sources");
  });
}

test("navigation during a delayed directory refresh wins over the initial location", async () => {
  const app = harness(); await app.reload();
  let release;
  app.respond((path) => path === "?view=feeds" ? new Promise((done) => { release = done; }) : boards);
  app.start(); app.chooseFeed("feed/27"); release(directory); await app.settle();
  assert.equal(app.state.FeedFilter, "feed/27"); assert.equal(app.state.Panel, "articles");
});

test("cancelled directory responses cannot overwrite a new navigation choice", async () => {
  const app = harness(); await app.reload();
  let release;
  app.respond(() => new Promise((done) => { release = done; }));
  const cleanup = app.start(); cleanup(); app.chooseFeed("feed/26");
  release(directory); await app.settle();
  assert.equal(app.state.FeedFilter, "feed/26"); assert.equal(app.state.Panel, "articles");
});

test("saved locations restore and deleted targets fall back to a valid board or Sources", async () => {
  for (const location of ["source:feed/26", "board:tech", "tags", "sources"]) {
    const app = harness(location); await app.reload();
    assert.equal(app.state.Panel, location.includes(":") ? "articles" : location);
  }
  const app = harness("source:deleted"); await app.reload();
  assert.equal(app.state.BoardFilter, "tech"); assert.equal(app.stored, "board:tech");
  app.respond((path) => path === "?view=feeds" ? directory : { ...boards, watchboards: [] });
  await app.reload(); assert.equal(app.state.Panel, "sources"); assert.equal(app.stored, "sources");
});
