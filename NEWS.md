# Feeds permissions and storage

`https://labulubius.com/feeds` uses the existing Supabase sign-in and `site_is_admin()` role. Same-origin `/api/news` requests run directly on VM100 and use the private Miniflux API at `127.0.0.1:8083`. Miniflux credentials stay in the root-readable `/etc/labulubius/news.env` EnvironmentFile of `labulubius-web.service`; the browser never receives API secrets. Direct subscriptions are stored as signed `drive.labulubius.com/api/news/feed/...` proxy URLs. The proxy pins a verified public address, revalidates every redirect, rejects private and special-use networks, and caps responses at 5 MiB. Configure a stable random `NEWS_FEED_PROXY_SECRET` of at least 32 characters and optional `NEWS_FEED_PROXY_ORIGIN`; rotating the secret requires re-subscribing proxied feeds.

The public, read-only `/api/news?view=sidebar` exposes category names, subscription titles and the owner's selected checkboxes without feed IDs or URLs. `/api/news?view=publicArticles` serves selected, non-expired articles. Successful responses permit a 30-second shared-cache lifetime with 60 seconds of stale-while-revalidate; errors, invalid cursors, admin-only views and writes remain private and uncached. When there is exactly one preference file it defines the owner; with multiple files set `NEWS_PUBLIC_OWNER_ID`.

Administrators manage subscriptions and source tags under Settings → Sources, and Watchboards in the sidebar. The management API also retains Miniflux category operations; these are not exposed by the current Feeds UI. Deleting a category through that API unsubscribes its feeds and removes their articles; unchecking a source in the UI only hides it from the public selection. Per-user selections and Watchboards live outside Git at `${NEWS_DATA_DIR:-~/.local/share/labulubius/news}`. Feed metadata and articles live in Miniflux, not Supabase.

## Adding sources and discovering feeds

In Settings → Sources, choose **+ Source**, enter a full `https://` or `http://` URL,
then choose **Check source**. A successful probe is a preview, not a subscription:
choose tags as needed and **Save** to subscribe. The upstream may become unavailable
between checking and saving, and Miniflux still validates the subscription.

Discovery follows `app/lib/news-feed-discovery.ts`:

1. Recognized Reddit subreddit, V2EX and Linux.do page URLs map to their native
   feed endpoints before fetching the webpage. Only the explicitly supported URL
   forms are mapped; this is not a generic rule for every community website.
2. Other inputs are fetched directly. RSS/Atom/RDF feed responses are accepted;
   HTML responses are searched for declared feed links, followed by the existing
   BBC mappings and Discourse detection. These HTML-based steps require a
   successful response from the input page.
3. Ordinary discovery failures may fall back to registered webpage adapters and
   the static html2rss extractor. Native-feed unavailability and protected-access
   errors do not trigger webpage fallback. HTTP 401/403 means access was refused;
   HTTP 429 means retry later. Browser access does not prove server-side access.

### Stack Overflow: use the official feed URL

Stack Overflow currently has **no dedicated homepage or tag-page mapping** in
`nativeCommunityFeed`. Entering a webpage therefore depends on fetching its HTML;
a rejected homepage does not imply that the separate feed endpoint is unavailable.

Read-only probes from VM100 using the application's real
`discoverPinnedNewsFeedDetails` function on 2026-10-07 returned:

| Input | Observed result |
| --- | --- |
| `https://stackoverflow.com/` | HTTP 403; discovery stopped with an access-refused error |
| `https://stackoverflow.com/feeds` | Direct feed discovery succeeded |
| `https://stackoverflow.com/feeds/tag?tagnames=pytorch&sort=newest` | Direct feed discovery succeeded for the PyTorch tag |

Use one of the successful feed URLs in **+ Source** rather than the homepage.
Tag-specific feeds are useful when the site-wide feed is too broad. Other tags
can be checked using the same URL form, but were not part of this probe. See the
[Stack Overflow Meta explanation of tag-feed URLs](https://meta.stackoverflow.com/questions/417997/creating-an-rss-feed-from-a-filter-created-by-my-profile-to-follow-up-on-new-que/418000).

These results describe discovery at the time of testing, not a guarantee of
future availability or proof of a completed Miniflux subscription. No subscription
was created by these probes. Automatically mapping Stack Overflow homepage/tag-page
URLs would require a separate implementation and regression tests; it is not
implemented by this documentation update.

## Generated notice sources

The tokenized CAU endpoint at `https://labulubius.com/api/news/cau/<token>` logs in through CAS server-side and publishes only title, date, publishing unit, original login-required link and a sanitized short summary. Credentials are encrypted with systemd credentials and must never enter environment files, Git, arguments or logs. `labulubius-cau-news-refresh.timer` refreshes its private cache every 30 minutes.

The separate CIEE endpoint at `https://labulubius.com/api/news/ciee` adapts the public college listing and uses source-specific HTTP Basic authentication derived from `NEWS_FEED_PROXY_SECRET`. It publishes bounded, sanitized metadata and summaries without attachments or full bodies. `labulubius-ciee-news-refresh.timer` refreshes its cache every 30 minutes. Both generated feeds retain only notices from the latest five days.

## Five-day article lifecycle

Miniflux polls subscriptions every 30 minutes and cleans read and unread archived entries after five days. `/api/news` independently requests only entries published in the latest five days and before the next UTC midnight, preserving chronological pagination and excluding future-dated content. GitHub stores code and CI history, not Miniflux article data.

## Watchboards

Admin-only `/api/news/watchboards` stores tags, Watchboards and source assignments in private per-user JSON files. A Watchboard matches sources carrying every selected tag. Deleting a tag removes assignments and board references but does not unsubscribe feeds. Article requests by board use the same Miniflux-backed chronological pagination and five-day window.

Sources are not automatically classified by their title or domain. To include a
source in the currently configured **Tech Forums** Watchboard, assign both `Tech`
and `Forum` in its source tags; preserve any other desired tags. These names are
owner configuration, not hardcoded application rules. A Watchboard with no matching
tags configured matches no sources.

The reader remembers the latest source, Watchboard or settings panel selected in
the current tab. Account rechecks and delayed directory responses must not restore
the stale initial selection over that choice. Local storage persists the selection
across visits when available; in-memory navigation still works when storage is
blocked. A missing source or Watchboard falls back to the first available Watchboard,
or Sources when there are none.

## Generic static webpage fallback

After native RSS/Atom and registered high-precision adapters fail, `/feeds` may ask the private html2rss service to extract a server-rendered article listing. The pinned deployment under `deploy/html2rss/` listens only on loopback, uses a private bearer token and has no browser renderer. Generated sources normalize stable GUIDs, preserve first-seen dates when needed, reject future dates and abnormal batch shrinkage, emit only the latest five days and fall back to the last successful cache.

## Verification

- Logged out, verify the public sidebar and article views return only selected content from the latest five days, paginate without overlap, and transition from Cloudflare `MISS` to `HIT` after a purge.
- Verify admin-only views and writes reject signed-out requests and remain uncached.
- Signed in as admin, create, edit and delete a source; create tags and a Watchboard; verify Miniflux receives subscription changes and existing subscriptions remain intact. Category operations, when tested, use the management API rather than the current UI.
- Verify a successful source check does not create a subscription until Save. For supported page mappings and direct feeds, test discovery separately from subscription creation; do not assume homepage access and feed access are equivalent.
- Open a source from Sources, follow an item in a new tab, and return after an account recheck: the reader must stay on the selected source. Repeat with a Watchboard and with local storage unavailable. The navigation regressions in `tests/feeds-navigation.test.mjs` execute the actual effect and handlers without a browser.
- Verify Watchboards require every configured tag, independently of the source's public-selection checkbox.
- Confirm `labulubius-cau-news-refresh.timer` and `labulubius-ciee-news-refresh.timer` are active.
- Confirm Miniflux is reachable only at `127.0.0.1:8083` and no standalone reader hostname is published.

## Short-lived verified feed reuse

Probe, save and the signed feed proxy share a versioned `globalThis` server-process
cache: successful RSS/Atom/RDF bytes recognized by the existing XML feed-root check
live for 60 seconds. This is not full XML schema validation; Miniflux still validates
subscriptions. HTML and failed responses are never stored as successful feeds.
Original and final redirect URLs are aliases; each counts toward the 64-entry and
16 MiB limits. Each consumer gets a fresh Response. At most 16 distinct fetches run
through this helper concurrently; excess requests fail temporarily rather than
starting untracked work. Rejections always clear in-flight entries.

HTTP 429 stores only cooldown metadata (never the upstream error body), honoring
integer/date Retry-After values within 1–300 seconds, defaulting to 30 seconds.
The signed proxy preserves 429 and emits the remaining Retry-After. Expired entries
are removed on access; bounded FIFO eviction may shorten reuse/cooldowns under load.
The cache is volatile, process-local (not shared across workers/hosts), and does not
change edge caching, owner authorization, capability checks or persistent storage.
Every cache miss still uses public DNS pinning and per-redirect validation. An HTML
landing page may be fetched again; its discovered feed bytes can still be reused.

A failed source creation clears the successful probe preview but keeps the URL,
name and tags. A source already created with incomplete setup keeps the existing
close-and-edit recovery behavior. Automated regressions exercise actual management,
discovery and proxy wiring with mocked network/backend boundaries, separate module
bundles sharing a process global, and the actual UI submit handler without a browser.
