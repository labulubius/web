# Private Miniflux reader

This pinned stack is the production storage and polling backend for `/feeds`. It binds only to `127.0.0.1:8083`; do not publish the Miniflux UI or API through a reverse proxy.

Install `compose.yml` at `/opt/miniflux/compose.yml`. Create `/opt/miniflux/.env` as `root:docker` mode `0640` with `MINIFLUX_DB_PASSWORD` and `MINIFLUX_ADMIN_PASSWORD`. The PostgreSQL data directory is `/opt/miniflux/postgres`. Keep the Miniflux API token root-only and provide it to `labulubius-web.service` as `MINIFLUX_API_TOKEN`; the browser never receives it.

The app joins the private `html2rss_backend` network only to use that stack's DNS proxy. Sources are accepted exclusively through the application's public-URL validation or managed generated-feed adapters.

Miniflux cleanup settings are defense in depth. The `/feeds` backend independently enforces its five-day query window and UTC future-date exclusion and deliberately does not expose Miniflux read/unread, favorites, notification or archive state.
