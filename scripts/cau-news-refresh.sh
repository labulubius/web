#!/bin/sh
set -eu

if [ "${#NEWS_FEED_PROXY_SECRET}" -lt 32 ]; then
  echo "NEWS_FEED_PROXY_SECRET is unavailable." >&2
  exit 1
fi

token=$(printf %s 'cau-news-feed-v1' |
  openssl dgst -sha256 -hmac "$NEWS_FEED_PROXY_SECRET" -binary |
  openssl base64 -A |
  tr '+/' '-_' |
  tr -d '=')

curl --fail --silent --show-error --max-time 90 \
  --output /dev/null \
  "http://127.0.0.1:3000/api/news/cau/$token"
