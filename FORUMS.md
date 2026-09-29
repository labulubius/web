# Communities

`/forums` aggregates public community discussions from Discourse forums, V2EX, Hacker News, Stack Exchange sites, Reddit communities, and arbitrary RSS/Atom feeds. Categories, provider configuration, and the shared source selection are managed by the site administrator in the sidebar. Topics from enabled sources are merged by recent activity, while visitors can filter by category or source and open the original discussion. The obsolete internal detail pages and thread-fetching API have been removed.

Configuration is stored atomically in `~/.local/share/labulubius/forums/directory.json` on the web server (override with `FORUMS_DATA_DIR`). Back up this directory with other persistent data. Legacy Discourse-only files are normalized in memory and written as version 2 on the next mutation. A missing file uses the built-in LinuxDo, V2EX, Hacker News, Stack Overflow, and Obsidian Forum sources.

The public same-origin `/api/forums` endpoint serves source metadata and accepts authenticated administrator mutations (Supabase `site_is_admin()`); Vercel relays these requests through `drive.labulubius.com`. Provider credentials are not accepted or exposed. Custom Discourse and feed URLs must be public HTTPS addresses; DNS is checked and pinned on every connection, redirects are not followed, responses are capped at 2 MB, and errors from one provider do not block other providers. Provider responses and merged snapshots are cached in each server process for five minutes, while issued pagination snapshots remain available for 30 minutes. The initial page and each Load more request return at most 50 globally sorted topics. No community content is persisted across process restarts.

Provider notes:
- Discourse uses JSON APIs and falls back to public RSS for Cloudflare-protected installations such as LinuxDo.
- V2EX uses its public topic API.
- Hacker News supports Top, New, Best, Ask HN, and Show HN.
- Stack Exchange supports a site identifier plus optional semicolon-separated tags; anonymous API quota limits apply.
- Reddit uses public JSON best-effort. Datacenter requests may be rate limited until OAuth credentials are added.
- RSS/Atom sources provide article previews but not reply counts.

Manual checks: add/edit/delete each source type, toggle sources, filter by category, and verify merged ordering and Load more without duplicates. Reject localhost/private IPs, non-HTTPS URLs, custom ports, malformed site/subreddit names, and duplicate sources. Verify original links, partial-provider warnings, mobile layout, old detail URLs returning 404, and both web-server and Vercel deployments.
