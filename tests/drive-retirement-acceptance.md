# Drive retirement acceptance

Target route: `/drive/**`, `/api/drive/**`, and the former `drive.labulubius.com` host.
Approved scope: complete retirement, removal of global Drive navigation, and deletion of Drive data by explicit owner request. No replacement file manager is deployed.
Reference pages inspected: existing Drive route, SiteShell, PlacesSidebar and Agent layout. `DESIGN.md` was read before planning and modification.
Existing components/tokens reused: remaining SiteShell and PlacesSidebar are unchanged except removal of their Drive entry and unused icon. No stylesheet changes.
Shared files changed: approved navigation removal in `app/site-shell.tsx` and `app/places-sidebar.tsx`; retirement of host/path routing in `proxy.ts`. No website-authentication, CSP or global-layout changes.
Other routes changed visually or behaviorally: shared navigation on Home, Navigator, Feeds and About loses Drive only. Agent keeps its existing independent iframe behavior.

## Files changed

- `DRIVE.md`
- `OPERATIONS.md`
- `README.md`
- `SHARE.md`
- `app/api/drive/download/route.ts`
- `app/api/drive/route.ts`
- `app/api/drive/shares/[id]/route.ts`
- `app/api/drive/shares/route.ts`
- `app/api/drive/upload/route.ts`
- `app/drive-shortcut.tsx`
- `app/drive/drive-manager.tsx`
- `app/drive/drive.css`
- `app/drive/file/[id]/download-response.ts`
- `app/drive/file/[id]/download/route.ts`
- `app/drive/file/[id]/route.ts`
- `app/drive/page.tsx`
- `app/lib/drive-server.ts`
- `app/lib/drive-shares.ts`
- `app/lib/retired-drive.ts`
- `app/lib/upload-client.ts`
- `app/lib/upload-sessions.ts`
- `app/places-sidebar.tsx`
- `app/site-shell.tsx`
- `proxy.ts`
- `scripts/health-check.sh`
- `scripts/verify-backup.mjs`
- `tests/core.test.mjs`
- `tests/drive-retirement-acceptance.md`
- `tests/drive-retirement.test.mjs`
- `tests/page-metadata.test.mjs`

## States checked

- Application retirement: page, nested public links/downloads, management APIs and stale uploads return `410 Gone` for all HTTP methods without touching storage. A defensive direct-origin host guard remains, but the public former hostname must not resolve; see the DNS retirement addendum below.
- Anonymous requests and invalid bearer tokens cannot retrieve files or mutate storage; retirement responses do not enable CORS or return download headers.
- Existing Tasks authentication boundary remains `401` for anonymous access; public News sidebar remains available.
- Loading, populated/empty collections, editing and destructive dialogs for Drive: not applicable, because their implementation is removed rather than redesigned.
- Signed-out remaining pages checked in Chromium. Existing administrator/non-admin account sessions and mutation workflows were not exercised; their code was not changed.

## Responsive and accessibility checks

Automated Chromium checks through an isolated candidate server on VM100 covered Home, Navigator, Feeds and About at 1440, 1280, 760, 650 and 390 px, each in light, dark and system theme mode (60 combinations). Checks verified active theme, removal of Drive links, no horizontal document overflow, focusable navigation and preserved Tab order. Agent iframe destination was checked separately.

Focus appearance, visual contrast, dialogs, screen-reader announcements, system-color-scheme switching, and reduced-motion behavior were not manually reviewed; related styles and logic are unchanged. This is not a claim of a complete accessibility audit.

## Security and data contract

The retired surface returns uncached `410 Gone` with no filesystem or authentication calls. Adjacent namespaces (`/driveway`, `/api/driver`), canonical-www redirects and unrelated APIs remain unaffected. Explicit host matchers retire old-host static assets as well.

Only contents of the dedicated `/home/debian/drive-data` root are authorized for deletion, after production retirement verification. The empty directory remains for an independent PDF-to-EPUB cleanup unit sandbox. No new Drive-data backup is created. Remove the obsolete `DRIVE_DATA_DIR` setting without logging environment values. Zotero data, DAV/auth/tunnel configuration and unrelated legacy storage must remain untouched; compare their audit fingerprints during deployment.

## Automated verification

- `git diff --check`: passed before validation.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 95 passed, 0 failed.
- `npm run build`: passed; Drive page/API routes absent from generated route table.
- One-off VM100 candidate HTTP smoke: 128 method/path/host combinations plus static-host, boundary, Tasks-auth, News and canonical-www checks passed.
- One-off VM100 Chromium smoke: 60 route/width/theme combinations and the independent Agent iframe check passed. An ephemeral read-only container supplied browser libraries; existing services and host packages were not modified.

Production restart, public health/cache checks, data deletion and GitHub Actions are deployment gates verified separately after committing this report. Source restoration from GitHub cannot restore deleted data.

## DNS retirement correction — 2026-10-15

The owner clarified that retirement requires removal from Cloudflare, not a live HTTP 410-only hostname. The exact `drive.labulubius.com` CNAME and local Cloudflare Tunnel ingress are deleted. All 12 unrelated DNS records are unchanged. The Tunnel configuration validated successfully and its service was restarted; the old hostname now matches the final `http_status:404` fallback rather than Next.js.

Cloudflare and Google public DNS-over-HTTPS both returned `NXDOMAIN` with no answers for A, AAAA and CNAME. Main-site health and Agent remained available; Zotero DAV kept its unauthenticated 401 boundary. `/drive/**` and `/api/drive/**` on the main hostname retain their defensive 410 responses. No UI, authentication, CSP, persistent data or other DNS records changed in this correction.

The health script now checks DNS NXDOMAIN rather than making HTTP requests to the retired hostname. Audit snapshots of DNS before/after and the pre-change Tunnel configuration are root-only under `/var/backups/labulubius/drive-dns-retirement-20261015T060051Z` on VM100; they contain configuration, not deleted Drive files. Recreating Drive DNS or ingress requires a new explicit owner decision.
