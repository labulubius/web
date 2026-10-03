## Project Memory

#decision [[labulubius-deployment]] labulubius.com 的唯一生产代码工作区是 VM100 上的 `/home/debian/labulubius`，通过 `ssh web` 操作；不再使用 Vercel，也不应在 Mac mini 维护该仓库副本。部署前依次运行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`，审查并提交推送后重启 `labulubius-web.service`，最后运行 `scripts/health-check.sh`。
