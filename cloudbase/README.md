# EarthOnline · CloudBase 后端

国内可直连的 CloudBase 版：一个云函数 `api` + 云数据库 + 静态托管，API 契约与 `server/`、`cloudflare/` 完全一致。代码自包含，首次请求自动创建集合。

## 部署（在 `cloudbase/` 执行，共 6 条）
```powershell
npm i -g @cloudbase/cli
tcb login
tcb env list                              # 记下环境 ID
tcb deploy --only functions -e <envId>    # 部署 api，并下发 cloudbaserc 里的 envVariables
tcb deploy --only hosting   -e <envId>    # 上传 ../dist（先 npm run build）
tcb deploy --only gateway   -e <envId>    # 绑定 /api → function:api
```
`deploy.ps1` 是逐步确认版（含失败提示），不会自动执行；可先跑 `tcb deploy --dry-run -e <envId>` 预览。

## 环境变量（cloudbaserc.json → functions[0].envVariables）
> `cloudbase/cloudbaserc.json` 含密钥，已加入 `.gitignore`，**不要提交**。仓库里只保留 `cloudbaserc.example.json`。
> 本地部署：复制 example → cloudbaserc.json 并填入真实值；CI 部署：由 GitHub Secrets 在流水线里动态生成。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `EO_MASTER_KEY` | 是 | 会话 HMAC、OAuth state、AES-GCM 的主密钥；生产必须配置，否则回退固定开发密钥并打警告。生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `EO_PUBLIC_BASE_URL` | 否 | 静态托管域名，用于拼 OAuth 回调；不填则按请求 Host 推导 |
| `ALLOWED_ORIGIN` | 否 | 额外 CORS 源，逗号分隔（同域、localhost:4173/5173 已内置） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 发信必填 | 验证码邮件通道；`SMTP_PASS` 是邮箱授权码，绝不入库 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 否 | 不配则 `/api/oauth/github/start` 返回 501；Secret 只放云函数环境变量 |

## 前端如何指向 /api
静态托管与 HTTP 访问服务同域时，前端默认请求 `location.origin`，**无需改动**。若网关域名与站点不同，把前端 baseUrl 设为 `https://<网关域名>/api`，并把站点域名加入 `ALLOWED_ORIGIN`；GitHub OAuth App 回调填 `https://<域名>/api/oauth/github/callback`。

## 免费额度与限制
- 免费额度按环境计（函数调用与 GB·s、数据库读写、静态流量），超量按量计费；先把 `dist` 与 `/api/health` 跑通再导数据。
- 已用分片规避 CloudBase 单文档体积上限：快照 = 头文档（提交点）+ 每片 ≤200KB 的分片文档，20MB 整包可正常存取。
- HTTP 访问服务对请求体也可能有平台上限（可能低于 20MB），超大快照会先被网关拦截。
- 冷启动首次会建集合、派生密钥，略慢；免费额度下并发实例有限。

## 本地自测
`cd functions/api && npm install`，然后 `node ../../test-runner.mjs`（内存假 DB，覆盖 10 个路由与持久化读写）。
