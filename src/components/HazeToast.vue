<script setup>
// 右下角 Haze 气泡（需求 8.3）：剪贴板监听命中后提示「是否加入笔记」。
import { useClipboardWatcher } from '../composables/useClipboardWatcher.js'
import Icon from './Icon.vue'
const { state, accept, dismiss } = useClipboardWatcher()
</script>

<template>
  <teleport to="body">
    <transition name="hazetoast">
      <div v-if="state.visible" class="haze-toast glass glass-strong" role="status">
        <span class="ht-illu"><Icon name="sparkles" :size="18" /></span>
        <div class="ht-body">
          <div class="ht-title">检测到剪贴板内容</div>
          <div class="ht-text">{{ state.text || '' }}</div>
        </div>
        <button class="ht-btn" @click="accept">孵化节点</button>
        <button class="ht-close" @click="dismiss"><Icon name="x" :size="14" /></button>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.haze-toast {
  position: fixed; right: 18px; bottom: 18px; z-index: 88;
  display: flex; align-items: center; gap: 10px;
  width: min(92vw, 360px); padding: 12px 12px; border-radius: 16px;
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
}
.ht-illu {
  width: 34px; height: 34px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
.ht-body { flex: 1; min-width: 0; }
.ht-title { font-size: 13px; font-weight: 700; color: var(--eo-ink); }
.ht-text {
  font-size: 12px; color: var(--eo-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ht-btn {
  flex: none; padding: 8px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--eo-primary), var(--eo-primary-deep));
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18) inset, var(--eo-shadow-soft);
}
.ht-btn:active { transform: scale(.96); }
.ht-close { flex: none; color: var(--eo-ink-soft); padding: 4px; }
.hazetoast-enter-active, .hazetoast-leave-active { transition: opacity .22s ease, transform .22s cubic-bezier(.22, 1, .36, 1); }
.hazetoast-enter-from, .hazetoast-leave-to { opacity: 0; transform: translateY(12px); }
</style>
