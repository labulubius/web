# Labulubius Workspace

A personal web workspace with a KDE Breeze-inspired interface. A Supabase-authenticated site administrator manages private tasks, links and reading sources; the About page remains public.

All interface work must follow the scoped visual, interaction, accessibility and permission rules in [DESIGN.md](DESIGN.md).

## Pages

| Route | Purpose | Data / access |
| --- | --- | --- |
| `/` | All tasks, project tasks and cross-month date-range Gantt chart | Administrator only; signed-out visitors see a generic Home screen |
| `/nav` | Website directory, search, favorites and categories | Administrator only; signed-out visitors see a generic Navigator screen |
| `/about` | Project overview | Public |

The navigator's canonical URL is `https://labulubius.com/nav`. Drive is retired: `/drive/**` and `/api/drive/**` return `404 Not Found`; the former `drive.labulubius.com` DNS record and Tunnel ingress are deleted, so that hostname no longer resolves (`NXDOMAIN`). Its files and public-link metadata are deleted; GitHub retains source history, not those files. Zotero WebDAV at `dav.labulubius.com` is independent and unchanged.

## Architecture

- Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS 4) serves the UI. Supabase Auth and Row Level Security control administrator access. Navigator data and icons use Supabase; the navigator is managed in the UI, **not** in `app/nav/sites.ts` (which only defines types).
- The application has one production deployment on VM 100 (`vm100`) of the M920Q Proxmox host. Cloudflare Tunnel is the only public web entry point and sends `labulubius.com` and `www.labulubius.com` to Next.js and `agent.labulubius.com` to Agent. The gateway routes only the Tunnel's port `7844` traffic through the measured Hong Kong path. Cloudflare edge-caches the three static Next.js document shells; authenticated APIs, RSC requests and errors remain uncached. The former `drive.labulubius.com`, `rss.labulubius.com` and `share.labulubius.com` DNS records and Tunnel ingress rules are deleted.
- Personal task data lives **outside Git** on `web`. GitHub stores source history and CI results, not production data.

## Verification on VM100

Connect from the Mac mini with `ssh web`, then run all project commands from `/home/debian/labulubius`. There is no Mac mini checkout for this repository.

```bash
npm run lint       # ESLint
npm run typecheck  # Generate Next.js route types, then run TypeScript
npm test           # Focused regression tests
npm run build      # Production build
```

## Deployment and persistent data

Apply the SQL migrations and set up the administrator account using [supabase/README.md](supabase/README.md). Set the two `NEXT_PUBLIC_SUPABASE_*` variables on `web` (the publishable key is not a service-role secret). Configure an optional writable absolute `TASKS_DATA_DIR` path outside the repository. The retired `DRIVE_DATA_DIR` setting is no longer used. Tasks default to `~/.local/share/labulubius/tasks` when `TASKS_DATA_DIR` is unset.

The production checkout is `/home/debian/labulubius` on VM100, and it is the only Web code workspace. Do not clone or maintain this repository on the Mac mini. The Mac mini Agent must connect with `ssh web`, modify the VM100 checkout directly, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, commit and push the verified change to GitHub, then restart `labulubius-web.service`. Purge the cached public HTML URLs after deployment, run `scripts/health-check.sh`, verify the intended `MISS → HIT` transitions and cache exclusions, and confirm GitHub Actions succeeds. Cloudflare Tunnel must preserve the original `Host` header for host-specific behavior. Back up the Tasks directory separately from Git and Supabase. The exact Tunnel, cache, performance, purge and rollback procedures are in [OPERATIONS.md](OPERATIONS.md).

More details: [TASKS.md](TASKS.md), [DRIVE.md](DRIVE.md), [SHARE.md](SHARE.md), [operations and restore verification](OPERATIONS.md), [supabase/README.md](supabase/README.md).

## Repository map

- `app/`: pages, API routes, shared UI and server helpers. The task UI is under `app/tasks/` and its API under `app/api/tasks/`.
- `app/nav/`: navigator UI and TypeScript types; actual entries are stored in Supabase.
- `app/lib/`: authorization and server-side task storage helpers.
- `proxy.ts`: canonical-host redirects.
- `supabase/migrations/`: database and storage policy migrations.

## License

No license has been specified for this repository.
