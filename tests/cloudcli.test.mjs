import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import nextConfig from "../next.config.ts";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const nginx = process.env.CLOUDCLI_TEST_NGINX || "/usr/sbin/nginx";

test("CloudCLI navigation is a main-site route, not a backend-hostname link or redirect", async () => {
  for (const file of ["app/site-shell.tsx", "app/places-sidebar.tsx"]) {
    const source = await read(file);
    assert.match(source, /["']\/cloudcli["']/);
    assert.doesNotMatch(source, /https:\/\/cloudcli\.labulubius\.com/);
  }
  const page = await read("app/cloudcli/page.tsx");
  assert.doesNotMatch(page, /redirect\(|<iframe|<CloudCLIFrame/);
  assert.match(page, /index: false, follow: false/);
  assert.ok((await nextConfig.redirects?.() ?? []).every(({ source }) => source !== "/cloudcli"));
});

test("CloudCLI iframe is persistent and independent of Pi Web and main-site auth", async () => {
  const layout = await read("app/layout.tsx");
  const keeper = await read("app/persistent-cloudcli.tsx");
  const frame = await read("app/cloudcli/cloudcli-frame.tsx");
  assert.match(layout, /<PersistentCloudCLI><PersistentAgent>\{children\}<\/PersistentAgent><\/PersistentCloudCLI>/);
  assert.match(keeper, /pathname === "\/cloudcli"/);
  assert.match(keeper, /cloudcliMounted \|\| isCloudCLIRoute/);
  assert.match(keeper, /hidden=\{!isCloudCLIRoute\}/);
  assert.match(keeper, /<CloudCLIFrame \/>/);
  assert.match(frame, /src="https:\/\/cloudcli\.labulubius\.com"/);
  assert.match(frame, /title="CloudCLI"/);
  assert.match(frame, /clipboard-read; clipboard-write; fullscreen/);
  assert.match(frame, /role=\{failed \? "alert" : "status"\}/);
  assert.match(frame, /Retry CloudCLI/);
  assert.doesNotMatch(frame + keeper, /supabase|getSession|access_token|Authorization|owner-auth|window\.location/);
});

test("main CSP allows exactly the Pi Web and CloudCLI iframe backends", async () => {
  const rules = await nextConfig.headers();
  const csp = rules[0].headers.find(({ key }) => key === "Content-Security-Policy").value;
  const frames = csp.split(";").map((value) => value.trim()).find((value) => value.startsWith("frame-src "));
  assert.equal(frames, "frame-src https://pi-web.labulubius.com https://cloudcli.labulubius.com");
  assert.match(csp, /frame-ancestors 'none'/);
});

test("CloudCLI proxy stays private, disables public registration and preserves streaming", async () => {
  const config = await read("deploy/cloudcli/nginx.conf");
  assert.match(config, /listen 127\.0\.0\.1:30144;/);
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:30143;/);
  assert.match(config, /location ~\* \^\/api\/auth\/register/);
  assert.match(config, /return 403;/);
  assert.match(config, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(config, /proxy_set_header Connection \$cloudcli_connection_upgrade/);
  assert.match(config, /proxy_buffering off;/);
  assert.match(config, /private, no-store/);
  assert.match(config, /access_log off;/);
  assert.match(config, /error_log \/dev\/null crit;/);
  assert.doesNotMatch(config, /proxy_set_header Authorization|auth_request|platform_mode/);
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("real Nginx blocks setup variants, preserves native auth, uploads, SSE and WebSocket upgrade", {
  skip: existsSync(nginx) ? false : "Nginx not installed",
  timeout: 20_000,
}, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "cloudcli-proxy-test-"));
  const calls = [];
  const sockets = new Set();
  let releaseStream;
  let child;
  let stderr = "";
  const backend = http.createServer(async (req, res) => {
    calls.push(req.url);
    if (req.url.startsWith("/api/") && req.headers.authorization !== "Bearer fixture-only") {
      res.writeHead(401).end("Authentication required");
      return;
    }
    if (req.url === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      res.write("data: first\n\n");
      await new Promise((resolve) => { releaseStream = resolve; });
      res.end("data: done\n\n");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ url: req.url, bytes: Buffer.concat(chunks).length, proto: req.headers["x-forwarded-proto"] }));
  });
  backend.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  backend.on("upgrade", (req, socket) => {
    assert.equal(req.url, "/ws?token=fixture-only");
    assert.equal(req.headers.upgrade, "websocket");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  try {
    const backendPort = await listen(backend);
    const reserve = http.createServer();
    const port = await listen(reserve);
    await close(reserve);
    const source = (await read("deploy/cloudcli/nginx.conf"))
      .replaceAll("127.0.0.1:30143", `127.0.0.1:${backendPort}`)
      .replace("127.0.0.1:30144", `127.0.0.1:${port}`);
    await writeFile(path.join(temp, "nginx.conf"), `daemon off;
master_process off;
error_log stderr error;
pid ${temp}/nginx.pid;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path ${temp}/body;
  proxy_temp_path ${temp}/proxy;
  ${source}
}
`);
    child = spawn(nginx, ["-p", `${temp}/`, "-c", path.join(temp, "nginx.conf")], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    function request(url, { method = "GET", authenticated = false, body } = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: url, method,
          headers: { Host: "cloudcli.labulubius.com", ...(authenticated ? { Authorization: "Bearer fixture-only" } : {}) },
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
        });
        req.setTimeout(3000, () => req.destroy(new Error("fixture request timed out")));
        req.on("error", reject);
        req.end(body);
      });
    }
    for (let attempt = 0; ; attempt++) {
      try { await request("/health"); break; }
      catch (error) {
        if (attempt >= 99 || child.exitCode !== null) throw new Error(`Nginx failed to start: ${stderr}`, { cause: error });
        await delay(20);
      }
    }
    for (const url of ["/api/auth/register", "/api/auth/register/", "/API/AUTH/REGISTER", "//api//auth//register", "/%61pi/auth/register", "/api/auth/register?probe=1"]) {
      const denied = await request(url, { method: "POST", body: "fixture" });
      assert.equal(denied.status, 403, url);
      assert.match(denied.headers["cache-control"], /no-store/);
      assert.ok(!calls.includes(url), `${url} must not reach the native setup handler`);
    }
    assert.equal((await request("/api/projects")).status, 401);
    const allowed = await request("/api/projects", { authenticated: true });
    assert.equal(allowed.status, 200);
    assert.equal(JSON.parse(allowed.body).proto, "https");
    assert.equal(allowed.headers["cache-control"], "private, no-store");
    assert.equal(allowed.headers["content-security-policy"], "frame-ancestors https://labulubius.com");
    const uploaded = await request("/api/assets", { method: "POST", authenticated: true, body: Buffer.alloc(256 * 1024, "x") });
    assert.equal(JSON.parse(uploaded.body).bytes, 256 * 1024);
    await new Promise((resolve, reject) => {
      let first = true;
      const req = http.get({ host: "127.0.0.1", port, path: "/api/stream", headers: { Authorization: "Bearer fixture-only" } }, (res) => {
        res.on("data", (chunk) => {
          if (first) {
            first = false;
            assert.match(chunk.toString(), /data: first/);
            releaseStream();
          }
        });
        res.on("end", resolve);
      });
      req.setTimeout(2000, () => req.destroy(new Error("SSE was buffered instead of streamed")));
      req.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/ws?token=fixture-only",
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.on("upgrade", (res, socket) => {
        assert.equal(res.statusCode, 101);
        socket.destroy();
        resolve();
      });
      req.on("response", (res) => { res.resume(); reject(new Error(`Upgrade returned ${res.statusCode}`)); });
      req.on("error", reject);
      req.setTimeout(2000, () => req.destroy(new Error("WebSocket upgrade timeout")));
      req.end();
    });
  } finally {
    releaseStream?.();
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    for (const socket of sockets) socket.destroy();
    await close(backend);
    await rm(temp, { recursive: true, force: true });
  }
});
