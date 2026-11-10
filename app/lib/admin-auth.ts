import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type SiteAdmin = { user: User; supabase: SupabaseClient };

export function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

/**
 * Verifies the Supabase access token on a request and the site administrator role.
 * Returns null when either check fails and throws when Supabase is not configured.
 * The returned client acts with the caller token, so Row Level Security still applies.
 */
export async function requireSiteAdmin(request: Request): Promise<SiteAdmin | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data, error }, role] = await Promise.all([supabase.auth.getUser(token), supabase.rpc("site_is_admin")]);
  if (error || !data.user || role.error || role.data !== true) return null;
  return { user: data.user, supabase };
}
