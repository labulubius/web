# Drive — retired

The owner requested complete retirement of the custom Drive service and deletion of its server-side data.

- `/drive`, all `/drive/**` capability/download paths, `/api/drive` and `/api/drive/**` return `410 Gone` with `private, no-store`.
- The former `drive.labulubius.com` hostname has no Cloudflare DNS record or Tunnel ingress and must return DNS `NXDOMAIN`, not an HTTP retirement page. Do not recreate its DNS record or route. The application retains a defensive `410 Gone` guard for stale/direct-origin requests only.
- Drive navigation, UI, management APIs, public downloads, resumable-upload code and storage handlers are removed.
- All contents of `/home/debian/drive-data`, including public-link metadata and pending-upload data, are deleted after deployment and retirement verification. The empty directory remains only because an independent PDF-to-EPUB cleanup unit lists it in its filesystem sandbox. No new data backup is created for this deletion.
- `DRIVE_DATA_DIR` is no longer used. Do not restore files or enable Drive handlers on deployment.
- `dav.labulubius.com` and Zotero authentication were separate from the retired Drive. The later, explicitly approved WebDAV file root is `/srv/webdav-data`, with existing attachments in its ordinary `zotero` subfolder; see `deploy/webdav/README.md`. No retired Drive data is restored.

GitHub retains the old implementation in Git history (pre-retirement revision: `8d166a13f9d01d6495a87a7079d76d8a8cdb4a6b`). Restoring source cannot restore deleted files or resurrect old public links. Any future file service needs a new, explicit deployment and data decision.
