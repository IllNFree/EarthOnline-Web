<script setup>
// ===== 全局统一空状态组件（模块二 · 极简重构） =====
// 去卡片化：彻底移除背景卡片框 / 边框 / 阴影，纯透明背景，内容绝对居中，
// 仅靠留白营造呼吸感。保留 SVG 图标（液态玻璃徽标）、提示文案与主操作按钮。
import Icon from './Icon.vue'

defineProps({
  icon: { type: String, default: 'spark' },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' }
})
</script>

<template>
  <div class="eo-empty">
    <span class="eo-empty__badge"><Icon :name="icon" :size="32" /></span>
    <div class="eo-empty__title">{{ title }}</div>
    <div class="eo-empty__sub" v-if="subtitle">{{ subtitle }}</div>
    <div class="eo-empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
/* 纯透明容器：无背景、无边框、无阴影 —— 靠留白营造呼吸感 */
.eo-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 52px 24px; text-align: center;
  max-width: 460px; margin: 0 auto; width: 100%; box-sizing: border-box;
}
/* 图标徽标：保留 Haze 液态玻璃质感（内高光 + 背景模糊），但本身不是卡片 */
.eo-empty__badge {
  width: 66px; height: 66px; border-radius: 24px; flex: none;
  display: flex; align-items: center; justify-content: center;
  color: var(--eo-primary-deep);
  background: linear-gradient(150deg, rgba(255, 255, 255, .58), rgba(255, 255, 255, .16));
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  border: 1px solid var(--eo-glass-border);
  box-shadow: 0 12px 28px -18px rgba(44, 44, 44, .12), inset 0 1px 0 rgba(255, 255, 255, .55);
}
.eo-empty__title { font-weight: 800; font-size: 16px; color: var(--eo-ink); line-height: 1.4; }
.eo-empty__sub { font-size: 13px; color: var(--eo-ink-soft); line-height: 1.75; max-width: 320px; }
.eo-empty__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
</style>
