# 地球Online Web · v2.0.0 发布说明

## 版本定位

活跃端。封板日期 2026-10-26。版本号四处统一为 2.0.0（package.json / model.js / 侧边栏 / 备份 appVersion）。

## 亮点

- 遗留双轨制终结：`modules/` 旧包、`build_pakr.js`、`index_pakr.html`、旧根 `manifest.json` 全部删除，仓库只剩一套活跃构建（src/ + Vite）。
- 跨端同步真正可用：WebDAV 远端文件名统一 `earth_online_backup.json`，拉取改按主键合并 + `lastSyncAt` 冲突比对，不再整包覆盖。
- 数据安全线修复：软删除改为与 Android 同构的 `deletedAt` 字段模型（含历史 `trash` 自动迁移），跨端不再出现幽灵数据。
- 全局搜索、列表页右下角 FAB、断网全局横幅、自动同步、Steam 跨域内置代理（`/steam-api`）补齐。
- 卡片默认透明度对齐 80%；界面 Emoji 清零；微动效与回收站空状态插画补齐。

## 破坏性变更

- 备份文件结构变更：软删除由 `trash[]` 迁移为实体 `deletedAt` 字段；远端路径由 `earth-online-web.json` 改为 `earth_online_backup.json`。
- 旧版（v1.x）备份首次加载自动迁移，无需手动操作；建议升级前先导出一份备份。

## 升级指引

Web 为 PWA，无需安装：访问部署地址即自动更新到最新构建。若曾离线缓存旧版，刷新后服务端 `no-cache` 会强制拉取新版本。

## 已知问题

- 旧浏览器或非 HTTPS 环境下 PWA 安装与 WebDAV 同步可能受限。
- 小组件、灵动岛等原生能力仅 iOS 端具备，Web 端不提供。

## 完整变更

后续由 git-cliff 基于 Conventional Commits 自动生成并维护于 `CHANGELOG.md`。
