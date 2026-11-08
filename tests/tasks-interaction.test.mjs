import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("app/tasks/task-manager.tsx", "utf8");
const parsed = ts.createSourceFile("tasks.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskManager");
const deletion = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "deleteTask");
const list = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "TaskList");
const row = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "SortableTaskRow");
const dateLabel = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "taskDateLabel");
const compile = (node) => ts.transpileModule(node.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" } }).outputText;
const archiveProjectId = "00000000-0000-4000-8000-000000000001";
const task = { id: "task-1", title: "A long task title", projectId: null, isImportant: false, importantSortOrder: null };

for (const confirmed of [false, true]) {
  test(`deleting a task requires confirmation: ${confirmed}`, async () => {
    const requests = []; const dialogs = []; const prompts = [];
    const handler = new Function("window", "mutate", "closeTaskDialog", `${compile(deletion)}; return deleteTask;`)(
      { confirm: (message) => { prompts.push(message); return confirmed; } },
      async (...args) => { requests.push(args); return true; }, () => dialogs.push(null),
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
  const handler = new Function("window", "mutate", "closeTaskDialog", `${compile(deletion)}; return deleteTask;`)(
    { confirm: () => true }, async () => false, () => dialogs.push(null),
  );
  await handler(task);
  assert.deepEqual(dialogs, []);
});

const h = (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) });
function nodes(tree) { return tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : []; }
test("task body is inert and edit, delete, complete stay separate", () => {
  const calls = [];
  const dragStart = () => {};
  const renderRow = new Function("h", "useSortable", "CSS", "Circle", "Star", "Pencil", "Trash2", "shortDate", compile(dateLabel) + ";" + compile(row) + "; return SortableTaskRow;")(
    h, () => ({ attributes: { role: "button", tabIndex: 0 }, listeners: { onPointerDown: dragStart, onKeyDown: dragStart }, setNodeRef() {}, setActivatorNodeRef() {}, transform: null, transition: undefined, isDragging: false }),
    { Transform: { toString: () => undefined } }, "circle", "star", "pencil", "trash", (date) => date,
  );
  const tree = renderRow({ task, projectName: "Uncategorized", disabled: false, onOpen: () => calls.push(["edit", { task }]), onDelete: () => calls.push(["delete", task]), onComplete: () => calls.push(["complete", task]), onImportant: () => calls.push(["important", task]) });
  const all = nodes(tree);
  const body = all.find((n) => n.props.className === "task-list-main");
  assert.equal(body.tag, "div");
  assert.equal(body.props.onClick, undefined);
  const taskRow = all.find((n) => n.tag === "li");
  assert.equal(taskRow.props.onClick, undefined);
  assert.equal(taskRow.props.onPointerDown, dragStart, "the whole row starts pointer dragging");
  assert.equal(body.props.onKeyDown, undefined, "keyboard events bubble to the row listener");
  assert.equal(body.props.role, "button");
  assert.equal(body.props.tabIndex, 0);
  assert.equal(body.props["aria-label"], `Reorder ${task.title}`);
  assert.ok(!all.some((n) => n.props.className === "task-drag-handle"));
  assert.doesNotMatch(source, /GripVertical|task-drag-handle/);
  let stopped = 0;
  const stopEvent = { stopPropagation() { stopped++; } };
  all.find((n) => n.props.className === "task-check").props.onPointerDown(stopEvent);
  all.find((n) => n.props.className === "task-list-actions").props.onPointerDown(stopEvent);
  assert.equal(stopped, 2, "task actions stop drag activation");
  for (const action of ["Delete", "Edit", "Complete", "Add"]) all.find((n) => n.props["aria-label"]?.startsWith(`${action} ${task.title}`)).props.onClick();
  assert.deepEqual(calls, [["delete", task], ["edit", { task }], ["complete", task], ["important", task]]);
  const actionLabels = all.filter((n) => n.props.className?.includes?.("task-important") || ["Edit task", "Delete task"].includes(n.props.title)).map((n) => n.props.title);
  assert.deepEqual(actionLabels, ["Add to Important", "Edit task", "Delete task"]);
  assert.equal(all.find((n) => n.props.className === "task-check").props.disabled, false, "complete stays clickable while idle");
  const busy = nodes(renderRow({ task, projectName: "Uncategorized", disabled: true, onOpen() {}, onComplete() {}, onImportant() {}, onDelete() {} }));
  assert.equal(busy.find((n) => n.props.className === "task-check").props.disabled, true, "complete is locked while a save is in flight");
  const renderList = new Function("h", "CheckCircle2", `${compile(list)}; return TaskList;`)(h, "check");
  assert.ok(nodes(renderList({ tasks: [], projects: [], empty: "Empty" })).some((n) => n.props.className === "task-empty"));
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

test("task dialog saves a start date or due date without filling the other", async () => {
  for (const [startDate, endDate] of [["", "2026-11-04"], ["2026-11-03", ""]]) {
    const calls = [];
    const tree = renderDialog({ value: {}, projects: [], busy: false, onClose() {}, onSave: async (draft) => calls.push(draft) });
    const form = nodes(tree).find((node) => node.tag === "form");
    form.props.onSubmit({ preventDefault() {}, currentTarget: { title: "Task", description: "", projectId: "", startDate, endDate } });
    await Promise.resolve();
    assert.deepEqual(calls, [{ title: "Task", description: "", projectId: null, startDate: startDate || null, endDate: endDate || null }]);
  }
});

test("task dialog keeps saving and errors accessible", () => {
  const tree = renderDialog({ value: {}, projects: [], busy: true, error: "Cannot save", onClose() {}, onSave() {} });
  assert.equal(tree.props.busy, true);
  assert.ok(nodes(tree).filter((n) => n.tag === "button").every((n) => n.props.disabled));
  assert.ok(nodes(tree).some((n) => n.props.role === "alert" && n.children.includes("Cannot save")));
});

test("task dialog reports unsubmitted field changes without normalizing dates", () => {
  const drafts = [];
  const tree = renderDialog({ value: {}, projects: [], busy: false, onClose() {}, onSave() {}, onDraftChange: (draft) => drafts.push(draft) });
  const form = nodes(tree).find((node) => node.tag === "form");
  const fields = { title: "Draft title", description: "Draft description", projectId: "project-1", startDate: "", endDate: "2026-11-04" };
  form.props.onInput({ currentTarget: fields });
  form.props.onChange({ currentTarget: fields });
  assert.deepEqual(drafts, [
    { title: "Draft title", description: "Draft description", projectId: "project-1", startDate: null, endDate: "2026-11-04" },
    { title: "Draft title", description: "Draft description", projectId: "project-1", startDate: null, endDate: "2026-11-04" },
  ]);
});

test("task dialog drafts stay in TaskManager state across transient auth loading", () => {
  assert.doesNotMatch(source, /TASK_DIALOG_DRAFT_KEY_PREFIX|sessionStorage|site-task-dialog-draft/);
  assert.match(source, /setTaskDialog\(\(current\) => \{/);
  assert.match(source, /return \{ \.\.\.current, draft \}/);
  assert.match(source, /onDraftChange=\{rememberTaskDraft\}/);
});

test("a remounted task dialog prefers its in-memory draft over saved task values", () => {
  const draft = { title: "Unsaved title", description: "Unsaved description", projectId: null, startDate: "2026-11-03", endDate: "2026-11-04" };
  const tree = renderDialog({ value: { task, draft }, projects: [], busy: false, onClose() {}, onSave() {} });
  const all = nodes(tree);
  assert.equal(all.find((node) => node.props.name === "title").props.defaultValue, draft.title);
  assert.equal(all.find((node) => node.props.name === "description").props.defaultValue, draft.description);
  assert.equal(all.find((node) => node.props.name === "startDate").props.defaultValue, draft.startDate);
  assert.equal(all.find((node) => node.props.name === "endDate").props.defaultValue, draft.endDate);
});

test("a remounted task dialog keeps a cleared start date empty", () => {
  const saved = { ...task, startDate: "2026-10-10", endDate: "2026-10-15" };
  const draft = { title: "Task", description: "", projectId: null, startDate: null, endDate: "2026-11-04" };
  const tree = renderDialog({ value: { task: saved, draft }, projects: [], busy: false, onClose() {}, onSave() {} });
  const all = nodes(tree);
  assert.equal(all.find((node) => node.props.name === "startDate").props.defaultValue, "");
  assert.equal(all.find((node) => node.props.name === "endDate").props.defaultValue, "2026-11-04");
});

for (const view of ["important", "project"]) {
  for (const success of [true, false]) {
    test(`quick add saves directly without a dialog (${view}, success: ${success})`, async () => {
      const quickAdd = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "quickAdd");
      const calls = []; const dialogs = [];
      const handle = new Function("FormData", "view", "projectId", "mutate", "setTaskDialog", `${compile(quickAdd)}; return quickAdd;`)(
        class { get() { return "  Report  "; } }, view, "project-1",
        async (...args) => { calls.push(args); return success; }, (value) => dialogs.push(value),
      );
      let reset = false;
      await handle({ preventDefault() {}, currentTarget: { reset() { reset = true; } } });
      assert.deepEqual(calls, [["/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Report", projectId: view === "project" ? "project-1" : null, ...(view === "important" ? { isImportant: true } : {}) }) }]]);
      assert.deepEqual(dialogs, []);
      assert.equal(reset, success);
    });
  }
}

test("quick add ignores blank titles without opening a dialog", async () => {
  const quickAdd = component.body.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "quickAdd");
  const unexpected = () => assert.fail("Blank title must not submit, reset, or open a dialog");
  const handle = new Function("FormData", "view", "projectId", "mutate", "setTaskDialog", `${compile(quickAdd)}; return quickAdd;`)(
    class { get() { return "   "; } }, "important", null, unexpected, unexpected,
  );
  await handle({ preventDefault() {}, currentTarget: { reset: unexpected } });
});

test("task rows show start and due dates independently", () => {
  const renderRow = new Function("h", "useSortable", "CSS", "Circle", "Star", "Pencil", "Trash2", "shortDate", compile(dateLabel) + ";" + compile(row) + "; return SortableTaskRow;")(
    h, () => ({ attributes: {}, listeners: {}, setNodeRef() {}, setActivatorNodeRef() {}, transform: null, transition: undefined, isDragging: false }),
    { Transform: { toString: () => undefined } }, "circle", "star", "pencil", "trash", (date) => date,
  );
  for (const [startDate, endDate, expected] of [
    ["2026-10-10", "2026-10-15", "Starts 2026-10-10 · Due 2026-10-15"],
    ["2026-10-10", null, "Starts 2026-10-10"],
    [null, "2026-10-15", "Due 2026-10-15"],
    [null, null, "Not scheduled"],
  ]) {
    const tree = renderRow({
      task: { ...task, startDate, endDate }, projectName: "Uncategorized",
      disabled: false, onOpen() {}, onComplete() {}, onImportant() {}, onDelete() {},
    });
    assert.ok(nodes(tree).some((node) => node.tag === "span" && node.children.includes(expected)), expected);
  }
});

test("Archive remains an ordinary project without its former All tasks filter", () => {
  assert.doesNotMatch(source, /<span>Archive<\/span>|ArchiveIcon/);
  assert.match(source, /items=\{data\.projects\.map/);
  assert.match(source, /data\.projects\.map\(\(project\) => <SortableProjectRow/);
  assert.match(source, /value\.view === "archive" \? TASK_ARCHIVE_PROJECT_ID/);
  assert.match(source, /setView\("important"\)/);
});

test("Archive is available in the task editor and another project can restore a task", () => {
  const projects = [
    { id: "project-1", name: "Course" },
    { id: archiveProjectId, name: "Archive" },
  ];
  const archived = { ...task, description: "", projectId: archiveProjectId, startDate: null, endDate: null };
  const tree = renderDialog({ value: { task: archived }, projects, busy: false, onClose() {}, onSave() {} });
  const all = nodes(tree);
  const select = all.find((node) => node.tag === "select" && node.props.name === "projectId");
  assert.equal(select.props.defaultValue, archiveProjectId);
  assert.ok(all.some((node) => node.tag === "option" && node.props.value === archiveProjectId && node.children.includes("Archive")));
  assert.ok(all.some((node) => node.tag === "option" && node.props.value === "project-1" && node.children.includes("Course")));
});


test("Important navigation includes starred tasks from every project", () => {
  assert.match(source, /important: \{ label: "Important"/);
  assert.match(source, /data\?\.tasks\.filter\(\(task\) => task\.isImportant\)/);
  assert.match(source, /Starred tasks from every project\./);
  assert.match(source, /view === "important" \? importantTasks/);
});

test("task list sorting separates base and Important persistence", () => {
  assert.match(source, /mode: "important"/);
  assert.match(source, /mode: "base"/);
  assert.match(source, /importantSortOrder: orderById\.get\(task\.id\)!/);
  assert.match(source, /if \(!ok\) setData\(before\)/);
  assert.match(source, /sortableKeyboardCoordinates/);
});

test("task list dragging stays inside the visible list", () => {
  const restrict = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "restrictTaskListDrag");
  const modifier = new Function(`${compile(restrict)}; return restrictTaskListDrag;`)();
  const transform = { x: 24, y: 500, scaleX: 1, scaleY: 1 };
  const list = { getBoundingClientRect: () => ({ top: 100, bottom: 300 }) };
  assert.deepEqual(modifier(list, { active: { id: "list:task-1" }, draggingNodeRect: { top: 120, bottom: 175 }, transform }), { ...transform, x: 0, y: 125 });
  assert.deepEqual(modifier(list, { active: { id: "list:task-1" }, draggingNodeRect: { top: 120, bottom: 175 }, transform: { ...transform, y: -100 } }), { ...transform, x: 0, y: -20 });
  assert.equal(modifier(list, { active: { id: "project-1" }, draggingNodeRect: { top: 120, bottom: 175 }, transform }), transform, "project dragging is unchanged");
  assert.match(source, /modifiers=\{\[taskListModifier\]\}/);
  assert.match(source, /<ul ref=\{listRef\} className="task-list">/);
});


test("retired browser locations restore to active task views", () => {
  const read = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "readLocation");
  const storage = { value: null, getItem() { return JSON.stringify(this.value); } };
  const restore = new Function("window", "TASK_ARCHIVE_PROJECT_ID", "LOCATION_KEY", `${compile(read)}; return readLocation;`)({ localStorage: storage }, archiveProjectId, "site-tasks-location-v1");
  const projects = [{ id: archiveProjectId, name: "Archive" }, { id: "project-1", name: "Course" }];
  for (const view of ["all", "inbox", "uncategorized"]) {
    storage.value = { version: 1, view, projectId: null };
    assert.deepEqual(restore(projects), { version: 2, view: "important", projectId: null });
  }
  storage.value = { version: 1, view: "gantt", projectId: null };
  assert.deepEqual(restore(projects), { version: 2, view: "important", projectId: null });
  storage.value = { version: 1, view: "archive", projectId: null };
  assert.deepEqual(restore(projects), { version: 2, view: "project", projectId: archiveProjectId });
  storage.value = { version: 2, view: "project", projectId: "missing" };
  assert.deepEqual(restore(projects), { version: 2, view: "important", projectId: null });
});

test("home offers only Important and project task views", () => {
  assert.match(source, /important: \{ label: "Important"/);
  assert.doesNotMatch(source, /label: "All tasks"|label: "Gantt"|label: "Uncategorized"|<GanttView|task-range-form/);
  assert.match(source, /useState<View>\("important"\)/);
});

test("same-account auth rechecks keep the loaded task workspace mounted", () => {
  assert.match(source, /const \[dataAccountId, setDataAccountId\] = useState<string \| null>\(null\)/);
  assert.match(source, /setDataAccountId\(requestedAccountId\)/);
  assert.match(source, /const readyForAccount = Boolean\(data && accountId && dataAccountId === accountId && isAdmin\)/);
  assert.match(source, /if \(loading && !readyForAccount\) return <HomeAccess/);
  assert.doesNotMatch(source, /if \(loading\) return <HomeAccess/);
  assert.match(source, /if \(!data \|\| dataAccountId !== accountId\) return <section/);
  assert.match(source, /setDataAccountId\(null\)/);
  assert.match(source, /setTaskDialog\(null\)/);
});
