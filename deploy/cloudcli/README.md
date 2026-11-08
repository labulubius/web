# CloudCLI deployment

## Scope and addresses

- User-facing entry and both navigation links: `https://labulubius.com/cloudcli`.
- Iframe backend: `https://cloudcli.labulubius.com`; do not use it as a toolbar link or redirect the main-site route there.
- Version: the existing `@cloudcli-ai/cloudcli` 1.37.7 installation at `/Users/labulubius/Claude/projects/cloudcli/node_modules/@cloudcli-ai/cloudcli`.
- The duplicate `~/.local/share/cloudcli` installation is retained, unused and unmodified.
- No extra main-site/Supabase authentication gate. CloudCLI's native authentication is retained; hosted platform mode is explicitly disabled. Signing out of the main site does not sign out of this independent application.
- Claude credentials, provider settings and existing Remote Control services are not changed by deployment. Changes made later inside CloudCLI may affect the same provider configuration used by the native CLIs.

## Process and data separation

Mac mini service scripts and private logs are under `/Users/labulubius/CloudCLI`, mode 0700; scripts are `run.sh`, `run-tunnel.sh`, `start.py`, and `watchdog.py`.

The server listens only on `127.0.0.1:30143`, with `DATABASE_PATH=/Users/labulubius/Claude/projects/cloudcli/data/cloudcli.db`. Its existing projects, sessions and authentication configuration are retained. The database and backups are private (0600), and their directories are 0700. Keep a separate SQLite-consistent backup, not a copy of a live main database without its WAL.

A dedicated `cloudcli_tunnel_ed25519` SSH key allows only the loopback reverse listener `127.0.0.1:30143` on `web`; it does not allow a shell. The public Nginx adapter at `127.0.0.1:30144` uses that listener. Cloudflare Tunnel selects the adapter only for the exact backend hostname; retain the final 404 ingress fallback and all unrelated routes.

The Mac's `cloudcli-watchdog` crontab stanza checks for absent service/tunnel processes every minute. It never kills a live process after a health timeout. This avoids interrupting active agent tasks during a transient HTTP failure. Pi Web scripts, keys, ports and watchdog remain independent.

## Private initial account setup

CloudCLI is a single-user application. Before an account exists, its native register endpoint creates the first user without prior authentication. Therefore the public adapter permanently blocks `/api/auth/register`, including case, encoded and trailing-slash variants. Native login and authenticated APIs continue to work normally.

Initial setup is performed through a private SSH local forward to Mac `127.0.0.1:30143`. Open `http://127.0.0.1:30143/` in the browser on the machine holding that forward and choose a CloudCLI username and password yourself. This is not a Claude account login. Do not send the password through chat or put it in scripts, arguments or logs. The browser's private-origin token does not transfer to the final hostname; sign in once again through `/cloudcli` after publication using the same CloudCLI account.

Do not enable public registration or hosted platform mode as an initialization shortcut. Do not invent a default password. If setup has not been completed, report that fact instead of claiming the service is fully usable.

## Adapter and long-lived connections

Install `nginx.conf` as `/etc/nginx/conf.d/cloudcli.conf`, test the complete configuration with `nginx -t`, then reload Nginx. The adapter preserves native bearer headers and WebSocket query tokens, supports Upgrade, disables proxy buffering for SSE, and permits request bodies up to the native server's 50 MiB limit. API/HTML/asset responses all use private/no-store at this adapter. Only the main site may frame the backend. Access logging is disabled; error output is discarded because native SSE/WebSocket URLs may contain tokens.

Run `tests/cloudcli.test.mjs` for isolated real-Nginx registration, authentication forwarding, upload, streaming and upgrade checks. These tests use temporary mock services and fixture tokens, never production sessions or agent commands. Positive login and an actual agent task require the owner's browser and provider authorization; do not claim those checks from HTTP probes alone.

## DNS and cache publication

The proxied CNAME `cloudcli.labulubius.com` targets the existing Tunnel UUID hostname. Use the existing Mac Keychain helper for DNS changes and cache purging; never export its Cloudflare token to Linux or save it to a file. Headless SSH cannot currently access the login-Keychain item. If necessary, the owner runs the prepared `~/bin/publish-cloudcli-20261108.py` in the already-authorized Mac terminal. It is limited to the exact new CNAME and a zone-scoped cache purge, and checks origin readiness before changing DNS.

After publishing the new main-site toolbar, purge the zone cache once: URL-only purges previously failed to invalidate these document shells. Verify ordinary, unversioned `/`, `/nav` and `/about` responses contain `href="/cloudcli"` and retain `href="/pi-web"`. Verify `/cloudcli` returns 200 without a Location header, native protected APIs reject unauthenticated requests with 401, and public registration is 403. Backend responses and private APIs must not become edge-cached.

## Rollback

Retain the pre-deployment source/build and `/etc/cloudflared/config.yml` snapshots under the deployment state/backup directories. Remove only the new CloudCLI ingress, CNAME and Nginx adapter when retiring it; never touch Pi Web or other ingress rules. Roll back the main-site source/build using the standard deployment procedure and purge the zone's old document shells.

Before stopping the Mac service, remove only the `cloudcli-watchdog` crontab stanza. Stop only PIDs whose command lines match this CloudCLI installation and dedicated tunnel key. Keep the database, account, existing project installation, provider credentials and session data. Do not use a broad `pkill node` or a destructive Git clean/reset.
