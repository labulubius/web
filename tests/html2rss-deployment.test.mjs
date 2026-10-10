import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const compose = readFileSync("deploy/html2rss/compose.yml", "utf8");
const profiles = readFileSync("deploy/html2rss/browser-profiles.yml", "utf8");

test("html2rss browser stays private, immutable, bounded and credential-free", () => {
  const browser = compose.slice(compose.indexOf("  botasaurus:\n"), compose.lastIndexOf("\nnetworks:"));
  assert.match(browser, /image: html2rss\/botasaurus-scrape-api@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(browser, /ports:|env_file:|privileged:|network_mode: host|cap_add:/);
  for (const expected of ["SCRAPE_MAX_WORKERS: 1", "SCRAPE_MAX_PER_HOST: 1", "mem_limit: 768m", "init: true", "ipv4_address: 172.30.0.54", "no-new-privileges:true"])
    assert.ok(browser.includes(expected), expected);
  assert.match(compose, /127\.0\.0\.1:4000:4000/);
  assert.match(compose, /BOTASAURUS_SCRAPER_URL: http:\/\/botasaurus:4010/);
  assert.match(compose, /browser-profiles\.rb:ro/);
});

test("html2rss timeout chain accounts for browser work and client overhead", () => {
  const value = (name) => Number(compose.match(new RegExp(`${name}: (\\d+)`))?.[1]);
  assert.ok(value("SCRAPE_WORK_TIMEOUT_SECONDS") < value("SCRAPE_TIMEOUT_SECONDS"));
  assert.ok(value("SCRAPE_TIMEOUT_SECONDS") + 2 < value("HTML2RSS_TOTAL_TIMEOUT_SECONDS"));
  assert.ok(value("HTML2RSS_TOTAL_TIMEOUT_SECONDS") < value("REQUEST_TIMEOUT_SECONDS"));
  const client = readFileSync("app/lib/news-html2rss.ts", "utf8");
  assert.match(client, /HTML2RSS_REQUEST_TIMEOUT_MS = 43_000/);
  assert.match(client, /AbortSignal\.timeout\(HTML2RSS_REQUEST_TIMEOUT_MS\)/);
});

test("browser egress permits only public web and dedicated DNS after private denials", () => {
  const rules = execFileSync("sh", ["deploy/html2rss/browser-egress.sh", "--print-rules"], { encoding: "utf8" });
  assert.match(rules, /--ctstate ESTABLISHED,RELATED/);
  assert.match(rules, /172\.30\.0\.53 -p udp --dport 53 -j RETURN/);
  for (const network of ["10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15"])
    assert.ok(rules.indexOf(`-d ${network} -j REJECT`) < rules.indexOf("--dports 80,443 -j RETURN"), network);
  assert.match(rules, /--dst-type LOCAL -j REJECT/);
  assert.match(rules, /-A LAB-H2R-BROWSER -j REJECT\nCOMMIT/);
  const guard = readFileSync("deploy/html2rss/browser-egress.sh", "utf8");
  assert.match(guard, /iptables-restore --noflush/);
  assert.match(guard, /browser_ip=172\.30\.0\.54/);
  assert.doesNotMatch(guard, /iptables -F(?:\s|$)/);
});

test("configured browser source keeps filters and extracts dates from actual cards", () => {
  for (const expected of ["displayconttype_exact: Press Release", "lang_exact: English", "strategy: botasaurus", "wait_for_selector:", "published_at:", "name: parse_time", "enhance: false"])
    assert.ok(profiles.includes(expected), expected);
  const adapter = readFileSync("deploy/html2rss/browser-profiles.rb", "utf8");
  assert.match(adapter, /Profiles must preserve the submitted URL/);
  assert.match(adapter, /result\.delete\(:auto_source\)/);
  assert.match(adapter, /singleton_class\.prepend/);
  assert.doesNotMatch(adapter, /generate_feed_token|validate_and_decode_feed_token/);
});
