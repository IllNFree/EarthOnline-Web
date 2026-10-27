# 地球Online · Web

![Platform](https://img.shields.io/badge/platform-Web-PWA-blue) ![Version](https://img.shields.io/badge/version-v2.0.0-orange) ![License](https://img.shields.io/badge/license-MIT-green)

同名应用的网页端，离线优先 PWA，数据存于本机 IndexedDB。

## 当前状态

活跃开发（v2.0.0，封板日期 2026-10-26）。

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

## 在线访问

- 生产地址（唯一）：**https://earth-online-life-95391.app.workbuddy.host/**
- 部署通道：WorkBuddy sites（非 GitHub Pages）。GitHub 仓库的 Homepage 字段已指向上述地址；任何 `*.github.io` 链接均为历史残留，已废弃，请勿使用。
