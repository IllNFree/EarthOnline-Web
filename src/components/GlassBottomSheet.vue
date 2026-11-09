<script setup>
// 全局二级弹窗：默认固定尺寸、屏幕居中；drawer=true 时改为底部抽屉上滑（天气详情使用）
import { computed, onMounted, onUnmounted } from 'vue'
import { motion, AnimatePresence } from 'motion-v'
import Icon from './Icon.vue'

const props = defineProps({
  title: { type: String, default: '' },
  show: { type: Boolean, default: false },
  drawer: { type: Boolean, default: false },
  // 竖屏：贴当前窗口右侧的抽屉（不居中遮挡画布）
  side: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

// 全局 Esc（App.vue 广播 eo-esc）：弹窗打开时消费事件并关闭
function onEsc(e) {
  if (!props.show) return
  e.preventDefault()
  emit('close')
}
onMounted(() => document.addEventListener('eo-esc', onEsc))
onUnmounted(() => document.removeEventListener('eo-esc', onEsc))

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
const drawerVariants = {
  initial: { opacity: 0, y: '100%' },
  animate: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 340, damping: 32, mass: 0.9 } },
  exit: { opacity: 0, y: '100%', transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }
}
const sideVariants = {
  initial: { opacity: 0, x: '100%' },
  animate: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 340, damping: 32, mass: 0.9 } },
  exit: { opacity: 0, x: '100%', transition: { duration: 0.2 } }
}
const variants = computed(() => (props.side ? sideVariants : (props.drawer ? drawerVariants : panelVariants)))
</script>

<template>
  <AnimatePresence>
    <motion.div v-if="show" class="modal-mask" :class="{ 'drawer-mask': drawer, 'side-mask': side }" :variants="maskVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'" @click.self="emit('close')">
      <motion.div class="modal glass" :class="{ 'modal-drawer': drawer, 'modal-side': side }" :variants="variants" :initial="'initial'" :animate="'animate'" :exit="'exit'">
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
/* 抽屉模式：贴底上滑、顶部圆角，保留同一套玻璃质感 */
.modal-mask.drawer-mask { align-items: flex-end; padding: 0; }
.modal.modal-drawer {
  width: min(100vw, 640px);
  max-height: 86vh;
  border-radius: 22px 22px 0 0;
  padding: 18px 20px max(22px, env(safe-area-inset-bottom));
}
/* 竖屏：贴窗口右侧、通高、从右滑入 */
.modal-mask.side-mask { align-items: stretch; justify-content: flex-end; padding: 0; }
.modal.modal-side {
  width: min(88vw, 420px); max-height: none; height: 100%;
  border-radius: 20px 0 0 20px;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
}
</style>
