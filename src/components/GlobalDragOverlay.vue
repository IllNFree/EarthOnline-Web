<script setup>
// 全屏拖拽浮层（需求 8.2）：拖文件进入窗口时满血 Haze 提示。
import { useGlobalDropZone } from '../composables/useGlobalDropZone.js'
const { state } = useGlobalDropZone()
</script>

<template>
  <transition name="fade">
    <div v-if="state.dragging" class="drop-overlay">
      <div class="drop-card glass glass-strong">
        <div class="drop-ring">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </div>
        <div class="drop-title">松手即可上传</div>
        <div class="drop-sub">将文件拖入此处，自动存入对应模块</div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.drop-overlay {
  position: fixed; inset: 0; z-index: 92;
  display: flex; align-items: center; justify-content: center;
  background: rgba(28, 22, 16, .34);
  backdrop-filter: blur(8px) saturate(140%);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
}
.drop-card {
  width: min(86vw, 420px); padding: 34px 28px; border-radius: var(--eo-radius);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center;
}
.drop-ring {
  width: 72px; height: 72px; border-radius: 24px; margin-bottom: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .4);
  animation: dropPulse 1.6s ease-in-out infinite;
}
@keyframes dropPulse { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
.drop-title { font-size: 17px; font-weight: 800; color: var(--eo-ink); }
.drop-sub { font-size: 13px; color: var(--eo-ink-soft); }
</style>
