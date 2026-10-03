# Labulubius Workspace

A personal web workspace with a KDE Breeze-inspired interface. The public pages organize links and reading sources; a Supabase-authenticated site administrator manages the directory, files, feeds, forums and a private note.

## Pages

| Route | Purpose | Data / access |
| --- | --- | --- |
| `/` | Workspace home | Public |
| `/nav` | Website directory, search, favorites and categories | Published entries are public; administrators edit entries and icons in the UI (Supabase) |
| `/news` | FreshRSS-backed reader | Visitors can read the owner's selected, non-expired articles; administrators manage sources and categories |
| `/forums` | Discourse topic browser | Visitors see the selected public sources; administrators manage the shared directory |
| `/drive` | Private file manager | Administrator only; files live on the `web` server |
| `/share` | Public file/folder link manager | Administrator only; generated `/f/<id>` and `/s/<id>` links are public |
| `/note` | Private note | Administrator only; stored in Supabase |
| `/about` | Project overview | Public |

The navigator's canonical URL is `https://labulubius.com/nav`; the former `nav.labulubius.com` hostname is retired. The Drive subdomain redirects its page to the main-site UI, while its API remains on the dedicated Drive hostname.

## Architecture

- Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS 4) serves the UI. Supabase Auth and Row Level Security control administrator access. Navigator data, icons and the private note use Supabase; the navigator is managed in the UI, **not** in `app/nav/sites.ts` (which only defines types).
- The application has one production deployment on VM 100 (`vm100`) of the M920Q Proxmox host. Cloudflare Tunnel sends `labulubius.com`, `drive.labulubius.com`, `feeds.labulubius.com` and `share.labulubius.com` to services on that VM. The main UI and same-origin News/Forums APIs run in the same Next.js process; no Vercel relay is involved.
- Drive and Share files, News preferences and the Forums directory live **outside Git** on `web`. FreshRSS and its PostgreSQL database run in Docker there. GitHub stores source history and CI results, not production data.

## Local development

Requirements: Node.js 24 and npm, plus a Supabase project configured as described in [supabase/README.md](supabase/README.md).

```bash
git clone git@github.com:labulubius/web.git
cd web
npm install
```

Create `.env.local` locally (never commit it) with your own project's values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
# Required to use local Drive and Share APIs; choose distinct absolute paths outside this checkout:
DRIVE_DATA_DIR=<absolute-private-drive-directory>
SHARE_DATA_DIR=<absolute-public-share-directory>
```

Run `npm run dev` and open <http://localhost:3000>; the navigator is at <http://localhost:3000/nav>. Login and database-backed features require a configured Supabase project and administrator account. News requires a reachable FreshRSS instance and API credentials on the server; see [NEWS.md](NEWS.md). The Share UI currently calls `https://share.labulubius.com` directly, so local development is **not** an isolated local Share backend without a code/configuration change.

```bash
npm run dev    # Development server
npm run lint       # ESLint
npm run typecheck  # TypeScript without emitting files
npm test           # Focused regression tests
npm run build      # Production build
npm run start  # Run the production build
```

## Deployment and persistent data

Apply the SQL migrations and set up the administrator account using [supabase/README.md](supabase/README.md). Set the two `NEXT_PUBLIC_SUPABASE_*` variables on `web` (the publishable key is not a service-role secret). Configure distinct writable absolute `DRIVE_DATA_DIR` and `SHARE_DATA_DIR` paths outside the repository. Configure FreshRSS credentials for the `web` service separately; never expose them with `NEXT_PUBLIC_` variables.

The production checkout is `/home/debian/labulubius` on VM100. The Mac mini Agent connects with `ssh web`, modifies this checkout directly, runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, commits and pushes the verified change to GitHub, then restarts `labulubius-web.service` and runs `scripts/health-check.sh`. Cloudflare Tunnel must preserve the original `Host` header for host-specific behavior. Back up the server-side file directories, News preferences, Forums directory and FreshRSS data separately from Git and Supabase. The installed five-day News retention job and its operational checks are described in [NEWS.md](NEWS.md).

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
