import "server-only";

import { createClient } from "@supabase/supabase-js";
import { newsReaderBackend } from "./news-reader-backend";
import type { NewsFeed } from "./news-server-types";

export const privateNewsHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function newsAdmin(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  const role = await client.rpc("site_is_admin");
  return !role.error && role.data === true ? { client, user } : null;
}

export function validNewsCursor(cursor: string) {
  return /^\d{1,12}:\d{1,20}$/.test(cursor);
}

export function newsCategories() { return newsReaderBackend().categories(); }
export function newsFeeds() { return newsReaderBackend().feeds(); }
export function newsArticles(selected: string[], cursor: string | null, feeds: NewsFeed[]) {
  if (cursor && !validNewsCursor(cursor)) throw new Error("Invalid article cursor.");
  return newsReaderBackend().articles(selected, cursor, feeds);
}
