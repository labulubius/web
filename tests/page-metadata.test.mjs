import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title.js";

function readMetadata(path) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => node.name.getText(source) === "metadata");
  assert.ok(declaration?.initializer, `Missing metadata in ${path}`);
  return new Function(`return (${declaration.initializer.getText(source)});`)();
}

const pages = [
  ["app/page.tsx", "Home"],
  ["app/nav/layout.tsx", "Navigator"],
  ["app/feeds/page.tsx", "Feeds"],
  ["app/drive/page.tsx", "Drive"],
  ["app/agent/page.tsx", "Pi Agent"],
  ["app/about/page.tsx", "About"],
];

for (const [path, expected] of pages) {
  test(`${path} uses the requested title without a site suffix`, () => {
    const root = readMetadata("app/layout.tsx");
    const metadata = readMetadata(path);
    // A root page does not inherit a template from its same-segment layout.
    const template = path === "app/page.tsx" ? null : root.title.template;
    assert.equal(resolveTitle(metadata.title, template).absolute, expected);
  });
}
