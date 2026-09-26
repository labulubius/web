# Public Share

`/share` is the administrator-only management UI on `https://labulubius.com/share` (Vercel). Public downloads and the admin API are served by the `web` machine at `https://share.labulubius.com`. This is separate from the private `/drive` and `DRIVE_DATA_DIR`; do not point the two at the same directory.

## Deploy

1. Set `SHARE_DATA_DIR` in the web server's `.env.local` to an absolute writable directory outside the repository (for example `/home/debian/share-data`). Keep it owned by the web service user with mode `0700`. **Do not set it on Vercel.**
2. Add a Cloudflare Tunnel ingress rule for `share.labulubius.com` pointing at `http://127.0.0.1:3000`, before the catch-all rule. Configure the DNS hostname to route to this tunnel; the existing wildcard currently routes it to Vercel, which cannot access the web server's persistent files. Confirm DNS and tunnel routing before publishing the UI.
3. Build/restart the web service and deploy the main-site UI to Vercel. Test with a small image and document, including link revocation, before using it for real files.
4. Back up the entire `SHARE_DATA_DIR` (blobs, thumbnails, metadata) as one unit. It is not backed up by Git or Supabase. Restore all three directories together. Keep at least 4 GiB of disk headroom. Storage accounting limits listed original files to 5 GiB.

Every admin request verifies the Supabase bearer token and `site_is_admin()` role. CORS only permits `https://labulubius.com`. Each file is at `/f/<random UUID>`; images are re-encoded as WebP and shown inline, other files are served as downloads with `nosniff`. No public listing endpoint exists. Public responses use `Cache-Control: no-store` to minimize stale links after revocation, although copies already downloaded or cached by third parties cannot be revoked. Files are limited to 20 MiB; only JPEG, PNG and WebP uploads are displayed inline, and animations are rejected. Other extensions are downloads only. No antivirus scanning is included: only the site administrator may upload.

Share metadata is stored in individual JSON files on `web`; there is no Supabase migration. On deletion metadata is removed before the blob; a failed unlink can leave orphan blobs. Review backup size and orphan files periodically. To move the storage, copy the entire directory and update `SHARE_DATA_DIR`.
