# Operations

## Health checks

`GET /api/health` is an unauthenticated liveness check. It returns only `{"status":"ok"}` with `Cache-Control: no-store`; it intentionally does not disclose dependency, disk, version, path, or credential details.

Run `scripts/health-check.sh` to check the main Next.js service, the `/pi-web` and `/cloudcli` entries (200 without redirects), the Agent backend hostname, and CloudCLI's native backend health and unauthenticated API rejection, require `404 Not Found` for retired Drive and Feeds paths on the main origin, and require DNS `NXDOMAIN` for the former Drive hostname (A, AAAA and CNAME via Cloudflare DNS-over-HTTPS). The script requires curl and Python 3. Override `MAIN_ORIGIN`, `RETIRED_DRIVE_HOSTNAME`, `AGENT_ORIGIN`, `CLOUDCLI_ORIGIN`, or `HEALTH_TIMEOUT` for staging. Monitor dependency failures through authenticated application checks and systemd logs rather than expanding the public response.

## Production host routing

Cloudflare Tunnel is the only public web entry point. It sends `labulubius.com` and `www.labulubius.com` to Next.js on `127.0.0.1:3000` and `pi-web.labulubius.com` to Pi Web. These services and WebDAV remain bound to loopback; do not add a public port forward. The former `drive.labulubius.com`, `rss.labulubius.com` and `share.labulubius.com` DNS records and Tunnel ingress rules are deleted. Drive must no longer resolve. Do not recreate the Drive DNS record or ingress. The Drive DNS/configuration audit snapshots are root-only on VM100 under `/var/backups/labulubius/drive-dns-retirement-20261015T060051Z`. Keep the Tunnel's final `http_status:404` fallback so an unconfigured hostname cannot reach another origin.

The ImmortalWrt gateway's Nikki configuration routes only Cloudflare Tunnel destination port `7844` through Hong Kong `Node-1`; the active Tunnel should register at an HKG edge. This rule must not capture VM100's other outbound traffic or other LAN clients. The route improves the origin-to-Cloudflare leg but cannot control the Anycast edge selected for visitors, so clients in China may still enter Cloudflare through LAX. The 2026-10-06 comparison measured median total times of 2.783 seconds through Hong Kong, 5.219 seconds by direct domestic egress, and 6.899 seconds through the former RackNerd route. Gateway and VM100 rollback material is under `/root/backups/nikki-route-cutover-20261006T132639Z` on the gateway and `/var/backups/labulubius/network-route-cutover-20261006T132639Z` on VM100.

The user-facing Pi Web entry is `https://labulubius.com/pi-web`. It embeds the backend at `https://pi-web.labulubius.com` without changing the top-level browser address. Main-site navigation and handoffs target `/pi-web`; an administrator's main-site session is exchanged through the backend's `/api/owner-auth` endpoint using credentialed requests with an Authorization header, never a token in the iframe URL. Keep `PI_WEB_PARENT_ORIGIN=https://labulubius.com` and the exact backend allowed hostname `pi-web.labulubius.com`. The persistent frame survives main-site navigation and background auth refresh; signing out clears its owner-session hint and requests backend session removal. Passwords and session files are unchanged. The former `pi.labulubius.com` DNS record and ingress and main-site `/pi` route stay removed, without redirects.

CloudCLI's user-facing route is `https://labulubius.com/cloudcli`; its separate iframe backend is `https://cloudcli.labulubius.com`. Cloudflare Tunnel forwards that backend hostname to Nginx on `web` at `127.0.0.1:30144`, which proxies through a dedicated SSH reverse listener at `127.0.0.1:30143` to the Mac mini's loopback CloudCLI server at the same port. Native CloudCLI authentication stays enabled; no main-site token is forwarded and no extra Supabase gate is added. Public registration is disabled by the adapter, and initial setup uses a private local SSH forward. Keep backend responses private/no-store and preserve WebSocket upgrades and unbuffered SSE. See [CloudCLI operations](deploy/cloudcli/README.md).

## Cloudflare performance and cache boundaries

The active Cloudflare Cache Rule edge-caches ordinary HTML document requests for the exact paths `/`, `/about`, and `/nav` for one hour. The HTML rule requires `GET` or `HEAD`, an empty query string, an `Accept` header containing `text/html`, no `Authorization` header, and no React Server Component header. These responses are static document shells; private workspace data is loaded only after browser-side administrator verification.

Never broaden these rules to `/api/**`, authenticated requests, Agent responses, WebDAV, errors, mutations, or capability URLs. Authorization failures, health checks and private APIs must remain `DYNAMIC` or `BYPASS` with `private, no-store` or `no-store`. After every deployment, purge the three cached HTML URLs so clients cannot receive an old Next.js asset manifest, then verify a cold request (`MISS` or `EXPIRED`) followed by `HIT`. Also repeat the exclusion checks before considering the deployment complete. If URL-only purging leaves an old HTML object in place, use a zone-scoped `purge_everything` once, then verify the actual public navigation links, not only the API's success response. This occurred during the 2026-11-08 Pi Web entry change; do not declare a new toolbar link live while a cached shell still contains the old one.

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

Commit and push the verified revision to GitHub, restart `labulubius-web.service`, purge the cached HTML URLs `/`, `/about` and `/nav` through the Cloudflare API, then run `scripts/health-check.sh`. Confirm the new GitHub Actions run succeeds and validate `MISS → HIT` for the document shells. Recheck that RSC requests, `/api/health`, authorization failures and `/feeds` are not cached. GitHub is the source history and CI remote; it is not a deployment target. Never use `git clean` or a destructive reset on the production checkout without separately checking ignored environment files and the persistent data directories. Roll back by checking out or reverting to a known-good Git revision, rebuilding, restarting the service, purging the affected cache entries and repeating the health and cache-boundary checks.

## WebDAV file storage

`https://dav.labulubius.com/` is the authenticated WebDAV file root, independent of the retired Drive website. Its canonical configuration is `deploy/webdav/nginx.conf`, installed as `/etc/nginx/sites-available/zotero-webdav`. Cloudflare Tunnel reaches the loopback frontend on `127.0.0.1:8081`; that frontend normalizes same-origin HTTPS `Destination` headers and proxies to the authenticated DAV engine on `127.0.0.1:8084`. The existing Supabase administrator authentication bridge remains on `127.0.0.1:8082`. Keep all three listeners private; the DAV engine must authenticate requests even when accessed directly on loopback.

All files live under `/srv/webdav-data`. The existing attachments are at `/srv/webdav-data/zotero`, and Zotero's external `/zotero/` URL is unchanged. `zotero` is an ordinary, visible folder: it has no alias, virtual mount, special route or protection against renaming, moving or deletion. Renaming or deleting it will affect Zotero synchronization. Ordinary files and folders may be managed directly alongside it at the root. Do not restore any retired Drive files, DNS records, APIs or UI.

Keep `absolute_redirect off;` on both servers to preserve the public HTTPS connection during directory normalization. The frontend also translates HTTP `Location` headers from the DAV engine back to the public HTTPS origin. Unauthenticated root and file requests must return 401 with private/no-store caching; authenticated `PROPFIND /` must list `zotero/`. A browser directory index is deliberately disabled; use WebDAV clients, not an HTML file-management page. The current per-request upload limit remains 95 MiB.

Run the isolated Nginx integration tests in `tests/webdav.test.mjs` before deployment. They use a temporary data root and mock authentication, never production attachments, and verify authentication on both listeners, root listing, Unicode filenames, upload/download, absolute-HTTPS file and folder MOVE/COPY, and equal rename/delete/recreate behavior for `Documents` and `zotero`. GitHub CI installs Nginx and its DAV extension so these tests are exercised there too. See `deploy/webdav/README.md` for client addresses, deployment and rollback details.

## Security headers

Next.js applies CSP, clickjacking, MIME-sniffing, referrer, permissions, and production HSTS headers to all routes. The CSP permits the same origin, Supabase HTTPS/WebSocket connections, and the dedicated Drive origin. It retains inline script/style compatibility required by the current Next.js bootstrap, theme initializer, and drag-and-drop UI. Recheck CSP before adding a new browser-side origin. Verify effective headers on the main hostname and DNS `NXDOMAIN` for the retired Drive hostname after changes to Cloudflare Tunnel or a reverse proxy.

## Backups and restore drills

Back up these independent data sets together at a documented point in time:

- `${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}`, including `tasks.json` when tasks have been created;
- Supabase data using the provider's supported export/backup mechanism.

Generate and retain checksums with the backup. Drive has been retired and its live data deleted by owner request; do not restore `DRIVE_DATA_DIR` as an active service. Its empty directory remains solely for the independent PDF-to-EPUB cleanup sandbox; do not remove that directory without reviewing the dependent unit.

Perform periodic restores into isolated directories, never over live data. Before starting an isolated service, run:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks
```

The verifier is read-only. It rejects symlinks and malformed task JSON. Optional `--drive LEGACY_DIR` verifies an independently retained historical Drive backup, if one exists; it is not required for current backups. Passing structural checks is not a substitute for opening files and exercising an isolated restored application.
