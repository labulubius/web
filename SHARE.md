# Public Drive links

Public sharing is managed directly from the administrator-only `/drive` page. A Drive file or folder can have one opaque URL at `https://labulubius.com/share/<UUID>`. `/share` without an ID redirects to `/drive`; the former `/f/<id>` and `/s/<id>` routes are retired.

The shared bytes remain in `DRIVE_DATA_DIR`; there is no second Share file store and new deployments do not require `SHARE_DATA_DIR`. Link metadata lives in `DRIVE_DATA_DIR/.drive-shares` as private JSON files and must be backed up with the entire Drive directory. Do not edit the metadata or Drive tree out of band.

Creating, listing and revoking links uses `/api/drive/shares` on the Drive host and requires a valid Supabase bearer token plus `site_is_admin()`. Public pages and downloads require only the unguessable UUID. Folder links grant read-only access to descendants, while Drive root sharing is forbidden. Every public request validates metadata, re-resolves path segments below `DRIVE_DATA_DIR`, rejects internal names and symbolic links, and uses no-store responses. Files download through `/api/share/<UUID>` with optional relative `path` for descendants and support `HEAD` and byte ranges.

Deleting a Drive file or folder revokes associated links, including links to descendants. Revocation prevents future requests but cannot retract copies already downloaded. The legacy `/home/debian/share-data` directory is not modified automatically; after a verified backup it may be archived or removed operationally if no older deployment needs it.
