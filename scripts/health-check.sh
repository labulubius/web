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

retired_origin="${RETIRED_DRIVE_ORIGIN:-https://drive.labulubius.com}"
for url in "$main_origin/drive" "$main_origin/api/drive" "$main_origin/drive/file/retired" "$retired_origin/" "$retired_origin/api/health"; do
  status=$(curl --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null --write-out '%{http_code}' "$url")
  if [[ "$status" != "410" ]]; then
    echo "Expected retired Drive to return 410: $url (received $status)" >&2
    exit 1
  fi
  echo "retired $url"
done
