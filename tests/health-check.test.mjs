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
  const hostname = args.find((arg) => arg.startsWith("name="))?.slice(5);
  const hostResponses = JSON.parse(process.env.MOCK_DNS_HOST_RESPONSES || "{}");
  const response = hostResponses[hostname]?.[type] ?? responses[type] ?? { Status: 3 };
  process.stdout.write(typeof response === "string" ? response : JSON.stringify(response));
} else if (args.includes("--write-out")) {
  const entry = args.includes("https://main.example/pi-web");
  process.stdout.write(entry ? (process.env.MOCK_AGENT_ENTRY_STATUS || "200") : (process.env.MOCK_RETIRED_HTTP_STATUS || "404"));
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
        RETIRED_AGENT_HOSTNAME: "retired-agent.example",
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
    assert.equal(dns.length, 6);
    for (const hostname of ["retired.example", "retired-agent.example"]) {
      assert.match(stdout, new RegExp(`retired DNS ${hostname.replaceAll(".", "\\.")} \\(NXDOMAIN\\)`));
      for (const type of ["A", "AAAA", "CNAME"]) {
        assert.ok(dns.some((args) => args.includes(`type=${type}`) && args.includes(`name=${hostname}`)));
      }
    }
    assert.ok(requests.every((args) => !args.some((arg) => arg.startsWith("https://retired.example"))));
    const probed = requests.filter((args) => args.includes("--write-out")).map((args) => args[args.length - 1]);
    assert.equal(probed.length, 8);
    for (const pathname of ["/drive", "/api/drive", "/drive/file/retired", "/feeds", "/api/news", "/pi", "/pi/session", "/pi-web"]) {
      assert.ok(probed.some((url) => url === `https://main.example${pathname}`), pathname);
    }
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
        await assert.rejects(execute, /Expected retired DNS NXDOMAIN/);
      });
    });
  }
});

test("health also rejects an old Agent hostname that still resolves", async () => {
  await withMockCurl({ MOCK_DNS_HOST_RESPONSES: JSON.stringify({ "retired-agent.example": { A: { Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] } } }) }, async (execute) => {
    await assert.rejects(execute, /Expected retired DNS NXDOMAIN: retired-agent\.example/);
  });
});

test("health requires the main-site Pi Web entry to be a real page, not a redirect", async () => {
  for (const status of ["404", "307", "308", "500"]) {
    await withMockCurl({ MOCK_AGENT_ENTRY_STATUS: status }, async (execute) => {
      await assert.rejects(execute, /Expected embedded Pi Web entry to return 200/);
    });
  }
});

test("health fails closed on DNS transport errors and old main-site Drive revival", async () => {
  await withMockCurl({ MOCK_DNS_TRANSPORT_FAIL: "1" }, async (execute) => {
    await assert.rejects(execute, { code: 22 });
  });
  await withMockCurl({ MOCK_RETIRED_HTTP_STATUS: "200" }, async (execute) => {
    await assert.rejects(execute, /Expected retired path to return 404/);
  });
});
