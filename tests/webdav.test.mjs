import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const configUrl = new URL("../deploy/webdav/nginx.conf", import.meta.url);
const nginx = process.env.WEBDAV_TEST_NGINX || "/usr/sbin/nginx";
const modulePath = process.env.WEBDAV_TEST_MODULE || "/usr/lib/nginx/modules/ngx_http_dav_ext_module.so";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("WebDAV has one authenticated file root and no Zotero-specific folder rules", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.match(config, /listen 127\.0\.0\.1:8081;/);
  assert.match(config, /listen 127\.0\.0\.1:8084;/);
  assert.match(config, /proxy_set_header Destination \$webdav_destination;/);
  assert.match(config, /proxy_request_buffering on;/);
  assert.match(config, /root \/srv\/webdav-data;/);
  assert.match(config, /absolute_redirect off;/);
  assert.match(config, /location \/ \{\s+auth_request \/_zotero_auth;/);
  assert.match(config, /dav_methods PUT DELETE MKCOL COPY MOVE;/);
  assert.match(config, /dav_ext_methods PROPFIND OPTIONS;/);
  assert.match(config, /private, no-store/);
  assert.match(config, /client_max_body_size 95m;/);
  assert.doesNotMatch(config, /location[^\n]*\/zotero|alias\s|\/srv\/zotero-data|return 404|limit_except/);
});

test("real Nginx lists the root and treats zotero exactly like any ordinary folder", {
  skip: !existsSync(nginx) || !existsSync(modulePath) ? "Nginx DAV module not installed" : false,
  timeout: 30_000,
}, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "webdav-test-"));
  const root = path.join(temp, "data");
  const source = await readFile(configUrl, "utf8");
  const authorization = `Basic ${Buffer.from("fixture@example.invalid:fixture-only").toString("base64")}`;
  const auth = http.createServer((req, res) => {
    assert.equal(req.url, "/auth");
    if (req.headers.authorization === authorization) {
      res.writeHead(204).end();
    } else {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Test WebDAV"' }).end();
    }
  });
  let child;
  let stderr = "";
  try {
    await mkdir(path.join(root, "zotero"), { recursive: true });
    await writeFile(path.join(root, "zotero", "existing.zip"), "existing attachment fixture");
    const authPort = await listen(auth);
    const reservation = http.createServer();
    const port = await listen(reservation);
    const backendReservation = http.createServer();
    const backendPort = await listen(backendReservation);
    await close(reservation);
    await close(backendReservation);
    const server = source
      .replace("127.0.0.1:8081", `127.0.0.1:${port}`)
      .replaceAll("127.0.0.1:8084", `127.0.0.1:${backendPort}`)
      .replace("127.0.0.1:8082", `127.0.0.1:${authPort}`)
      .replace("/srv/webdav-data", root);
    await writeFile(path.join(temp, "nginx.conf"), `load_module ${modulePath};
daemon off;
master_process off;
error_log stderr error;
pid ${temp}/nginx.pid;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path ${temp}/body;
  proxy_temp_path ${temp}/proxy;
  fastcgi_temp_path ${temp}/fastcgi;
  uwsgi_temp_path ${temp}/uwsgi;
  scgi_temp_path ${temp}/scgi;
  ${server}
}
`);
    child = spawn(nginx, ["-p", `${temp}/`, "-c", path.join(temp, "nginx.conf")], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    async function request(method, url, headers = {}, body, authenticated = true, targetPort = port) {
      return new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${targetPort}` + url, {
          method,
          headers: { Host: "dav.labulubius.com", ...(authenticated ? { Authorization: authorization } : {}), ...headers },
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
        });
        req.setTimeout(5_000, () => req.destroy(new Error("WebDAV fixture request timed out")));
        req.on("error", reject);
        if (headers["Transfer-Encoding"] === "chunked") {
          // Flush headers before the terminating chunk, as streaming gateways do.
          req.flushHeaders();
          void delay(40).then(() => req.end(body));
        } else {
          req.end(body);
        }
      });
    }
    for (let attempt = 0; ; attempt++) {
      try { await request("OPTIONS", "/"); break; }
      catch (error) {
        if (attempt >= 99 || child.exitCode !== null) throw new Error(`Nginx did not start: ${stderr}`, { cause: error });
        await delay(20);
      }
    }
    for (const url of ["/", "/zotero/", "/zotero/existing.zip"]) {
      const denied = await request("PROPFIND", url, { Depth: "1" }, undefined, false);
      assert.equal(denied.status, 401, url);
      assert.match(denied.headers["cache-control"], /no-store/);
    }
    assert.equal((await request("PROPFIND", "/", { Depth: "1" }, undefined, false, backendPort)).status, 401);
    for (const method of ["GET", "PUT", "MKCOL", "MOVE", "COPY", "DELETE"]) {
      const denied = await request(method, "/zotero/", { Destination: "https://dav.labulubius.com/anonymous/" }, undefined, false);
      assert.equal(denied.status, 401, `anonymous ${method}`);
    }
    const invalid = await request("PROPFIND", "/", { Authorization: "Basic invalid", Depth: "1" });
    assert.equal(invalid.status, 401);
    const listing = await request("PROPFIND", "/", { Depth: "1" });
    assert.equal(listing.status, 207, listing.body);
    assert.match(listing.body, /<[^>]*href>\/zotero\//);
    assert.match(listing.headers["cache-control"], /no-store/);
    assert.equal((await request("GET", "/zotero/existing.zip")).body, "existing attachment fixture");
    // Solid Explorer / HTTP gateways can send an empty body with chunked framing.
    // Nginx DAV must receive Content-Length: 0, not Transfer-Encoding: chunked.
    for (const suffix of ["", "/"]) {
      const folder = `/${encodeURIComponent("数据结构")}${suffix}`;
      const created = await request("MKCOL", folder, { "Transfer-Encoding": "chunked" });
      assert.equal(created.status, 201, `empty chunked MKCOL: ${created.status} ${created.body}`);
      assert.equal((await request("DELETE", `/${encodeURIComponent("数据结构")}/`)).status, 204);
    }
    const withBody = await request("MKCOL", "/unsupported-body/", { "Content-Type": "application/xml" }, "<unsupported/>");
    assert.equal(withBody.status, 415, "real MKCOL bodies must not be silently discarded");
    assert.equal((await request("PROPFIND", "/unsupported-body/", { Depth: "0" })).status, 404);
    const chunkedBody = await request("MKCOL", "/unsupported-chunked-body/", { "Transfer-Encoding": "chunked" }, "<unsupported/>");
    assert.equal(chunkedBody.status, 415);
    assert.equal((await request("PROPFIND", "/unsupported-chunked-body/", { Depth: "0" })).status, 404);
    const anonymousChunked = await request("MKCOL", "/anonymous-chunked/", { "Transfer-Encoding": "chunked" }, undefined, false);
    assert.equal(anonymousChunked.status, 401);
    assert.equal((await request("PUT", "/chunked-upload.txt", { "Transfer-Encoding": "chunked" }, "chunked upload fixture")).status, 201);
    assert.equal((await request("GET", "/chunked-upload.txt")).body, "chunked upload fixture");
    assert.equal((await request("DELETE", "/chunked-upload.txt")).status, 204);
    for (const folder of ["Documents", "zotero"]) {
      if (folder !== "zotero") assert.equal((await request("MKCOL", `/${folder}`)).status, 201);
      const file = `/${folder}/sample%20file.prop`;
      assert.equal((await request("PUT", file, { "Content-Type": "application/octet-stream" }, "fixture payload")).status, 201);
      assert.equal((await request("GET", file)).body, "fixture payload");
      assert.equal((await request("PUT", file, { "Transfer-Encoding": "chunked" }, "updated fixture payload")).status, 204);
      assert.equal((await request("GET", file)).body, "updated fixture payload");
      assert.equal((await request("PUT", file, {}, "fixture payload")).status, 204);
      const destination = `https://dav.labulubius.com:443/${folder}/renamed.prop`;
      const moved = await request("MOVE", file, { Destination: destination, Overwrite: "F" });
      assert.ok([201, 204].includes(moved.status), `${folder} file MOVE: ${moved.status} ${moved.body}`);
      assert.equal((await request("GET", file)).status, 404);
      assert.ok(!moved.headers.location?.startsWith("http:"), moved.headers.location);
      assert.equal((await request("GET", `/${folder}/renamed.prop`)).body, "fixture payload");
      const unicodeFile = `/${folder}/${encodeURIComponent("中文文件.txt")}`;
      assert.equal((await request("PUT", unicodeFile, {}, "unicode fixture")).status, 201);
      assert.equal((await request("GET", unicodeFile)).body, "unicode fixture");
      const renamed = `/renamed-${folder}/`;
      const movedFolder = await request("MOVE", `/${folder}/`, { Destination: `https://dav.labulubius.com${renamed}`, Overwrite: "F" });
      assert.ok([201, 204].includes(movedFolder.status), `${folder} folder MOVE: ${movedFolder.status} ${movedFolder.body}`);
      assert.ok(!movedFolder.headers.location?.startsWith("http:"), movedFolder.headers.location);
      const copied = await request("COPY", renamed, { Destination: `https://dav.labulubius.com/copy-${folder}/`, Depth: "infinity", Overwrite: "F" });
      assert.equal(copied.status, 201, `${folder} folder COPY: ${copied.status} ${copied.body}`);
      assert.equal((await request("GET", `/copy-${folder}/renamed.prop`)).body, "fixture payload");
      assert.equal((await request("DELETE", `/copy-${folder}/`)).status, 204);
      assert.ok([201, 204].includes((await request("MOVE", renamed, { Destination: `https://dav.labulubius.com/${folder}/`, Overwrite: "F" })).status));
      if (folder === "zotero") assert.equal((await request("GET", "/zotero/existing.zip")).body, "existing attachment fixture");
      assert.equal((await request("DELETE", `/${folder}/`)).status, 204);
      assert.equal((await request("GET", `/${folder}/renamed.prop`)).status, 404);
    }
    assert.equal((await request("MKCOL", "/zotero/")).status, 201);
    const normalized = await request("GET", "/zotero");
    assert.equal(normalized.status, 301);
    assert.equal(normalized.headers.location, "/zotero/");
    for (const destination of ["https://unrelated.invalid/stolen/", "http://unrelated.invalid/stolen/", "https://dav.labulubius.com.evil.invalid/stolen/"]) {
      const badDestination = await request("MOVE", "/zotero/", { Destination: destination });
      assert.equal(badDestination.status, 400, destination);
    }
    const final = await request("PROPFIND", "/", { Depth: "1" });
    assert.equal(final.status, 207);
    assert.match(final.body, /<[^>]*href>\/zotero\//);
    assert.doesNotMatch(final.body, /Documents|renamed-zotero|copy-zotero/);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    if (auth.listening) await close(auth);
    await rm(temp, { recursive: true, force: true });
  }
});
