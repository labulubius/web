import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("app/nav/site-filter.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", code)(exports);
const { visibleSites } = exports;

const categories = [{ id: "dev", name: "Development", sort_order: 0 }, { id: "read", name: "Reading", sort_order: 1 }];
const site = (id, category_id, extra = {}) => ({ id, category_id, name: id, description: "", url: `https://${id}.example`, icon_url: null, sort_order: 0, is_favorite: false, ...extra });
const names = (list) => list.map((item) => item.id);

test("a category shows only its sites, by sort order and then name", () => {
  const sites = [site("zeta", "dev", { sort_order: 1 }), site("beta", "dev", { sort_order: 1 }), site("alpha", "dev", { sort_order: 2 }), site("news", "read")];
  assert.deepEqual(names(visibleSites(sites, categories, "dev", "")), ["beta", "zeta", "alpha"]);
});

test("favorites follow their own order, then category order", () => {
  const sites = [
    site("book", "read", { is_favorite: true, favorite_sort_order: 0 }),
    site("git", "dev", { is_favorite: true, favorite_sort_order: 0 }),
    site("docs", "dev", { is_favorite: true, favorite_sort_order: null, sort_order: 5 }),
    site("plain", "dev"),
  ];
  assert.deepEqual(names(visibleSites(sites, categories, "favorites", "")), ["git", "book", "docs"]);
});

test("search matches name, description, URL and category name, ignoring case and padding", () => {
  const sites = [site("git", "dev", { description: "Source hosting" }), site("blog", "read", { url: "https://writing.example" }), site("other", "dev")];
  assert.deepEqual(names(visibleSites(sites, categories, "dev", "  SOURCE ")), ["git"]);
  assert.deepEqual(names(visibleSites(sites, categories, "read", "writing")), ["blog"]);
  assert.deepEqual(names(visibleSites(sites, categories, "dev", "development")), ["git", "other"]);
  assert.deepEqual(names(visibleSites(sites, categories, "dev", "missing")), []);
});

test("filtering never mutates the stored list", () => {
  const sites = [site("b", "dev", { sort_order: 1 }), site("a", "dev")];
  visibleSites(sites, categories, "dev", "");
  assert.deepEqual(names(sites), ["b", "a"]);
});
