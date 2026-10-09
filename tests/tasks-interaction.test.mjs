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

const dialogSource = readFileSync("app/tasks/task-dialogs.tsx", "utf8");
const dialogParsed = ts.createSourceFile("dialogs.tsx", dialogSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dialogNode = dialogParsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskDialog");
const dialogCode = ts.transpileModule(dialogNode.getText(dialogParsed).replace("export function", "function"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" },
}).outputText;
const renderDialog = new Function("h", "useMemo", "useEffect", "useRef", "AccessibleDialog", "X", "FormData", `${dialogCode}; return TaskDialog;`)(
  h, (fn) => fn(), () => {}, (current) => ({ current }), "dialog", "close", class { constructor(values) { this.values = values; } get(key) { return this.values[key] ?? null; } },
);

for (const editing of [false, true]) {
  test(`${editing ? "edit" : "new"} uses the same description and uncategorized date fields`, async () => {
    const calls = [];
    const value = editing ? { task: { ...task, description: "Existing description", startDate: "2026-10-10", endDate: "2026-10-15" } } : {};
    const tree = renderDialog({ value, projects: [], busy: false, onClose() {}, onSave: async (draft) => calls.push(draft) });
    const all = nodes(tree);
    const description = all.find((n) => n.tag === "textarea");
    assert.equal(description.props.name, "description");
    assert.equal(description.props.rows, 3);
    assert.equal(description.props.maxLength, 300);
    assert.equal(description.props.defaultValue, editing ? "Existing description" : "");
    assert.equal(all.filter((n) => n.props.type === "date").length, 2);
    const form = all.find((n) => n.tag === "form");
    form.props.onSubmit({ preventDefault() {}, currentTarget: { title: "New title", description: "New description", projectId: "", startDate: "2026-10-10", endDate: "2026-10-15" } });
    await Promise.resolve();
    assert.deepEqual(calls, [{ title: "New title", description: "New description", projectId: null, startDate: "2026-10-10", endDate: "2026-10-15" }]);
  });
}

test("task dialog keeps saving and errors accessible", () => {
  const tree = renderDialog({ value: {}, projects: [], busy: true, error: "Cannot save", onClose() {}, onSave() {} });
  assert.equal(tree.props.busy, true);
  assert.ok(nodes(tree).filter((n) => n.tag === "button").every((n) => n.props.disabled));
  assert.ok(nodes(tree).some((n) => n.props.role === "alert" && n.children.includes("Cannot save")));
});

test("quick add opens the shared form rather than bypassing description entry", () => {
  const quickAdd = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "quickAdd");
  const calls = [];
  const handle = new Function("FormData", "view", "projectId", "setTaskDialog", "setError", `${compile(quickAdd)}; return quickAdd;`)(
    class { get() { return "  Report  "; } }, "all", null, (value) => calls.push(value), () => {},
  );
  let reset = false;
  handle({ preventDefault() {}, currentTarget: { reset() { reset = true; } } });
  assert.deepEqual(calls, [{ defaults: { title: "Report", projectId: null } }]);
  assert.equal(reset, true);
});

test("uncategorized tasks retain dates in the list and can move on Gantt", () => {
  const scheduled = { ...task, startDate: "2026-10-10", endDate: "2026-10-15" };
  const render = new Function("h", "CheckCircle2", "Circle", "Pencil", "Trash2", "shortDate", `${compile(list)}; return TaskList;`)(h, "check", "circle", "pencil", "trash", (date) => date);
  const tree = render({ tasks: [scheduled], projects: [], empty: "Empty" });
  assert.ok(nodes(tree).some((n) => n.tag === "span" && n.children.includes("2026-10-10 – 2026-10-15")));
  const drag = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "dragEnd");
  const patches = [];
  const handle = new Function("data", "saving", "daysBetween", "addDays", "patchTask", `${compile(drag)}; return dragEnd;`)(
    { tasks: [scheduled] }, false, () => 5, () => "2026-10-16", (task, patch) => patches.push([task, patch]),
  );
  handle({ active: { id: "task:task-1" }, over: { id: "gantt:task-1:2026-10-11" } });
  assert.deepEqual(patches, [[scheduled, { startDate: "2026-10-11", endDate: "2026-10-16" }]]);
});


test("Gantt includes dated uncategorized tasks and excludes unscheduled or out-of-range tasks", () => {
  const source = readFileSync("app/tasks/gantt-view.tsx", "utf8");
  const parsed = ts.createSourceFile("gantt.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "GanttView");
  const code = ts.transpileModule(node.getText(parsed).replace("export function", "function"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" },
  }).outputText;
  const render = new Function("h", "useMemo", "dateRange", "localDate", "fromLocalDate", "longDate", "shortDate", "DayCell", "GanttBar", "Pencil", `${code}; return GanttView;`)(
    h, (fn) => fn(), () => ["2026-10-10", "2026-10-11"], () => "2026-10-10", (date) => new Date(`${date}T12:00:00`), (date) => date, (date) => date, "day", "bar", "pencil",
  );
  const dated = { ...task, startDate: "2026-10-10", endDate: "2026-10-15" };
  const tree = render({ timelineStart: "2026-10-10", timelineEnd: "2026-10-11", projects: [], tasks: [task, dated, { ...dated, id: "outside", startDate: "2026-11-01", endDate: "2026-11-02" }] });
  const bars = nodes(tree).filter((n) => n.tag === "bar");
  assert.equal(bars.length, 1);
  assert.equal(bars[0].props.task, dated);
});
