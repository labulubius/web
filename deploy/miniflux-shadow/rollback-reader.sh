#!/bin/sh
set -eu

backup=${1:?Usage: rollback-reader.sh /opt/miniflux-shadow/cutover-backup-TIMESTAMP}
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -d "$backup" ] && [ -f "$backup/report.json" ] || { echo "Invalid cutover backup." >&2; exit 1; }
news=/home/debian/.local/share/labulubius/news
for source in "$backup"/*.json; do
  [ "$(basename "$source")" = report.json ] && continue
  destination="$news/$(basename "$source")"
  install -m 0600 -o debian -g debian "$source" "$destination"
done
tmp=$(mktemp)
grep -v "^NEWS_READER_BACKEND=" /etc/labulubius/news.env > "$tmp"
printf "%s\n" "NEWS_READER_BACKEND=freshrss" >> "$tmp"
chown --reference=/etc/labulubius/news.env "$tmp"
chmod --reference=/etc/labulubius/news.env "$tmp"
mv "$tmp" /etc/labulubius/news.env
systemctl restart labulubius-web.service
systemctl is-active --quiet labulubius-web.service
