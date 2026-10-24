<script setup>
// 头像裁剪器：鼠标滚轮缩放 + 拖动定位 + canvas 输出 512×512
// 交互：在预览区滚动 = 缩放；按住拖动 = 移动图片；圆形裁剪框居中固定
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({ src: { type: String, default: '' } }) // 原图 dataURL
const emit = defineEmits(['crop', 'cancel'])

const VIEW = 260          // 预览区边长
const OUT = 512           // 输出尺寸
const img = ref(null)     // HTMLImageElement
const scale = ref(1)      // 相对 cover 基准的缩放
const offX = ref(0)       // 图片中心相对预览中心的偏移（px）
const offY = ref(0)
const dragging = ref(false)
let dragStart = null
let st = null

const baseCover = computed(() => {
  const im = img.value
  if (!im) return 1
  return Math.max(VIEW / im.width, VIEW / im.height)
})
const drawW = computed(() => img.value ? img.value.width * baseCover.value * scale.value : 0)
const drawH = computed(() => img.value ? img.value.height * baseCover.value * scale.value : 0)
// 图片左上角位置 = 中心 + 偏移 - 半宽
const style = computed(() => ({
  width: drawW.value + 'px',
  height: drawH.value + 'px',
  left: (VIEW / 2 + offX.value - drawW.value / 2) + 'px',
  top: (VIEW / 2 + offY.value - drawH.value / 2) + 'px'
}))

watch(() => props.src, (v) => {
  img.value = null; scale.value = 1; offX.value = 0; offY.value = 0
  if (!v) return
  const im = new Image()
  im.onload = () => { img.value = im }
  im.src = v
}, { immediate: true })

function clampOffset() {
  if (!img.value) return
  const halfW = drawW.value / 2, halfH = drawH.value / 2
  const limX = Math.max(0, halfW - VIEW / 2)
  const limY = Math.max(0, halfH - VIEW / 2)
  offX.value = Math.min(limX, Math.max(-limX, offX.value))
  offY.value = Math.min(limY, Math.max(-limY, offY.value))
}
function onWheel(e) {
  if (!img.value) return
  e.preventDefault()
  const next = Math.min(6, Math.max(1, scale.value * (e.deltaY < 0 ? 1.1 : 0.9)))
  // 简单锚定视图中心，缩放后重新夹紧偏移
  scale.value = next
  clampOffset()
}
function onDown(e) {
  if (!img.value) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, ox: offX.value, oy: offY.value }
}
function onMove(e) {
  if (!dragging.value) return
  offX.value = dragStart.ox + (e.clientX - dragStart.x)
  offY.value = dragStart.oy + (e.clientY - dragStart.y)
  clampOffset()
}
function onUp() { dragging.value = false }

onMounted(() => {
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
})

function apply() {
  const im = img.value
  if (!im) return
  const canvas = document.createElement('canvas')
  canvas.width = OUT; canvas.height = OUT
  const ctx = canvas.getContext('2d')
  const b = baseCover.value
  // 预览坐标 → 原图坐标：drawW = im.width * b * scale ⇒ 原图像素 = 预览px / (b*scale)
  const k = b * scale.value
  const sx = (VIEW / 2 - offX.value - drawW.value / 2) / k
  const sy = (VIEW / 2 - offY.value - drawH.value / 2) / k
  const sw = VIEW / k
  const sh = VIEW / k
  ctx.drawImage(im, sx, sy, sw, sh, 0, 0, OUT, OUT)
  emit('crop', canvas.toDataURL('image/jpeg', 0.86))
}
</script>

<template>
  <div class="ac">
    <div class="ac-view" :class="{ dragging }" @wheel="onWheel" @mousedown="onDown" @dragstart.prevent>
      <img v-if="img" :src="src" :style="style" alt="" draggable="false" />
      <div class="ac-mask"></div>
      <div v-if="!img" class="muted" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px">图片加载中…</div>
    </div>
    <div class="muted" style="font-size:12px;text-align:center;margin-top:6px">滚轮缩放 · 按住拖动调整位置</div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn" style="flex:1" @click="apply"><Icon name="checklist" :size="16" /> 使用该头像</button>
      <button class="btn ghost" @click="emit('cancel')"><Icon name="x" :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.ac-view {
  position: relative; width: 260px; height: 260px; margin: 0 auto;
  border-radius: 20px; overflow: hidden; cursor: grab; user-select: none;
  background: var(--eo-chip); touch-action: none;
  border: 1.5px solid var(--eo-glass-border);
  box-shadow: inset 0 1px 0 var(--eo-glass-hi);
}
.ac-view.dragging { cursor: grabbing; }
.ac-view img { position: absolute; max-width: none; pointer-events: none; }
/* 圆形裁剪框参考遮罩：中心圆外压暗 */
.ac-mask {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at center, transparent 0, transparent calc(130px - 1px), rgba(0,0,0,.45) 130px);
}
.ac-mask::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 260px; height: 260px;
  transform: translate(-50%, -50%); border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .8);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0);
}
</style>
