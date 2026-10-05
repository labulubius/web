# Operations

## Health checks

`GET /api/health` is an unauthenticated liveness check. It returns only `{"status":"ok"}` with `Cache-Control: no-store`; it intentionally does not disclose dependency, disk, version, path, or credential details.

Run `scripts/health-check.sh` to check the main, Drive, Feeds and Agent hostnames. Override `MAIN_ORIGIN`, `DRIVE_ORIGIN`, `FEEDS_ORIGIN`, `AGENT_ORIGIN`, or `HEALTH_TIMEOUT` for staging. Monitor dependency-specific failures through authenticated application checks and systemd/container logs rather than expanding the public response.

## Production deployment

VM100 is the only web production host and the only Web code workspace. The checkout is `/home/debian/labulubius`, and `labulubius-web.service` runs its production build on `127.0.0.1:3000`. Do not clone or maintain the Web repository on the Mac mini. The Mac mini Agent must reach the VM with `ssh web` and edit the VM100 checkout directly. Before committing or restarting production, require a clean review of `git diff` and run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Commit and push the verified revision to GitHub, restart `labulubius-web.service`, then run `scripts/health-check.sh`. GitHub is the source history and CI remote; it is not a deployment target. Never use `git clean` or a destructive reset on the production checkout without separately checking ignored environment files and the persistent data directories. Roll back by checking out or reverting to a known-good Git revision, rebuilding, restarting the service and repeating the health checks.

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
- `${FORUMS_DATA_DIR}/directory.json`;
- a consistent FreshRSS PostgreSQL dump;
- Supabase data using the provider's supported export/backup mechanism.

Pause new uploads or let pending sessions complete before taking a consistency-sensitive snapshot. Generate and retain checksums with the backup. Article-bearing FreshRSS backups must follow the same five-day retention policy as the live News database.

Perform periodic restores into isolated directories, never over live data. Before starting an isolated service, run:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news \
  --forums /restore/forums \
  --freshrss-dump /restore/freshrss.dump
```

The verifier is read-only. It rejects symlinks, malformed task or Drive share-link JSON, and unreadable PostgreSQL dump catalogs. Passing structural checks is not a substitute for opening files and exercising an isolated restored application.
