import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = ["scripts/verify-backup.mjs", "--tasks"];
const cwd = new URL("..", import.meta.url);

async function backup(t, data) {
  const root = await mkdtemp(path.join(tmpdir(), "verify-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tasks = path.join(root, "tasks");
  await mkdir(tasks);
  if (data) await writeFile(path.join(tasks, "tasks.json"), JSON.stringify(data));
  return tasks;
}

test("backup verification accepts the task data version the server currently writes", async (t) => {
  const tasks = await backup(t, { version: 6, tasks: [], projects: [] });
  const result = await run(process.execPath, [...script, tasks], { cwd });
  assert.match(result.stdout, /Backup structure verified successfully/);
});

test("backup verification rejects unknown task data versions and shapes", async (t) => {
  for (const data of [{ version: 99, tasks: [], projects: [] }, { version: 6, tasks: {}, projects: [] }]) {
    const tasks = await backup(t, data);
    await assert.rejects(run(process.execPath, [...script, tasks], { cwd }), (error) => /invalid data structure/.test(error.stderr));
  }
});
