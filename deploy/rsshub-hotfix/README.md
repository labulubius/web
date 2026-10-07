# RSSHub production hotfix image

This derived image keeps the existing Anthropic Research hotfix and replaces the broken Reuters category route. Reuters now blocks the former PF API with DataDome and removed the fallback mobile outbound feed. The replacement reads Reuters' public official news sitemap and filters entries by category/topic URL path. It intentionally provides metadata only (title, link, publication time, and image when present) and does not bypass article-page access controls.

Build on VM100:

```sh
sudo docker build -t local/rsshub:labulubius-20261007 deploy/rsshub-hotfix
```

The base image is pinned because RSSHub production bundles use hashed filenames. When updating RSSHub, rebase both bundle overrides against the new image and test `/anthropic/research` and `/reuters/world` before changing `/opt/freshrss/compose.yml`.
