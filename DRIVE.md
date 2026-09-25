# Private Drive

Files live on the `web` server at `DRIVE_DATA_DIR`, outside the repository and its `public/` folder. Supabase Auth is only used to verify the existing site administrator role; Drive files are not uploaded to Supabase Storage.

The user interface is at `https://labulubius.com/drive` on Vercel and uses the main site's login session. In production, its Drive API calls go to `https://drive.labulubius.com/api/drive` on the `web` server through Cloudflare Tunnel. The server allows CORS only from `https://labulubius.com` and still verifies the Bearer token and administrator role on every request. Do not configure `DRIVE_DATA_DIR` on Vercel: its filesystem is not the persistent Drive storage. The old Drive subdomain page redirects to the main-site UI; its `/api/drive` endpoints remain on the server.

Set an absolute `DRIVE_DATA_DIR` in `.env.local` (for example `/home/debian/drive-data`). The directory must be writable by the Next.js process. Back up this directory separately: it is not included in Git or a Supabase database backup. To migrate, copy the directory with file names, folders, permissions and contents to the new server and update `DRIVE_DATA_DIR`.

First version: administrator-only folders, upload (20 MB per file), download and recursive delete. There is no sharing, public access, overwrite, rename, preview, or online editing. Uploads with an existing name fail rather than replacing data. Download responses are attachments with no-store headers. Keep the server's disk usage and backups under review.
