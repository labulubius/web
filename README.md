# Labulubius Workspace

A personal web workspace with a KDE Breeze-inspired interface. The public pages organize links and reading sources; a Supabase-authenticated site administrator manages private tasks, files and feeds.

All interface work must follow the scoped visual, interaction, accessibility and permission rules in [DESIGN.md](DESIGN.md).

## Pages

| Route | Purpose | Data / access |
| --- | --- | --- |
| `/` | All tasks, project tasks and cross-month date-range Gantt chart | Administrator only; signed-out visitors see a generic Home screen |
| `/nav` | Website directory, search, favorites and categories | Published entries are public; administrators edit entries and icons in the UI (Supabase) |
| `/news` | FreshRSS-backed reader for websites, feeds and community forums | Visitors can read the owner's selected, non-expired articles; administrators manage sources, tags and Watchboards |
| `/drive` | Private file manager and public-link manager | Administrator only; files live on the `web` server |
| `/share/<id>` | Public file or folder link | Anyone holding an active opaque link |
| `/about` | Project overview | Public |

The navigator's canonical URL is `https://labulubius.com/nav`. The Drive subdomain redirects its page to the main-site UI, while its API remains on the dedicated Drive hostname.

## Architecture

- Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS 4) serves the UI. Supabase Auth and Row Level Security control administrator access. Navigator data and icons use Supabase; the navigator is managed in the UI, **not** in `app/nav/sites.ts` (which only defines types).
- The application has one production deployment on VM 100 (`vm100`) of the M920Q Proxmox host. Cloudflare Tunnel sends `labulubius.com`, `drive.labulubius.com` and `feeds.labulubius.com` to services on that VM. The main UI and same-origin News APIs run in the same Next.js process.
- Personal task data, Drive files and their share-link metadata, News preferences live **outside Git** on `web`. FreshRSS and its PostgreSQL database run in Docker there. GitHub stores source history and CI results, not production data.

## Verification on VM100

Connect from the Mac mini with `ssh web`, then run all project commands from `/home/debian/labulubius`. There is no Mac mini checkout for this repository.

```bash
npm run lint       # ESLint
npm run typecheck  # Generate Next.js route types, then run TypeScript
npm test           # Focused regression tests
npm run build      # Production build
```

## Deployment and persistent data

Apply the SQL migrations and set up the administrator account using [supabase/README.md](supabase/README.md). Set the two `NEXT_PUBLIC_SUPABASE_*` variables on `web` (the publishable key is not a service-role secret). Configure writable absolute `DRIVE_DATA_DIR` and optional `TASKS_DATA_DIR` paths outside the repository. Tasks default to `~/.local/share/labulubius/tasks` when `TASKS_DATA_DIR` is unset. Configure FreshRSS credentials for the `web` service separately; never expose them with `NEXT_PUBLIC_` variables.

The production checkout is `/home/debian/labulubius` on VM100, and it is the only Web code workspace. Do not clone or maintain this repository on the Mac mini. The Mac mini Agent must connect with `ssh web`, modify the VM100 checkout directly, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, commit and push the verified change to GitHub, then restart `labulubius-web.service` and run `scripts/health-check.sh`. Cloudflare Tunnel must preserve the original `Host` header for host-specific behavior. Back up the Tasks directory, complete Drive directory, News preferences and FreshRSS data separately from Git and Supabase. The installed five-day News retention job and its operational checks are described in [NEWS.md](NEWS.md).

More details: [TASKS.md](TASKS.md), [DRIVE.md](DRIVE.md), [SHARE.md](SHARE.md), [NEWS.md](NEWS.md), [operations and restore verification](OPERATIONS.md), [supabase/README.md](supabase/README.md).

## Repository map

- `app/`: pages, API routes, shared UI and server helpers. The task UI is under `app/tasks/` and its API under `app/api/tasks/`.
- `app/nav/`: navigator UI and TypeScript types; actual entries are stored in Supabase.
- `app/lib/`: authorization, Drive/share-link persistence, FreshRSS integration.
- `proxy.ts`: hostname-based Drive-page redirect.
- `supabase/migrations/`: database and storage policy migrations.
- `scripts/`: News retention SQL and hourly job.

## License

No license has been specified for this repository.
