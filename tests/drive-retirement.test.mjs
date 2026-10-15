import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRetiredDriveRequest, retiredDriveResponse } from "../app/lib/retired-drive.ts";

const run = promisify(execFile);

test("all retired Drive namespaces and its entire former hostname are blocked", () => {
  for (const host of ["labulubius.com", "www.labulubius.com", "localhost"]) {
    for (const pathname of ["/drive", "/drive/", "/drive/file/opaque-id", "/drive/file/opaque-id/download", "/api/drive", "/api/drive/upload", "/api/drive/shares/id", "/api/drive/download"]) {
      assert.equal(isRetiredDriveRequest(host, pathname), true, `${host}${pathname}`);
    }
  }
  for (const host of ["drive.labulubius.com", "DRIVE.LABULUBIUS.COM", "drive.localhost"]) {
    for (const pathname of ["/", "/api/health", "/api/tasks", "/favicon.ico", "/_next/static/old.js"]) {
      assert.equal(isRetiredDriveRequest(host, pathname), true, `${host}${pathname}`);
    }
  }
});

test("retirement does not capture neighboring routes, other apps or Zotero", () => {
  for (const pathname of ["/", "/nav", "/feeds", "/agent", "/about", "/api/health", "/api/tasks", "/api/news", "/driveway", "/api/driver", "/zotero/"]) {
    assert.equal(isRetiredDriveRequest("labulubius.com", pathname), false, pathname);
  }
  assert.equal(isRetiredDriveRequest("dav.labulubius.com", "/zotero/"), false);
  assert.equal(isRetiredDriveRequest("not-drive.labulubius.com", "/"), false);
});

test("every HTTP method gets an uncached retirement response without CORS or a download", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"]) {
    const response = retiredDriveResponse(method);
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.equal(response.headers.has("content-disposition"), false);
    assert.equal(await response.text(), method === "HEAD" ? "" : "Drive has been retired.\n");
  }
});

test("Drive UI, storage handlers and public download implementations are removed", async () => {
  for (const name of ["app/drive", "app/api/drive", "app/drive-shortcut.tsx", "app/lib/drive-server.ts", "app/lib/drive-shares.ts", "app/lib/upload-sessions.ts", "app/lib/upload-client.ts", "app/share/page.tsx", "app/share/[id]/page.tsx", "app/api/share/[id]/route.ts"]) {
    await assert.rejects(access(new URL(`../${name}`, import.meta.url)), { code: "ENOENT" });
  }
  for (const name of ["app/site-shell.tsx", "app/places-sidebar.tsx"]) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["\x27]\/drive["\x27]|HardDrive/);
    assert.match(source, /\/agent/);
    assert.match(source, /\/feeds/);
  }
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /isRetiredDriveRequest\(hostname, request.nextUrl.pathname\)/);
  assert.match(source, /retiredDriveResponse\(request.method\)/);
  assert.ok(source.indexOf("isRetiredDriveRequest(hostname") < source.indexOf("if (isWwwHost)"));
  assert.match(source, /type: "host", value: "drive.labulubius.com"/);
});

test("current backups no longer require a deleted Drive directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "retired-drive-backup-"));
  try {
    const tasks = path.join(root, "tasks");
    const news = path.join(root, "news");
    await mkdir(tasks);
    await mkdir(news);
    const result = await run(process.execPath, ["scripts/verify-backup.mjs", "--tasks", tasks, "--news", news], { cwd: new URL("..", import.meta.url) });
    assert.match(result.stdout, /Backup structure verified successfully/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
