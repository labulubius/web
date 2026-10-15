# Drive sharing — retired

The owner has retired the custom Drive service and requested deletion of its files and share metadata. All former `/drive/file/<UUID>` and `/drive/file/<UUID>/download` links return uncached `410 Gone`. Creation, listing and revocation APIs under `/api/drive/**` are also retired.

There is no replacement public sharing service. Zotero WebDAV is private and unchanged; it does not become public when Drive is removed. Previously downloaded copies cannot be recalled.

The older `/share/**`, `/api/share/**` and `share.labulubius.com` surfaces remain retired. This task does not modify unrelated legacy storage directories or independent historical backups. GitHub retains source history, not deleted Drive files or share metadata.
