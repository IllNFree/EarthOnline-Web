# 地球Online · Web

![Platform](https://img.shields.io/badge/platform-Web-PWA-blue) ![Version](https://img.shields.io/badge/version-v3.0.1-orange) ![License](https://img.shields.io/badge/license-MIT-green)

同名应用的网页端，离线优先 PWA，数据存于本机 IndexedDB。

## 在线访问

👉 **[https://illnfree.github.io/EarthOnline-Web/](https://illnfree.github.io/EarthOnline-Web/)**（点击直接打开，无需登录）

## 当前状态

活跃开发（v3.0.1，封板日期 2026-11-08）。

## 技术栈

- Vue 3 + Vite + Pinia
- PWA（离线缓存、可安装）
- 零运行时框架依赖；生产服务 `server.cjs`（Node 零依赖）提供 SPA 回退与 `/steam-api` 反向代理
- WebDAV 同步（备份文件 `earth_online_backup.json`）
- 数据持久化：IndexedDB（无服务器、无账号、无埋点）

## 跨端契约

四端共用同一份数据契约 `earth-online-backup.json`：字段全 camelCase、WebDAV 按主键合并、软删除对齐。完整契约见 [docs/contract.md](docs/contract.md)。

## 快速开始

```bash
npm install
npm run dev
```

## 仓库导航

- Android：https://github.com/IllNFree/EarthOnline-Android
- Desktop（Windows）：https://github.com/IllNFree/EarthOnline-Desktop
- iOS：https://github.com/IllNFree/EarthOnline-iOS

## 许可证

[MIT](LICENSE)

---

## 发布说明

- v1.0.0：[RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md)
- v2.0.0：[RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md)

## 部署形态

- 活跃构建：`npm ci && npm run build` → `dist/`（Vite + Vue 3 + Pinia + PWA）
- 生产服务：`npm start`（= `node server.cjs`）静态托管 `dist/` 并内置 Steam 反向代理；`index.html` 输出 `no-cache`，避免版本更新后仍命中旧缓存

## 部署通道

- GitHub Pages：`push main` 由 `.github/workflows/pages.yml` 自动构建 `dist/` 并发布到上面的地址，无需密钥。
- 腾讯云 CloudBase：同一次 push 由 `deploy-cloudbase.yml` 并行部署静态托管 + 云函数 + 网关，提供账号 / 同步 / OAuth 后端。
- WorkBuddy sites：另一条独立发布通道（https://earth-online-life-95391.app.workbuddy.host/），不由 GitHub Actions 更新。
- 本地预览：`npm run preview`（4173）。前端数据存于本机 IndexedDB，各地址之间不共享。
