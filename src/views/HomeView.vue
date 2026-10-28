<script setup>
// ===== 主页入口：仪表盘 / 画布 视图切换（默认视图可在设置中心配置） =====
// 对应需求 1：主页提供两种视图，默认显示仪表盘，可切换画布。
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useUserSettings } from '../composables/useUserSettings.js'
import DashboardHome from './DashboardHome.vue'
import WhiteboardHome from './WhiteboardHome.vue'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const settings = useUserSettings()
const mode = ref(settings.homeDefaultView || 'dashboard')

function toggle() {
  mode.value = mode.value === 'dashboard' ? 'canvas' : 'dashboard'
  settings.homeDefaultView = mode.value
}
// 跟随设置变化（设置中心修改后回写）
if (settings.homeDefaultView !== mode.value) mode.value = settings.homeDefaultView
</script>

<template>
  <div class="homeview">
    <div class="hv-switch glass">
      <button :class="{ on: mode === 'dashboard' }" @click="mode = 'dashboard'; settings.homeDefaultView = 'dashboard'">
        <Icon name="grid" :size="14" /> 仪表盘
      </button>
      <button :class="{ on: mode === 'canvas' }" @click="mode = 'canvas'; settings.homeDefaultView = 'canvas'">
        <Icon name="layout" :size="14" /> 画布
      </button>
      <span class="hv-tip">默认视图可在「设置中心 → 桌面与主页」修改</span>
    </div>
    <KeepAlive>
      <component :is="mode === 'dashboard' ? DashboardHome : WhiteboardHome" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.hv-switch { position: fixed; top: 12px; right: 14px; z-index: 30; display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 999px; }
.hv-switch button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border: none; border-radius: 999px; background: transparent; color: var(--eo-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.hv-switch button.on { background: var(--eo-primary); color: #fff; }
.hv-tip { font-size: 10px; opacity: .55; padding: 0 8px 0 4px; }
@media (max-width: 640px) { .hv-tip { display: none; } }
.homeview { position: relative; }
</style>
