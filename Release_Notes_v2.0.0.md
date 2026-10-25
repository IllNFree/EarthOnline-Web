# 地球Online Web · v2.0.0 发布说明

> 发布日期：2026-10-26 · 版本号四处统一为 **2.0.0**（`package.json` / `src/lib/model.js` / 侧边栏 / 备份 `appVersion`）
> 本轮依据《v2.0.0 双端对齐审计报告》24 项对照，集中清理 **P0 / P1 / P2 断层**，并与 Android v2.0.0（versionCode 74）对齐。

---

## 结论先行

- **遗留双轨制终结**：`modules/` 单文件旧包、`build_pakr.js`、`index_pakr.html` 全部删除，仓库只剩一套活跃构建（`src/` + Vite）。
- **跨端同步真正可用**：WebDAV 远端文件名统一 `earth_online_backup.json`，拉取改按主键合并 + `lastSyncAt` 冲突比对，不再整包覆盖。
- **数据安全线修复**：软删除改为 Android 同构的 `deletedAt` 字段模型（含历史 `trash[]` 自动迁移），跨端不再出现幽灵数据。

---

## P0（生死线）

| # | 修复项 | 说明 |
| - | ---- | ---- |
| 1 | WebDAV 远端文件名统一 | 活跃构建由 `earth-online-web.json` 改为 `/earth_online_backup.json`，与 Android `CloudSyncManager.DEFAULT_REMOTE_PATH` 完全一致；设置页新增「远端文件路径」可配置项 |
| 2 | 恢复主键合并语义 | 云端拉取与本地 JSON 导入均改为 **按实体主键 upsert**（同主键以修订时间新者为准 / 本地独有保留 / 云端独有补入），彻底替换原先 `Object.assign` 整包浅覆盖 |
| 3 | `lastSyncAt` 冲突比对 | 新增 `state.lastSyncAt` 水位线；云端 `exportedAt` 不比本地新时拒绝落库并如实提示，杜绝「误拉抹掉本地新增」 |
| 4 | 软删除模型同构 | 删除操作改为**实体留在原集合并写 `deletedAt`**（不再搬进 `trash[]`）；回收站由 `trashList()` 实时派生；支持恢复 / 永久删除 / 30 天过期清理；老版本 `trash[]` 数据首次加载自动迁移，内容不丢 |
| 5 | 遗留 `modules/` 彻底下线 | 删除 `modules/`（14 个遗留 JS）、`build_pakr.js`、`index_pakr.html`，以及与之冲突的旧根 `manifest.json`（PWA 双清单问题一并解决） |
| 6 | 版本号四处统一 | `package.json` / `src/lib/model.js` / 侧边栏版本显示 / 备份中的版本信息统一为 `2.0.0` |
| 7 | 卡片默认透明度对齐 | 出厂默认由 50% 调整为 **80%**（对齐 Android `LocalCardOpacity = 0.8f`），老存档一次性迁移到新基线 |

## P1（体验闭环）

- **全局搜索**：右上角搜索入口 + 全屏搜索面板，覆盖 **任务 / 物品 / 收藏 / 笔记 / 足迹 / 成就** 六类聚合，结果直达对应路由，Esc 关闭。
- **右下角新增 FAB**：任务 / 笔记 / 背包 / 相册 / 记账五个列表页各自注册自己的「新增」动作，由全局悬浮按钮触发（对齐 Android 列表页 FAB）。
- **断网全局横幅**：新增 `online` 状态监听，离线时顶部横幅提示；WebDAV 上传 / 拉取 / 测试连接与同步前统一做离线拦截。
- **自动同步**：设置页新增「自动同步」开关（默认开启，对齐 Android `AUTO_SYNC`），数据变更后延迟推送云端。
- **Steam 跨域根治**：内置代理 `/steam-api/*`（Vite dev/preview proxy + 生产零依赖 Node 服务 `server.js`），Steam 游戏库零配置可拉取；用户自定义代理前缀仍可覆盖。
- **WebDAV 配置持久化**：地址 / 账号 / 密码 / 路径 / 自动同步落 localStorage（不进存档，避免凭据随备份外泄），刷新后不再丢失。

## P2（质感）

- **微动效**：卡片 / 列表项弹簧按压（低阻尼回弹 0.978）；路由转场补齐离场动画（淡出下沉 + `out-in` 模式），入场保持淡入上浮。
- **回收站空状态**：补齐矢量插画 + 引导文案，不再是单行纯文本。
- **尊重系统降低动效设置**：`prefers-reduced-motion` 下自动关闭按压缩放与页面转场。

---

## 部署形态

- 活跃构建：`npm ci && npm run build` → `dist/`（Vite + Vue 3 + Pinia + PWA）。
- 生产服务：`npm start`（= `node server.js`，零第三方依赖）— 静态托管 `dist/`，并内置 Steam 反向代理；`index.html` 输出 `no-cache`，避免版本更新后仍命中旧缓存。

> 数据全部保留在本机 IndexedDB；无服务器、无账号、无埋点。详见《隐私政策》。
