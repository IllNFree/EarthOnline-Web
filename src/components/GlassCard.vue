<script setup>
// 全局玻璃卡片组件：统一套用地球Online 暖色调液态玻璃材质。
import { motion } from 'motion-v'
const props = defineProps({
  padding: { type: [Number, String], default: 16 },
  hover: { type: Boolean, default: false },
  glow: { type: Boolean, default: false }
})
</script>

<template>
  <motion.div
    class="eo-card glass"
    :class="{ 'eo-card--hover': hover }"
    :style="{ padding: typeof padding === 'number' ? padding + 'px' : padding }"
    :while-press="hover ? { scale: 0.985 } : undefined"
    :transition="{ type: 'spring', stiffness: 420, damping: 26 }"
  >
    <span v-if="glow" class="eo-card__glow" aria-hidden="true" />
    <div class="eo-card__body"><slot /></div>
  </motion.div>
</template>

<style scoped>
.eo-card { position: relative; border-radius: var(--eo-radius); overflow: hidden; }
.eo-card--hover { cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
.eo-card--hover:hover { transform: translateY(-2px); box-shadow: 0 16px 34px -14px rgba(201,100,63,.42); }
.eo-card__glow {
  position: absolute; top: -40px; right: -16px; width: 150px; height: 150px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,132,60,.18), transparent 70%); pointer-events: none;
}
.eo-card__body { position: relative; z-index: 1; }
</style>
