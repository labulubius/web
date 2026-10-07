# Operations

## Health checks

`GET /api/health` is an unauthenticated liveness check. It returns only `{"status":"ok"}` with `Cache-Control: no-store`; it intentionally does not disclose dependency, disk, version, path, or credential details.

Run `scripts/health-check.sh` to check the main Next.js service, Drive API host and Agent hostname. Override `MAIN_ORIGIN`, `DRIVE_ORIGIN`, `AGENT_ORIGIN`, or `HEALTH_TIMEOUT` for staging. Monitor Miniflux and other dependency failures through authenticated application checks and systemd/container logs rather than expanding the public response.

## Production host routing

Cloudflare Tunnel is the only public web entry point. It sends `labulubius.com` and `drive.labulubius.com` to Next.js on `127.0.0.1:3000` and `agent.labulubius.com` to Agent. These services and WebDAV remain bound to loopback; do not add a public port forward. The workspace reader is at `https://labulubius.com/feeds`; Miniflux remains private on `127.0.0.1:8083`. The former `rss.labulubius.com` and `share.labulubius.com` DNS records and Tunnel ingress rules are retired. Keep the Tunnel's final `http_status:404` fallback so an unconfigured hostname cannot reach another origin.

The ImmortalWrt gateway's Nikki configuration routes only Cloudflare Tunnel destination port `7844` through Hong Kong `Node-1`; the active Tunnel should register at an HKG edge. This rule must not capture VM100's other outbound traffic or other LAN clients. The route improves the origin-to-Cloudflare leg but cannot control the Anycast edge selected for visitors, so clients in China may still enter Cloudflare through LAX. The 2026-10-06 comparison measured median total times of 2.783 seconds through Hong Kong, 5.219 seconds by direct domestic egress, and 6.899 seconds through the former RackNerd route. Gateway and VM100 rollback material is under `/root/backups/nikki-route-cutover-20261006T132639Z` on the gateway and `/var/backups/labulubius/network-route-cutover-20261006T132639Z` on VM100.

## Cloudflare performance and cache boundaries

The active Cloudflare Cache Rules edge-cache ordinary HTML document requests for the exact public paths `/`, `/about`, `/nav`, and `/feeds` for one hour. The HTML rule requires `GET` or `HEAD`, an empty query string, an `Accept` header containing `text/html`, no `Authorization` header, and no React Server Component header. A separate rule caches successful `GET /api/news` responses only when the query is exactly `view=sidebar`, exactly `view=publicArticles`, or starts with `view=publicArticles&cursor=`. The API rule preserves the full query string as part of the default cache key and respects the route's `s-maxage=30, stale-while-revalidate=60` header.

Never broaden these rules to `/api/**`, `/drive/file/**`, authenticated requests, Agent responses, WebDAV, errors, mutations, or capability URLs. Invalid cursors, authorization failures, health checks and private APIs must remain `DYNAMIC` or `BYPASS` with `private, no-store` or `no-store`. After every deployment, purge the four cached HTML URLs so clients cannot receive an old Next.js asset manifest, then verify a cold request (`MISS` or `EXPIRED`) followed by `HIT`. Also repeat the exclusion checks before considering the deployment complete.

HTTP/3, TLS 1.3 with 0-RTT, Brotli/Zstandard compression, Early Hints and Smart Tiered Cache are enabled. Always Online remains disabled because the workspace includes owner-only and time-sensitive surfaces. A same-path seven-request sample on 2026-10-06 measured a 1.002-second median TTFB for cached HTML versus 2.255 seconds for an uncached health request; this is an operational comparison, not a guarantee for every visitor.

Cloudflare automation uses the Mac mini's `cf-labulubius-api` helper and a least-privilege token stored in the macOS login Keychain. Never put the token in Git, VM environment files, command arguments, documentation or backup archives. Keep the token scoped to `labulubius.com`; this workflow requires Zone Read, Zone Settings Edit, Cache Rules Edit, Cache Purge and Argo Edit permissions, and no account-wide access. The root-only pre-change responses, final state, checksums and rollback instructions are stored on VM100 at `/var/backups/labulubius/cloudflare-performance-20261006`.

## Production deployment

VM100 is the only web production host and the only Web code workspace. The checkout is `/home/debian/labulubius`, and `labulubius-web.service` runs its production build on `127.0.0.1:3000`. Do not clone or maintain the Web repository on the Mac mini. The Mac mini Agent must reach the VM with `ssh web` and edit the VM100 checkout directly. Before committing or restarting production, require a clean review of `git diff` and run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Commit and push the verified revision to GitHub, restart `labulubius-web.service`, purge the cached HTML URLs `/`, `/about`, `/nav` and `/feeds` through the Cloudflare API, then run `scripts/health-check.sh`. Confirm the new GitHub Actions run succeeds and validate `MISS → HIT` for public HTML and both public News views. Recheck that RSC requests, `/api/health`, private News views, invalid cursors and `/drive/file/**` are not cached. GitHub is the source history and CI remote; it is not a deployment target. Never use `git clean` or a destructive reset on the production checkout without separately checking ignored environment files and the persistent data directories. Roll back by checking out or reverting to a known-good Git revision, rebuilding, restarting the service, purging the affected cache entries and repeating the health and cache-boundary checks.

## CAU notice synchronization

`labulubius-cau-news-refresh.timer` refreshes the authenticated school-notice feed every 30 minutes. Check it with `systemctl status labulubius-cau-news-refresh.timer` and `journalctl -u labulubius-cau-news-refresh.service`. Login failures do not log credentials or response bodies. Rotate the encrypted credentials with `systemd-creds encrypt --name=cau-username` and `--name=cau-password`, then restart `labulubius-web.service`.

`labulubius-ciee-news-refresh.timer` independently refreshes the public CIEE notice feed every 30 minutes. Check it with `systemctl status labulubius-ciee-news-refresh.timer` and `journalctl -u labulubius-ciee-news-refresh.service`. Its cache is `${NEWS_DATA_DIR:-~/.local/share/labulubius/news}/ciee-feed.json`; a failed refresh keeps the last successful cache. Install the root-owned wrapper from `scripts/ciee-news-refresh.sh` and the unit templates from `deploy/systemd/`.

## Security headers

Next.js applies CSP, clickjacking, MIME-sniffing, referrer, permissions, and production HSTS headers to all routes. The CSP permits the same origin, Supabase HTTPS/WebSocket connections, and the dedicated Drive origin. It retains inline script/style compatibility required by the current Next.js bootstrap, theme initializer, and drag-and-drop UI. Recheck CSP before adding a new browser-side origin. Verify effective headers on the main and Drive hostnames after changes to Cloudflare Tunnel or a reverse proxy.

## Backups and restore drills

Back up these independent data sets together at a documented point in time:

- `${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}`, including `tasks.json` when tasks have been created;
- the complete `DRIVE_DATA_DIR`, including `.upload-sessions`;
- `${NEWS_DATA_DIR}` preferences and Watchboards;
- a consistent Miniflux PostgreSQL backup;
- Supabase data using the provider's supported export/backup mechanism.

Pause new uploads or let pending sessions complete before taking a consistency-sensitive snapshot. Generate and retain checksums with the backup. Article-bearing Miniflux backups must follow the same five-day retention policy as the live Miniflux database.

Perform periodic restores into isolated directories, never over live data. Before starting an isolated service, run:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news
```

The verifier is read-only. It rejects symlinks and malformed task, Drive share-link or News JSON. Restore and validate the Miniflux database separately with PostgreSQL tooling. Passing structural checks is not a substitute for opening files and exercising an isolated restored application.
