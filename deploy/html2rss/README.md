# Private html2rss fallback

This pinned stack is the final static-page fallback for `/feeds`. It is installed at `/opt/html2rss`, binds only to `127.0.0.1:4000`, and intentionally omits Botasaurus or any other browser renderer.

Create `/opt/html2rss/.env` as root with mode `0640`, owned by `root:docker`:

```text
HTML2RSS_SECRET_KEY=<64-hex-character random value>
HTML2RSS_ACCESS_TOKEN=<64-hex-character random value>
HEALTH_CHECK_TOKEN=<64-hex-character random value>
```

Copy `compose.yml` beside that file and run `docker compose up -d`. Copy only `HTML2RSS_ACCESS_TOKEN` into root-readable `/etc/labulubius/news.env`, along with:

```text
HTML2RSS_API_URL=http://127.0.0.1:4000/api/v1
```

The dedicated DNS-over-HTTPS sidecar is required because VM100 system DNS returns `198.18.0.0/15` proxy addresses. Supplying real public answers lets html2rss retain its private/special-use network denial instead of weakening SSRF protection. Neither service publishes a management interface.
