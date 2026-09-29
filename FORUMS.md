# Communities

`/forums` aggregates public community discussions from Discourse forums, V2EX, Hacker News, Stack Exchange sites, Reddit communities, and arbitrary RSS/Atom feeds. Categories, provider configuration, and the shared source selection are managed by the site administrator in the sidebar. Topics from enabled sources are merged by recent activity, while visitors can filter by category or source and open text-only discussion previews.

Configuration is stored atomically in `~/.local/share/labulubius/forums/directory.json` on the web server (override with `FORUMS_DATA_DIR`). Back up this directory with other persistent data. Legacy Discourse-only files are normalized in memory and written as version 2 on the next mutation. A missing file uses the built-in LinuxDo, V2EX, Hacker News, Stack Overflow, and Obsidian Forum sources.

The public same-origin `/api/forums` endpoint serves source metadata and accepts authenticated administrator mutations (Supabase `site_is_admin()`); Vercel relays these requests through `drive.labulubius.com`. Provider credentials are not accepted or exposed. Custom Discourse and feed URLs must be public HTTPS addresses; DNS is checked and pinned on every connection, redirects are not followed, responses are capped at 2 MB, and errors from one provider do not block other providers. Responses are cached in each server process for five minutes and no community content is persisted.

Provider notes:
- Discourse uses JSON APIs and falls back to public RSS for Cloudflare-protected installations such as LinuxDo.
- V2EX uses its public topic and reply APIs.
- Hacker News supports Top, New, Best, Ask HN, and Show HN.
- Stack Exchange supports a site identifier plus optional semicolon-separated tags; anonymous API quota limits apply.
- Reddit uses public JSON best-effort. Datacenter requests may be rate limited until OAuth credentials are added.
- RSS/Atom sources provide article previews but not reply counts.

Manual checks: add/edit/delete each source type, toggle sources, filter by category, and verify merged ordering. Reject localhost/private IPs, non-HTTPS URLs, custom ports, malformed site/subreddit names, and duplicate sources. Open list and detail views for each provider, verify original links, partial-provider warnings, mobile layout, and both web-server and Vercel deployments.
