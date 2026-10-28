<script setup>
// 全局液态玻璃右键菜单：渲染 useContextMenu 的共享状态，Haze 满血不降级。
import { onMounted, onUnmounted } from 'vue'
import { useContextMenu } from '../composables/useContextMenu.js'
import Icon from './Icon.vue'

const { state, close } = useContextMenu()

function run(item) {
  close()
  if (item && typeof item.action === 'function') {
    try { item.action() } catch (e) {}
  }
}
function onKey(e) {
  if (e.key === 'Escape' && state.visible) close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <teleport to="body">
    <div v-if="state.visible" class="ctx-mask" @click="close" @contextmenu.prevent="close">
      <div
        class="ctx-menu glass glass-strong"
        :style="{ left: state.x + 'px', top: state.y + 'px' }"
        role="menu"
        @click.stop
      >
        <button
          v-for="(it, i) in state.items"
          :key="i"
          class="ctx-item"
          :class="{ danger: it.danger }"
          role="menuitem"
          @click="run(it)"
        >
          <Icon v-if="it.icon" :name="it.icon" :size="18" />
          <span>{{ it.label }}</span>
        </button>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ctx-mask {
  position: fixed; inset: 0; z-index: 95;
}
.ctx-menu {
  position: fixed; min-width: 200px; max-width: 240px;
  padding: 8px; border-radius: var(--eo-radius-sm);
  display: flex; flex-direction: column; gap: 2px;
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
}
.ctx-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; border-radius: 10px; text-align: left;
  font-size: 14px; font-weight: 600; color: var(--eo-ink);
  transition: background .14s ease, transform .14s ease;
}
.ctx-item:hover { background: var(--eo-chip); transform: translateX(2px); }
.ctx-item.danger { color: var(--eo-bad); }
.ctx-item svg { color: var(--eo-primary-deep); flex: none; }
.ctx-item.danger svg { color: var(--eo-bad); }
</style>
