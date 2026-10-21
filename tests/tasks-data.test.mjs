import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(file, imports, environment) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", code)((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), exports, environment);
  return exports;
}
const projectOrder = compile("app/tasks/project-order.ts", {}, process);
const taskTypes = compile("app/tasks/task-types.ts", {}, process);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "tasks-regression-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = compile("app/lib/tasks-server.ts", { "server-only": {}, "../tasks/project-order": projectOrder, "../tasks/task-types": taskTypes }, {
    env: { TASKS_DATA_DIR: root }, cwd: () => process.cwd(),
  });
  return { ...server, root };
}
const range = { startDate: "2026-10-10", endDate: "2026-10-15" };

test("uncategorized task descriptions and dates survive create, update and reload", async (t) => {
  const api = await fixture(t);
  let data = await api.createTask({ title: "Report", description: " First line\nSecond line ", ...range });
  const id = data.tasks[0].id;
  assert.equal(data.version, 4);
  assert.equal(data.tasks[0].projectId, null);
  assert.equal(data.tasks[0].description, "First line\nSecond line");
  assert.deepEqual(await api.loadTaskData(), data);
  data = await api.updateTask(id, { title: "Updated report" });
  assert.equal(data.tasks[0].description, "First line\nSecond line");
  assert.equal(data.tasks[0].endDate, range.endDate);
  data = await api.updateTask(id, { description: "", startDate: null, endDate: null });
  assert.equal(data.tasks[0].description, "");
  assert.equal(data.tasks[0].startDate, null);
  data = await api.updateTask(id, { description: "New description", ...range });
  assert.equal(data.tasks[0].description, "New description");
  assert.equal(data.tasks[0].startDate, range.startDate);
  assert.deepEqual(await api.loadTaskData(), data);
  data = await api.createTask({ title: "No optional fields" });
  assert.equal(data.tasks[0].description, "");
  assert.equal(data.tasks[0].startDate, null);
});

test("moving out of or deleting a project preserves task descriptions and dates", async (t) => {
  const api = await fixture(t);
  let data = await api.createProject({ name: "Course" });
  const projectId = data.projects[0].id;
  data = await api.createTask({ title: "Report", description: "Keep me", projectId, ...range });
  const id = data.tasks[0].id;
  data = await api.updateTask(id, { projectId: null });
  assert.equal(data.tasks[0].projectId, null);
  assert.equal(data.tasks[0].startDate, range.startDate);
  await api.updateTask(id, { projectId });
  data = await api.deleteProject(projectId);
  assert.deepEqual(data.projects.map(({ id }) => id), [taskTypes.TASK_ARCHIVE_PROJECT_ID]);
  assert.equal(data.tasks[0].projectId, null);
  assert.equal(data.tasks[0].description, "Keep me");
  assert.equal(data.tasks[0].startDate, range.startDate);
  assert.equal(data.tasks[0].endDate, range.endDate);
  assert.deepEqual(await api.loadTaskData(), data);
});

test("invalid descriptions and date ranges never overwrite existing data", async (t) => {
  const api = await fixture(t);
  const data = await api.createTask({ title: "Original", description: "x".repeat(300), ...range });
  const id = data.tasks[0].id;
  const invalid = [
    { description: "x".repeat(301) }, { description: null }, { description: 12 },
    { startDate: "2026-02-30" }, { endDate: "2026-10-09" }, { startDate: null },
  ];
  for (const patch of invalid) {
    await assert.rejects(api.updateTask(id, patch), /Invalid/);
    await assert.rejects(api.createTask({ title: "Invalid", ...range, ...patch }), /Invalid/);
    assert.deepEqual(await api.loadTaskData(), data);
  }
});

for (const version of [1, 2, 3]) {
  test(`version ${version} tasks migrate to descriptions without losing dates`, async (t) => {
    const api = await fixture(t);
    const task = {
      id: "11111111-1111-4111-8111-111111111111", title: "Old task", projectId: null,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
      ...(version === 1 ? { date: range.startDate, notes: "", completedAt: null, startMinute: null, durationMinutes: 30 } : range),
      ...(version === 2 ? { notes: "" } : {}),
    };
    await writeFile(path.join(api.root, "tasks.json"), JSON.stringify({ version, tasks: [task], projects: [] }));
    const data = await api.loadTaskData();
    assert.equal(data.version, 4);
    assert.equal(data.tasks[0].description, "");
    assert.equal(data.tasks[0].startDate, range.startDate);
    assert.equal(data.tasks[0].endDate, version === 1 ? range.startDate : range.endDate);
    assert.deepEqual(JSON.parse(await readFile(path.join(api.root, "tasks.json"), "utf8")), data);
    assert.deepEqual(await api.loadTaskData(), data);
  });
}

test("invalid stored description is rejected rather than silently discarded", async (t) => {
  const api = await fixture(t);
  const data = await api.createTask({ title: "Task" });
  data.tasks[0].description = "x".repeat(301);
  await writeFile(path.join(api.root, "tasks.json"), JSON.stringify(data));
  await assert.rejects(api.loadTaskData(), /Stored task data is invalid/);
});

test("Archive is initialized as one protected system project", async (t) => {
  const api = await fixture(t);
  let data = await api.loadTaskData();
  assert.deepEqual(data.projects.map(({ id, name }) => ({ id, name })), [{ id: taskTypes.TASK_ARCHIVE_PROJECT_ID, name: "Archive" }]);
  data = await api.createProject({ name: "Course" });
  assert.deepEqual(data.projects.map(({ name }) => name), ["Course", "Archive"]);
  data = await api.createTask({ title: "Later", projectId: taskTypes.TASK_ARCHIVE_PROJECT_ID, ...range });
  assert.equal(taskTypes.isArchivedTask(data.tasks[0]), true);
  await assert.rejects(api.createProject({ name: "archive" }), /already exists/);
  await assert.rejects(api.updateProject(taskTypes.TASK_ARCHIVE_PROJECT_ID, { name: "Later" }), /Invalid project/);
  await assert.rejects(api.deleteProject(taskTypes.TASK_ARCHIVE_PROJECT_ID), /Invalid project/);
  assert.equal((await api.loadTaskData()).tasks[0].projectId, taskTypes.TASK_ARCHIVE_PROJECT_ID);
});

test("an existing Archive project migrates to the stable system ID", async (t) => {
  const api = await fixture(t);
  const previousId = "11111111-1111-4111-8111-111111111111";
  const taskId = "22222222-2222-4222-8222-222222222222";
  const timestamp = "2026-10-01T00:00:00.000Z";
  await writeFile(path.join(api.root, "tasks.json"), JSON.stringify({
    version: 4,
    projects: [{ id: previousId, name: "archive", createdAt: timestamp, updatedAt: timestamp }],
    tasks: [{ id: taskId, title: "Later", description: "", projectId: previousId, ...range, createdAt: timestamp, updatedAt: timestamp }],
  }));
  const data = await api.loadTaskData();
  assert.deepEqual(data.projects.map(({ id, name }) => ({ id, name })), [{ id: taskTypes.TASK_ARCHIVE_PROJECT_ID, name: "Archive" }]);
  assert.equal(data.tasks[0].projectId, taskTypes.TASK_ARCHIVE_PROJECT_ID);
  assert.deepEqual(JSON.parse(await readFile(path.join(api.root, "tasks.json"), "utf8")), data);
});
