# Private News

`https://labulubius.com/news` uses the existing Supabase sign-in and `site_is_admin()` role. The page and its same-origin `/api/news` endpoint run on Vercel; the endpoint forwards to `https://drive.labulubius.com/api/news` through the existing Cloudflare Tunnel. The web server validates the Supabase bearer token again and calls the local FreshRSS GReader API at `127.0.0.1:8080`. Browsers never contact FreshRSS or its API credentials.

## Required web server setup

Provide `FRESHRSS_API_USER` and `FRESHRSS_API_PASSWORD` to `labulubius-web.service` (via a root-only systemd EnvironmentFile; do **not** put them in `NEXT_PUBLIC_*`, Git, or a Vercel environment). Use the FreshRSS user's **API password**, not the site login password. In FreshRSS, enable API access and set/check the API password under profile / authentication. The existing account may already have an API password: do not reset it without checking other clients. Optional `FRESHRSS_API_URL` overrides the local API root for development. Restart the web service after safely providing the secret and building the new web deployment.

The web-server account persists each admin's source selection at `${NEWS_DATA_DIR:-~/.local/share/labulubius/news}/<user-id>.json`. This directory is outside the checkout and should be included in backups. FreshRSS subscriptions themselves are unchanged. No new Docker container, Cloudflare DNS entry or Supabase table is needed.

## Verification

- Sign out: `/api/news?view=feeds` must return 401 and `/news` must show no sources or articles.
- Sign in as a non-admin: same result.
- Sign in as the site admin: check sources in the News sidebar, save, refresh and confirm the selection persists; verify article links open the original site.
- Verify the browser's Network panel uses only `labulubius.com/api/news` for News data. The `drive.labulubius.com` host is used only server-to-server.
