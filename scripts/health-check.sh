#!/usr/bin/env bash
set -euo pipefail

app_origins=(
  "${MAIN_ORIGIN:-https://labulubius.com}"
  "${DRIVE_ORIGIN:-https://drive.labulubius.com}"
)

for origin in "${app_origins[@]}"; do
  body=$(curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT:-15}" "$origin/api/health")
  if [[ "$body" != '{"status":"ok"}' ]]; then
    echo "Unexpected health response from $origin" >&2
    exit 1
  fi
  echo "ok $origin"
done

agent_origin="${AGENT_ORIGIN:-https://agent.labulubius.com}"
curl --fail --silent --show-error --location --max-redirs 3 --max-time "${HEALTH_TIMEOUT:-15}" --output /dev/null "$agent_origin"
echo "ok $agent_origin"
