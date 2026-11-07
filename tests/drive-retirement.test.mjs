import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

test("retirement is a plain 404 with no application-level guard", async () => {
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(proxy, /410|isRetiredDriveRequest|retiredDriveResponse|drive\.labulubius\.com|drive\.localhost/);
  assert.match(proxy, /hostname === "www\.labulubius\.com"/);
  assert.match(proxy, /NextResponse\.redirect\(url, 308\)/);
  await assert.rejects(access(new URL("../app/lib/retired-drive.ts", import.meta.url)), { code: "ENOENT" });
});

test("Drive UI, storage handlers and public download implementations are removed", async () => {
  for (const name of ["app/drive", "app/api/drive", "app/drive-shortcut.tsx", "app/lib/drive-server.ts", "app/lib/drive-shares.ts", "app/lib/upload-sessions.ts", "app/lib/upload-client.ts", "app/share/page.tsx", "app/share/[id]/page.tsx", "app/api/share/[id]/route.ts"]) {
    await assert.rejects(access(new URL(`../${name}`, import.meta.url)), { code: "ENOENT" });
  }
  for (const name of ["app/site-shell.tsx", "app/places-sidebar.tsx"]) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["'\x27]\/drive[\x27"]|HardDrive/);
    assert.match(source, /\/pi/);
  }
});

test("current backups no longer require a deleted Drive or News directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "retired-drive-backup-"));
  try {
    const tasks = path.join(root, "tasks");
    await mkdir(tasks);
    const result = await run(process.execPath, ["scripts/verify-backup.mjs", "--tasks", tasks], { cwd: new URL("..", import.meta.url) });
    assert.match(result.stdout, /Backup structure verified successfully/);
    const script = await readFile(new URL("../scripts/verify-backup.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(script, /--news|News backup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
