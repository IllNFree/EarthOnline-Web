<script setup>
// 新版本提示条：Service Worker 检测到新版本时出现，用户点击后才刷新（不静默打断编辑）
import Icon from './Icon.vue'
import { updateState, applyUpdate, dismissUpdate } from '../services/appUpdate.js'
</script>

<template>
  <transition name="up-fade">
    <div v-if="updateState.needRefresh" class="up-banner">
      <Icon name="reset" :size="16" />
      <div class="up-text">
        <div class="up-title">有新版本可用</div>
        <div class="up-sub">刷新后加载最新代码，本地数据不受影响</div>
      </div>
      <button class="up-btn" :disabled="updateState.updating" @click="applyUpdate">{{ updateState.updating ? '更新中…' : '立即刷新' }}</button>
      <button class="up-close" title="稍后" @click="dismissUpdate"><Icon name="close" :size="14" /></button>
    </div>
  </transition>
</template>

<style scoped>
.up-banner {
  position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%);
  z-index: 9000; display: flex; align-items: center; gap: 10px;
  max-width: min(92vw, 460px); padding: 10px 12px;
  border-radius: 16px; background: var(--eo-glass-strong, rgba(255,255,255,.92));
  border: 1px solid var(--eo-line, rgba(0,0,0,.08));
  box-shadow: 0 18px 40px -18px rgba(0,0,0,.35);
  backdrop-filter: blur(18px) saturate(1.6);
  color: var(--eo-ink, #2C2C2C);
}
.up-text { min-width: 0; flex: 1; }
.up-title { font-size: 13px; font-weight: 700; }
.up-sub { font-size: 11px; opacity: .62; margin-top: 2px; }
.up-btn {
  flex: none; height: 30px; padding: 0 12px; border-radius: 10px; border: 0;
  background: var(--eo-primary, #2C2C2C); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
}
.up-btn:disabled { opacity: .6; }
.up-close { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 8px; background: transparent; color: inherit; opacity: .5; cursor: pointer; }
.up-close:hover { opacity: .8; }
.up-fade-enter-active, .up-fade-leave-active { transition: opacity .22s ease, transform .22s ease; }
.up-fade-enter-from, .up-fade-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
