#!/usr/bin/env node

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function forumSourceUrl(source) {
  switch (source.kind) {
    case "discourse": {
      const url = new URL(source.latest || "/latest.json", source.origin);
      url.pathname = url.pathname.replace(/\/latest(?:\.json)?$/, "/latest.rss");
      if (!url.pathname.endsWith("/latest.rss")) throw new Error(`Unsupported Discourse view for ${source.name}.`);
      return url.href;
    }
    case "v2ex": return "https://www.v2ex.com/index.xml";
    case "hackernews": {
      if ((source.view || "top") !== "top") throw new Error(`Unsupported Hacker News view for ${source.name}.`);
      return "https://hnrss.org/frontpage";
    }
    case "stackexchange": {
      const sites = { stackoverflow: "stackoverflow.com", superuser: "superuser.com", serverfault: "serverfault.com", askubuntu: "askubuntu.com" };
      const host = sites[source.site] || `${source.site}.stackexchange.com`;
      const url = new URL(`https://${host}/${source.tags ? "feeds/tag" : "feeds"}`);
      if (source.tags) { url.searchParams.set("tagnames", source.tags); url.searchParams.set("sort", "newest"); }
      return url.href;
    }
    case "reddit": return `https://www.reddit.com/r/${encodeURIComponent(source.subreddit)}/${source.sort || "hot"}/.rss`;
    case "rss": return new URL(source.feedUrl).href;
    default: throw new Error(`Unsupported forum source type: ${source.kind}`);
  }
}

function parseEnvironment(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function proxyUrl(url, env) {
  const secret = env.NEWS_FEED_PROXY_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEWS_FEED_PROXY_SECRET is unavailable.");
  const encoded = Buffer.from(url).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${(env.NEWS_FEED_PROXY_ORIGIN || "https://drive.labulubius.com").replace(/\/$/, "")}/api/news/feed/${encoded}.${signature}`;
}

function originalUrl(value, env) {
  let token;
  try { token = new URL(value).pathname.match(/^\/api\/news\/feed\/([^/]+)$/)?.[1]; } catch { return value; }
  if (!token) return value;
  const split = token.lastIndexOf(".");
  if (split < 1) return value;
  const encoded = token.slice(0, split);
  const supplied = Buffer.from(token.slice(split + 1));
  const expected = Buffer.from(createHmac("sha256", env.NEWS_FEED_PROXY_SECRET || "").update(encoded).digest("base64url"));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return value;
  try { return Buffer.from(encoded, "base64url").toString("utf8"); } catch { return value; }
}

async function freshClient(env) {
  const root = env.FRESHRSS_API_URL || "http://127.0.0.1:8080/api/greader.php/";
  const user = env.FRESHRSS_API_USER;
  const password = env.FRESHRSS_API_PASSWORD;
  if (!user || !password) throw new Error("FreshRSS API credentials are unavailable.");
  const login = await fetch(new URL("accounts/ClientLogin", root), { method: "POST", body: new URLSearchParams({ Email: user, Passwd: password }), signal: AbortSignal.timeout(10000) });
  const token = login.ok ? (await login.text()).match(/^Auth=(.+)$/m)?.[1]?.trim() : null;
  if (!token) throw new Error("FreshRSS login failed.");
  const request = async (endpoint, options = {}) => {
    const response = await fetch(new URL(endpoint, root), { ...options, headers: { ...options.headers, Authorization: `GoogleLogin auth=${token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`FreshRSS request failed (${response.status}).`);
    return response;
  };
  return {
    async feeds() {
      const response = await request("reader/api/0/subscription/list?output=json");
      const data = await response.json();
      if (!Array.isArray(data.subscriptions)) throw new Error("Invalid FreshRSS subscription list.");
      return data.subscriptions.filter((feed) => typeof feed.id === "string").map((feed) => ({ id: feed.id, title: feed.title || feed.id, url: feed.url || "" }));
    },
    async subscribe(url, title) {
      const response = await request("reader/api/0/subscription/edit", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ s: `feed/${url}`, ac: "subscribe", t: title }) });
      if ((await response.text()).trim() !== "OK") throw new Error(`FreshRSS rejected ${title}.`);
    },
  };
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
    const directory = await open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

async function ownerFiles(newsDirectory, env) {
  let owner = env.NEWS_PUBLIC_OWNER_ID;
  if (!owner) {
    const files = (await readdir(newsDirectory)).filter((name) => uuid.test(name.replace(/\.json$/, "")) && !name.endsWith(".watchboards.json"));
    if (files.length !== 1) throw new Error("Exactly one News owner preference file is required.");
    owner = files[0].slice(0, -5);
  }
  if (!uuid.test(owner)) throw new Error("Invalid News owner ID.");
  return { selection: path.join(newsDirectory, `${owner}.json`), watchboards: path.join(newsDirectory, `${owner}.watchboards.json`) };
}

export async function migrate({ apply, env, home = os.homedir() }) {
  const forumsDirectory = env.FORUMS_DATA_DIR || path.join(home, ".local", "share", "labulubius", "forums");
  const newsDirectory = env.NEWS_DATA_DIR || path.join(home, ".local", "share", "labulubius", "news");
  const directory = JSON.parse(await readFile(path.join(forumsDirectory, "directory.json"), "utf8"));
  if (!Array.isArray(directory.sources)) throw new Error("Invalid Forums directory.");
  const sources = directory.sources.filter((source) => source.selected !== false).map((source) => ({ source, url: forumSourceUrl(source) }));
  const fresh = await freshClient(env);
  let feeds = await fresh.feeds();
  const migrated = [];
  for (const { source, url } of sources) {
    let feed = feeds.find((item) => {
      try { return new URL(originalUrl(item.url, env)).href === new URL(url).href; } catch { return false; }
    });
    const action = feed ? "reuse" : "subscribe";
    console.log(`${action}: ${source.name} -> ${url}`);
    if (!feed && apply) {
      await fresh.subscribe(url === "https://linux.do/latest.rss" ? url : proxyUrl(url, env), source.name);
      for (let attempt = 0; attempt < 10 && !feed; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        feeds = await fresh.feeds();
        feed = feeds.find((item) => item.title === source.name || (() => { try { return new URL(originalUrl(item.url, env)).href === new URL(url).href; } catch { return false; } })());
      }
      if (!feed) throw new Error(`Subscribed to ${source.name}, but FreshRSS did not return it.`);
    }
    if (feed) migrated.push(feed.id);
  }
  if (!apply) return { sources: sources.length, existing: migrated.length };
  if (migrated.length !== sources.length) throw new Error("Not all forum sources were migrated.");

  const files = await ownerFiles(newsDirectory, env);
  const selected = JSON.parse(await readFile(files.selection, "utf8"));
  if (!Array.isArray(selected)) throw new Error("Invalid News selection.");
  await atomicJson(files.selection, [...new Set([...selected, ...migrated])]);

  let state;
  try { state = JSON.parse(await readFile(files.watchboards, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; state = { tags: [], watchboards: [], sourceTags: {} }; }
  const tag = state.tags.find((item) => item.name.toLocaleLowerCase() === "forums") || { id: randomUUID(), name: "Forums" };
  if (!state.tags.some((item) => item.id === tag.id)) state.tags.push(tag);
  const board = state.watchboards.find((item) => item.name.toLocaleLowerCase() === "forums") || { id: randomUUID(), name: "Forums", tagIds: [] };
  if (!state.watchboards.some((item) => item.id === board.id)) state.watchboards.push(board);
  if (!board.tagIds.includes(tag.id)) board.tagIds.push(tag.id);
  for (const id of migrated) state.sourceTags[id] = [...new Set([...(state.sourceTags[id] || []), tag.id])];
  await atomicJson(files.watchboards, state);
  return { sources: sources.length, migrated: migrated.length, tag: tag.name, watchboard: board.name };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const envText = process.argv.includes("--env-stdin") ? await new Promise((resolve, reject) => { let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (part) => value += part); process.stdin.on("end", () => resolve(value)); process.stdin.on("error", reject); }) : "";
  const env = { ...process.env, ...parseEnvironment(envText) };
  const result = await migrate({ apply, env });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
