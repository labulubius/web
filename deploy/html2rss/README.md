# Private html2rss fallback

This pinned stack is the final webpage fallback for `/feeds`. It is installed at
`/opt/html2rss`. Only html2rss-web publishes a port, on `127.0.0.1:4000`; the
Botasaurus API has no host port, secrets, Docker socket, or host filesystem mount.
Native/direct RSS discovery and the existing CSIS adapter remain higher priority.

## Components and limits

- DNS-over-HTTPS sidecar: keeps real public DNS answers despite VM100's fake-IP
  system DNS. Do not weaken application private/special-use address checks.
- html2rss-web: existing digest-pinned image (gem 0.30.0), 512 MiB / 1 CPU.
- Botasaurus: digest-pinned image, one worker / one request per host, 768 MiB /
  1 CPU, 512 MiB shared memory, request-scoped browser profiles, no prewarming.
- Browser timeout 30s (20s post-boot work); gem 35s; web 40s; Next client 43s.
  The scraper transport adds up to 2s, still below the gem wall. A pinned-gem
  compatibility hook replaces its hidden 10s browser read timeout with the
  bounded scrape attempt deadline; normal HTTP/connect limits remain unchanged. Do not increase
  concurrency on this 4 GiB VM without measuring memory and site availability.

## Install

Create `/opt/html2rss/.env` as root with mode `0640`, owned by `root:docker`:

```text
HTML2RSS_SECRET_KEY=<64-hex-character random value>
HTML2RSS_ACCESS_TOKEN=<64-hex-character random value>
HEALTH_CHECK_TOKEN=<64-hex-character random value>
```

Copy only `HTML2RSS_ACCESS_TOKEN` into root-readable `/etc/labulubius/news.env`,
along with `HTML2RSS_API_URL=http://127.0.0.1:4000/api/v1`. Never print either env
file or use Compose output that expands secret values.

Copy `compose.yml`, `browser-profiles.rb`, `browser-profiles.yml`, and
`browser-egress.sh` to `/opt/html2rss`, without replacing `.env`.

**Install the egress guard before starting the production browser**:

```sh
sudo install -m 0755 deploy/html2rss/browser-egress.sh /opt/html2rss/browser-egress.sh
sudo install -m 0644 deploy/html2rss/browser-egress.service /etc/systemd/system/html2rss-browser-egress.service
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo install -m 0644 deploy/html2rss/docker-browser-egress.conf /etc/systemd/system/docker.service.d/html2rss-browser-egress.conf
sudo systemctl daemon-reload
sudo systemctl enable --now html2rss-browser-egress.service
cd /opt/html2rss
sudo docker compose config --quiet
sudo docker compose up -d
```

The systemd dependency installs rules before Docker starts after a reboot. It
requires no Docker restart during installation. The guard owns only its dedicated
`LAB-H2R-BROWSER` chain and jumps for source `172.30.0.54`; it never flushes shared
rules. Keep the browser's fixed address in Compose and the script in sync.

The guard permits established replies, dedicated DNS at `172.30.0.53:53`, and
public TCP 80/443, then rejects private/special-use ranges and host-local addresses.
It protects cross-container, host, redirect and subresource egress in addition to
Botasaurus's initial-target validation. The Docker network is IPv4-only. Chromium
still has its own isolated container loopback for internal browser IPC; this is
not the host's loopback and holds no host credentials or mounted private data.

## Declarative browser profiles

The URL-only create API does not accept browser wait/selector controls. A small,
read-only `RUBYOPT` adapter waits for the real SourceResolver to load, then prepends its token input method
and applies operator-owned `browser-profiles.yml` settings. It does not change
API routes, authentication, signed-token format, source registries, or original
URLs. Existing tokens pick up the same configuration on their next refresh.
Unmatched sources keep upstream `auto` behavior, with browser fallback available.

A profile matches HTTPS host/path and required query parameters. Extra query
parameters are retained, not rewritten. It can configure browser wait conditions
and html2rss's existing CSS selectors and date transforms. It cannot change the
channel URL, read local files, or carry proxy/cookie/header credentials.

The World Bank English Press Release profile:

- keeps the exact filter URL rather than resolving it to `/ext/en/news`;
- waits for actual search-result links, not just the page load event;
- extracts only `.search-item` cards, their title, URL, description and date;
- uses `parse_time` on the displayed date, not a URL date or scrape timestamp;
- disables automatic link extraction for this explicitly configured source.

Other complex sites may need a short declarative profile, not a new parser.
Browser rendering is not a guarantee of faithful extraction: check result previews,
real dates, filters, and summaries before accepting a source. Profiles cover the
loaded listing page; they do not automatically traverse all archive pages.

## Verify and operate

```sh
sh deploy/html2rss/browser-egress.sh --print-rules
sudo docker run --rm --network none --entrypoint ruby \
  -v "$PWD/deploy/html2rss:/trial:ro" \
  html2rss/web@sha256:f603b9e6e045f72165200842939f46c4f0b38825b11c850857bfb39d746ac45f \
  /trial/browser-profiles.test.rb
curl --fail --silent http://127.0.0.1:4000/api/v1/health/ready
sudo docker compose -f /opt/html2rss/compose.yml ps
sudo iptables -S LAB-H2R-BROWSER
```

Also test browser `/health` and private-target rejection from inside the container,
verify no host port is published, and use direct socket probes to verify the host
and peer services cannot be reached even if URL validation is skipped. Verify a
World Bank preview against the rendered page, including all article dates.

The site still intentionally displays only the latest five days and concise
summaries, not the complete archive or full article bodies. Existing bad Miniflux
entries are **not deleted** by enabling the browser. Removing those entries is a
separate owner-approved data cleanup. Do not delete subscriptions or preferences.

## Rollback

Keep a root-owned copy of the pre-browser Compose file before deployment. Restore
that file, run `docker compose up -d --remove-orphans`, and restore the prior site
revision if its client timeout changed. The source-specific firewall rules may
remain harmlessly installed while no container owns `172.30.0.54`. Remove the
Docker systemd drop-in/dependency only when intentionally retiring browser support.
