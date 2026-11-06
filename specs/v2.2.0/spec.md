# 《地球Online》Web v2.2.0 变更规格（8 项）

## 目标
按用户确认的 8 项需求完成本地修改、构建与 CloudBase 部署（不执行 git push），交付可验收产物。

## 范围与逐项决策

### 1. 画布交互重构（选择 / 长按拖拽 / 连线 / 多选）
文件：`src/space/SpaceWorkspace.vue`、`src/space/components/SpaceToolRail.vue`、`src/space/components/SpaceCanvas.vue`、`src/space/core/homeSeed.js`（引导文案）

- 新增 `ui.multiMode`：`null | 'click' | 'box'`，默认 `null`。
- 工具栏：删除「抓手」按钮及 `pan` 工具入口；新增「多选」按钮，点开弹层三选项：`自定义多选（click）`、`框选（box）`、`退出多选（null）`。
- 长按阈值 `LONG_PRESS_MS = 250`（桌面与触屏一致）。
- 卡片（DOM 卡片与画布渲染卡片统一规则）：
  - 按下即选中（多选 click 模式下改为切换选中，不建连线）。
  - 按住 ≥250ms 后移动 → 拖动卡片；未满 250ms 移动超过 6px → 取消本次按下，不拖动、不建连线。
  - 未移动且未满 250ms 抬起 → 单击：
    - `ui.multiMode === 'click'`：切换选中，不建连线；
    - 否则若按下前恰有 1 张已选卡片且点击的是另一张卡片 → 调用 `ws.connect(prevId, n.id)`，提示「已创建连线」，选中新卡；
    - 否则普通单选（堆叠成员整组选中）。
- 空白区域：
  - `ui.multiMode === 'box'`：拖动 = 框选（沿用 `startMarquee/finishMarquee`）。
  - 否则按下后长按 ≥250ms 再移动 = 平移画布；未满 250ms 抬起 = 清空选中（不影响双击新建）。
  - 双击空白 → 新建卡片浮层（保留）；双击卡片 → 编辑/卡片设置（保留）。
- 删除 `props.ui.tool === 'pan'` 分支与 `grab/grabbing` 手型光标；保留空格键与鼠标中键平移作为隐藏兜底，光标保持默认。
- 同步更新帮助文案（`SpaceWorkspace.vue` 快捷键表与 `homeSeed.js` 欢迎卡）。

验收：单击选中不误移；长按拖动；单击第二张卡生成连线；多选两模式行为正确；工具栏无抓手按钮。

### 2. Steam 游戏库默认收起
文件：`src/views/Steam.vue`

- 新增 `libOpen`（默认 `false`），localStorage 键 `eo_steam_lib_open` 记忆上次状态。
- 在搜索/排序工具条上方增加「游戏库（N）」折叠栏（含 chevron）；收起时隐藏 `st-toolbar` 与 `st-games` 网格，展开后恢复。
- 「最近游玩」与顶部统计保持展示。

验收：首次进入游戏库默认收起；点击可展开；刷新后记住状态。

### 3. 强调色改为黛蓝
文件：`src/styles/main.css` 及使用硬编码强调色的组件样式

- `:root`：`--eo-primary:#3E5F8A`、`--eo-primary-deep:#33506F`、`--eo-primary-soft:#7087A1`、`--eo-accent:#5B7CA6`。
- `[data-theme='dark']`：`--eo-primary:#8FB4DA`、`--eo-primary-deep:#A9C6E8`、`--eo-primary-soft:#8FA0B0`、`--eo-accent:#9DB6D0`。
- 暖白背景 `--eo-bg:#FAF8F3` 不变；禁止红/棕/黄/橙强调色。
- 将组件 scoped 样式中用于选中/主按钮填充的硬编码 `#2C2C2C` 替换为 `var(--eo-primary)`（仅限背景、边框、选中描边；正文文字色保持 `var(--eo-ink)`）：`SpaceToolRail.vue`、`SpaceInspector.vue`、`SpaceCanvas.vue`、`CanvasPanelNode.vue`、`CanvasCreateSheet.vue`、`Settings.vue` 等。
- 绘制默认笔色、卡片数据色不改。

验收：全局主按钮/选中态为黛蓝；暖白底保留；无红色强调。

### 4. 画布设置面板默认收起并记忆
文件：`src/space/components/SpaceInspector.vue`

- `open` 初始值从 localStorage `eo:inspector:sections` 读取；无记录时全部 `false`（默认收起）。
- `toggle(key)` 后写回 localStorage；保留 `ui.inspector` 整体开合记忆（桌面默认开、手机默认关）。

验收：首次进入各分区收起；展开/收起后刷新保持。

### 5. Markdown 默认预览 + 可视化工具条
文件：`src/space/components/SpaceCanvas.vue`、`src/components/CanvasCardBody.vue`

- 卡片编辑器 `editor` 默认 `preview = true`（打开即预览）。
- 编辑页替换裸 textarea 上方为可视化工具条：标题、加粗、列表、引用、链接、图片、待办；点击按钮对 textarea 选区插入对应 Markdown（`# `、`**`、`- `、`> `、`[文字](url)`、`![](url)`、`- [ ] `），普通用户无需手写语法。
- 文档卡正文使用已有 `MarkdownView` 渲染（`CanvasCardBody.vue` 中 `cb-md` 分支），数据仍以 markdown 字符串存储。
- 保存逻辑不变（`saveEditor` 写回 `cardData.body` / memo）。

验收：打开编辑器默认预览；工具条可插入格式；文档卡显示渲染结果。

### 6. 个人主页 `/profile`
文件：新增 `src/views/Profile.vue`；修改 `src/router/index.js`、`src/App.vue`、`src/lib/model.js`

- 博客式布局：横幅（暖白+黛蓝细线）、头像（默认首字，支持本地上传并压缩至 256px 存本地）、昵称、简介、加入日期、统计（任务/笔记/物品/收藏/成就）、收藏墙（取 `collections` 封面）、最近动态时间线（`activities`）、成就徽章墙（`ACHIEVEMENTS` + 已解锁）。
- 「编辑资料」居中模态：昵称、简介、头像、第三方账号链接（GitHub / B站 / Steam / 微博 / X），链接仅展示跳转，不做 OAuth。
- 数据：复用 `store.data.profile`（`name/signature/avatarData`）；在 `defaultProfile()` 增加 `joinedAt`（首次创建日期）与 `links` 空对象；写入走 `store.setProfile`。
- 导航：侧边栏增加「个人主页」入口；移动端「更多」抽屉增加同名入口。

验收：路由可访问；资料可编辑并持久化；头像上传压缩；各区块有真实数据或空态。

### 7. 收藏/物品粘贴链接自动封面
文件：`cloudbase/functions/api/handler.js`、新增 `src/lib/cover.js`、`src/views/Backpack.vue`

- 云函数新增 `GET /api/cover?url=<encoded>`：仅允许 http/https；拒绝私有/内网地址（localhost、127.x、10.x、172.16–31、192.168.x、169.254.x、::1）；8s 超时、响应体 ≤3MB、跟随最多 3 次重定向；解析 `og:image` / `twitter:image`，返回绝对 URL；内存 LRU 缓存 1 小时、上限 200 条。
- `src/lib/cover.js`：`fetchLinkCover(url)` 调云函数；失败回退 DuckDuckGo favicon（`https://icons.duckduckgo.com/ip3/<host>.ico`）；再失败返回空（UI 用域名首字渐变）。
- `Backpack.vue`：添加/编辑收藏时，链接输入失焦或粘贴后自动请求封面（仅在封面为空时填充），显示「封面获取中」；失败静默回退，不阻塞保存。
- 需重新部署 `api` 云函数。

验收：输入公开网页链接可自动出封面；内网/非法链接被拒绝；失败有回退；构建与部署通过。

### 8. 彩蛋三则
文件：`src/views/Settings.vue`、`src/space/SpaceWorkspace.vue`、`src/views/Achievements.vue`、`src/lib/achievements.js`

- (a) 设置页底部弱化文字按钮「千万别点」：点击进入 5 段熊对话，逐次点击推进；结束后爆炸动画并尝试 `window.close()`，失败回退 `location.replace('about:blank')`；localStorage `eo_egg_dontclick` 永久隐藏按钮。
- (b) 打开画布时 0.5% 概率触发「无量空处」全屏彩蛋：政治/经济/文化/动漫四类卡片铺满屏幕，点击任意处关闭；localStorage `eo_egg_void` 仅触发一次（已触发过不再出现）。为验收提供 `?egg=void` 测试入口（不展示给普通用户）。
- (c) 成就页新增隐藏成就 `egg_rickroll`：标题「隐藏成就 · 免费解锁全部主题（限时领取）」，红点 + NEW 样式；点击立即解锁并打开 `https://www.bilibili.com/video/BV1GJ411x7h7/`（新标签），无需观看。

验收：三处彩蛋均可按规则触发；`eo_egg_dontclick`/`eo_egg_void` 只生效一次；不影响正常功能。

## 执行步骤
1. 按 1→8 顺序修改源码（1、5 涉及同一文件，合并编辑）。
2. 本地构建：`npm run build`（`emptyOutDir:true`）。
3. 截图验收：1440×900 与 390×844（主页/画布、Profile、Steam、Settings、成就）。
4. 部署：`api` 云函数 → 静态托管。
5. 线上冒烟：路由、封面 API、登录/同步不受影响。

## 输出物与路径
- 源码：`d:\AI\app\EarthOnline-Web\src\...`
- 构建：`d:\AI\app\EarthOnline-Web\dist`
- 线上：https://earthonline-d6g4gdqln67ca31a0-1517552805.tcloudbaseapp.com/

## 风险与约束
- 交互重构影响画布核心手感，需重点回归（拖动、框选、堆叠、缩放、双击）。
- 强调色替换可能遗漏个别组件硬编码，验收时全页巡检。
- 封面代理存在 SSRF 风险，已用协议白名单 + 私网黑名单 + 大小/超时限制。
- `window.close()` 在非脚本打开的标签页会被浏览器拦截，已有回退方案。
- 不执行 git push；密钥不写入代码或日志。

## 需确认
- 以上 8 项范围与实现方式是否确认执行（回复「确认/开始执行」）。
