# Private Miniflux shadow

This pinned stack mirrors the FreshRSS subscriptions while the application continues to use FreshRSS. It binds only to `127.0.0.1:8083`; do not add a public reverse proxy during shadow validation.

Install `compose.yml` at `/opt/miniflux-shadow/compose.yml`. Create `/opt/miniflux-shadow/.env` as `root:docker` mode `0640`:

```text
MINIFLUX_DB_PASSWORD=<64-hex-character random value>
MINIFLUX_ADMIN_PASSWORD=<64-hex-character random value>
```

The PostgreSQL data directory is `/opt/miniflux-shadow/postgres`. The Miniflux API token, FreshRSS OPML export, and validation reports are runtime artifacts under `/opt/miniflux-shadow` and must remain root-only; they are not tracked in Git.

The app joins `freshrss_backend` so imported `http://rsshub:1200/...` subscriptions continue to work. `FETCHER_ALLOW_PRIVATE_NETWORKS=1` is therefore required. This would broaden SSRF exposure on a public reader, so the shadow API/UI must remain loopback-only and future application writes must continue to pass the existing public-URL validation or use explicitly managed internal providers.

FreshRSS OPML does not include feed-level HTTP Basic credentials. Migrate the single authenticated generated source separately through `PUT /v1/feeds/{id}` without logging or committing the decoded credential.

Miniflux cleanup settings are defense in depth. The `/feeds` backend must still enforce its own five-day query window and UTC future-date exclusion rather than exposing Miniflux read/unread or archive semantics.

## Cutover and rollback

Before setting `NEWS_READER_BACKEND=miniflux`, create a root-only timestamped backup of every Source-selection and Watchboard JSON file, then remap all current `feed/{FreshRSS ID}` values to `feed/{Miniflux ID}` by exact raw feed URL. Drop stale unmapped tag keys so reused Miniflux IDs cannot inherit old tags.

Keep FreshRSS running but application-read-only for two to four weeks after cutover. To roll back to the cutover snapshot:

```sh
sudo deploy/miniflux-shadow/rollback-reader.sh /opt/miniflux-shadow/cutover-backup-<timestamp>
```

This restores the saved selections and tag bindings, switches the application backend to FreshRSS, and restarts the web service. Changes made after the cutover snapshot are not dual-written and must be reconciled manually before a late rollback.
