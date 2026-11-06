<script setup>
// ===== 迷你地图 =====
// 全局缩略图：节点色块 + 视口框，可点击/拖拽瞬移相机。
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  ws: { type: Object, required: true },
  ui: { type: Object, required: true },
  stageW: { type: Number, default: 1200 },
  stageH: { type: Number, default: 700 }
})
const emit = defineEmits(['navigate'])

const el = ref(null)
const scale = ref(100)
// 收起后只留标题条：避免小地图压住右下角卡片（画布仍可拖动平移）
const collapsed = ref(false)
const W = 216
const H = 148
let raf = 0
let dirty = true
let dragging = false
let mapping = null
let lastDark = null

function themeDark() {
  const de = document.documentElement
  return (de.dataset && de.dataset.theme) === 'dark' || de.getAttribute('data-theme') === 'dark'
}

function invalidate() { dirty = true }

function draw() {
  raf = requestAnimationFrame(draw)
  // 主题切换后强制重绘缩略图
  const dark = themeDark()
  if (dark !== lastDark) { lastDark = dark; dirty = true }
  if (!dirty) return
  dirty = false
  const cv = el.value
  if (!cv) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr; cv.height = H * dpr
  }
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = dark ? '#1B1B1E' : '#F7F5F0'
  ctx.fillRect(0, 0, W, H)

  const nodes = props.ws.nodes.filter((n) => n.spaceId === props.ws.currentId)
  const draws = props.ws.drawings.filter((d) => d.spaceId === props.ws.currentId)
  const cam = props.ws.space.camera
  scale.value = Math.round(cam.s * 100)
  const vw = props.stageW / cam.s
  const vh = props.stageH / cam.s
  let x1 = cam.x - vw / 2, y1 = cam.y - vh / 2, x2 = cam.x + vw / 2, y2 = cam.y + vh / 2
  nodes.forEach((n) => {
    x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y)
    x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h)
  })
  draws.forEach((d) => {
    x1 = Math.min(x1, d.x); y1 = Math.min(y1, d.y)
    x2 = Math.max(x2, d.x + d.w); y2 = Math.max(y2, d.y + d.h)
  })
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1)
  const pad = 14
  const s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)
  const ox = (W - bw * s) / 2 - x1 * s
  const oy = (H - bh * s) / 2 - y1 * s
  mapping = { s, ox, oy }

  // 微点背景
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(44,44,44,0.10)'
  for (let x = 8; x < W; x += 12) {
    for (let y = 8; y < H; y += 12) {
      ctx.fillRect(x, y, 1, 1)
    }
  }

  draws.forEach((d) => {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(44,44,44,0.18)'
    ctx.fillRect(d.x * s + ox, d.y * s + oy, Math.max(1, d.w * s), Math.max(1, d.h * s))
  })

  nodes.forEach((n) => {
    const rx = n.x * s + ox, ry = n.y * s + oy
    const rw = Math.max(2, n.w * s), rh = Math.max(2, n.h * s)
    ctx.fillStyle = n.kind === 'space' ? (dark ? 'rgba(255,255,255,0.28)' : '#D9D3C4') : (n.color || '#CFCABF')
    ctx.globalAlpha = n.kind === 'space' ? 0.9 : 0.72
    ctx.fillRect(rx, ry, rw, rh)
    ctx.globalAlpha = 1
    if (props.ui.selection.includes(n.id)) {
      ctx.strokeStyle = dark ? '#EDEBE7' : '#2C2C2C'
      ctx.lineWidth = 1
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
    }
  })

  // 视口框
  const vx = (cam.x - vw / 2) * s + ox
  const vy = (cam.y - vh / 2) * s + oy
  const vwr = vw * s, vhr = vh * s
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(44,44,44,0.75)'
  ctx.lineWidth = 1.2
  ctx.strokeRect(Math.max(1, vx), Math.max(1, vy), Math.min(W - 2, vwr), Math.min(H - 2, vhr))
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(44,44,44,0.05)'
  ctx.fillRect(Math.max(1, vx), Math.max(1, vy), Math.min(W - 2, vwr), Math.min(H - 2, vhr))
}

function jump(e) {
  if (!mapping) return
  const r = el.value.getBoundingClientRect()
  const x = (e.clientX - r.left - mapping.ox) / mapping.s
  const y = (e.clientY - r.top - mapping.oy) / mapping.s
  const cam = props.ws.space.camera
  cam.x = x; cam.y = y
  props.ui.tick++
  invalidate()
  emit('navigate')
  props.ws.saveDebounced()
}
function onDown(e) {
  dragging = true
  el.value.setPointerCapture(e.pointerId)
  jump(e)
}
function onMove(e) { if (dragging) jump(e) }
function onUp(e) {
  dragging = false
  try { el.value.releasePointerCapture(e.pointerId) } catch (err) {}
}

onMounted(() => {
  draw()
  unsub = props.ws.on(() => invalidate())
  timer = setInterval(invalidate, 600)
})
let unsub = null
let timer = null
onUnmounted(() => {
  cancelAnimationFrame(raf)
  unsub && unsub()
  clearInterval(timer)
})
watch(() => [props.ui.tick, props.ui.selection.length, props.ws.currentId], invalidate, { deep: true })
</script>

<template>
  <div class="minimap" :title="'拖动定位画布'">
    <div class="minimap-head">
      <span>全局地图</span>
      <span class="minimap-scale">{{ scale }}%</span>
      <button class="mm-fold" :class="{ closed: collapsed }" :title="collapsed ? '展开地图' : '收起地图'"
        @click="collapsed = !collapsed">
        <span></span>
      </button>
    </div>
    <canvas v-show="!collapsed" ref="el" :style="{ width: W + 'px', height: H + 'px' }" @pointerdown="onDown"
      @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"></canvas>
  </div>
</template>

<style scoped>
.minimap {
  background: var(--sp-card, #FFFFFF); border: 1px solid var(--sp-line, rgba(44,44,44,0.10));
  border-radius: 14px; padding: 8px 8px 9px; box-shadow: 0 18px 40px -26px rgba(0,0,0,0.32);
  backdrop-filter: blur(10px);
}
.minimap-head {
  display: flex; justify-content: space-between; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; color: var(--sp-ink-2, #8A867E);
  text-transform: uppercase; padding: 1px 2px 6px;
}
.minimap-scale { color: var(--sp-ink-3, #B0ACA4); font-weight: 600; letter-spacing: 0; font-size: 10px; margin-left: auto; }
.mm-fold {
  width: 18px; height: 18px; margin-left: 6px; border-radius: 6px; display: grid; place-items: center;
  transition: background .18s ease; flex: none;
}
.mm-fold:hover { background: var(--eo-chip); }
.mm-fold span {
  width: 6px; height: 6px; border-right: 1.5px solid var(--sp-ink-3, #9A968E); border-bottom: 1.5px solid var(--sp-ink-3, #9A968E);
  transform: translateY(-1px) rotate(45deg); transition: transform .22s cubic-bezier(.2,.8,.2,1);
}
.mm-fold.closed span { transform: translateY(2px) rotate(-135deg); }
canvas { display: block; border-radius: 8px; cursor: crosshair; touch-action: none; }
</style>
