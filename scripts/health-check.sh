#!/usr/bin/env bash
set -euo pipefail

main_origin="${MAIN_ORIGIN:-https://labulubius.com}"
body=$(curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" "$main_origin/api/health")
if [[ "$body" != '{"status":"ok"}' ]]; then
  echo "Unexpected health response from $main_origin" >&2
  exit 1
fi
echo "ok $main_origin"

agent_origin="${AGENT_ORIGIN:-https://pi-web.labulubius.com}"
curl --fail --silent --show-error --location --max-redirs 3 --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null "$agent_origin"
echo "ok $agent_origin"

entry_status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$main_origin/pi-web")
if [[ "$entry_status" != "200" ]]; then
  echo "Expected embedded Pi Web entry to return 200: $main_origin/pi-web (received $entry_status)" >&2
  exit 1
fi
echo "ok $main_origin/pi-web"

cloudcli_entry_status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$main_origin/cloudcli")
if [[ "$cloudcli_entry_status" != "200" ]]; then
  echo "Expected embedded CloudCLI entry to return 200: $main_origin/cloudcli (received $cloudcli_entry_status)" >&2
  exit 1
fi
cloudcli_origin="${CLOUDCLI_ORIGIN:-https://cloudcli.labulubius.com}"
cloudcli_health=$(curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" "$cloudcli_origin/health")
if ! printf '%s' "$cloudcli_health" | python3 -c 'import json, sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)'; then
  echo "Unexpected CloudCLI health response" >&2
  exit 1
fi
cloudcli_api_status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$cloudcli_origin/api/projects")
if [[ "$cloudcli_api_status" != "401" ]]; then
  echo "Expected unauthenticated CloudCLI API to return 401 (received $cloudcli_api_status)" >&2
  exit 1
fi
echo "ok $main_origin/cloudcli (native authentication enforced)"

# Retired features are removed, not answered with a tombstone.
for url in "$main_origin/drive" "$main_origin/api/drive" "$main_origin/drive/file/retired" "$main_origin/feeds" "$main_origin/api/news" "$main_origin/pi" "$main_origin/pi/session"; do
  status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$url")
  if [[ "$status" != "404" ]]; then
    echo "Expected retired path to return 404: $url (received $status)" >&2
    exit 1
  fi
  echo "retired $url"
done

# The old hostname is removed, not kept online to serve an HTTP tombstone.
for retired_hostname in "${RETIRED_DRIVE_HOSTNAME:-drive.labulubius.com}" "${RETIRED_AGENT_HOSTNAME:-pi.labulubius.com}"; do
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
    echo "Expected retired DNS NXDOMAIN: $retired_hostname ($dns_type)" >&2
    exit 1
  fi
done
echo "retired DNS $retired_hostname (NXDOMAIN)"
done
