import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("app/tasks/task-manager.tsx", "utf8");
const parsed = ts.createSourceFile("tasks.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskManager");
const deletion = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "deleteTask");
const list = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskList");
const compile = (node) => ts.transpileModule(node.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" } }).outputText;
const task = { id: "task-1", title: "A long task title", projectId: null };

for (const confirmed of [false, true]) {
  test(`deleting a task requires confirmation: ${confirmed}`, async () => {
    const requests = []; const dialogs = []; const prompts = [];
    const handler = new Function("window", "mutate", "setTaskDialog", `${compile(deletion)}; return deleteTask;`)(
      { confirm: (message) => { prompts.push(message); return confirmed; } },
      async (...args) => { requests.push(args); return true; }, (value) => dialogs.push(value),
    );
    await handler(task);
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes(task.title));
    assert.match(prompts[0], /cannot be undone/);
    assert.deepEqual(requests, confirmed ? [["/api/tasks/task-1", { method: "DELETE" }]] : []);
    assert.deepEqual(dialogs, confirmed ? [null] : []);
  });
}

test("failed deletion does not close the current dialog", async () => {
  const dialogs = [];
  const handler = new Function("window", "mutate", "setTaskDialog", `${compile(deletion)}; return deleteTask;`)(
    { confirm: () => true }, async () => false, (value) => dialogs.push(value),
  );
  await handler(task);
  assert.deepEqual(dialogs, []);
});

const h = (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) });
function nodes(tree) { return tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : []; }
test("task body is inert and edit, delete, complete stay separate", () => {
  const calls = [];
  const render = new Function("h", "CheckCircle2", "Circle", "Pencil", "Trash2", "shortDate", `${compile(list)}; return TaskList;`)(h, "check", "circle", "pencil", "trash", (date) => date);
  const tree = render({ tasks: [task], projects: [], empty: "Empty", onOpen: (value) => calls.push(["edit", value]), onDelete: (value) => calls.push(["delete", value]), onComplete: (value) => calls.push(["complete", value]) });
  const all = nodes(tree);
  const body = all.find((n) => n.props.className === "task-list-main");
  assert.equal(body.tag, "div");
  assert.equal(body.props.onClick, undefined);
  assert.equal(all.find((n) => n.tag === "li").props.onClick, undefined);
  for (const action of ["Delete", "Edit", "Complete"]) all.find((n) => n.props["aria-label"] === `${action} ${task.title}`).props.onClick();
  assert.deepEqual(calls, [["delete", task], ["edit", { task }], ["complete", task]]);
  assert.ok(nodes(render({ tasks: [], projects: [], empty: "Empty" })).some((n) => n.props.className === "task-empty"));
});

test("Gantt title and draggable bar do not activate editing", () => {
  const gantt = readFileSync("app/tasks/gantt-view.tsx", "utf8");
  assert.match(gantt, /<div className="gantt-task-label">/);
  assert.doesNotMatch(gantt, /className="gantt-bar-main"[^>]*onClick/);
  assert.match(gantt, /className="gantt-task-edit"[^\n]*onClick=\{\(\) => onOpen\(\{ task \}\)\}/);
  assert.match(gantt, /ref=\{setActivatorNodeRef\}/);
  assert.match(gantt, /\{\.\.\.listeners\} \{\.\.\.attributes\}/);
});
