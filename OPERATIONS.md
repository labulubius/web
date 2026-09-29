# Operations

## Health checks

`GET /api/health` is an unauthenticated liveness check. It returns only `{"status":"ok"}` with `Cache-Control: no-store`; it intentionally does not disclose dependency, disk, version, path, or credential details.

Run `scripts/health-check.sh` to check the main, Drive, and Share hostnames. Override `MAIN_ORIGIN`, `DRIVE_ORIGIN`, `SHARE_ORIGIN`, or `HEALTH_TIMEOUT` for staging. Monitor dependency-specific failures through authenticated application checks and systemd/container logs rather than expanding the public response.

## Security headers

Next.js applies CSP, clickjacking, MIME-sniffing, referrer, permissions, and production HSTS headers to all routes. The CSP permits the same origin, Supabase HTTPS/WebSocket connections, and the dedicated Drive/Share origins. It retains inline script/style compatibility required by the current Next.js bootstrap, theme initializer, and drag-and-drop UI. Recheck CSP before adding a new browser-side origin. Verify effective headers on all three hostnames after changes to Vercel, Cloudflare, or a reverse proxy.

## Backups and restore drills

Back up these independent data sets together at a documented point in time:

- the complete `DRIVE_DATA_DIR`, including `.upload-sessions`;
- the complete `SHARE_DATA_DIR`, including metadata, blobs, thumbnails, folders, and upload sessions;
- `${NEWS_DATA_DIR}` preferences and Watchboards;
- `${FORUMS_DATA_DIR}/directory.json`;
- a consistent FreshRSS PostgreSQL dump;
- Supabase data using the provider's supported export/backup mechanism.

Pause new uploads or let pending sessions complete before taking a consistency-sensitive snapshot. Generate and retain checksums with the backup. Article-bearing FreshRSS backups must follow the same five-day retention policy as the live News database.

Perform periodic restores into isolated directories, never over live data. Before starting an isolated service, run:

```bash
node scripts/verify-backup.mjs \
  --drive /restore/drive \
  --share /restore/share \
  --news /restore/news \
  --forums /restore/forums \
  --freshrss-dump /restore/freshrss.dump
```

The verifier is read-only. It rejects symlinks, malformed JSON, missing Share blobs/thumbnails, reused Drive/Share roots, and unreadable PostgreSQL dump catalogs. Passing structural checks is not a substitute for opening files and exercising an isolated restored application.
