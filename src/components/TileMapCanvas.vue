<script setup>
// ===== 瓦片地图组件（Canvas 2D 渲染 · 视口裁剪 · LRU 缓存 · 懒加载）=====
// 只在卡片进入视口时启动渲染循环与瓦片请求；离开视口立即暂停（缓存保留，回来秒开）。
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  TILE_SIZE, clampZoom, lngToWorldX, latToWorldY, worldXToLng, worldYToLat,
  fitZoom, createTileLoader, createPointIndex
} from '../lib/tileMap.js'

const props = defineProps({
  points: { type: Array, default: () => [] },
  // 卡片内缩放倍率（1 ~ 2.4），与画布缩放完全独立
  zoom: { type: Number, default: 1 },
  dark: { type: Boolean, default: false },
  // 内部是否可拖拽平移：false 时整个地图指针穿透（无边框地图卡 → 拖拽 = 移动整张卡片）
  interactive: { type: Boolean, default: true }
})
const emit = defineEmits(['pick', 'zoom'])

const rootEl = ref(null)
const canvasEl = ref(null)
let ctx = null
let raf = 0
let visible = false
let dirty = true
let ro = null
let io = null

const loader = createTileLoader({ max: 180, concurrency: 6 })
let index = createPointIndex([])

// 视图状态：中心经纬度 + 浮点缩放
const view = { lng: 116.397, lat: 39.909, zoom: 5 }
const baseZoom = ref(5)
let dragging = false
let dragStart = null

const pointsKey = computed(() => (props.points || []).map((p) => p.id + ':' + p.lng + ':' + p.lat).join('|'))

function resizeCanvas() {
  const c = canvasEl.value
  const box = rootEl.value
  if (!c || !box) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, box.clientWidth)
  const h = Math.max(1, box.clientHeight)
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  c.style.width = w + 'px'
  c.style.height = h + 'px'
  ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  dirty = true
}

function recenter(keepZoom) {
  const pts = props.points || []
  if (pts.length) {
    let sx = 0, sy = 0
    pts.forEach((p) => { sx += p.lng; sy += p.lat })
    view.lng = sx / pts.length
    view.lat = sy / pts.length
  }
  const box = rootEl.value
  if (!keepZoom && box) baseZoom.value = fitZoom(pts, box.clientWidth, box.clientHeight, 30)
  index = createPointIndex(pts, 2)
  dirty = true
}

function draw() {
  const c = canvasEl.value
  if (!c || !ctx) return
  const box = rootEl.value
  const w = box ? box.clientWidth : 0
  const h = box ? box.clientHeight : 0
  if (!w || !h) return
  const dark = props.dark
  const bg = dark ? '#20201d' : '#F2F1ED'
  const placeholder = dark ? '#2b2a26' : '#E9E7E2'
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const zf = clampZoom(baseZoom.value + Math.log2(Math.max(0.5, props.zoom || 1)))
  const z = Math.max(3, Math.min(19, Math.floor(zf)))
  const s = Math.pow(2, zf - z) // 小数级别 → 像素拉伸
  const scale = s

  const cx = lngToWorldX(view.lng, z)
  const cy = latToWorldY(view.lat, z)
  const halfW = w / (2 * scale)
  const halfH = h / (2 * scale)
  const x0 = cx - halfW
  const y0 = cy - halfH

  // 视口裁剪：只遍历屏幕覆盖到的瓦片（tile rendering + viewport culling）
  const tx0 = Math.floor(x0 / TILE_SIZE)
  const ty0 = Math.floor(y0 / TILE_SIZE)
  const tx1 = Math.floor((x0 + w / scale) / TILE_SIZE)
  const ty1 = Math.floor((y0 + h / scale) / TILE_SIZE)
  const maxTile = Math.pow(2, z)

  let pending = 0
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= maxTile) continue
      const wx = ((tx % maxTile) + maxTile) % maxTile
      const px = (tx * TILE_SIZE - x0) * scale
      const py = (ty * TILE_SIZE - y0) * scale
      const size = TILE_SIZE * scale + 0.6
      const pri = Math.abs(tx - (tx0 + tx1) / 2) + Math.abs(ty - (ty0 + ty1) / 2)
      const it = visible ? loader.request(z, wx, ty, pri) : loader.get(z, wx, ty)
      if (it && it.state === 'ok') {
        try { ctx.drawImage(it.img, px, py, size, size) } catch (e) { ctx.fillStyle = placeholder; ctx.fillRect(px, py, size, size) }
      } else {
        if (!it || it.state !== 'error') pending++
        ctx.fillStyle = placeholder
        ctx.fillRect(px, py, size, size)
      }
    }
  }

  // 深色主题：瓦片压暗，避免整块亮白刺眼
  if (dark) {
    ctx.fillStyle = 'rgba(18, 18, 17, 0.42)'
    ctx.fillRect(0, 0, w, h)
  }

  // 点位：空间索引只取视口内的
  const minLng = worldXToLng(x0, z), maxLng = worldXToLng(x0 + w / scale, z)
  const maxLat = worldYToLat(y0, z), minLat = worldYToLat(y0 + h / scale, z)
  const pins = index.query(minLng, minLat, maxLng, maxLat)
  const r = 4
  pins.forEach((p) => {
    const px = (lngToWorldX(p.lng, z) - x0) * scale
    const py = (latToWorldY(p.lat, z) - y0) * scale
    ctx.beginPath()
    ctx.arc(px, py, r + 2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = '#2C2C2C'
    ctx.fill()
    if (p.name && pins.length <= 14) {
      ctx.font = '600 9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      const label = String(p.name).slice(0, 8)
      const tw = ctx.measureText(label).width
      const bx = Math.min(w - tw - 10, Math.max(2, px - tw / 2 - 4))
      const by = Math.max(2, py - 18)
      ctx.fillStyle = dark ? 'rgba(44, 44, 44, .86)' : 'rgba(28,28,30,.86)'
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(bx, by, tw + 8, 13, 4) : ctx.rect(bx, by, tw + 8, 13)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(label, bx + 4, by + 9.5)
    }
  })

  // 无点位：中心十字提示
  if (!pins.length && !(props.points || []).length) {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.22)' : 'rgba(44, 44, 44, .12)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(w / 2 - 8, h / 2); ctx.lineTo(w / 2 + 8, h / 2)
    ctx.moveTo(w / 2, h / 2 - 8); ctx.lineTo(w / 2, h / 2 + 8); ctx.stroke()
  }
  return pending
}

function loop() {
  if (!visible) { raf = 0; return }
  if (dirty) { dirty = false; draw() }
  raf = requestAnimationFrame(loop)
}

function kick() { dirty = true; if (visible && !raf) raf = requestAnimationFrame(loop) }

// 瓦片到货 → 重绘
loader.onUpdate(() => { if (visible) kick() })

// ---- 滚轮缩放（仅地图模式）：不冒泡到画布，避免缩放整张画布 ----
function onWheelZoom(e) {
  if (!props.interactive) return
  e.preventDefault()
  e.stopPropagation()
  const next = Math.round((Number(props.zoom || 1) + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10
  emit('zoom', Math.max(1, Math.min(2.4, next)))
}

// ---- 拖拽平移（不冒泡到画布，避免拖动卡片）----
function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return
  dragging = true
  dragStart = { x: e.clientX, y: e.clientY, lng: view.lng, lat: view.lat }
  const move = (ev) => {
    if (!dragging) return
    const box = rootEl.value
    if (!box) return
    const zf = clampZoom(baseZoom.value + Math.log2(Math.max(0.5, props.zoom || 1)))
    const z = Math.max(3, Math.min(19, Math.floor(zf)))
    const scale = Math.pow(2, zf - z)
    const dLng = -((ev.clientX - dragStart.x) / scale) / (TILE_SIZE * Math.pow(2, z)) * 360
    const dLatPx = (ev.clientY - dragStart.y) / scale
    const lat0 = latToWorldY(dragStart.lat, z) - dLatPx
    view.lng = dragStart.lng + dLng
    view.lat = worldYToLat(lat0, z)
    dirty = true
  }
  const up = () => {
    dragging = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

onMounted(async () => {
  await nextTick()
  resizeCanvas()
  recenter(false)
  // 卡片尺寸变化：画布随卡片实时重算，并重新适配缩放层级，
  // 保证地图在拖拽改变卡片大小时「始终铺满、永不溢出」。
  ro = new ResizeObserver(() => {
    resizeCanvas()
    refitZoom()
    kick()
  })
  if (rootEl.value) ro.observe(rootEl.value)
  // 懒加载：只有卡片进入视口才启动渲染与瓦片请求
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      visible = en.isIntersecting
      if (visible) kick()
      else if (raf) { cancelAnimationFrame(raf); raf = 0 }
    })
  }, { root: null, rootMargin: '160px', threshold: 0.01 })
  if (rootEl.value) io.observe(rootEl.value)
  kick()
})

// 用户手动缩放过（zoom ≠ 1）时保留其视角，只在未干预时自动重新适配
let userZoomed = false
function refitZoom() {
  if (userZoomed) return
  const box = rootEl.value
  if (!box) return
  const w = box.clientWidth, h = box.clientHeight
  if (!w || !h) return
  const fit = fitZoom(props.points || [], w, h, 30)
  if (fit && isFinite(fit)) baseZoom.value = fit
  dirty = true
}

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
  if (io) io.disconnect()
  loader.clear()
})

watch(pointsKey, () => { recenter(false); kick() })
watch(() => props.zoom, (v) => { userZoomed = Number(v || 1) !== 1; kick() })
watch(() => props.dark, () => kick())
</script>

<template>
  <div ref="rootEl" class="tm-root" :class="{ 'tm-dead': !interactive }" @pointerdown.stop="onDown" @wheel="onWheelZoom" @dblclick.stop @click.stop>
    <canvas ref="canvasEl" class="tm-canvas"></canvas>
  </div>
</template>

<style scoped>
.tm-root { position: absolute; inset: 0; overflow: hidden; cursor: grab; touch-action: none; border-radius: inherit; }
.tm-root:active { cursor: grabbing; }
/* 非交互模式（无边框地图卡）：指针完全穿透，拖拽事件交给卡片根节点 → 整卡移动 */
.tm-dead { pointer-events: none; cursor: default; }
.tm-canvas { display: block; width: 100%; height: 100%; }
</style>
