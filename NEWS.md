# Feeds permissions and storage

`https://labulubius.com/feeds` uses the existing Supabase sign-in and `site_is_admin()` role. Same-origin `/api/news` requests run directly on VM100 and use the private Miniflux API at `127.0.0.1:8083`. Miniflux credentials stay in the root-readable `/etc/labulubius/news.env` EnvironmentFile of `labulubius-web.service`; the browser never receives API secrets. Direct subscriptions are stored as signed `drive.labulubius.com/api/news/feed/...` proxy URLs. The proxy pins a verified public address, revalidates every redirect, rejects private and special-use networks, and caps responses at 5 MiB. Configure a stable random `NEWS_FEED_PROXY_SECRET` of at least 32 characters and optional `NEWS_FEED_PROXY_ORIGIN`; rotating the secret requires re-subscribing proxied feeds.

The public, read-only `/api/news?view=sidebar` exposes category names, subscription titles and the owner's selected checkboxes without feed IDs or URLs. `/api/news?view=publicArticles` serves selected, non-expired articles. Successful responses permit a 30-second shared-cache lifetime with 60 seconds of stale-while-revalidate; errors, invalid cursors, admin-only views and writes remain private and uncached. When there is exactly one preference file it defines the owner; with multiple files set `NEWS_PUBLIC_OWNER_ID`.

Administrators can create, rename and delete Miniflux categories and subscriptions from the Feeds sidebar. Source discovery checks direct RSS/Atom, standard HTML feed links, BBC mappings and verified Discourse pages before trying registered webpage adapters. Deleting a category unsubscribes its feeds and removes their articles; unchecking a feed only hides it from the public selection. Per-user selections and Watchboards live outside Git at `${NEWS_DATA_DIR:-~/.local/share/labulubius/news}`. Feed metadata and articles live in Miniflux, not Supabase.

## Generated notice sources

The tokenized CAU endpoint at `https://labulubius.com/api/news/cau/<token>` logs in through CAS server-side and publishes only title, date, publishing unit, original login-required link and a sanitized short summary. Credentials are encrypted with systemd credentials and must never enter environment files, Git, arguments or logs. `labulubius-cau-news-refresh.timer` refreshes its private cache every 30 minutes.

The separate CIEE endpoint at `https://labulubius.com/api/news/ciee` adapts the public college listing and uses source-specific HTTP Basic authentication derived from `NEWS_FEED_PROXY_SECRET`. It publishes bounded, sanitized metadata and summaries without attachments or full bodies. `labulubius-ciee-news-refresh.timer` refreshes its cache every 30 minutes. Both generated feeds retain only notices from the latest five days.

## Five-day article lifecycle

Miniflux polls subscriptions every 30 minutes and cleans read and unread archived entries after five days. `/api/news` independently requests only entries published in the latest five days and before the next UTC midnight, preserving chronological pagination and excluding future-dated content. GitHub stores code and CI history, not Miniflux article data.

## Watchboards

Admin-only `/api/news/watchboards` stores tags, Watchboards and source assignments in private per-user JSON files. A Watchboard matches sources carrying every selected tag. Deleting a tag removes assignments and board references but does not unsubscribe feeds. Article requests by board use the same Miniflux-backed chronological pagination and five-day window.

## Generic static webpage fallback

After native RSS/Atom and registered high-precision adapters fail, `/feeds` may ask the private html2rss service to extract a server-rendered article listing. The pinned deployment under `deploy/html2rss/` listens only on loopback, uses a private bearer token and has no browser renderer. Generated sources normalize stable GUIDs, preserve first-seen dates when needed, reject future dates and abnormal batch shrinkage, emit only the latest five days and fall back to the last successful cache.

## Verification

- Logged out, verify the public sidebar and article views return only selected content from the latest five days, paginate without overlap, and transition from Cloudflare `MISS` to `HIT` after a purge.
- Verify admin-only views and writes reject signed-out requests and remain uncached.
- Signed in as admin, create, edit and delete a source and category; create tags and a Watchboard; verify Miniflux receives the changes and existing subscriptions remain intact.
- Confirm `labulubius-cau-news-refresh.timer` and `labulubius-ciee-news-refresh.timer` are active.
- Confirm Miniflux is reachable only at `127.0.0.1:8083` and no standalone reader hostname is published.
