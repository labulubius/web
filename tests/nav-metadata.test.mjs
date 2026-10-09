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

test("Nav inherits the site title suffix exactly once", () => {
  const root = readMetadata("app/layout.tsx");
  const nav = readMetadata("app/nav/layout.tsx");
  assert.equal(resolveTitle(nav.title, root.title.template).absolute, "Nav — Labulubius");
});
