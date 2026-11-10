/**
 * Sliding sign-in lifetime shared with CloudCLI and the router console: the session
 * stays valid while the site is used and ends after seven days without a visit.
 * Supabase refresh tokens never expire on this project, so the browser enforces the
 * idle limit and revokes the session through a normal sign-out once it is exceeded.
 */
export const SESSION_IDLE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ACTIVITY_KEY = "site-auth-last-active";

type ActivityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): ActivityStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readLastActive(storage = browserStorage()): number | null {
  try {
    const value = Number(storage?.getItem(SESSION_ACTIVITY_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

export function markActive(now = Date.now(), storage = browserStorage()) {
  try { storage?.setItem(SESSION_ACTIVITY_KEY, String(now)); } catch { /* storage unavailable */ }
}

export function clearActivity(storage = browserStorage()) {
  try { storage?.removeItem(SESSION_ACTIVITY_KEY); } catch { /* storage unavailable */ }
}

/** A missing marker (first visit after this feature shipped) never counts as idle. */
export function isIdleExpired(lastActive: number | null, now = Date.now()) {
  return lastActive !== null && now - lastActive > SESSION_IDLE_LIMIT_MS;
}
