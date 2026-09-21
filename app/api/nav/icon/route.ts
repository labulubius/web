import { createClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const BUCKET = "navigator-icons";
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 8_000;

type IconFile = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

type RequestBody = {
  siteId?: unknown;
  sourceUrl?: unknown;
};

function getSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url, key };
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function getAdminClient(request: Request) {
  const token = getAccessToken(request);
  if (!token) return null;

  const { url, key } = getSupabaseConfiguration();
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }] = await Promise.all([
    supabase.auth.getUser(token),
    supabase.rpc("site_is_admin"),
  ]);

  if (userError || !userData.user || adminError || isAdmin !== true) return null;
  return supabase;
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);

  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP and HTTPS URLs are allowed.");
  }
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new Error("Only standard HTTP and HTTPS ports are allowed.");
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("Private network addresses are not allowed.");
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("The hostname does not resolve to a public address.");
    }
  }
  return url;
}

async function fetchPublicUrl(value: string, accept: string) {
  let current = value;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": "Labulubius-Navigator-Icon/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response has no location.");
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`Remote server returned ${response.status}.`);
    return { response, finalUrl: url.href };
  }
  throw new Error("Too many redirects.");
}

async function readLimited(response: Response, maximum: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximum) throw new Error("Remote file is too large.");
  if (!response.body) throw new Error("Remote response has no body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("Remote file is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function identifyImage(bytes: Uint8Array): Omit<IconFile, "bytes"> | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  const signature = new TextDecoder().decode(bytes.slice(0, 12));
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    return { contentType: "image/x-icon", extension: "ico" };
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, 2048)).trimStart().toLowerCase();
  if (prefix.startsWith("<svg") || (prefix.startsWith("<?xml") && prefix.includes("<svg"))) {
    return { contentType: "image/svg+xml", extension: "svg" };
  }
  return null;
}

async function downloadImage(url: string): Promise<IconFile> {
  const { response } = await fetchPublicUrl(url, "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.2");
  const bytes = await readLimited(response, MAX_IMAGE_BYTES);
  const image = identifyImage(bytes);
  if (!image) throw new Error("Remote file is not a supported image.");
  return { bytes, ...image };
}

function readAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), (match[2] ?? match[3] ?? match[4] ?? "").replaceAll("&amp;", "&"));
  }
  return attributes;
}

function iconCandidates(html: string, pageUrl: string) {
  const candidates: Array<{ url: string; score: number }> = [];
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const baseHref = baseTag ? readAttributes(baseTag).get("href") : undefined;
  let baseUrl = pageUrl;
  try {
    if (baseHref) baseUrl = new URL(baseHref, pageUrl).href;
  } catch {
    // Ignore an invalid base element.
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href");
    if (!href || !rel.some((value) => value === "icon" || value === "shortcut" || value === "apple-touch-icon" || value === "mask-icon")) continue;
    try {
      const sizes = attributes.get("sizes") ?? "";
      const size = Math.max(0, ...Array.from(sizes.matchAll(/(\d+)x(\d+)/g), (item) => Number(item[1]) * Number(item[2])));
      const score = (rel.includes("apple-touch-icon") ? 1_000_000 : 0) + size;
      candidates.push({ url: new URL(href, baseUrl).href, score });
    } catch {
      // Ignore invalid icon URLs from remote markup.
    }
  }
  return candidates.sort((a, b) => b.score - a.score).map(({ url }) => url);
}

async function discoverIcon(siteUrl: string, customSource: string | null) {
  const candidates: string[] = customSource ? [customSource] : [];
  let finalSiteUrl = siteUrl;

  try {
    const { response, finalUrl } = await fetchPublicUrl(siteUrl, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || !contentType) {
      const html = new TextDecoder().decode(await readLimited(response, MAX_HTML_BYTES));
      candidates.push(...iconCandidates(html, finalUrl));
    }
    finalSiteUrl = finalUrl;
  } catch {
    // Conventional root icon paths can still work if the page blocks crawlers.
  }

  const origin = new URL(finalSiteUrl).origin;
  candidates.push(
    new URL("/favicon.ico", origin).href,
    new URL("/favicon.svg", origin).href,
    new URL("/apple-touch-icon.png", origin).href,
  );

  for (const candidate of [...new Set(candidates)]) {
    try {
      return await downloadImage(candidate);
    } catch {
      // Continue through all advertised and conventional candidates.
    }
  }
  return null;
}

function isManagedIconUrl(value: string, supabaseUrl: string) {
  return value.startsWith(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/`);
}

type AdminClient = NonNullable<Awaited<ReturnType<typeof getAdminClient>>>;

async function retryStorageOperation(operation: () => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function removeStoragePaths(supabase: AdminClient, paths: string[]) {
  if (paths.length === 0) return;
  await retryStorageOperation(async () => {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  });
}

async function removeStoredIcons(supabase: AdminClient, siteId: string) {
  await retryStorageOperation(async () => {
    const { data, error } = await supabase.storage.from(BUCKET).list("sites", { limit: 1000, search: siteId });
    if (error) throw error;
    const paths = (data ?? [])
      .map(({ name }) => `sites/${name}`)
      .filter((path) => {
        const name = path.slice("sites/".length);
        return name.startsWith(`${siteId}.`) || name.startsWith(`${siteId}-`);
      });
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
      if (removeError) throw removeError;
    }
  });
}

function managedIconPath(value: string | null, supabaseUrl: string) {
  if (!value || !isManagedIconUrl(value, supabaseUrl)) return null;
  try {
    const url = new URL(value);
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
    return path.startsWith("sites/") && !path.includes("..") ? path : null;
  } catch {
    return null;
  }
}

async function updateIconIfCurrent(supabase: AdminClient, siteId: string, previousIconUrl: string | null, nextIconUrl: string | null) {
  const query = supabase.from("navigator_sites").update({ icon_url: nextIconUrl }).eq("id", siteId);
  const result = previousIconUrl === null
    ? await query.is("icon_url", null).select("id").maybeSingle()
    : await query.eq("icon_url", previousIconUrl).select("id").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The website icon changed during import. Please try again.");
}

async function storeIcon(supabase: AdminClient, siteId: string, siteUrl: string, sourceUrl: string | null, previousIconUrl: string | null) {
  const { url: supabaseUrl } = getSupabaseConfiguration();
  const previousPath = managedIconPath(previousIconUrl, supabaseUrl);
  const icon = await discoverIcon(siteUrl, sourceUrl);
  if (!icon) {
    return previousIconUrl
      ? { status: "retained", iconUrl: previousIconUrl }
      : { status: "fallback", iconUrl: null };
  }

  const path = `sites/${siteId}-${randomUUID()}.${icon.extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, icon.bytes, {
    cacheControl: "31536000",
    contentType: icon.contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  try {
    await updateIconIfCurrent(supabase, siteId, previousIconUrl, publicUrlData.publicUrl);
  } catch (error) {
    await removeStoragePaths(supabase, [path]);
    throw error;
  }
  if (previousPath && previousPath !== path) await removeStoragePaths(supabase, [previousPath]);
  return { status: "stored", iconUrl: publicUrlData.publicUrl };
}

export async function POST(request: Request) {
  try {
    const supabase = await getAdminClient(request);
    if (!supabase) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const body = await request.json() as RequestBody;
    const siteId = typeof body.siteId === "string" ? body.siteId : "";
    const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId)) {
      return Response.json({ error: "Invalid website ID." }, { status: 400 });
    }

    const { data: site, error: siteError } = await supabase.from("navigator_sites").select("url,icon_url").eq("id", siteId).single();
    if (siteError || !site) return Response.json({ error: "Website not found." }, { status: 404 });

    const { url: supabaseUrl } = getSupabaseConfiguration();
    if (sourceUrl && sourceUrl === site.icon_url && isManagedIconUrl(sourceUrl, supabaseUrl)) {
      return Response.json({ status: "unchanged", iconUrl: sourceUrl });
    }

    return Response.json(await storeIcon(supabase, siteId, site.url, sourceUrl, site.icon_url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import the website icon.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let websiteDeleted = false;
  try {
    const supabase = await getAdminClient(request);
    if (!supabase) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const body = await request.json() as RequestBody;
    const siteId = typeof body.siteId === "string" ? body.siteId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId)) {
      return Response.json({ error: "Invalid website ID." }, { status: 400 });
    }
    const { error: deleteError } = await supabase.from("navigator_sites").delete().eq("id", siteId);
    if (deleteError) throw deleteError;
    websiteDeleted = true;
    await removeStoredIcons(supabase, siteId);
    return Response.json({ status: "deleted" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const message = websiteDeleted
      ? `Website deleted, but its stored icon could not be removed: ${detail}`
      : `Could not delete the website: ${detail}`;
    return Response.json({ error: message }, { status: 500 });
  }
}
