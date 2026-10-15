import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function withMockCurl(overrides, check) {
  const root = await mkdtemp(path.join(tmpdir(), "drive-dns-health-"));
  const log = path.join(root, "calls.jsonl");
  try {
    await writeFile(path.join(root, "curl"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_CURL_LOG, JSON.stringify(args) + "\\n");
if (args.includes("https://cloudflare-dns.com/dns-query")) {
  if (process.env.MOCK_DNS_TRANSPORT_FAIL === "1") process.exit(22);
  const type = args.find((arg) => arg.startsWith("type="))?.slice(5);
  const responses = JSON.parse(process.env.MOCK_DNS_RESPONSES || "{}");
  const response = responses[type] ?? { Status: 3 };
  process.stdout.write(typeof response === "string" ? response : JSON.stringify(response));
} else if (args.includes("--write-out")) {
  process.stdout.write(process.env.MOCK_DRIVE_HTTP_STATUS || "410");
} else if (args.some((arg) => arg.endsWith("/api/health"))) {
  process.stdout.write('{"status":"ok"}');
}
`, { mode: 0o700 });
    const execute = () => run("bash", ["scripts/health-check.sh"], {
      cwd: new URL("..", import.meta.url),
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH}`,
        MAIN_ORIGIN: "https://main.example",
        AGENT_ORIGIN: "https://agent.example",
        RETIRED_DRIVE_HOSTNAME: "retired.example",
        MOCK_CURL_LOG: log,
        ...overrides,
      },
    });
    await check(execute, async () => (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("health requires DNS NXDOMAIN for every old-host record type, not an HTTP tombstone", async () => {
  await withMockCurl({}, async (execute, calls) => {
    const { stdout } = await execute();
    assert.match(stdout, /retired DNS retired\.example \(NXDOMAIN\)/);
    const requests = await calls();
    const dns = requests.filter((args) => args.includes("https://cloudflare-dns.com/dns-query"));
    assert.equal(dns.length, 3);
    for (const type of ["A", "AAAA", "CNAME"]) {
      assert.ok(dns.some((args) => args.includes(`type=${type}`) && args.includes("name=retired.example")));
    }
    assert.ok(requests.every((args) => !args.some((arg) => arg.startsWith("https://retired.example"))));
    assert.equal(requests.filter((args) => args.includes("--write-out")).length, 3);
  });
});

test("health rejects resolvable, empty-success, failing or malformed DNS replies", async (t) => {
  const cases = [
    ["A still resolves", "A", { Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] }],
    ["AAAA still resolves", "AAAA", { Status: 0, Answer: [{ type: 28, data: "2001:db8::1" }] }],
    ["CNAME still exists", "CNAME", { Status: 0, Answer: [{ type: 5, data: "tunnel.example" }] }],
    ["NODATA is not NXDOMAIN", "A", { Status: 0 }],
    ["SERVFAIL is not NXDOMAIN", "A", { Status: 2 }],
    ["answers contradict NXDOMAIN", "A", { Status: 3, Answer: [{ type: 1, data: "192.0.2.1" }] }],
    ["missing DNS status", "A", {}],
    ["malformed JSON", "A", "not JSON"],
  ];
  for (const [name, type, response] of cases) {
    await t.test(name, async () => {
      await withMockCurl({ MOCK_DNS_RESPONSES: JSON.stringify({ [type]: response }) }, async (execute) => {
        await assert.rejects(execute, /Expected retired Drive DNS NXDOMAIN/);
      });
    });
  }
});

test("health fails closed on DNS transport errors and old main-site Drive revival", async () => {
  await withMockCurl({ MOCK_DNS_TRANSPORT_FAIL: "1" }, async (execute) => {
    await assert.rejects(execute, { code: 22 });
  });
  await withMockCurl({ MOCK_DRIVE_HTTP_STATUS: "200" }, async (execute) => {
    await assert.rejects(execute, /Expected retired Drive to return 410/);
  });
});
