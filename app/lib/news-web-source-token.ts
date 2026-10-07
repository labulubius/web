import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type WebSourceTokenData = { adapter: "csis-topic-v1"; url: string };

function secret() {
  const value = process.env.NEWS_FEED_PROXY_SECRET;
  if (!value || value.length < 32) throw new Error("News feed secret is unavailable.");
  return value;
}

function signature(encoded: string) {
  return createHmac("sha256", secret()).update(`web-source-v1:${encoded}`).digest("base64url");
}

export function webSourceToken(data: WebSourceTokenData) {
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function decodeWebSourceToken(token: string): WebSourceTokenData | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1 || token.length > 3500) return null;
  const encoded = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(signature(encoded));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const data = parsed as Partial<WebSourceTokenData>;
    return data.adapter === "csis-topic-v1" && typeof data.url === "string" ? data as WebSourceTokenData : null;
  } catch { return null; }
}

export function webSourceFeedUrl(data: WebSourceTokenData) {
  const origin = process.env.NEWS_FEED_PROXY_ORIGIN || "https://drive.labulubius.com";
  return `${origin.replace(/\/$/, "")}/api/news/generated/${webSourceToken(data)}`;
}

export function originalWebSourceUrl(value: string) {
  let path: string;
  try { path = new URL(value).pathname; }
  catch { return value; }
  const token = path.match(/^\/api\/news\/generated\/([^/]+)$/)?.[1];
  if (!token) return value;
  return decodeWebSourceToken(token)?.url || value;
}
