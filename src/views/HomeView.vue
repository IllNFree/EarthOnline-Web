<script setup>
// ===== 主页入口：仪表盘 / 画布 视图切换（默认视图可在设置中心配置） =====
// 对应需求 1：主页根组件必须包含「仪表盘」与「画布（白板）」两个视图，默认显示仪表盘。
import { ref } from 'vue'
import { useUserSettings } from '../composables/useUserSettings.js'
import DashboardHome from './DashboardHome.vue'
import WhiteboardHome from './WhiteboardHome.vue'
import Icon from '../components/Icon.vue'

const settings = useUserSettings()
// 默认显示仪表盘；从设置中心读取已持久化偏好（undefined / 非 canvas 一律回退 dashboard）
const mode = ref(settings.homeDefaultView === 'canvas' ? 'canvas' : 'dashboard')
function setMode(v) {
  mode.value = v
  settings.homeDefaultView = v
}
</script>

<template>
  <div class="homeview">
    <div class="hv-switch glass">
      <button :class="{ on: mode === 'dashboard' }" @click="setMode('dashboard')">
        <Icon name="grid" :size="14" /> 仪表盘
      </button>
      <button :class="{ on: mode === 'canvas' }" @click="setMode('canvas')">
        <Icon name="layout" :size="14" /> 画布
      </button>
    </div>
    <KeepAlive>
      <component :is="mode === 'dashboard' ? DashboardHome : WhiteboardHome" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.hv-switch { position: fixed; top: 64px; right: 14px; z-index: 40; display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 999px; }
.hv-switch button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border: none; border-radius: 999px; background: transparent; color: var(--eo-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.hv-switch button.on { background: var(--eo-primary); color: #fff; }
.hv-tip { font-size: 10px; opacity: .55; padding: 0 8px 0 4px; }
@media (max-width: 640px) { .hv-tip { display: none; } .hv-switch { top: 60px; right: 10px; } }
.homeview { position: relative; min-height: 100%; }
</style>
