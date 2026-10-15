# Authenticated WebDAV file root

## Client connections

- HTTPS URL: `https://dav.labulubius.com/`
- Fedora KDE Dolphin: `webdavs://dav.labulubius.com/`
- Windows WinSCP: WebDAV, TLS/SSL, host `dav.labulubius.com`, port `443`, remote directory `/`.
- Android WebDAV file manager: the HTTPS URL above.
- Credentials: the existing Supabase administrator account used for Zotero; do not put credentials in URLs or this repository.

The root lists ordinary user files and folders, including `zotero/`. That folder is not hidden, protected, aliased or mounted specially: it can be renamed, moved, copied or deleted just like any other folder. Doing so may break Zotero synchronization or delete attachments. Zotero continues to use `https://dav.labulubius.com/zotero/`; its existing contents and account are preserved during the initial migration.

This is not an HTML file browser or automatic folder-sync service. Authenticated WebDAV clients browse using PROPFIND; directory indexes remain disabled. The per-request upload limit is 95 MiB, below the Cloudflare proxied request limit. This change does not add chunked uploads, public shares, a new backup schedule or an automatic trash/recovery system. User deletions are real deletions. No old Drive data is restored.

## Storage and service boundaries

- One ordinary filesystem root: `/srv/webdav-data`, owned by `www-data:www-data`, mode `0750`.
- Existing attachment folder after migration: `/srv/webdav-data/zotero`.
- Canonical Nginx configuration: `deploy/webdav/nginx.conf`.
- Installed configuration: `/etc/nginx/sites-available/zotero-webdav`, already enabled by the existing symlink.
- Cloudflare Tunnel frontend: `127.0.0.1:8081`.
- Authenticated DAV engine: `127.0.0.1:8084`.
- Existing administrator-auth bridge: `127.0.0.1:8082` (`zotero-auth.service`, unchanged).

All listeners stay bound to loopback. The frontend normalizes only same-origin HTTPS Destination headers for the HTTP DAV engine; cross-origin destinations are rejected by the DAV engine. The engine retains authentication even for direct loopback requests. Relative directory redirects preserve HTTPS, and COPY/MOVE response Location headers are rewritten to public HTTPS. Authenticated and unauthenticated public responses are private/no-store; no DAV path belongs in a shared cache rule.

## Verification and future configuration deployments

Install `nginx` and `libnginx-mod-http-dav-ext` for the real-server integration test (CI does so explicitly), then run the normal lint, typecheck, tests and build. `tests/webdav.test.mjs` starts isolated loopback servers with a temporary root and fixture-only authentication. It performs destructive folder tests only on fixtures, not on real attachments. It verifies that `zotero` and `Documents` have the same behavior.

Before changing the live configuration, review its diff and save a root-only backup. Install the reviewed configuration, run `sudo nginx -t`, and reload Nginx. Check that unauthenticated root, attachment and direct-engine requests are rejected, then check root PROPFIND and a disposable folder's upload/download/rename/copy/move/delete with the real client account. Never test destructive folder operations against the real `zotero` directory.

For a configuration-only rollback, restore the saved config, run the Nginx configuration test and reload. If switching from a newer build, confirm that its storage root still matches the configuration before reloading.

## Initial migration and recovery

The initial root deployment takes a short DAV-only maintenance window: stop Nginx writes, archive and hash all existing `/srv/zotero-data` files in a root-only backup, move that directory on the same filesystem to `/srv/webdav-data/zotero`, compare its manifest and hashes, install the reviewed configuration, test and start Nginx. No attachment contents are rewritten. The ordinary `zotero` folder then has no privileged treatment.

The migration backup directory is `/var/backups/labulubius/webdav-root-20261015T135109Z`. It contains the pre-change Nginx configuration (`nginx.conf.before`), attachment archive and SHA-256 manifest recorded at cutover. These data backups are not committed to Git.

A pre-root rollback must restore the old filesystem layout together with `nginx.conf.before`: stop DAV writes, preserve any newly uploaded files, and move the current `zotero` folder back to `/srv/zotero-data` if it is intact and that destination does not exist. If the folder was subsequently renamed/deleted or changed, inspect the current data and restore the archived snapshot only into a separate directory for recovery; never overwrite or discard newer user files automatically. Test the restored configuration and restart Nginx. The earlier redirect-only backup at `/var/backups/labulubius/webdav-redirect-20261015T133044Z/zotero-webdav` predates this storage migration and must not be blindly applied to the new layout.
