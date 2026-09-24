# Private Drive

Files live on the `web` server at `DRIVE_DATA_DIR`, outside the repository and its `public/` folder. Supabase Auth is only used to verify the existing site administrator role; Drive files are not uploaded to Supabase Storage.

Set an absolute `DRIVE_DATA_DIR` in `.env.local` (for example `/home/debian/drive-data`). The directory must be writable by the Next.js process. Back up this directory separately: it is not included in Git or a Supabase database backup. To migrate, copy the directory with file names, folders, permissions and contents to the new server and update `DRIVE_DATA_DIR`.

First version: administrator-only folders, upload (20 MB per file), download and recursive delete. There is no sharing, public access, overwrite, rename, preview, or online editing. Uploads with an existing name fail rather than replacing data. Download responses are attachments with no-store headers. Keep the server's disk usage and backups under review.
