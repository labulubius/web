import "server-only";

import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { freshEditToken, freshPost, newsCategories, newsFeeds } from "./news-server";

const labelPrefix = "user/-/label/";
const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, bits, "ipv4");
// Only globally routable IPv6 unicast; exclude documentation, transition and special-use ranges.
for (const [network, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]] as const) {
  blocked.addSubnet(network, bits, "ipv6");
}

export class InvalidNewsInput extends Error {}
const invalid = (message: string): never => { throw new InvalidNewsInput(message); };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid request.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return invalid(`Invalid ${field}.`);
  return value.trim();
}
function categoryName(value: unknown): string {
  const name = text(value, "category name", 191);
  if (Buffer.byteLength(name, "utf8") > 191 || name === "Uncategorized") return invalid("Invalid category name.");
  return name;
}
function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}
function publicIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !blocked.check(ip, "ipv6");
}
async function publicURL(value: unknown): Promise<string> {
  const raw = text(value, "URL", 2048);
  let url: URL;
  try { url = new URL(raw); } catch { return invalid("Invalid URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.hash) return invalid("Invalid URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isIP(host) && (!host.includes(".") || host.endsWith(".") ||
    /\.(?:local|localhost|internal|test|invalid|example|onion|home|lan)$/i.test(host) ||
    !/^[a-z0-9.-]+$/.test(host) || host.split(".").some((part) => !part || part.startsWith("-") || part.endsWith("-")))) return invalid("Invalid public host.");
  let addresses: string[];
  try { addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address); }
  catch { return invalid("Host could not be resolved."); }
  if (!addresses.length || addresses.some((address) => !publicIP(address))) return invalid("URL must resolve to a public address.");
  return url.href;
}

async function category(value: unknown, allowDefault = true) {
  const id = text(value, "category ID");
  const found = (await newsCategories()).find((item) => item.id === id);
  if (!found || (!allowDefault && found.name === "Uncategorized")) return invalid("Unknown category.");
  return found;
}
async function feed(value: unknown) {
  const id = text(value, "feed ID");
  const found = (await newsFeeds()).find((item) => item.id === id);
  if (!found) return invalid("Unknown feed.");
  return found;
}

// FreshRSS GReader does not create empty folders. Run only constant PHP code and read
// the validated name from stdin: no user input or credentials are passed as argv.
async function categoryCli(action: "create" | "delete", name: string) {
  const php = `require '/var/www/FreshRSS/cli/_cli.php'; cliInitUser('labulubius'); $name = htmlspecialchars(trim(stream_get_contents(STDIN)), ENT_COMPAT, 'UTF-8'); $dao = FreshRSS_Factory::createCategoryDao(); $cat = $dao->searchByName($name); if ('${action}' === 'create') { if ($cat !== null || !$dao->addCategory(['name' => $name])) exit(1); } else { if ($cat === null || $cat->id() <= 1) exit(1); $feeds = FreshRSS_Factory::createFeedDao()->listFeeds(); foreach ($feeds as $feed) { if ($feed->categoryId() === $cat->id() && !FreshRSS_feed_Controller::deleteFeed($feed->id())) exit(1); } if (!$dao->deleteCategory($cat->id())) exit(1); }`;
  // Only a constant, locally constructed PHP program runs in the existing container.
  // The category name travels over stdin, never as a shell argument.
  await new Promise<void>((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", "freshrss", "php", "-r", php], { timeout: 30000, maxBuffer: 1024 }, (error) => error ? reject(new Error("FreshRSS category update failed.")) : resolve());
    child.stdin?.on("error", () => { /* handled by process exit */ });
    child.stdin?.end(name);
  });
}

export async function manageNews(input: unknown): Promise<void> {
  const body = object(input);
  const action = text(body.action, "action", 40);
  switch (action) {
    case "createCategory": {
      const name = categoryName(body.name);
      if ((await newsCategories()).some((item) => item.name.toLowerCase() === name.toLowerCase())) return invalid("Category already exists.");
      await categoryCli("create", name);
      return;
    }
    case "renameCategory": {
      const old = await category(body.categoryId ?? body.category ?? body.id, false);
      const name = categoryName(body.name);
      if ((await newsCategories()).some((item) => item.name.toLowerCase() === name.toLowerCase())) return invalid("Category already exists.");
      await freshPost("reader/api/0/rename-tag", { T: await freshEditToken(), s: old.id, dest: labelPrefix + name });
      return;
    }
    case "deleteCategory": {
      const old = await category(body.categoryId ?? body.category ?? body.id, false);
      // Includes hidden FreshRSS feeds (not returned by GReader subscription/list).
      await categoryCli("delete", old.name);
      return;
    }
    case "addFeed": {
      const url = await publicURL(body.url);
      const dest = await category(body.categoryId ?? body.category);
      const title = optionalText(body.title, "title");
      await freshPost("reader/api/0/subscription/edit", { s: `feed/${url}`, ac: "subscribe", a: dest.id, ...(title ? { t: title } : {}) });
      return;
    }
    case "editFeed": {
      const source = await feed(body.feedId ?? body.id);
      const title = optionalText(body.title, "title");
      const dest = body.categoryId === undefined && body.category === undefined ? undefined : await category(body.categoryId ?? body.category);
      if (!title && !dest) return invalid("No changes provided.");
      await freshPost("reader/api/0/subscription/edit", { s: source.id, ac: "edit", ...(title ? { t: title } : {}), ...(dest ? { a: dest.id } : {}) });
      return;
    }
    case "deleteFeed": {
      const source = await feed(body.feedId ?? body.id);
      await freshPost("reader/api/0/subscription/edit", { s: source.id, ac: "unsubscribe" });
      return;
    }
    default: return invalid("Invalid action.");
  }
}
