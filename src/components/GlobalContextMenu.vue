<script setup>
// 全局液态玻璃右键菜单：渲染 useContextMenu 的共享状态，Haze 满血不降级。
import { onMounted, onUnmounted } from 'vue'
import { useContextMenu } from '../composables/useContextMenu.js'
import { MACARON_PALETTE } from '../lib/palette.js'
import { pluginRegistry } from '../services/PluginAPI.js'
import Icon from './Icon.vue'

const { state, close } = useContextMenu()

function run(item) {
  close()
  if (item && typeof item.action === 'function') {
    try { item.action() } catch (e) {}
  }
}
function pickColor(key) {
  const cb = state.onColor
  close()
  if (typeof cb === 'function') {
    try { cb(key) } catch (e) {}
  }
}
// 轻马卡龙：选色板底色与卡片色板同源（lib/palette.js），不再硬编码
function swatchBg(key) {
  const p = MACARON_PALETTE[key]
  return p ? p.card : '#F0F0F0'
}
// 模块六：插件注册的右键项（本地插件直接执行 run；URL 插件经 iframe 桥接触发）
function runPluginMenu(m) {
  close()
  if (typeof m.run === 'function') { try { m.run() } catch (e) {} return }
  const rec = pluginRegistry._iframes[m.owner]
  if (rec && rec.iframe && rec.iframe.contentWindow) rec.iframe.contentWindow.postMessage({ __eoRun: m.id }, '*')
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
        <div v-if="state.title" class="ctx-title">{{ state.title }}</div>
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
        <div v-if="state.colors && state.colors.length" class="ctx-colors">
          <button
            v-for="c in state.colors" :key="c.key"
            class="ctx-swatch"
            :class="'sw-' + c.key"
            :style="{ background: swatchBg(c.key) }"
            :title="c.label"
            @click="pickColor(c.key)"
          ></button>
        </div>
        <template v-if="pluginRegistry.contextMenus.length">
          <div class="ctx-divider"></div>
          <button
            v-for="m in pluginRegistry.contextMenus" :key="m.id"
            class="ctx-item plugin" role="menuitem"
            @click="runPluginMenu(m)"
          >
            <Icon v-if="m.icon" :name="m.icon" :size="18" />
            <span>{{ m.label }}</span>
          </button>
        </template>
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
  padding: 7px; border-radius: 18px;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--eo-glass-strong);
  backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
}
.ctx-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; border-radius: 12px; text-align: left;
  font-size: 14px; font-weight: 600; color: var(--eo-ink);
  transition: background .14s ease, transform .14s ease;
}
.ctx-title { font-size: 11px; opacity: .55; padding: 2px 12px 6px; }
.ctx-colors { display: flex; gap: 6px; padding: 8px 12px 4px; border-top: 1px solid var(--eo-glass-border); margin-top: 4px; }
.ctx-swatch { width: 20px; height: 20px; border-radius: 6px; border: 1px solid rgba(44, 44, 44, .12); cursor: pointer; transition: transform .12s ease; }
.ctx-swatch:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.ctx-item:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.ctx-item.danger { color: var(--eo-ink); }
.ctx-item svg { color: var(--eo-primary-deep); flex: none; }
.ctx-item.danger svg { color: var(--eo-ink); }
.ctx-divider { height: 1px; background: var(--eo-glass-border); margin: 4px 8px; }
.ctx-item.plugin { font-weight: 500; color: var(--eo-primary-deep); }
.ctx-item.plugin::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--eo-primary); margin-right: 2px; flex: none; }
</style>
