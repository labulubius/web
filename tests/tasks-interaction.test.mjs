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
const navigationRow = parsed.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "SortableNavigationRow");
const compile = (node) => ts.transpileModule(node.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" } }).outputText;
const archiveProjectId = "00000000-0000-4000-8000-000000000001";
const task = { id: "task-1", title: "A long task title", projectId: null, isImportant: false, importantSortOrder: null };

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
  const dragStart = () => {};
  const renderRow = new Function("h", "useSortable", "CSS", "Circle", "Star", "Pencil", "Trash2", "shortDate", `${compile(row)}; return SortableTaskRow;`)(
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
  const renderList = new Function("h", "CheckCircle2", `${compile(list)}; return TaskList;`)(h, "check");
  assert.ok(nodes(renderList({ tasks: [], projects: [], empty: "Empty" })).some((n) => n.props.className === "task-empty"));
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

for (const view of ["all", "important", "gantt", "project"]) {
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
    class { get() { return "   "; } }, "all", null, unexpected, unexpected,
  );
  await handle({ preventDefault() {}, currentTarget: { reset: unexpected } });
});

test("uncategorized tasks retain dates in the list and can move on Gantt", () => {
  const scheduled = { ...task, startDate: "2026-10-10", endDate: "2026-10-15" };
  const renderRow = new Function("h", "useSortable", "CSS", "Circle", "Star", "Pencil", "Trash2", "shortDate", `${compile(row)}; return SortableTaskRow;`)(
    h, () => ({ attributes: {}, listeners: {}, setNodeRef() {}, setActivatorNodeRef() {}, transform: null, transition: undefined, isDragging: false }),
    { Transform: { toString: () => undefined } }, "circle", "star", "pencil", "trash", (date) => date,
  );
  const tree = renderRow({ task: scheduled, projectName: "Uncategorized", disabled: false, onOpen() {}, onComplete() {}, onImportant() {}, onDelete() {} });
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

test("Archive is an ordinary project row while its tasks stay out of active views", () => {
  const all = source.indexOf('label: "All tasks"');
  const gantt = source.indexOf('label: "Gantt"');
  assert.ok(all >= 0 && all < gantt);
  assert.doesNotMatch(source, /<span>Archive<\/span>|ArchiveIcon/);
  assert.match(source, /data\?\.tasks\.filter\(\(task\) => !isArchivedTask\(task\)\)/);
  assert.match(source, /tasks=\{allTasks\}/);
  assert.match(source, /items=\{data\.projects\.map/);
  assert.match(source, /data\.projects\.map\(\(project\) => <SortableProjectRow/);
  assert.match(source, /storedView === "archive" \? "project"/);
  assert.match(source, /storedView === "archive" \? TASK_ARCHIVE_PROJECT_ID/);
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


test("Important navigation includes starred Archive tasks without adding them to active views", () => {
  assert.match(source, /important: \{ label: "Important"/);
  assert.match(source, /data\?\.tasks\.filter\(\(task\) => task\.isImportant\)/);
  assert.match(source, /Starred tasks from every project, including Archive/);
  assert.match(source, /view === "important" \? importantTasks/);
  assert.match(source, /tasks=\{allTasks\}/);
});

test("task list sorting separates base and Important persistence", () => {
  assert.match(source, /mode: "important"/);
  assert.match(source, /mode: "base"/);
  assert.match(source, /importantSortOrder: orderById\.get\(task\.id\)!/);
  assert.match(source, /if \(!ok\) setData\(before\)/);
  assert.match(source, /sortableKeyboardCoordinates/);
});


test("task view rows are fully draggable, selectable, and namespaced from other sortables", () => {
  const calls = [];
  const pointer = () => {};
  const render = new Function("h", "useSortable", "CSS", "NAVIGATION_VIEWS", `${compile(navigationRow)}; return SortableNavigationRow;`)(
    h,
    (options) => {
      calls.push(options);
      return { attributes: { "aria-roledescription": "sortable" }, listeners: { onPointerDown: pointer }, setNodeRef() {}, setActivatorNodeRef() {}, transform: null, transition: undefined, isDragging: false };
    },
    { Transform: { toString: () => undefined } },
    { all: { label: "All tasks", icon: "list" }, important: { label: "Important", icon: "star" }, gantt: { label: "Gantt", icon: "calendar" } },
  );
  let selected = 0;
  const tree = render({ id: "important", active: true, disabled: false, onSelect: () => selected++ });
  assert.deepEqual(calls, [{ id: "view:important", disabled: false }]);
  const button = nodes(tree).find((node) => node.tag === "button");
  assert.equal(button.props.onPointerDown, pointer);
  assert.equal(button.props["aria-current"], "page");
  assert.equal(button.props["aria-roledescription"], "sortable");
  button.props.onClick();
  assert.equal(selected, 1);
});

test("task navigation sorting is isolated, optimistic, and rolls back independently", () => {
  assert.match(source, /items=\{navigationOrder\.map\(\(id\) => `view:\$\{id\}`\)\}/);
  assert.match(source, /<DndContext sensors=\{sensors\} collisionDetection=\{closestCenter\} onDragEnd=\{\(event\) => void navigationDragEnd\(event\)\}>/);
  assert.match(source, /navigationSaveInFlight\.current/);
  assert.match(source, /setNavigationOrder\(next\)/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /JSON\.stringify\(\{ order: next \}\)/);
  assert.match(source, /setNavigationOrder\(before\)/);
  assert.match(source, /setNavigationSaving\(true\)/);
  assert.doesNotMatch(source, /setSaving\(true\)[\s\S]{0,120}navigation-order/);
  assert.match(source, /PointerSensor/);
  assert.match(source, /TouchSensor/);
  assert.match(source, /KeyboardSensor/);
  assert.match(source, /className="sr-only" role="status" aria-live="polite"/);
});

test("task navigation preferences are bound to the initiating account and stale work is invalidated", () => {
  assert.match(source, /const \{ supabase, user, isAdmin/);
  assert.match(source, /const accountId = user\?\.id \?\? null/);
  assert.match(source, /sessionData\.session\.user\.id !== expectedAccountId/);
  assert.match(source, /accountIdRef\.current !== requestedAccountId/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*navigationLoadGeneration\.current\+\+/);
  assert.match(source, /navigationSaveGeneration\.current\+\+/);
  assert.match(source, /navigationLoadAbort\.current\?\.abort\(\)/);
  assert.match(source, /navigationSaveAbort\.current\?\.abort\(\)/);
  assert.match(source, /setNavigationOrder\(DEFAULT_NAVIGATION_ORDER\)/);
  assert.match(source, /setNavigationReadyAccountId\(null\)/);
  assert.match(source, /setNavigationSaving\(false\)/);
});

test("failed task-navigation loads disable only sorting and expose a focused retry", () => {
  assert.match(source, /const navigationReady = Boolean\(accountId && navigationReadyAccountId === accountId\)/);
  assert.match(source, /disabled=\{!navigationReady \|\| navigationLoading \|\| navigationSaving\}/);
  assert.match(source, /onSelect=\{\(\) => select\(id\)\}/);
  assert.match(source, /if \(!navigationReady \|\| navigationLoading \|\| !accountId/);
  assert.match(source, /onClick=\{\(\) => void loadNavigationPreference\(\)\}/);
  assert.match(source, />\{navigationLoading \? "Retrying…" : "Retry"\}<\/button>/);
  assert.match(source, /sorting is unavailable/);
});

test("task navigation has no permanent feedback row and clears success announcements", () => {
  const styles = readFileSync("app/tasks/tasks.css", "utf8");
  assert.doesNotMatch(source, /task-navigation-feedback|navigationStatus \|\| " "/);
  assert.doesNotMatch(styles, /task-navigation-feedback|min-height: 24px/);
  assert.match(source, /className="sr-only" role="status" aria-live="polite"/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /setNavigationStatus\(""\)/);
  assert.match(source, /\}, 2400\)/);
  assert.match(source, /navigationError && <div className="task-navigation-error" role="alert">/);
});
