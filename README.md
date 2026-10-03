# Labulubius Workspace

A personal web workspace with a KDE Breeze-inspired interface. The Home page is a private Tasks and Day Planner workspace; public pages organize links and reading sources. A Supabase-authenticated site administrator manages tasks, the directory, files, feeds, forums and a private note.

All interface work must follow the scoped visual, interaction, accessibility and permission rules in [DESIGN.md](DESIGN.md).

## Pages

| Route | Purpose | Data / access |
| --- | --- | --- |
| `/` | Private Tasks and Day Planner home | Administrator only; stored in Supabase |
| `/nav` | Website directory, search, favorites and categories | Published entries are public; administrators edit entries and icons in the UI (Supabase) |
| `/news` | FreshRSS-backed reader | Visitors can read the owner's selected, non-expired articles; administrators manage sources and categories |
| `/forums` | Discourse topic browser | Visitors see the selected public sources; administrators manage the shared directory |
| `/drive` | Private file manager | Administrator only; files live on the `web` server |
| `/share` | Public file/folder link manager | Administrator only; generated `/f/<id>` and `/s/<id>` links are public |
| `/note` | Private note | Administrator only; stored in Supabase |
| `/tasks` | Compatibility redirect to `/` | Same as Home |
| `/about` | Project overview | Public |

The navigator's canonical URL is `https://labulubius.com/nav`. The Drive subdomain redirects its page to the main-site UI, while its API remains on the dedicated Drive hostname.

## Architecture

- Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS 4) serves the UI. Supabase Auth and Row Level Security control administrator access. Tasks, navigator data, icons and the private note use Supabase; the navigator is managed in the UI, **not** in `app/nav/sites.ts` (which only defines types).
- The application has one production deployment on VM 100 (`vm100`) of the M920Q Proxmox host. Cloudflare Tunnel sends `labulubius.com`, `drive.labulubius.com`, `feeds.labulubius.com` and `share.labulubius.com` to services on that VM. The main UI and same-origin News/Forums APIs run in the same Next.js process.
- Drive and Share files, News preferences and the Forums directory live **outside Git** on `web`. FreshRSS and its PostgreSQL database run in Docker there. GitHub stores source history and CI results, not production data.

## Verification on VM100

Connect from the Mac mini with `ssh web`, then run all project commands from `/home/debian/labulubius`. There is no Mac mini checkout for this repository.

```bash
npm run lint       # ESLint
npm run typecheck  # Generate Next.js route types, then run TypeScript
npm test           # Focused regression tests
npm run build      # Production build
```

## Deployment and persistent data

Apply the SQL migrations and set up the administrator account using [supabase/README.md](supabase/README.md). Set the two `NEXT_PUBLIC_SUPABASE_*` variables on `web` (the publishable key is not a service-role secret). Configure distinct writable absolute `DRIVE_DATA_DIR` and `SHARE_DATA_DIR` paths outside the repository. Configure FreshRSS credentials for the `web` service separately; never expose them with `NEXT_PUBLIC_` variables.

The production checkout is `/home/debian/labulubius` on VM100, and it is the only Web code workspace. Do not clone or maintain this repository on the Mac mini. The Mac mini Agent must connect with `ssh web`, modify the VM100 checkout directly, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, commit and push the verified change to GitHub, then restart `labulubius-web.service` and run `scripts/health-check.sh`. Cloudflare Tunnel must preserve the original `Host` header for host-specific behavior. Back up the server-side file directories, News preferences, Forums directory and FreshRSS data separately from Git and Supabase. The installed five-day News retention job and its operational checks are described in [NEWS.md](NEWS.md).

More details: [DRIVE.md](DRIVE.md), [SHARE.md](SHARE.md), [NEWS.md](NEWS.md), [FORUMS.md](FORUMS.md), [operations and restore verification](OPERATIONS.md), [supabase/README.md](supabase/README.md).

## Repository map

- `app/`: pages, API routes, shared UI and server helpers.
- `app/nav/`: navigator UI and TypeScript types; actual entries are stored in Supabase.
- `app/lib/`: authorization, persistent storage, FreshRSS and Forums integration.
- `proxy.ts`: hostname-based Drive-page redirect.
- `supabase/migrations/`: database and storage policy migrations.
- `scripts/`: News retention SQL and hourly job.

## License

No license has been specified for this repository.
