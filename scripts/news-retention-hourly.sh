#!/bin/sh
# Install as root-owned, non-writable-by-web-service; see NEWS.md.
set -eu
# PostgreSQL is the existing freshrss-postgres Docker container. SQL lives on
# the host and is passed through stdin; no database password is exposed.
exec /usr/bin/docker exec -i freshrss-postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /usr/local/share/labulubius/news-retention-cleanup.sql
