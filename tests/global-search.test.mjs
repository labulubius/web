import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports;
}

const siteFilter = load("app/nav/site-filter.ts");
const { isOpenableUrl, isSearchShortcut, matchScore, searchPages, searchSites, SITE_RESULT_LIMIT } = load("app/global-search/search-index.ts", { "../nav/site-filter": siteFilter });
const component = readFileSync("app/global-search/global-search.tsx", "utf8");
const shell = readFileSync("app/site-shell.tsx", "utf8");

const pages = [
  { href: "/", label: "Home" },
  { href: "/nav", label: "Nav" },
  { href: "/pi-web", label: "Pi Web" },
  { href: "/cloudcli", label: "CloudCLI" },
  { href: "/about", label: "About" },
];
const categories = [{ id: "dev", name: "Development", sort_order: 0 }, { id: "read", name: "Reading", sort_order: 1 }];
const site = (id, category_id, extra = {}) => ({ id, category_id, name: id, description: "", url: `https://${id}.example`, icon_url: null, sort_order: 0, is_favorite: false, ...extra });
const titles = (list) => list.map((item) => item.title);

test("an empty query lists every page in toolbar order", () => {
  assert.deepEqual(titles(searchPages(pages, "  ")), ["Home", "Nav", "Pi Web", "CloudCLI", "About"]);
});

test("page search ranks title prefixes before word prefixes and ignores case", () => {
  assert.deepEqual(titles(searchPages(pages, "WEB")), ["Pi Web"]);
  assert.deepEqual(titles(searchPages(pages, "c")), ["CloudCLI"]);
  assert.deepEqual(titles(searchPages(pages, "missing")), []);
  assert.equal(searchPages(pages, "about")[0].href, "/about");
});

test("match quality orders exact, prefix, word prefix, contains, then other fields", () => {
  assert.equal(matchScore("git", "git"), 0);
  assert.equal(matchScore("git", "GitHub"), 1);
  assert.equal(matchScore("hub", "Docker Hub"), 2);
  assert.equal(matchScore("hub", "GitHub"), 3);
  assert.equal(matchScore("source", "GitHub", ["Source hosting"]), 4);
  assert.equal(matchScore("none", "GitHub", ["Source hosting"]), null);
});

test("site search covers every category and matches name, description, URL and category", () => {
  const sites = [site("git", "dev", { description: "Source hosting" }), site("blog", "read", { url: "https://writing.example" }), site("news", "read")];
  assert.deepEqual(titles(searchSites(sites, categories, "source")), ["git"]);
  assert.deepEqual(titles(searchSites(sites, categories, "writing")), ["blog"]);
  assert.deepEqual(titles(searchSites(sites, categories, "reading")), ["blog", "news"]);
  assert.deepEqual(searchSites(sites, categories, "git")[0], { kind: "site", id: "site:git", title: "git", detail: "git.example · Development", href: "https://git.example", iconUrl: null });
});

test("better matches come first, then favorites, then Navigator order", () => {
  const sites = [
    site("docs", "dev", { name: "Docs hub", sort_order: 0 }),
    site("tools", "read", { name: "Hub tools", sort_order: 5 }),
    site("mail", "dev", { name: "Hub mail", sort_order: 9, is_favorite: true }),
  ];
  assert.deepEqual(titles(searchSites(sites, categories, "hub")), ["Hub mail", "Hub tools", "Docs hub"]);
});

test("an empty query lists favorites in their Navigator order", () => {
  const sites = [
    site("book", "read", { is_favorite: true, favorite_sort_order: 1 }),
    site("git", "dev", { is_favorite: true, favorite_sort_order: 0 }),
    site("plain", "dev"),
  ];
  assert.deepEqual(titles(searchSites(sites, categories, "")), ["git", "book"]);
});

test("site results are capped and never include URLs that are not web links", () => {
  const many = Array.from({ length: SITE_RESULT_LIMIT + 4 }, (_, index) => site(`site${index}`, "dev", { sort_order: index }));
  assert.equal(searchSites(many, categories, "site").length, SITE_RESULT_LIMIT);
  const unsafe = [site("bad", "dev", { url: "javascript:alert(1)" }), site("worse", "dev", { url: "not a url", is_favorite: true })];
  assert.deepEqual(searchSites(unsafe, categories, "bad"), []);
  assert.deepEqual(searchSites(unsafe, categories, ""), []);
  assert.equal(isOpenableUrl("https://example.com"), true);
  assert.equal(isOpenableUrl("http://example.com"), true);
  assert.equal(isOpenableUrl("data:text/html,hi"), false);
});

test("Ctrl+K and ⌘K open search anywhere; / only when not typing", () => {
  const keys = (key, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(isSearchShortcut(keys("k", { ctrlKey: true }), true), true);
  assert.equal(isSearchShortcut(keys("K", { metaKey: true }), false), true);
  assert.equal(isSearchShortcut(keys("/"), false), true);
  assert.equal(isSearchShortcut(keys("/"), true), false);
  assert.equal(isSearchShortcut(keys("k"), false), false);
  assert.equal(isSearchShortcut(keys("k", { ctrlKey: true, shiftKey: true }), false), false);
  assert.equal(isSearchShortcut(keys("k", { ctrlKey: true, altKey: true }), false), false);
});

test("websites are requested and shown only for the site owner", () => {
  assert.match(component, /if \(!open \|\| authLoading \|\| !isAdmin\) return;/);
  assert.match(component, /isAdmin \? searchSites\(/);
  assert.equal([...component.matchAll(/supabase\.from\(/g)].length, 2);
});

test("the toolbar renders search from the shared navigation list", () => {
  assert.match(shell, /import \{ GlobalSearch \} from "\.\/global-search\/global-search";/);
  assert.match(shell, /<GlobalSearch pages=\{navigation\} \/>/);
  assert.match(component, /aria-label="Search"/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /window\.open\(result\.href, "_blank", "noopener,noreferrer"\)/);
});
