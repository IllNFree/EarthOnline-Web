<script setup>
import { motion, AnimatePresence } from 'motion-v'
import { computed, onMounted, onUnmounted } from 'vue'
import { useDialogStore } from '../stores/dialog.js'
import Icon from './Icon.vue'

const dialog = useDialogStore()

const maskVariants = {
  initial: { opacity: 0, backdropFilter: 'blur(0px)' },
  animate: { opacity: 1, backdropFilter: 'blur(20px)', transition: { duration: 0.28 } },
  exit: { opacity: 0, backdropFilter: 'blur(0px)', transition: { duration: 0.2 } }
}
const panelVariants = {
  initial: { opacity: 0, y: 36, scale: 0.92, filter: 'blur(12px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 360, damping: 26, mass: 0.8 } },
  exit: { opacity: 0, y: 20, scale: 0.96, filter: 'blur(8px)', transition: { duration: 0.16 } }
}

const iconName = computed(() => (dialog.danger ? 'warning' : 'info'))

function onKey(e) { if (e.key === 'Escape') dialog.close(false) }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <AnimatePresence>
    <motion.div v-if="dialog.open" class="dialog-mask" :variants="maskVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'" @click.self="dialog.close(false)">
      <!-- 面板：弹簧上浮 + 模糊清除 -->
      <motion.div class="dialog-panel glass" :class="{ danger: dialog.danger }" :variants="panelVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'" role="dialog" aria-modal="true">
        <!-- 顶部渐变发丝线 -->
        <motion.div class="hairline" :initial="{ scaleX: 0, opacity: 0 }" :animate="{ scaleX: 1, opacity: 1 }" :transition="{ delay: 0.1, duration: 0.45, ease: [0.22, 1, 0.36, 1] }" />
        <div class="glow" />

        <div class="dialog-body">
          <div class="row" style="gap:12px; align-items:flex-start">
            <motion.div class="icon-well" :initial="{ scale: 0.6, opacity: 0, rotate: -12 }" :animate="{ scale: 1, opacity: 1, rotate: 0 }" :transition="{ type: 'spring', stiffness: 420, damping: 18, delay: 0.06 }">
              <Icon :name="iconName" :size="22" />
            </motion.div>
            <div style="flex:1; min-width:0">
              <h3 class="dialog-title">{{ dialog.title }}</h3>
              <p v-if="dialog.message" class="dialog-message">{{ dialog.message }}</p>
              <p v-if="dialog.detail" class="dialog-detail">{{ dialog.detail }}</p>
            </div>
          </div>

          <motion.div class="dialog-actions" :initial="{ opacity: 0, y: 12 }" :animate="{ opacity: 1, y: 0 }" :transition="{ delay: 0.16, duration: 0.28 }">
            <button v-if="dialog.cancelText" class="btn ghost" @click="dialog.close(false)">{{ dialog.cancelText }}</button>
            <button class="btn" :class="{ danger: dialog.danger }" @click="dialog.close(true)">{{ dialog.confirmText }}</button>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

<style scoped>
.dialog-mask {
  position: fixed; inset: 0; z-index: 95; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(30, 18, 10, 0.45);
}
.dialog-panel {
  position: relative; width: 100%; max-width: 420px; overflow: hidden; padding: 22px 20px 20px;
  border-radius: 24px; z-index: 1;
}
.hairline {
  position: absolute; top: 0; left: 14%; right: 14%; height: 2px; transform-origin: center;
  background: linear-gradient(90deg, transparent, var(--eo-primary-soft), transparent);
  opacity: .9;
}
.glow {
  position: absolute; top: -40px; right: -10px; width: 140px; height: 140px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 132, 60, 0.18), transparent 70%);
  pointer-events: none;
}
.dialog-panel.danger .glow { background: radial-gradient(circle, rgba(217, 105, 78, 0.20), transparent 70%); }
.dialog-body { position: relative; z-index: 2; }
.icon-well {
  width: 44px; height: 44px; flex: none; border-radius: 14px; display: flex; align-items: center; justify-content: center;
  color: var(--eo-primary); background: linear-gradient(145deg, rgba(255,255,255,.4), rgba(255,255,255,.08));
  border: 1px solid var(--eo-glass-border); box-shadow: inset 0 1px 0 var(--eo-glass-hi);
}
.dialog-panel.danger .icon-well { color: var(--eo-bad); }
.dialog-title { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--eo-ink); }
.dialog-message { margin: 0; font-size: 14px; line-height: 1.5; color: var(--eo-ink); }
.dialog-detail { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--eo-ink-soft); white-space: pre-wrap; }
.dialog-actions { display: flex; gap: 10px; margin-top: 18px; }
.dialog-actions .btn { flex: 1; }
</style>
