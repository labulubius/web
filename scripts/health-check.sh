#!/usr/bin/env bash
set -euo pipefail

main_origin="${MAIN_ORIGIN:-https://labulubius.com}"
body=$(curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" "$main_origin/api/health")
if [[ "$body" != '{"status":"ok"}' ]]; then
  echo "Unexpected health response from $main_origin" >&2
  exit 1
fi
echo "ok $main_origin"

agent_origin="${AGENT_ORIGIN:-https://agent.labulubius.com}"
curl --fail --silent --show-error --location --max-redirs 3 --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null "$agent_origin"
echo "ok $agent_origin"

for url in "$main_origin/drive" "$main_origin/api/drive" "$main_origin/drive/file/retired"; do
  status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$url")
  if [[ "$status" != "410" ]]; then
    echo "Expected retired Drive to return 410: $url (received $status)" >&2
    exit 1
  fi
  echo "retired $url"
done

# The old hostname is removed, not kept online to serve an HTTP tombstone.
retired_hostname="${RETIRED_DRIVE_HOSTNAME:-drive.labulubius.com}"
for dns_type in A AAAA CNAME; do
  dns_body=$(curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" \
    --header 'Accept: application/dns-json' --get \
    --data-urlencode "name=$retired_hostname" --data-urlencode "type=$dns_type" \
    https://cloudflare-dns.com/dns-query)
  if ! printf '%s' "$dns_body" | python3 -c '
import json, sys
response = json.load(sys.stdin)
sys.exit(0 if response.get("Status") == 3 and not response.get("Answer") else 1)
'; then
    echo "Expected retired Drive DNS NXDOMAIN: $retired_hostname ($dns_type)" >&2
    exit 1
  fi
done
echo "retired DNS $retired_hostname (NXDOMAIN)"
