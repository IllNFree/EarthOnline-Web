<script setup>
// ===== 主页 = 无限画布可视化工作区（v2.1） =====
// 信息架构从「文件夹 + 文档列表」切换为「空间 Space — 画布 Canvas — 节点 / 绘画元素」。
// 页面本身只提供安全区容器；画布引擎、空间导航、面板全部在 SpaceWorkspace 内。
import { defineOptions, onMounted, onActivated } from 'vue'
import SpaceWorkspace from '../space/SpaceWorkspace.vue'
import { useAppStore } from '../stores/app.js'

// 组件名用于 App.vue 的 <KeepAlive :include>：
// 切到别的页面再回主页，画布实例不销毁，当前空间与视口原样保留。
defineOptions({ name: 'HomeView' })

const store = useAppStore()
// 竖屏主页注册「+」快捷新建（此前主页没注册，导致竖屏只有 AI 球、+/AI 对齐规则空转）。
// 在视口中心落一张便利贴，行为与画布工具栏「新建节点」一致。
function addStickyAtViewport() {
  const g = window.__eoSpace
  if (!g || !g.ws) return
  const w = g.ws
  const cam = w.space.camera || { x: 0, y: 0 }
  w.pushUndo()
  const n = w.addNode({ x: cam.x - 125 + (Math.random() - 0.5) * 40, y: cam.y - 75, w: 250, h: 150, title: '新便利贴', body: '' })
  if (n && n.id) { g.ui.selection = [n.id]; g.ui.tick++ }
  w.touch('node:add', { index: true })
}
// KeepAlive：onActivated 重新注册，覆盖上一页面遗留的 quickAdd
onMounted(() => store.setQuickAdd(addStickyAtViewport))
onActivated(() => store.setQuickAdd(addStickyAtViewport))
</script>

<template>
  <div class="home-shell">
    <SpaceWorkspace />
  </div>
</template>

<style scoped>
.home-shell {
  position: fixed;
  top: env(safe-area-inset-top, 0px);
  left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 86px);
  background: #FAF9F6;
  overflow: hidden;
}
@media (min-width: 900px) {
  .home-shell { left: var(--eo-sidebar-w); bottom: 0; }
}
</style>
