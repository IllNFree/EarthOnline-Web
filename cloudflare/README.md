# EarthOnline Cloudflare 后端（Workers + D1）

自包含目录：只在本目录装 wrangler，不污染前端依赖。API 契约与 `../server/` 的 Node 版完全一致。

## 5 条命令（首次部署）

```powershell
cd cloudflare
npm install                                        # 装 wrangler ^4
npx wrangler login                                 # 浏览器授权
npx wrangler d1 create eo-sync                     # 把返回的 database_id 填进 wrangler.toml
npx wrangler d1 execute eo-sync --remote --file=./schema.sql
npx wrangler secret put EO_MASTER_KEY              # 长随机串，例如 openssl rand -hex 32
npm run deploy                                      # = wrangler deploy
```

本地开发：`npm run dev`（8788，`--local` 用本地 sqlite），先跑 `npm run db:init:local` 建表。

## 环境变量 / secret

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `EO_MASTER_KEY` | 是 | 会话签名、OAuth state、provider token 加密的根密钥。**缺失时回落到固定开发密钥，生产禁止**。 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 否 | 缺省时 `/api/oauth/github/start` 返回 501，其它接口正常 |
| `EO_PUBLIC_BASE_URL` | 否 | OAuth 的对外回调基址，缺省用请求的 origin |
| `ALLOWED_ORIGIN` | 否 | 额外允许的 CORS 源（部署后的 Pages 域名），逗号分隔 |

## 接到 Cloudflare Pages

前端在非 localhost 环境默认请求同域 `/api`，所以给 Pages 域名加一条 Worker Route：
`https://<pages-domain>/api/*` → `eo-sync`（Pages → Custom domains → Routes，或给 Worker 绑定自定义域名）。也可把前端 `baseUrl` 直接指向 Worker 域名，并把该 Pages 域名填进 `ALLOWED_ORIGIN`。

GitHub OAuth App 的 Authorization callback URL 填：`https://<后端域名>/api/oauth/github/callback`。

注意：`/api/auth/*` 的限流是每 Worker 实例内存计数（每 IP 每分钟 10 次），多实例下只是尽力而为。
