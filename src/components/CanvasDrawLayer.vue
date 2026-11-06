<script setup>
// ===== 绘图层（ArcMind 画笔 / 形状 / 抬笔成型 / 图层） =====
// 渲染于画布 .wb-layer 内（与节点同坐标空间），仅在 drawMode 激活时捕获指针。
import { ref, computed, shallowRef, triggerRef } from 'vue'
import { useAppStore } from '../stores/app.js'

const props = defineProps({
  spaceId: { type: [String, null], default: null },
  tool: { type: String, default: 'pen' },
  color: { type: String, default: '#2C2C2C' },
  width: { type: Number, default: 3 },
  opacity: { type: Number, default: 1 },
  recognize: { type: Boolean, default: true },
  scale: { type: Number, default: 1 }
})
const store = useAppStore()
const rootEl = ref(null)
const drawings = computed(() =>
  store.data.whiteboardDrawings.filter((d) => !d.deletedAt && (d.spaceId || null) === (props.spaceId || null))
)
const selectedId = ref(null)

function toCanvas(e) {
  const r = rootEl.value.getBoundingClientRect()
  // 返回 [x, y] 数组，与 model.js 中 whiteboardDrawings.pts 的存储格式（[x,y] 数组）保持一致，
  // 否则 pathOf()/near()/recognizeShape() 按数组下标取点会读到 undefined 而抛 toFixed 异常。
  return [(e.clientX - r.left) / props.scale, (e.clientY - r.top) / props.scale]
}
// cur 必须是响应式：否则拖拽过程中的新点不会触发模板重渲染 → 笔迹「松手才出现」（无实时预览）
const cur = shallowRef(null)
let sid = null
function onDown(e) {
  e.stopPropagation(); e.preventDefault()
  if (e.button !== 0) return
  const p = toCanvas(e)
  if (props.tool === 'erase') { eraseAt(p); sid = 'erase'; return }
  // x1/y1/x2/y2 用数组下标取值（toCanvas 返回 [x, y]）——形状工具（直线/矩形/圆/星/叶刀）依赖这四个字段
  cur.value = { id: null, tool: props.tool, color: props.color, width: props.width, opacity: props.opacity, pts: [p], x1: p[0], y1: p[1], x2: p[0], y2: p[1] }
  triggerRef(cur)
  sid = 'draw'
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function onMove(e) {
  if (props.tool === 'erase') { eraseAt(toCanvas(e)); return }
  if (!cur.value) return
  const p = toCanvas(e)
  if (cur.value.tool === 'pen' || cur.value.tool === 'hl' || cur.value.tool === 'fountain' || cur.value.tool === 'pencil' || cur.value.tool === 'laser') cur.value.pts.push(p)
  else { cur.value.x2 = p[0]; cur.value.y2 = p[1] }
  triggerRef(cur) // 实时重渲染：每一笔移动都立刻反映到 SVG path
}
function onUp() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  if (props.tool === 'erase') { sid = null; return }
  if (!cur.value) return
  let d = cur.value
  if (props.recognize && (d.tool === 'pen' || d.tool === 'fountain' || d.tool === 'pencil')) d = recognizeShape(d)
  const r = store.addWhiteboardDrawing(Object.assign({}, d, { spaceId: props.spaceId || null }))
  if (r.ok) selectedId.value = r.drawing.id
  cur.value = null; sid = null
}
function eraseAt(p) {
  drawings.value.forEach((d) => {
    if (near(d, p)) store.deleteWhiteboardDrawing(d.id)
  })
}
function near(d, p) {
  if (d.tool === 'pen' || d.tool === 'hl' || d.tool === 'erase' || d.tool === 'fountain' || d.tool === 'pencil' || d.tool === 'laser') {
    return (d.pts || []).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 8)
  }
  const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2
  const rx = Math.abs(d.x2 - d.x1) / 2 + 6, ry = Math.abs(d.y2 - d.y1) / 2 + 6
  return Math.abs(p[0] - cx) < rx && Math.abs(p[1] - cy) < ry
}
// 抬笔成型：手绘近似识别为 直线 / 圆 / 矩形
function recognizeShape(d) {
  const pts = d.pts
  if (pts.length < 4) return d
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x1 = xs[0], y1 = ys[0], x2 = xs[xs.length - 1], y2 = ys[ys.length - 1]
  const len = Math.hypot(x2 - x1, y2 - y1)
  // 直线：所有点到首尾连线的最大偏差很小
  let maxDev = 0
  pts.forEach((p) => { maxDev = Math.max(maxDev, distToSeg(p, [x1, y1], [x2, y2])) })
  if (len > 20 && maxDev < len * 0.12) {
    return Object.assign({}, d, { tool: 'line', x1, y1, x2, y2, pts: [] })
  }
  const closed = Math.hypot(x2 - x1, y2 - y1) < 24
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs)
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const ar = (maxX - minX) / Math.max(1, maxY - minY)
  if (closed) {
    // 圆：各点到质心距离方差小，且接近正方形
    const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length
    const variance = dists.reduce((a, b) => a + (b - mean) * (b - mean), 0) / dists.length
    if (ar > 0.6 && ar < 1.6 && Math.sqrt(variance) < mean * 0.28) {
      const r = (maxX - minX) / 2
      return Object.assign({}, d, { tool: 'circle', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, pts: [] })
    }
    // 矩形：四角明显
    if (ar > 0.4 && ar < 2.6) {
      return Object.assign({}, d, { tool: 'rect', x1: minX, y1: minY, x2: maxX, y2: maxY, pts: [] })
    }
  }
  return d
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = Math.hypot(dx, dy) || 1
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L)
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
function pathOf(d) {
  if (d.tool === 'pen' || d.tool === 'hl' || d.tool === 'erase' || d.tool === 'fountain' || d.tool === 'pencil' || d.tool === 'laser') {
    if (!d.pts || !d.pts.length) return ''
    return 'M' + d.pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L')
  }
  const { x1, y1, x2, y2 } = d
  if (d.tool === 'line') return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2
  if (d.tool === 'rect') return 'M' + x1 + ' ' + y1 + ' H' + x2 + ' V' + y2 + ' H' + x1 + ' Z'
  if (d.tool === 'circle') { const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2; return 'M' + (cx - rx) + ' ' + cy + ' a' + rx + ' ' + ry + ' 0 1 0 ' + (rx * 2) + ' 0 a' + rx + ' ' + ry + ' 0 1 0 ' + (-rx * 2) + ' 0' }
  if (d.tool === 'tri') { const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2; const w = x2 - x1, h = y2 - y1; return 'M' + x1 + ' ' + y2 + ' L' + (cx) + ' ' + y1 + ' L' + x2 + ' ' + y2 + ' Z' }
  if (d.tool === 'star') { return starPath(x1, y1, x2, y2) }
  if (d.tool === 'scalpel') { return scalpelPath(x1, y1, x2, y2) }
  return ''
}
function starPath(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
  const R = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2
  const r = R * 0.45
  let p = ''
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5
    const rad = i % 2 === 0 ? R : r
    p += (i === 0 ? 'M' : ' L') + (cx + rad * Math.cos(ang)).toFixed(1) + ' ' + (cy + rad * Math.sin(ang)).toFixed(1)
  }
  return p + ' Z'
}
// 柳叶刀（willow-blade / 叶形填色）：以起止点为长轴两端，两侧外凸成叶
function scalpelPath(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const bulge = len * 0.3
  const m1x = cx + nx * bulge, m1y = cy + ny * bulge
  const m2x = cx - nx * bulge, m2y = cy - ny * bulge
  return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q' + m1x.toFixed(1) + ' ' + m1y.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' Q' + m2x.toFixed(1) + ' ' + m2y.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Z'
}
function strokeStyle(d) {
  if (d.tool === 'hl') return { stroke: d.color, 'stroke-width': Math.max(8, d.width * 4), 'stroke-opacity': 0.28, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  if (d.tool === 'erase') return { stroke: '#FFFCF4', 'stroke-width': 2, 'stroke-dasharray': '4 3', fill: 'none' }
  if (d.tool === 'fountain') return { stroke: d.color, 'stroke-width': Math.max(2, d.width), 'stroke-opacity': d.opacity, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  if (d.tool === 'pencil') return { stroke: d.color, 'stroke-width': Math.max(1, d.width * 0.6), 'stroke-opacity': Math.min(1, d.opacity * 0.85), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  if (d.tool === 'laser') return { stroke: d.color, 'stroke-width': Math.max(1.5, d.width * 0.7), 'stroke-opacity': 0.9, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'drop-shadow(0 0 3px ' + d.color + ')' }
  if (d.tool === 'scalpel') return { stroke: d.color, 'stroke-width': 1.5, fill: d.color, 'fill-opacity': 0.45, 'stroke-opacity': 0.9, 'stroke-linejoin': 'round' }
  return { stroke: d.color, 'stroke-width': d.width, 'stroke-opacity': d.opacity, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
}
function selectDrawing(id) {
  if (props.tool !== 'erase') selectedId.value = id
}
function deleteSelected() {
  if (selectedId.value) { store.deleteWhiteboardDrawing(selectedId.value); selectedId.value = null }
}
function clearSpace() {
  drawings.value.forEach((d) => store.deleteWhiteboardDrawing(d.id))
  selectedId.value = null
}
defineExpose({ deleteSelected, clearSpace })
</script>

<template>
  <div ref="rootEl" class="eo-draw" @pointerdown="onDown" style="position:absolute; left:0; top:0; width:200000px; height:200000px; overflow:visible; touch-action:none;">
    <svg width="10" height="10" style="overflow:visible; position:absolute; left:0; top:0; pointer-events:none;">
      <path v-for="d in drawings" :key="d.id"
        :d="pathOf(d)" :style="strokeStyle(d)"
        :stroke="d.id === selectedId ? '#8A8884' : undefined"
        @pointerdown.stop="selectDrawing(d.id)" />
      <path v-if="cur && cur.tool!=='erase'" :d="pathOf(cur)" :style="strokeStyle(cur)" />
    </svg>
  </div>
</template>

<style scoped>
.eo-draw { cursor: crosshair; z-index: 30; }
</style>
