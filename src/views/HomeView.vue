<script setup>
// ===== 主页 = 无限画布可视化工作区（v2.1） =====
// 信息架构从「文件夹 + 文档列表」切换为「空间 Space — 画布 Canvas — 节点 / 绘画元素」。
// 页面本身只提供安全区容器；画布引擎、空间导航、面板全部在 SpaceWorkspace 内。
import { defineOptions } from 'vue'
import SpaceWorkspace from '../space/SpaceWorkspace.vue'

// 组件名用于 App.vue 的 <KeepAlive :include>：
// 切到别的页面再回主页，画布实例不销毁，当前空间与视口原样保留。
defineOptions({ name: 'HomeView' })
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
