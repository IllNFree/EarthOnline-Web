<script setup>
// 全局二级弹窗：固定尺寸、屏幕居中（废弃抽屉式 BottomSheet，对齐 Android 决断）
import { motion, AnimatePresence } from 'motion-v'
import Icon from './Icon.vue'

const props = defineProps({ title: { type: String, default: '' }, show: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const maskVariants = {
  initial: { opacity: 0, backdropFilter: 'blur(0px)' },
  animate: { opacity: 1, backdropFilter: 'blur(18px)', transition: { duration: 0.26 } },
  exit: { opacity: 0, backdropFilter: 'blur(0px)', transition: { duration: 0.2 } }
}
const panelVariants = {
  initial: { opacity: 0, y: 28, scale: 0.94, filter: 'blur(10px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 360, damping: 26, mass: 0.8 } },
  exit: { opacity: 0, y: 16, scale: 0.96, filter: 'blur(8px)', transition: { duration: 0.16 } }
}
</script>

<template>
  <AnimatePresence>
    <motion.div v-if="show" class="modal-mask" :variants="maskVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'" @click.self="emit('close')">
      <motion.div class="modal glass" :variants="panelVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'">
        <div class="row between" style="margin-bottom:10px">
          <h3 style="margin:0">{{ title }}</h3>
          <button class="ghost-btn" @click="emit('close')"><Icon name="x" :size="20" /></button>
        </div>
        <slot />
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 4px; }
</style>
