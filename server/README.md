# EarthOnline 本地账号 / 同步 / OAuth 网关

零依赖（只用 Node 内置模块），Node 22。数据全部落在 `server/data/`。

## 启动

```bash
node server/server.mjs
```

默认 `http://127.0.0.1:8787`。前端预览端先跑 `npm run preview`（4173），再打开应用登录。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 端口，默认 `8787` |
| `HOST` | 监听地址，默认 `127.0.0.1`（局域网访问可设 `0.0.0.0`） |
| `EO_MASTER_KEY` | 覆盖 `server/data/.secret` 的签名/加密主密钥（部署到多实例时必配） |
| `EO_PUBLIC_BASE_URL` | 对外地址（OAuth 回调用），默认 `http://localhost:8787` |
| `EO_ALLOWED_ORIGINS` | 追加允许的前端 Origin，逗号分隔 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 未配置时 OAuth start 返回 501，其余接口正常 |

参考 `server/config.example.env`。

## API 一览（前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/auth/register` | 注册 `{email, password}`（≥8 位）→ `{token, user}` |
| POST | `/auth/login` | 登录 → `{token, user}` |
| GET | `/me` | 当前用户 |
| POST | `/auth/logout` | 吊销当前 token |
| GET | `/sync` | `{rev, updatedAt, data}` |
| PUT | `/sync` | `{baseRev, data, updatedAt}`；rev 不匹配返回 409 + 服务端快照 |
| POST | `/oauth/:provider/start` | `{redirectUri}` → `{url}`（state 为 HMAC 签名） |
| GET | `/oauth/:provider/callback` | 换 token 并加密落盘，302 到前端 |
| POST | `/proxy/:provider` | `{path, method, body}` 以用户 token 请求上游 |
| GET | `/oauth/status` | `{providers: {github: {connected, connectedAt}}}` |

认证统一用 `Authorization: Bearer <token>`。

## 平移到 Cloudflare Workers

路由与业务逻辑（`store` 的文件读写换成 KV / D1，`auth` 的 HMAC/加密逻辑原样复用）即可，入口换成 `fetch` handler。
