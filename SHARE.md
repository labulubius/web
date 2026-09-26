# Public Share

The administrator manages files and nested folders at `https://labulubius.com/share` (Vercel). Upload and management APIs, and public links at `/f/<UUID>` (file) and `/s/<UUID>` (folder), are served from `https://share.labulubius.com` on the `web` machine. Share is separate from the private Drive: never point `SHARE_DATA_DIR` and `DRIVE_DATA_DIR` at the same directory.

## Deployment

1. Set `SHARE_DATA_DIR` on `web` in `.env.local` to an absolute writable directory outside the repository (for example `/home/debian/share-data`). Keep it owned by the web service user and private (mode `0700`). **Do not set it on Vercel.** Both deployments need the appropriate Supabase public URL and publishable key.
2. Route `share.labulubius.com` to the local Next.js service (`http://127.0.0.1:3000`) through Cloudflare Tunnel, ahead of any catch-all rule, and configure/verify its DNS. The current `web` tunnel configuration contains a Share hostname entry; verify the complete ingress and live DNS when deploying rather than assuming the hostname reaches this server.
3. Build/restart the `web` service and deploy the main-site UI. Test an administrator upload, a public file and folder link, and link revocation before publishing files.
4. Back up the **entire** `SHARE_DATA_DIR` as one unit, including `blobs/`, `thumbs/`, `meta/`, `folders/` and any upload state. Restore together. Git and Supabase backups do not include these files.

Every management request verifies a Supabase Bearer token and `site_is_admin()`; CORS only permits `https://labulubius.com`. There is no public listing or root folder link. A folder link grants access to its descendants, while sharing only a child does not reveal its parent. Deleting a folder revokes its descendant folder and file links at the origin. Public file responses use `Cache-Control: no-store`, but copies already downloaded or cached elsewhere cannot be revoked.

Uploads use resumable sessions in 8 MiB chunks. Unfinished sessions survive service restarts, count toward the quota, and expire after seven days when new sessions are created. The **total listed Share-file quota** is 5 GiB, with pending uploads counted on creation; a new upload additionally needs its size plus 4 GiB of free disk space. There is no longer a 20 MiB per-file cap: individual files are limited by the remaining quota and available disk. Empty files are rejected. JPEG, PNG and WebP files must decode as the declared format, be non-animated and fit within the image decoder's 40-million-pixel input limit; they are re-encoded as WebP for inline display, with thumbnails. Other files are served as downloads (`nosniff`). There is no antivirus scanner, so only the administrator should upload trusted files.

Metadata lives in JSON files on `web`, not in a Supabase migration. Removal revokes metadata before deleting blobs; a failed unlink can leave orphan files. Review disk usage and orphan files, retain at least 4 GiB of free disk space for new uploads, and test backup restoration. To move Share, copy the complete directory with its permissions and update `SHARE_DATA_DIR`.
