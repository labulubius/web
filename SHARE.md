# Public Drive links

Public links are managed from the administrator-only `/drive` page. A Drive **file** can have one opaque direct-download URL at `https://labulubius.com/drive/file/<UUID>`. Anyone holding the URL can download that single file without signing in. Folders, Drive root and multiple selections cannot be published.

The bytes remain in `DRIVE_DATA_DIR`; there is no second Share file store and new deployments do not require `SHARE_DATA_DIR`. Link metadata lives in `DRIVE_DATA_DIR/.drive-shares` as private JSON files and must be backed up with the complete Drive directory. Do not edit the metadata or Drive tree out of band.

Creating, listing and revoking links uses `/api/drive/shares` on the Drive host and requires a valid Supabase bearer token plus `site_is_admin()`. Public downloads require only the unguessable UUID. Every request validates versioned file-only metadata, re-resolves the path below `DRIVE_DATA_DIR`, rejects internal names and symbolic links, opens with `O_NOFOLLOW`, and returns no-store attachment responses. `GET`, `HEAD` and byte ranges are supported. The compatibility path `/drive/file/<UUID>/download` serves the same protected response.

Deleting a Drive file revokes its link. Revocation prevents future requests but cannot retract copies already downloaded. The former `share.labulubius.com`, `/share/**` and `/api/share/**` surfaces are retired and must remain unavailable; old Share tokens are not migrated. The legacy `/home/debian/share-data` directory is not modified automatically and may be archived or removed only after a verified backup confirms that no older deployment needs it.
