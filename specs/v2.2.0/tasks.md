# v2.2.0 任务清单

| # | 任务 | 文件 | 验收 | 状态 |
|---|------|------|------|------|
| 1 | 画布交互重构（单击选中 / 250ms 长按拖拽 / 二次点击连线 / 空白长按平移 / 多选两模式 / 移除抓手） | SpaceWorkspace.vue, SpaceToolRail.vue, SpaceCanvas.vue, homeSeed.js | 单击不误移、长按可拖、连线成功、多选可用、无抓手按钮 | [x] |
| 2 | Steam 游戏库默认收起并记忆 | views/Steam.vue | 默认收起、可展开、刷新记忆 | [x] |
| 3 | 全站强调色改黛蓝 #3E5F8A | styles/main.css + 组件 scoped 样式 | 主按钮/选中态黛蓝，暖白底保留，无红色强调 | [x] |
| 4 | 画布设置面板分区默认收起并记忆 | components/SpaceInspector.vue | 默认收起、刷新记忆 | [x] |
| 5 | Markdown 默认预览 + 可视化工具条 | SpaceCanvas.vue, CanvasCardBody.vue | 打开即预览、工具条可插入格式、文档卡渲染 | [x] |
| 6 | 新增个人主页 /profile | views/Profile.vue, router/index.js, App.vue, lib/model.js | 可访问、资料编辑持久化、头像压缩、空态完整 | [x] |
| 7 | 收藏/物品链接自动封面 | cloudbase/functions/api/handler.js, lib/cover.js, views/Backpack.vue | 自动封面、非法链接拦截、回退可用 | [x] |
| 8 | 三则彩蛋 | views/Settings.vue, SpaceWorkspace.vue, views/Achievements.vue, lib/achievements.js | 触发规则正确、只生效一次、不破坏正常功能 | [x] |
| 9 | 构建与部署 | dist, CloudBase | `npm run build` 通过；函数与托管部署成功 | [x] |
| 10 | 验收与报告 | 截图/线上链接 | 1440/390 截图、线上冒烟通过、输出变更摘要 | [x] |
