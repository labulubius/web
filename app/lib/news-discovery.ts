import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const rssHubFeed = "http://rsshub:1200";
let rulesCache: { until: number; rules: Record<string, unknown> } | undefined;

// This address comes only from Docker's trusted container metadata, never from user input.
async function hubRoot(): Promise<string> {
  const { stdout } = await exec("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "freshrss-rsshub"], { timeout: 3000 });
  const ip = stdout.trim();
  if (!/^172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(ip)) throw new Error("RSSHub container unavailable.");
  return `http://${ip}:1200`;
}

async function hubGet(path: string): Promise<Response> {
  if (!/^\/[a-zA-Z0-9/._%~-]+$/.test(path) || path.includes("..") || path.includes("//")) throw new Error("Invalid RSSHub path.");
  return fetch(`${await hubRoot()}${path}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000) });
}

async function radarRules(): Promise<Record<string, unknown>> {
  if (rulesCache && rulesCache.until > Date.now()) return rulesCache.rules;
  const response = await hubGet("/api/radar/rules");
  if (!response.ok) throw new Error("RSSHub rules unavailable.");
  const rules = await response.json() as Record<string, unknown>;
  rulesCache = { rules, until: Date.now() + 600_000 };
  return rules;
}

// Match the simple URL templates in RSSHub Radar. Complex targets (functions,
// regex-constrained params, etc.) are deliberately skipped instead of guessed.
function candidate(url: URL, rules: Record<string, unknown>): string | null {
  const host = url.hostname.toLowerCase();
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const entry = rules[parts.slice(i).join(".")];
    if (!entry || typeof entry !== "object") continue;
    const groups = entry as Record<string, unknown>;
    const subdomain = parts.slice(0, i).join(".") || ".";
    const list = groups[subdomain] ?? (subdomain === "www" ? groups["."] : undefined);
    if (!Array.isArray(list)) continue;
    for (const rule of list) {
      if (!rule || !Array.isArray(rule.source) || typeof rule.target !== "string" || !/^\/[\w/.:?~-]+$/.test(rule.target)) continue;
      for (const pattern of rule.source) {
        if (typeof pattern !== "string" || !/^\/[\w/:?-]*$/.test(pattern)) continue;
        const names = [...pattern.matchAll(/:([a-zA-Z]\w*)\??/g)].map((m) => m[1]);
        const regex = new RegExp(`^${pattern.replace(/:[a-zA-Z]\w*\??/g, "([^/]+)")}$`);
        const match = url.pathname.replace(/\/$/, "") || "/";
        const optionalLast = names.at(-1) && (rule.target as string).includes(`:${names.at(-1)}?`);
        const found = regex.exec(match) || (optionalLast ? regex.exec(`${match}/_`) : null);
        if (!found) continue;
        let route = rule.target as string;
        for (const [index, name] of names.entries()) route = route.replace(new RegExp(`:${name}\\??`), found[index + 1] === "_" && index === names.length - 1 && optionalLast ? "" : encodeURIComponent(found[index + 1]));
        route = route.replace(/\/:[a-zA-Z]\w*\?/g, "");
        if (/:[a-zA-Z]/.test(route) || !/^\/[a-zA-Z0-9/._%~-]+$/.test(route) || route.includes("..") || route.includes("//")) continue;
        return route;
      }
    }
  }
  return null;
}

export async function discoverRssHub(url: string): Promise<string | null> {
  const route = candidate(new URL(url), await radarRules());
  if (!route) return null;
  const response = await hubGet(route);
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 2_000_000) return null;
  const xml = await response.text();
  if (xml.length > 2_000_000 || !/^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed)(?:\s|>)/i.test(xml) || !/<(?:item|entry)[\s>]/i.test(xml)) return null;
  return `${rssHubFeed}${route}`;
}
