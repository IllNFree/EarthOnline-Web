<script setup>
// ===== 画布主页（v2.3.0 纠偏版）：无限画布 + 多级空间（Space）架构 + 3D 文件夹动效 +
// 节点级堆叠（悬停 1.2s 合并 / 滚轮翻页 / 右键打散）+ 智能排版（树 / 网格 / 放射）+ 扁平模式 =====
import { ref, computed, reactive, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useRouter } from 'vue-router'
import { useDialogStore } from '../stores/dialog.js'
import EntityNode from '../components/EntityNode.vue'
import { dedupHomeNodes } from '../lib/dedupHome.js'
import CanvasCreateSheet from '../components/CanvasCreateSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/GlassBottomSheet.vue'
import { openContextMenu } from '../composables/useContextMenu.js'
import { registerCanvas, unregisterCanvas, consumeCanvasFocus } from '../services/canvasBridge.js'
import { CANVAS_PANELS } from '../lib/model.js'
import { STACK_DX, STACK_DY } from '../lib/model.js'
import { dragGuard } from '../lib/dragGuard.js'
import { PANEL_ORIGIN_X } from '../lib/ops.js'
import { gotoEntity } from '../services/CanvasNavigator.js'
import { incubateFile } from '../services/FileNodeFactory.js'
import { exportCanvas } from '../composables/useHtmlExport.js'
import { refreshData, openGlobalSearch, backupNow } from '../services/globalActions.js'
import { requestLayout, isWorkerLayoutEnabled } from '../lib/layoutClient.js'
import { computeLayout } from '../lib/layoutEngine.js'
import CanvasDrawLayer from '../components/CanvasDrawLayer.vue'
import CanvasCommandPalette from '../components/CanvasCommandPalette.vue'
import StackDrawer from '../components/StackDrawer.vue'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const router = useRouter()
const dialog = useDialogStore()
const viewport = ref(null)

// ---- 画布变换 ----
const panX = ref(0)
const panY = ref(0)
const scale = ref(1)
const ZOOM_MIN = 0.2
const ZOOM_MAX = 2.5
const spaceDown = ref(false)

// ---- 网格 / 磁吸辅助线（只画参考线，绝不推动任何其它卡片）----
const GRID = 4
const snap = (v) => Math.round(v / GRID) * GRID
const SNAP_GAP = 7
const animating = ref(false)

// ---- 空间（Space）架构 ----
const currentSpaceId = ref(null)
const spaceAnim = ref('') // '' | 'in' | 'out' 控制 3D 文件夹开合动效
const flatMode = ref(!!store.data.flatMode)

const allNodes = computed(() => store.data.whiteboardNodes.filter((n) => !n.deletedAt))
const allSpaces = computed(() => store.data.spaces.filter((s) => !s.deletedAt))
// 当前空间内可见节点：spaceId 等于当前空间（null ⇄ 枢纽根层）
const spaceNodes = computed(() => allNodes.value.filter((n) => (n.spaceId || null) === (currentSpaceId.value || null)))
const childSpaces = computed(() => allSpaces.value.filter((s) => (s.parentId || null) === (currentSpaceId.value || null)))
const visibleNodes = spaceNodes // 别名：连线 / 命中 / 渲染共用

// ---- 视口裁剪 + 空间索引（红线：屏幕外节点跳过渲染，保障大规模节点帧率）----
const cullEnabled = ref(true)
const CULL_MARGIN = 260
const CELL = 600
// 当前视口在画布坐标系下的矩形（含外扩边距）
const cullRect = computed(() => {
  const vp = viewport.value
  const w = vp ? vp.clientWidth : (window.innerWidth || 1280)
  const h = vp ? vp.clientHeight : (window.innerHeight || 800)
  const minX = (-panX.value) / scale.value - CULL_MARGIN
  const minY = (-panY.value) / scale.value - CULL_MARGIN
  const maxX = (w - panX.value) / scale.value + CULL_MARGIN
  const maxY = (h - panY.value) / scale.value + CULL_MARGIN
  return { minX, minY, maxX, maxY }
})
// 空间网格索引：cellKey -> nodeId[]（仅按绝对包围盒建索引）
const spatialIndex = computed(() => {
  const idx = new Map()
  spaceNodes.value.forEach((n) => {
    const p = absOf(n)
    const x0 = Math.floor(p.x / CELL), y0 = Math.floor(p.y / CELL)
    const x1 = Math.floor((p.x + n.w) / CELL), y1 = Math.floor((p.y + n.h) / CELL)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx + ',' + cy
      if (!idx.has(k)) idx.set(k, [])
      idx.get(k).push(n.id)
    }
  })
  return idx
})
// home 空间同类实体节点智能去重：同类型（且均为实体关联节点）≥2 张时，
// 自动合并为一张可滚动「总览卡」，杜绝同类型卡片满屏铺开。
const dedupedNodes = computed(() => dedupHomeNodes(spaceNodes.value, currentSpaceId.value))
// 实际渲染节点：空间索引查询视口覆盖的格子，跳过屏幕外节点
const renderedNodes = computed(() => {
  const base = dedupedNodes.value
  if (!cullEnabled.value) return base
  const r = cullRect.value
  const cells = new Set()
  const x0 = Math.floor(r.minX / CELL), y0 = Math.floor(r.minY / CELL)
  const x1 = Math.floor(r.maxX / CELL), y1 = Math.floor(r.maxY / CELL)
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const arr = spatialIndex.value.get(cx + ',' + cy)
    if (arr) arr.forEach((id) => cells.add(id))
  }
  return base.filter((n) => cells.has(n.id))
})
// 当前空间链（面包屑）
const breadcrumb = computed(() => {
  const chain = []
  let id = currentSpaceId.value
  while (id) {
    const sp = allSpaces.value.find((s) => s.id === id)
    if (!sp) break
    chain.unshift({ id: sp.id, name: sp.name, emoji: sp.emoji })
    id = sp.parentId
  }
  chain.unshift({ id: null, name: '空间枢纽', emoji: '🏠' })
  return chain
})
const currentSpace = computed(() => currentSpaceId.value ? allSpaces.value.find((s) => s.id === currentSpaceId.value) : null)

function spaceNodeCount(sid) { return allNodes.value.filter((n) => (n.spaceId || null) === sid).length }
function spaceChildCount(sid) { return allSpaces.value.filter((s) => (s.parentId || null) === sid).length }

// ---- 节点绝对坐标（含堆叠偏移）----
// v2.2.5 视觉降维：无论组内多少张，最多只渲染「顶层 + 2 层」= 3 张卡的错位边缘，
// 其余卡片不再向外偏移，改用实心错位阴影暗示纸堆厚度。
const STACK_VISIBLE_LEVELS = 2
// 组内层级由 stackIdx 唯一决定（0 = 组顶），排序稳定 → 翻页时不会出现顺序漂移
function topOf(stackId) {
  const list = stackNodes(stackId)
  if (!list.length) return null
  const t = topById(stackId)
  return t || list[0]
}
function topById(stackId) {
  const id = stackTop[stackId]
  if (!id) return null
  return stackNodes(stackId).find((n) => n.id === id) || null
}
function stackNodes(stackId) {
  return spaceNodes.value
    .filter((n) => n.stackId === stackId)
    .sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
}
const stackTop = reactive({})
function isStackTop(n) {
  if (!n.stackId) return false
  const list = stackNodes(n.stackId)
  if (list.length < 2) return false
  const t = topOf(n.stackId)
  return !!t && t.id === n.id
}
// 千层饼：下层卡与组顶同宽，层层错位才能看出「叠了几张」
function stackTopW(n) {
  if (!n.stackId) return n.w
  const t = topOf(n.stackId)
  return t ? t.w : n.w
}
// v2.2.4：下层卡与组顶同高，堆叠组边界整齐划一
function stackTopH(n) {
  if (!n.stackId) return n.h
  const t = topOf(n.stackId)
  return t ? t.h : n.h
}
function isBeneathNode(n) {
  if (!n.stackId) return false
  const list = stackNodes(n.stackId)
  if (list.length < 2) return false
  const t = topOf(n.stackId)
  return !!t && t.id !== n.id
}
// ---- 堆叠层级：纯「环序」推导（成熟卡片堆叠库标准做法：order[0]=顶层，位置 = 层级 × 固定步进）----
// 翻页只是旋转这个环，几何 100% 由「当前顶层 + 层级」决定，与翻页方向无关 → 上下滚轮必然一致。
function stackOrder(sid) {
  const ring = stackRingOf(sid)
  const topId = stackTop[sid] || ring[0]
  const ti = ring.indexOf(topId)
  if (ti <= 0) return ring.slice()
  return ring.slice(ti).concat(ring.slice(0, ti))
}
function stackLevelOf(n) {
  if (!n.stackId) return 0
  const order = stackOrder(n.stackId)
  const i = order.indexOf(n.id)
  return i < 0 ? Math.max(0, n.stackIdx || 0) : i
}
// 渲染偏移：只由「层级」决定，相对顶层卡做固定对角线错位。不依赖任何存储坐标，
// 即使存储坐标被某次合并 / 归一化写歪，渲染也始终工整 —— 上下滚轮翻页后几何恒等。
function stackOffsetOf(n) {
  if (!n.stackId) return null
  const lvl = stackLevelOf(n)
  if (lvl === 0) return null
  const k = Math.min(STACK_VISIBLE_LEVELS, lvl)
  return { x: k * STACK_DX, y: k * STACK_DY }
}
// v2.2.5：超过可见层数的最深层（层级 > 2）不再渲染，仅保留可见层的错位边缘
function isStackDeep(n) {
  return !!n.stackId && stackLevelOf(n) > STACK_VISIBLE_LEVELS
}
function isStackEdge(n) {
  if (!n.stackId) return false
  const list = stackNodes(n.stackId)
  return list.length > STACK_VISIBLE_LEVELS + 1 && stackLevelOf(n) === STACK_VISIBLE_LEVELS
}
function stackCountOf(n) {
  return n && n.stackId ? (stackCountMap.value.get(n.stackId) || 0) : 0
}
// 绝对坐标：顶层卡停在自身存储位置（组锚点），其余卡 = 组顶 + 层级 × 对角步进
function absOf(n) {
  if (!n.stackId) return { x: n.x, y: n.y }
  const lvl = stackLevelOf(n)
  if (lvl === 0) return { x: n.x, y: n.y }
  const top = topOf(n.stackId)
  if (!top) return { x: n.x, y: n.y }
  const k = Math.min(STACK_VISIBLE_LEVELS, lvl)
  return { x: top.x + k * STACK_DX, y: top.y + k * STACK_DY }
}
function posOf(n) { return absOf(n) }
const absMap = computed(() => {
  const m = new Map()
  spaceNodes.value.forEach((n) => { m.set(n.id, absOf(n)) })
  return m
})
// 每个堆叠组的卡片总数（角标 / 抽屉共用，一次遍历算完）
const stackCountMap = computed(() => {
  const m = new Map()
  spaceNodes.value.forEach((n) => {
    if (!n.stackId) return
    m.set(n.stackId, (m.get(n.stackId) || 0) + 1)
  })
  return m
})
// 实际渲染节点：堆叠组「全部成员」始终进入 DOM（最深层靠 CSS 透明遮挡），
// 这样翻页时离顶卡 / 入顶卡都有「上一帧位置」可做位移 + 透明度过渡，
// 上滚轮与下滚轮翻页才会呈现完全一致的「正面滑向背面 / 背面滑入正面」动画。
// 仅屏幕外节点仍由 renderedNodes 裁剪，不参与堆叠的零散卡不受影响。
const visibleRenderNodes = computed(() => renderedNodes.value)

const layerStyle = computed(() => ({
  transform: 'translate(' + panX.value + 'px,' + panY.value + 'px) scale(' + scale.value + ')'
}))
// 卡片实色度：跟随「设置 → 外观 → 卡片不透明度」，但整体抬到 0.62~1 区间，
// 保证 ArcMind 式的实色卡观感（不会因为底层设置过低而互相透出内容）
const cardAlpha = computed(() => {
  const v = Number(store.data.cardAlpha)
  const base = isFinite(v) && v > 0 ? Math.min(1, Math.max(0.3, v)) : 0.8
  return Math.min(1, 0.62 + base * 0.38)
})
// 画布底图背景已还原为独立「足迹地图」页（/map，侧栏「足迹」可达）；主页以无边框地图卡片呈现（见 ARCMIND_HOME 的 map 面板）
const spaceAnimClass = computed(() => spaceAnim.value ? 'wb-space-' + spaceAnim.value : '')

const COLOR_KEYS = [
  { key: 'amber', label: '杏' }, { key: 'blue', label: '蓝' }, { key: 'pink', label: '粉' },
  { key: 'green', label: '绿' }, { key: 'purple', label: '紫' }, { key: 'gray', label: '灰' }
]


// ---- 自动配色（多选一键分配协调色 / 内置方案）----
const COLOR_SCHEMES = [
  { key: 'cool', label: '静谧', colors: ['blue', 'purple', 'green', 'gray', 'amber', 'pink'] },
  { key: 'fresh', label: '清新', colors: ['green', 'blue', 'amber', 'gray', 'purple', 'pink'] },
  { key: 'mono', label: '单色', colors: ['gray', 'gray', 'gray', 'gray', 'gray', 'gray'] },
  { key: 'warm', label: '缤纷', colors: ['amber', 'pink', 'purple', 'green', 'blue', 'gray'] }
]
const colorSchemeKey = ref('cool')
const colorOpen = ref(false)
function autoColorSelected() {
  const ids = Array.from(selected.value)
  if (!ids.length) { store.showToast('先框选或 Shift 多选卡片，再一键配色'); return }
  const sch = COLOR_SCHEMES.find((s) => s.key === colorSchemeKey.value) || COLOR_SCHEMES[0]
  const colors = sch.colors
  // 取节点画布坐标，按位置从左到右、从上到下排序，保证近邻优先分配到不同色
  const pos = {}
  ids.forEach((id) => {
    const n = store.data.whiteboardNodes.find((x) => x.id === id)
    pos[id] = { x: n && typeof n.x === 'number' ? n.x : 0, y: n && typeof n.y === 'number' ? n.y : 0 }
  })
  const order = [...ids].sort((a, b) => (pos[a].x - pos[b].x) || (pos[a].y - pos[b].y))
  const assigned = {}
  const used = {}
  colors.forEach((c) => { used[c] = 0 })
  const NEAR = 240 // 视为相邻的画布距离阈值
  order.forEach((id) => {
    const p = pos[id]
    let best = colors[0], bestScore = -Infinity
    for (const c of colors) {
      let penalty = used[c] * 0.4 // 全局均衡：避免某色过度集中
      for (const other of order) {
        if (other === id || !assigned[other]) continue
        const op = pos[other]
        const d = Math.hypot(op.x - p.x, op.y - p.y)
        if (d < NEAR && assigned[other] === c) penalty += ((NEAR - d) / NEAR) * 3 // 近邻同色重罚
      }
      const score = -penalty
      if (score > bestScore) { bestScore = score; best = c }
    }
    assigned[id] = best
    used[best]++
  })
  store.pushHistory()
  ids.forEach((id) => store.updateWhiteboardNode(id, { color: assigned[id] }))
  store.showToast('已为 ' + ids.length + ' 张卡片智能分配「' + sch.label + '」配色（相邻不重复）')
  colorOpen.value = false
}
const selectedNode = ref(null)
const flashingId = ref(null)
const connectMode = ref(false)
const linkSource = ref(null)
const createOpen = ref(false)
const createPos = ref({ x: 0, y: 0 })
const selectMode = ref(false)

// 磁吸辅助线（拖拽时显示，贯穿画布的参考线）
const guideV = ref([])
const guideH = ref([])
const boxSel = ref({ active: false, x0: 0, y0: 0, x1: 0, y1: 0 })
const selected = ref(new Set())
const selectedSpaceId = ref(null)

// 画布锁定（2026-11-03 接通 UI + 持久化）：锁定后节点不可拖拽 / 缩放 / 编辑 / 删除，仅可平移缩放画布
const LOCK_KEY = 'eo_canvas_locked'
const canvasLocked = ref(false)
try { canvasLocked.value = localStorage.getItem(LOCK_KEY) === '1' } catch (e) {}
const minimapOn = ref(true)
// 扁平模式：切换 body 类，关闭阴影 / 毛玻璃 / 3D 悬浮
watch(flatMode, (v) => {
  document.body.classList.toggle('eo-flat', v)
  persistFlat(v)
})
onMounted(() => { document.body.classList.toggle('eo-flat', flatMode.value) })
onUnmounted(() => { document.body.classList.remove('eo-flat') })
function persistFlat(v) {
  store.data.flatMode = !!v
  store.persist()
}

// ---- 小地图 ----
const miniView = computed(() => {
  const ns = spaceNodes.value
  if (!ns.length) return { nodes: [], vp: null, W: 0, H: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  ns.forEach((n) => {
    const p = absOf(n)
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.w); maxY = Math.max(maxY, p.y + n.h)
  })
  const vp = viewport.value
  let vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0
  if (vp) {
    vx0 = (-panX.value) / scale.value; vy0 = (-panY.value) / scale.value
    vx1 = (vp.clientWidth - panX.value) / scale.value; vy1 = (vp.clientHeight - panY.value) / scale.value
    minX = Math.min(minX, vx0); minY = Math.min(minY, vy0)
    maxX = Math.max(maxX, vx1); maxY = Math.max(maxY, vy1)
  }
  const pad = 40
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const W = maxX - minX, H = maxY - minY
  const norm = (x, y, w, h) => ({ x: (x - minX) / W, y: (y - minY) / H, w: w / W, h: h / H })
  return {
    W, H,
    nodes: ns.map((n) => { const p = absOf(n); return norm(p.x, p.y, n.w, n.h) }),
    vp: norm(vx0, vy0, vx1 - vx0, vy1 - vy0)
  }
})
function minimapJump(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const nx = (e.clientX - r.left) / r.width
  const ny = (e.clientY - r.top) / r.height
  const vp = viewport.value; if (!vp || !miniView.value.W) return
  const minX = (-panX.value) / scale.value - 40
  const minY = (-panY.value) / scale.value - 40
  const W = miniView.value.W, H = miniView.value.H
  const cx = minX + nx * W, cy = minY + ny * H
  panX.value = vp.clientWidth / 2 - cx * scale.value
  panY.value = vp.clientHeight / 2 - cy * scale.value
}

// ---- 全局快捷键 ----
function isTyping(e) {
  const t = e.target
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
}
function onGlobalKey(e) {
  if (isTyping(e)) return
  // 斜杠唤起 AI 命令面板
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openAI(); return }
  const mod = e.metaKey || e.ctrlKey
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); store.redo(); return }
  // 成熟画布标配快捷键（对齐 tldraw / Excalidraw）：全选 / 复制 / 粘贴 / 副本
  if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAllNodes(); return }
  if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelectedNodes(); return }
  // Ctrl+V：有内部复制的节点就粘贴节点；否则放行原生 paste 事件
  // （onWindowPaste 会把系统剪贴板里的图片 / 文本粘成画布卡片，Excalidraw / tldraw 标配）
  if (mod && (e.key === 'v' || e.key === 'V')) {
    if (nodeClipboard.value.length) { e.preventDefault(); pasteCopiedNodes() }
    return
  }
  if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelectedNodes(); return }
  // 方向键微移（Shift=大步长 20px，默认 4px 与网格吸附一致）
  if (e.key.startsWith('Arrow')) { nudgeSelectedNodes(e); return }
  if (e.key === 'Escape') {
    if (currentSpaceId.value) { e.preventDefault(); goRoot(); return }
  }
  // Enter：选中空间卡片时进入该空间
  if (e.key === 'Enter' && selectedSpaceId.value) { e.preventDefault(); enterSpace(selectedSpaceId.value); selectedSpaceId.value = null; return }
  // Backspace：无选中节点时作为「返回上一级空间」；有选中 / 框选时仍是删除
  if (e.key === 'Backspace') {
    if (!selectedNode.value && !selected.value.size && currentSpaceId.value) { e.preventDefault(); goUp(); return }
    if (canvasLocked.value) return
    if (selected.value.size) { deleteSelected(Array.from(selected.value)); e.preventDefault(); return }
    if (selectedNode.value) { deleteNode(selectedNode.value); e.preventDefault(); return }
  }
  if (e.key === 'Delete') {
    if (canvasLocked.value) return
    if (selected.value.size) { deleteSelected(Array.from(selected.value)); e.preventDefault(); return }
    if (selectedNode.value) { deleteNode(selectedNode.value); e.preventDefault(); return }
  }
}
function deleteNode(n) {
  if (!n || n.pinned) return
  store.snapshotTimeMachine('删除节点前')
  store.pushHistory()
  store.deleteWhiteboardNode(n.id)
  selectedNode.value = null
}
function deleteSelected(ids) {
  if (!ids || !ids.length) return
  store.snapshotTimeMachine('批量删除前')
  store.pushHistory()
  ids.forEach((id) => { const n = store.data.whiteboardNodes.find((x) => x.id === id); if (n && !n.pinned) store.deleteWhiteboardNode(id) })
  selected.value = new Set()
  store.showToast('已删除 ' + ids.length + ' 个节点')
}
function toggleLock() {
  canvasLocked.value = !canvasLocked.value
  try { localStorage.setItem(LOCK_KEY, canvasLocked.value ? '1' : '0') } catch (e) {}
  if (canvasLocked.value) selected.value = new Set()
  store.showToast(canvasLocked.value ? '画布已锁定（仅可平移 / 缩放）' : '画布已解锁')
}
// ---- 网格显示 + 网格吸附（Excalidraw 标配）----
const gridOn = ref(false)
function toggleGrid() {
  gridOn.value = !gridOn.value
  store.showToast(gridOn.value ? '网格已开启（拖拽落位自动吸附 20px 网格）' : '网格已关闭')
}
// 开启网格时的落位吸附步长
function snapGrid(v) {
  const g = gridOn.value ? 20 : 4
  return Math.round(v / g) * g
}

// ---- 成熟画布标配：全选 / 复制 / 粘贴 / 副本 / 微移（对齐 tldraw / Excalidraw）----
function pickSelectionIds() {
  if (selected.value.size) return Array.from(selected.value)
  if (selectedNode.value) return [selectedNode.value.id]
  return []
}
function pickSelectionNodes() {
  return pickSelectionIds().map((id) => spaceNodes.value.find((n) => n.id === id)).filter(Boolean)
}
function selectAllNodes() {
  const ns = spaceNodes.value.filter((n) => !n.pinned)
  if (!ns.length) return
  selected.value = new Set(ns.map((n) => n.id))
  selectedNode.value = null
  store.showToast('已全选 ' + ns.length + ' 个节点')
}
const nodeClipboard = ref([])
function copySelectedNodes() {
  const ns = pickSelectionNodes()
  if (!ns.length) return
  nodeClipboard.value = ns.map((n) => ({
    type: n.type, refId: n.refId, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color,
    text: n.text, cardKind: n.cardKind, panelKind: n.panelKind, cardData: n.cardData
  }))
  store.showToast('已复制 ' + ns.length + ' 个节点（Ctrl+V 粘贴）')
}
function pasteCopiedNodes() {
  if (!nodeClipboard.value.length) return
  store.pushHistory()
  const sid = currentSpaceId.value || null
  const created = []
  nodeClipboard.value.forEach((c, i) => {
    const r = store.addWhiteboardNode({
      type: c.type, refId: c.refId || null, x: c.x + 24 + i * 6, y: c.y + 24 + i * 6,
      w: c.w, h: c.h, color: c.color, text: c.text, cardKind: c.cardKind,
      panelKind: c.panelKind, cardData: c.cardData, spaceId: sid
    })
    if (r && r.node) created.push(r.node)
  })
  if (created.length) { selected.value = new Set(created.map((n) => n.id)); selectedNode.value = null }
  store.showToast('已粘贴 ' + created.length + ' 个节点')
}
// ---- 系统剪贴板粘贴：图片 → 相册卡片，纯文本 → 便利贴（Excalidraw / tldraw 标配）----
function onWindowPaste(e) {
  if (isTyping(e)) return
  if (canvasLocked.value) return
  if (nodeClipboard.value.length) return // 内部剪贴板优先（keydown 已拦截处理）
  const dt = e.clipboardData
  if (!dt) return
  const files = Array.from(dt.files || [])
  const imgs = files.filter((f) => f.type && f.type.startsWith('image/'))
  if (imgs.length) {
    e.preventDefault()
    imgs.forEach((f) => incubateFile(f, {}))
    store.showToast('已粘贴 ' + imgs.length + ' 张图片并生成相册卡片')
    return
  }
  const text = (dt.getData('text/plain') || '').trim()
  if (text) {
    e.preventDefault()
    store.pushHistory()
    const c = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2)
    store.addWhiteboardNode({
      type: 'card', cardKind: 'note', text: text.slice(0, 2000),
      x: snap(Math.round(c.x - 110)), y: snap(Math.round(c.y - 70)),
      w: 220, h: 140, color: 'amber', spaceId: currentSpaceId.value || null
    })
    store.showToast('已把剪贴板文本粘贴为便利贴')
  }
}
function duplicateSelectedNodes() {
  // 实体节点与全局数据唯一绑定（同一任务/笔记只应有一张卡），仅复制画布原生卡片
  const cards = pickSelectionNodes().filter((n) => n.type === 'card' && !n.pinned)
  if (!cards.length) { store.showToast('仅卡片可创建副本（实体节点与全局数据唯一绑定）'); return }
  store.pushHistory()
  const sid = currentSpaceId.value || null
  const created = []
  cards.forEach((n) => {
    const copy = store.duplicateWhiteboardNode(n.id)
    if (copy) { copy.spaceId = sid; created.push(copy) }
  })
  if (created.length) { selected.value = new Set(created.map((n) => n.id)); selectedNode.value = null }
  store.showToast('已创建 ' + created.length + ' 个副本')
}
let nudgeTimer = null
function nudgeSelectedNodes(e) {
  const ids = pickSelectionIds()
  if (!ids.length) return
  e.preventDefault()
  const step = e.shiftKey ? 20 : 4
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (!d) return
  // 连续按键合并为一条历史记录（600ms 内视为一次微移动作）
  if (!nudgeTimer) store.pushHistory()
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => { nudgeTimer = null }, 600)
  ids.forEach((id) => {
    const n = store.data.whiteboardNodes.find((x) => x.id === id)
    if (!n || n.pinned) return
    n.x += d[0]; n.y += d[1]
    store.updateWhiteboardNode(id, { x: n.x, y: n.y })
  })
}

function toggleFlat() { flatMode.value = !flatMode.value; store.showToast(flatMode.value ? '已开启扁平模式（极致流畅）' : '已恢复满血质感') }

// ---- 实体解析 ----
function resolve(n) {
  const map = {
    task: () => store.live.tasks.find((t) => t.id === n.refId),
    memo: () => store.live.memos.find((m) => m.id === n.refId),
    item: () => store.live.items.find((i) => i.id === n.refId),
    photo: () => store.live.photos.find((p) => p.id === n.refId),
    collection: () => store.live.collections.find((c) => c.id === n.refId),
    location: () => store.live.locations.find((l) => l.id === n.refId),
    ledger: () => store.data.ledger.records.find((r) => r.id === n.refId),
    profile: () => store.data.profile,
    game: () => null,
    panel: () => null,
    insight: () => null
  }
  return map[n.type] ? map[n.type]() : null
}

// ---- 坐标换算 ----
function viewportCenterCanvas() {
  const vp = viewport.value
  if (!vp) return { x: 200, y: 150 }
  return { x: (vp.clientWidth / 2 - panX.value) / scale.value, y: (vp.clientHeight / 2 - panY.value) / scale.value }
}
function clientToCanvas(cx, cy) {
  const vp = viewport.value
  if (!vp) return { x: 60, y: 60 }
  const r = vp.getBoundingClientRect()
  return { x: (cx - r.left - panX.value) / scale.value, y: (cy - r.top - panY.value) / scale.value }
}

// ---- 平移 / 缩放 ----
function startPan(e) {
  // 绘图模式下，空白处拖拽应当绘图而非平移画布（capture 阶段的 space 平移除外，那是刻意的导航）
  if (drawMode.value) return
  if (e.target.closest('.eo-node') || e.target.closest('.wb-space-card')) return
  if (e.shiftKey || selectMode.value) { startBoxSelect(e); return }
  const sx = e.clientX, sy = e.clientY, ox = panX.value, oy = panY.value
  function mv(ev) { panX.value = ox + (ev.clientX - sx); panY.value = oy + (ev.clientY - sy) }
  function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
}
function startSpacePan(e) {
  const sx = e.clientX, sy = e.clientY, ox = panX.value, oy = panY.value
  function mv(ev) { panX.value = ox + (ev.clientX - sx); panY.value = oy + (ev.clientY - sy) }
  function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
}
function onWheel(e) {
  if (e.ctrlKey) { e.preventDefault(); zoomAt(e); return }
  const nodeEl = e.target && e.target.closest ? e.target.closest('.eo-node') : null
  if (nodeEl) {
    const id = nodeEl.getAttribute('data-node-id')
    const n = id ? spaceNodes.value.find((x) => x.id === id) : null
    // 只要指针落在堆叠组的任意一张卡（组顶或纸堆边条）上，滚轮一律翻页，绝不缩放画布
    if (n && n.stackId && stackNodes(n.stackId).length > 1) {
      e.preventDefault()
      e.stopPropagation()
      onStackWheel(n.stackId, e)
      return
    }
    return
  }
  e.preventDefault()
  zoomAt(e)
}
function zoomAt(e) {
  const vp = viewport.value
  if (!vp) return
  const rect = vp.getBoundingClientRect()
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top
  const old = scale.value
  const ns = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, old * (e.deltaY < 0 ? 1.1 : 0.9)))
  panX.value = cx - (cx - panX.value) * (ns / old)
  panY.value = cy - (cy - panY.value) * (ns / old)
  scale.value = ns
}
function zoom(delta) { scale.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale.value * (delta > 0 ? 1.1 : 0.9))) }
const zoomPct = computed(() => Math.round(scale.value * 100))
function resetZoom() { scale.value = 1 }
function onZoomSlider(e) { scale.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(e.target.value))) }

// 触控：双指缩放
const pinch = { active: false, d0: 0, s0: 1, cx: 0, cy: 0 }
function onTouchStart(e) {
  const vp = viewport.value
  if (!vp || !e.touches || e.touches.length !== 2) return
  const a = e.touches[0], b = e.touches[1]
  const r = vp.getBoundingClientRect()
  pinch.active = true
  pinch.d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
  pinch.s0 = scale.value
  pinch.cx = (a.clientX + b.clientX) / 2 - r.left
  pinch.cy = (a.clientY + b.clientY) / 2 - r.top
}
function onTouchMove(e) {
  if (!pinch.active || !e.touches || e.touches.length !== 2) return
  if (e.cancelable) e.preventDefault()
  const a = e.touches[0], b = e.touches[1]
  const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
  const ns = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.s0 * (d / pinch.d0)))
  const cx = pinch.cx, cy = pinch.cy
  panX.value = cx - (cx - panX.value) * (ns / scale.value)
  panY.value = cy - (cy - panY.value) * (ns / scale.value)
  scale.value = ns
}
function onTouchEnd(e) { if (!e.touches || e.touches.length < 2) pinch.active = false }

// ---- 视图复位 ----
function fitToContent(list) {
  const vp = viewport.value
  const boxes = (list || []).map((n) => { const p = absOf(n); return { x: p.x, y: p.y, w: n.w, h: n.h } })
  if (!vp || !boxes.length) { panX.value = 40; panY.value = 40; scale.value = 1; return }
  const minX = Math.min.apply(null, boxes.map((n) => n.x))
  const minY = Math.min.apply(null, boxes.map((n) => n.y))
  const maxX = Math.max.apply(null, boxes.map((n) => n.x + n.w))
  const maxY = Math.max.apply(null, boxes.map((n) => n.y + n.h))
  const pad = 28
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2
  // 上限 0.92：整版卡片四周留白，避免贴边被小地图 / 缩放条压住
  const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(vp.clientWidth / w, vp.clientHeight / h, 0.92)))
  scale.value = s
  const dockSpace = 76
  panX.value = (vp.clientWidth - (maxX - minX) * s) / 2 - minX * s
  panY.value = (vp.clientHeight - dockSpace - (maxY - minY) * s) / 2 - minY * s
}
function fitView() { fitToContent(spaceNodes.value.length ? spaceNodes.value : childSpaces.value) }
function fitToPanels() {
  const panels = spaceNodes.value.filter((n) => n.type === 'panel')
  fitToContent(panels.length ? panels : spaceNodes.value)
}

// ---- 节点拖拽（阈值 + 弹簧 + 内联保护 + 悬停 1.2s 合并堆叠）----
const DRAG_THRESHOLD = 6
let suppressClickUntil = 0
let dragAbort = null

// ---- 悬停 1.2 秒合并为堆叠组 ----
const STACK_HOVER_MS = 1200
const stackHoverId = ref(null)
let stackHoverTimer = null
function clearStackHover() {
  stackHoverId.value = null
  if (stackHoverTimer) { clearTimeout(stackHoverTimer); stackHoverTimer = null }
}
// 画布坐标下命中「最上层」的另一张卡片（堆叠组只认组顶，绝不合并进纸堆内部）
function nodeAtCanvasPoint(cx, cy, exclude) {
  const arr = store.data.whiteboardNodes
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i]
    if (!m || m.deletedAt || m === exclude || m._dragging) continue
    if ((m.spaceId || null) !== (currentSpaceId.value || null)) continue
    if (m.stackId && m.stackId === exclude.stackId) continue
    if (m.stackId && !isStackTop(m)) continue
    const p = absOf(m)
    if (cx >= p.x && cx <= p.x + m.w && cy >= p.y && cy <= p.y + m.h) return m
  }
  return null
}
function updateStackHover(n, ev) {
  // v2.2.3：恢复拖动合并 —— 悬停另一张卡片即叠成「错位重叠」的一摞（不是折叠成一条）
  const vp = viewport.value
  if (!vp) return
  const r = vp.getBoundingClientRect()
  const cx = (ev.clientX - r.left - panX.value) / scale.value
  const cy = (ev.clientY - r.top - panY.value) / scale.value
  const hit = nodeAtCanvasPoint(cx, cy, n)
  const hitId = hit ? hit.id : null
  if (hitId === stackHoverId.value) return
  stackHoverId.value = hitId
  if (stackHoverTimer) { clearTimeout(stackHoverTimer); stackHoverTimer = null }
  if (!hitId) return
  const target = hit
  stackHoverTimer = setTimeout(() => {
    stackHoverTimer = null
    if (stackHoverId.value !== hitId) return
    mergeIntoStack(n, target)
  }, STACK_HOVER_MS)
}
// 合并：被拖卡片成为「第一张」（组顶），锚定在它的落点；目标卡及原堆叠成员整体下沉为下层
function mergeIntoStack(n, target) {
  if (!n || !target || n === target) return false
  clearStackHover()
  if (dragAbort) dragAbort()
  store.pushHistory()
  // 第一张 = 被拖卡片，位置锁定在它当前落点（用户松手处）
  const ax = n.x, ay = n.y
  // 以「要重叠的卡片」尺寸为准：被拖卡对齐到目标卡宽高，并持久化
  const aw = target.w || n.w
  const ah = target.h || n.h
  // 收集目标所在堆叠组的既有成员（不含被拖卡）；目标本身是独立卡则仅有它一个
  const existing = (target.stackId ? stackNodes(target.stackId) : [target]).filter((x) => x.id !== n.id)
  const sid = target.stackId || ('wsg_' + Math.random().toString(36).slice(2, 9))
  // 新组顶 = 被拖卡片（第一张，完全显示）
  n.stackId = sid; n.stackIdx = 0; n.x = ax; n.y = ay; n.w = aw; n.h = ah
  store.updateWhiteboardNode(n.id, { stackId: sid, stackIdx: 0, x: ax, y: ay, w: aw, h: ah })
  // 既有成员整体下沉为下层，按原层序顺延、统一尺寸、向右下错位露出边缘
  existing.sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
  existing.forEach((m, i) => {
    const k = i + 1
    m.stackId = sid; m.stackIdx = k
    m.x = ax + k * STACK_DX; m.y = ay + k * STACK_DY
    m.w = aw; m.h = ah
    store.updateWhiteboardNode(m.id, { stackId: sid, stackIdx: k, x: m.x, y: m.y, w: aw, h: ah })
  })
  stackTop[sid] = n.id
  delete stackRing[sid]
  delete stackCursor[sid]
  bringToFront(n, true)
  store.showToast('已合并为堆叠组（滚轮翻页 · 右键打散）')
  return true
}

function onNodePointerDown(n, e) {
  if (e && e.button !== undefined && e.button !== 0) return
  if (connectMode.value || n.pinned) return
  if (canvasLocked.value) return
  if (e && e.target && e.target.closest && e.target.closest(
    'input, textarea, select, button, [contenteditable="true"], label, ' +
    '.mg-cell, .nb-check, .nb-ref, .pn-check, .pn-task__title, .pn-del, .pn-add-btn, .pn-refresh, .pn-cal-nav, ' +
    '.eo-handle, .eo-node-resize'
  )) return
  // Ctrl/Cmd+点击：加入 / 移出多选（tldraw / Excalidraw 标准交互）
  if (e && (e.ctrlKey || e.metaKey)) {
    const next = new Set(selected.value)
    if (next.has(n.id)) next.delete(n.id); else next.add(n.id)
    selected.value = next
    selectedNode.value = null
    return
  }
  const s = scale.value
  let sx = e.clientX, sy = e.clientY
  // 抓取的节点若属于多卡堆叠组，则整组一起拖拽：以「组顶卡」为锚点，保持层间错位
  const inStack = !!n.stackId && stackNodes(n.stackId).length > 1
  const anchor = inStack ? (topOf(n.stackId) || n) : n
  let ox = anchor.x, oy = anchor.y
  let dragging = false
  let aborted = false
  let wasStack = false
  // ---- 边缘自动平移（tldraw 标配）：拖拽中指针贴近视口边缘时画布自动滚动 ----
  const EDGE_PAN_BAND = 36
  let edgePanRaf = 0
  let lastCX = 0, lastCY = 0
  function edgePanTick() {
    edgePanRaf = 0
    if (!dragging || aborted) return
    const vw = window.innerWidth, vh = window.innerHeight
    let dx = 0, dy = 0
    // 左/上缘 → 画布层向右/下平移（露出边缘外内容）；右/下缘反之
    if (lastCX < EDGE_PAN_BAND) dx = (1 - lastCX / EDGE_PAN_BAND) * 14
    else if (lastCX > vw - EDGE_PAN_BAND) dx = -(1 - (vw - lastCX) / EDGE_PAN_BAND) * 14
    if (lastCY < EDGE_PAN_BAND) dy = (1 - lastCY / EDGE_PAN_BAND) * 14
    else if (lastCY > vh - EDGE_PAN_BAND) dy = -(1 - (vh - lastCY) / EDGE_PAN_BAND) * 14
    if (dx || dy) {
      panX.value += dx; panY.value += dy
      anchor.x += dx / s; anchor.y += dy / s
      // 堆叠组整体跟随平移
      const isGroupTop = !!anchor.stackId && isStackTop(anchor) && stackNodes(anchor.stackId).length > 1
      if (isGroupTop) {
        stackNodes(anchor.stackId).forEach((m) => {
          if (m.id === anchor.id) return
          const k = Math.max(1, stackLevelOf(m))
          m.x = anchor.x + k * STACK_DX
          m.y = anchor.y + k * STACK_DY
        })
      }
    }
    edgePanRaf = requestAnimationFrame(edgePanTick)
  }
  function mv(ev) {
    if (!dragging) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_THRESHOLD) return
      dragging = true
      anchor._dragging = true
      store.pushHistory()
      bringToFront(anchor, true)
      sx = ev.clientX; sy = ev.clientY
    }
    if (aborted) return
    lastCX = ev.clientX; lastCY = ev.clientY
    if (dragging && !edgePanRaf) edgePanRaf = requestAnimationFrame(edgePanTick)
    // 以组顶卡为锚点实时重算：接管整组拖拽瞬间以当前落点为新基准，避免跳位
    const gTop = !!anchor.stackId && isStackTop(anchor) && stackNodes(anchor.stackId).length > 1
    if (gTop && !wasStack) { ox = anchor.x; oy = anchor.y; sx = ev.clientX; sy = ev.clientY; wasStack = true; stackDragging.value = true }
    const rawX = ox + (ev.clientX - sx) / s
    const rawY = oy + (ev.clientY - sy) / s
    computeGuides(anchor, snap(rawX), snap(rawY))
    anchor.x = rawX; anchor.y = rawY
    // 整组同步：组内每张卡按层序向右下错位跟随，底层实时跟随不脱节
    if (gTop) {
      stackNodes(anchor.stackId).forEach((m) => {
        if (m.id === anchor.id) return
        const k = Math.max(1, stackLevelOf(m))
        m.x = rawX + k * STACK_DX
        m.y = rawY + k * STACK_DY
      })
    }
    // 仅独立单卡（非堆叠成员）允许「悬停合并成堆叠组」；堆叠组整体拖拽时不触发合并
    if (!inStack) updateStackHover(n, ev)
  }
  function cleanup() {
    if (edgePanRaf) { cancelAnimationFrame(edgePanRaf); edgePanRaf = 0 }
    window.removeEventListener('pointermove', mv)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  function gTopUp() {
    return !!anchor.stackId && isStackTop(anchor) && stackNodes(anchor.stackId).length > 1
  }
  function up() {
    cleanup()
    dragAbort = null
    clearStackHover()
    stackDragging.value = false
    if (aborted) return
    if (!dragging) {
      bringToFront(n, true); suppressClickUntil = Date.now() + 220; onNodeSelectLike(n); return
    }
    anchor._dragging = false
    guideV.value = []; guideH.value = []
    const fp = absOf(anchor)
    anchor._settle = true
    anchor.x = snapGrid(fp.x); anchor.y = snapGrid(fp.y)
    store.updateWhiteboardNode(anchor.id, { x: anchor.x, y: anchor.y })
    // 整组落位 —— 组内成员坐标一并落库，避免下次加载时错位。
    // ⚠️ 成员坐标不能各自 snap 到网格：GRID=10 是 10 的倍数，会把 18px 的对角偏移
    //    吸附成 18/20 不等，破坏「从第一张开始逐层等值往右下」的对角线。
    //    必须以「吸附后的组顶」为基准 + k*STACK_DX / k*STACK_DY 派生。
    if (gTopUp()) {
      stackNodes(anchor.stackId).forEach((m) => {
        if (m.id === anchor.id) return
        const k = Math.max(1, stackLevelOf(m))
        m.x = anchor.x + k * STACK_DX
        m.y = anchor.y + k * STACK_DY
        store.updateWhiteboardNode(m.id, { x: m.x, y: m.y })
      })
    }
    clearTimeout(settleTimer); settleTimer = setTimeout(() => { anchor._settle = false }, 360)
    suppressClickUntil = Date.now() + 220
    dragGuard.suppressJumpUntil = Date.now() + 260
  }
  dragAbort = () => {
    aborted = true
    cleanup()
    dragAbort = null
    anchor._dragging = false
    n._dragging = false
    stackDragging.value = false
    clearTimeout(settleTimer); settleTimer = setTimeout(() => { anchor._settle = false }, 360)
    guideV.value = []; guideH.value = []
    suppressClickUntil = Date.now() + 220
    dragGuard.suppressJumpUntil = Date.now() + 260
  }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
}
let settleTimer = null

function pruneEmptyStacks() {
  Object.keys(stackTop).forEach((sid) => { if (stackNodes(sid).length < 2) delete stackTop[sid] })
}

// （已移除：堆叠顶层卡专属拖拽状态机 —— 所有卡片一律走独立单卡拖拽，彻底斩断联动）
// 右键「移出顶层卡片」
function extractTopCard(sid) {
  const list = stackNodes(sid)
  const t = list[0]
  if (!t) return
  store.pushHistory()
  const p = absOf(t)
  t.stackId = null; t.stackIdx = 0; t.x = p.x; t.y = p.y
  store.updateWhiteboardNode(t.id, { x: t.x, y: t.y, stackId: null, stackIdx: 0 })
  delete stackTop[sid]
  renormalizeStack(sid, p)
  dissolveIfSingleton(sid, p)
  pruneEmptyStacks()
  delete stackRing[sid]
  delete stackCursor[sid]
  store.showToast('已移出顶层卡片')
}
// 组内层序重排：第 0 张接管锚点，其余顺延（保证任何增删后都不跳位）
function renormalizeStack(sid, anchor) {
  const rest = stackNodes(sid)
  if (!rest.length) return
  const a = anchor || { x: rest[0].x, y: rest[0].y }
  rest.forEach((n, k) => {
    n.stackIdx = k
    if (k === 0) { n.x = a.x; n.y = a.y }
    store.updateWhiteboardNode(n.id, k === 0 ? { stackIdx: 0, x: a.x, y: a.y } : { stackIdx: k })
  })
  stackTop[sid] = rest[0].id
}
// 打散堆叠：先冻结每张卡的真实位置，再解散（否则会跳回旧坐标）
function scatterStack(sid) {
  store.pushHistory()
  stackNodes(sid).forEach((m) => {
    const p = absOf(m)
    m.stackId = null; m.stackIdx = 0; m.x = p.x; m.y = p.y
    store.updateWhiteboardNode(m.id, { stackId: null, stackIdx: 0, x: p.x, y: p.y })
  })
  delete stackTop[sid]
  delete stackRing[sid]
  delete stackCursor[sid]
  store.showToast('已打散堆叠，卡片回归自由区')
}
// v2.2.5 一键展平：以当前堆叠中心为原点，全部卡片按网格散开（批量整理）
function flattenStack(sid) {
  const list = stackNodes(sid)
  if (list.length < 2) return
  store.pushHistory()
  const top = topOf(sid) || list[0]
  const p = absOf(top)
  const n = list.length
  const cellW = list.reduce((m, x) => Math.max(m, x.w || 0), top.w || 240)
  const cellH = list.reduce((m, x) => Math.max(m, x.h || 0), top.h || 160)
  const gapX = 28, gapY = 28
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.25)))
  const rows = Math.ceil(n / cols)
  const totalW = cols * cellW + (cols - 1) * gapX
  const totalH = rows * cellH + (rows - 1) * gapY
  const cx = p.x + (top.w || cellW) / 2
  const cy = p.y + (top.h || cellH) / 2
  const startX = snap(cx - totalW / 2)
  const startY = snap(cy - totalH / 2)
  list.forEach((m, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    const x = snap(startX + c * (cellW + gapX))
    const y = snap(startY + r * (cellH + gapY))
    m.stackId = null; m.stackIdx = 0; m.x = x; m.y = y
    m._settle = true
    store.updateWhiteboardNode(m.id, { stackId: null, stackIdx: 0, x, y })
    setTimeout(() => { m._settle = false }, 420)
  })
  delete stackTop[sid]
  delete stackRing[sid]
  delete stackCursor[sid]
  store.showToast('已平铺 ' + n + ' 张卡片')
}
// 从堆叠组抽离单卡：放到组右侧空位，剩余成员重新压实
function extractFromStack(sid, id) {
  const list = stackNodes(sid)
  const n = list.find((x) => x.id === id)
  if (!n || list.length < 2) return
  store.pushHistory()
  const top = topOf(sid) || list[0]
  const tp = absOf(top)
  n.stackId = null; n.stackIdx = 0
  n.x = snap(tp.x + (top.w || n.w || 240) + 36)
  n.y = snap(tp.y + Math.min(list.length - 1, 2) * 26)
  store.updateWhiteboardNode(n.id, { stackId: null, stackIdx: 0, x: n.x, y: n.y })
  n._settle = true
  setTimeout(() => { n._settle = false }, 420)
  delete stackTop[sid]
  renormalizeStack(sid, tp)
  dissolveIfSingleton(sid, tp)
  pruneEmptyStacks()
  delete stackRing[sid]
  delete stackCursor[sid]
  store.showToast('已抽出「' + stackNodeTitle(n) + '」')
}
// 组内只剩 1 张时自动解散，避免留下「看不见的组」
function dissolveIfSingleton(sid, anchor) {
  const rest = stackNodes(sid)
  if (rest.length !== 1) return
  const n = rest[0]
  n.stackId = null; n.stackIdx = 0
  if (anchor) { n.x = anchor.x; n.y = anchor.y }
  store.updateWhiteboardNode(n.id, { stackId: null, stackIdx: 0, x: n.x, y: n.y })
  delete stackTop[sid]
  delete stackRing[sid]
  delete stackCursor[sid]
}
// 翻页：组锚点固定不动，只轮换「谁在最上层」—— 绝不跳位、不空白、不缩放
// v2.2.5：用稳定的环形顺序（stackRing）+ 游标（stackCursor）翻页，确保 15 张能逐张翻完，
// 而不是在头两张之间来回跳；同时给出「当前 / 总数」进度指示。
let stackFlipAt = 0
let stackFlipTimer = null
const stackFlipping = ref(false)
// 堆叠组拖拽中：全组关闭过渡动画 → 刚体同步、跟手（组顶与下层卡同帧到位）
const stackDragging = ref(false)
const stackRing = reactive({})
const stackCursor = reactive({})
function stackRingOf(sid) {
  const ids = stackNodes(sid).map((n) => n.id)
  const ring = stackRing[sid]
  if (!ring || ring.length !== ids.length || ids.some((id) => !ring.includes(id))) {
    stackRing[sid] = ids.slice()
    stackCursor[sid] = 0
  }
  return stackRing[sid]
}
function showStackIndicator(sid, total, page) {
  const t = topOf(sid)
  const vp = viewport.value
  if (!t || !vp) return
  const p = absOf(t)
  const left = panX.value + (p.x + (t.w || 0)) * scale.value + 10
  const top = panY.value + p.y * scale.value - 2
  stackIndicator.value = {
    left: Math.max(10, Math.min((vp.clientWidth || 1200) - 78, left)),
    top: Math.max(10, Math.min((vp.clientHeight || 800) - 44, top)),
    page, total
  }
  clearTimeout(stackIndicatorTimer)
  stackIndicatorTimer = setTimeout(() => { stackIndicator.value = null }, 1100)
}
function onStackWheel(sid, e) {
  const list = stackNodes(sid)
  if (list.length < 2) return
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  if (now - stackFlipAt < 80) return // 触控板高频 delta 合并，避免一次滑动翻过多张
  stackFlipAt = now
  const step = e.deltaY > 0 ? 1 : -1
  const ring = stackRingOf(sid)
  const total = ring.length
  // ⚠️ 必须以「真实顶层卡」在环中的下标为基准选下一张，而非独立的 stackCursor——
  // 否则合并 / 抽屉挑卡 / 环重建后光标与真实顶层错位，下滚轮会挑错相邻卡、翻页形态失真。
  const top = topOf(sid)
  if (!top) return
  const curIdx = Math.max(0, ring.indexOf(top.id))
  const nextIdx = (curIdx + step + total) % total
  const next = list.find((n) => n.id === ring[nextIdx]) || list[0]
  if (!next) return
  showStackIndicator(sid, total, nextIdx + 1)
  promoteStackCard(sid, next, ring, nextIdx)
}
function promoteStackCard(sid, next, ringArg, idxArg) {
  const list = stackNodes(sid)
  const cur = topOf(sid) || list[0]
  if (!cur || !next || cur.id === next.id) return
  const anchor = { x: cur.x, y: cur.y }
  const ring = ringArg || stackRingOf(sid)
  const idx = idxArg != null ? idxArg : Math.max(0, ring.indexOf(next.id))
  const ordered = ring.map((id) => list.find((n) => n.id === id)).filter(Boolean)
  if (!ordered.length) return
  // 以 next 为第 0 位旋转环，层级按环序重排 → 纸堆深度顺序始终稳定
  const rotated = ordered.slice(idx).concat(ordered.slice(0, idx))
  // 翻页时整组尺寸保持「当前组顶」的宽高不变 —— 切换过程尺寸恒定不跳变（需求：后面切换过程保持不变）
  const w0 = cur.w, h0 = cur.h
  // ⚠️ 坐标必须全组统一重算并落库：
  //   渲染位置由 absOf() = 组顶坐标 + k*STACK_DX/DY 派生，若下层卡仍保留旧坐标，
  //   一旦组顶被拖动/落库，反推出的偏移就会错位（历史 bug：翻页后第一张跑位）。
  //   这里以「锚点 + k×等值对角」为唯一真源，k=0 即组顶本身。
  rotated.forEach((n, k) => {
    n.stackIdx = k
    n.x = anchor.x + k * STACK_DX
    n.y = anchor.y + k * STACK_DY
    n.w = w0; n.h = h0
    store.updateWhiteboardNode(n.id, { stackIdx: k, x: n.x, y: n.y, w: w0, h: h0 })
  })
  stackTop[sid] = next.id
  // 视觉层级：新组顶排到数组末尾（仅内存顺序，不额外写库）
  const arr = store.data.whiteboardNodes
  const i = arr.indexOf(next)
  if (i >= 0 && i !== arr.length - 1) { arr.splice(i, 1); arr.push(next) }
  stackFlipping.value = true
  clearTimeout(stackFlipTimer)
  stackFlipTimer = setTimeout(() => { stackFlipping.value = false }, 210)
}

// ---- v2.2.5 抽屉式全局预览（找卡神器）----
const stackIndicator = ref(null)
let stackIndicatorTimer = null
const stackDrawer = reactive({ open: false, stackId: null })
const stackDrawerItems = computed(() => {
  const sid = stackDrawer.stackId
  if (!sid) return []
  return stackNodes(sid).map((n, i) => ({
    id: n.id, index: i + 1,
    title: stackNodeTitle(n),
    summary: stackNodeSummary(n),
    icon: stackNodeIcon(n),
    kind: stackNodeKindLabel(n),
    accent: n.color || 'amber'
  }))
})
function stackNodeKindLabel(sn) {
  if (!sn) return '卡片'
  if (sn.type === 'panel') return '面板'
  if (sn.type === 'card') return '卡片'
  const m = { task: '任务', memo: '笔记', item: '物品', photo: '照片', collection: '收藏', location: '足迹', ledger: '记账', insight: '洞察', game: '游戏', profile: '资料' }
  return m[sn.type] || sn.type
}
function stackNodeSummary(sn) {
  if (!sn) return ''
  if (sn.type === 'panel') {
    const m = {
      calendar: '月历与日程聚合', todo: '今日待办清单', ledger: '近期收支记录', notes: '笔记速览',
      album: '相册预览', map: '足迹地图', backpack: '背包统计', steam: 'Steam 游戏库', achievements: '成就墙'
    }
    return m[sn.panelKind] || '数据面板'
  }
  if (sn.type === 'card') {
    const cd = sn.cardData || {}
    const label = { clock: '时钟', heatmap: '热力图', audio: '音乐播放', text: '文本', note: '便签', link: '链接' }
    const txt = cd.title || cd.text || cd.note || ''
    return String(txt || label[sn.cardKind] || '卡片').replace(/\s+/g, ' ').slice(0, 72)
  }
  const e = resolve(sn)
  if (!e) return '（内容已删除）'
  if (sn.type === 'memo') return String(e.markdown || e.content || '').replace(/\s+/g, ' ').slice(0, 72) || '空白笔记'
  if (sn.type === 'task') return (e.status === 'done' ? '已完成' : '进行中') + (e.dueDate ? ' · 截止 ' + e.dueDate : ' · 无截止')
  if (sn.type === 'item') return (e.category || '未分类') + ' ×' + (e.count || 1)
  if (sn.type === 'collection') return String(e.url || e.content || e.category || '收藏').slice(0, 72)
  if (sn.type === 'location') return (e.lat != null ? e.lat.toFixed(2) : '') + ', ' + (e.lng != null ? e.lng.toFixed(2) : '')
  if (sn.type === 'ledger') return (e.type === 'income' ? '+' : '-') + e.amount + ' 元 · ' + (e.category || '')
  if (sn.type === 'photo') return '照片 · ' + (e.name || '')
  return sn.type
}
function openStackDrawer(sid) {
  if (!sid) return
  if (stackNodes(sid).length < 2) return
  stackDrawer.stackId = sid
  stackDrawer.open = true
}
function closeStackDrawer() { stackDrawer.open = false }
function focusStack(sid) {
  const t = topOf(sid)
  const vp = viewport.value
  if (!t || !vp) return
  const p = absOf(t)
  const ns = Math.min(1.25, Math.max(0.75, scale.value))
  scale.value = ns
  panX.value = (vp.clientWidth || 1200) / 2 - (p.x + (t.w || 0) / 2) * ns
  panY.value = ((vp.clientHeight || 800) - 76) / 2 - (p.y + (t.h || 0) / 2) * ns
}
function drawerPick(id) {
  const sid = stackDrawer.stackId
  if (!sid) return
  const n = stackNodes(sid).find((x) => x.id === id)
  if (n) {
    const ring = stackRingOf(sid)
    const idx = Math.max(0, ring.indexOf(n.id))
    stackCursor[sid] = idx
    promoteStackCard(sid, n, ring, idx)
    focusStack(sid)
    flash(n.id)
  }
  closeStackDrawer()
}
function drawerExtract(id) {
  const sid = stackDrawer.stackId
  if (!sid) return
  extractFromStack(sid, id)
  if (stackNodes(sid).length < 2) closeStackDrawer()
}
function onDrawerFlatten() {
  const sid = stackDrawer.stackId
  closeStackDrawer()
  if (sid) flattenStack(sid)
}
// 堆叠组角标下拉（展开 / 全部平铺 / 移出顶层 / 打散）
function onStackMenu(n, e) {
  const sid = n && n.stackId
  if (!sid) return
  const list = stackNodes(sid)
  if (list.length < 2) return
  const items = [
    { icon: 'grid', label: '展开预览（' + list.length + ' 张）', action: () => openStackDrawer(sid) },
    { icon: 'columns', label: '全部平铺', action: () => flattenStack(sid) },
    { icon: 'arrowup', label: '移出顶层卡片', action: () => extractTopCard(sid) },
    { icon: 'layers', label: '打散堆叠', action: () => scatterStack(sid) }
  ]
  openContextMenu(e, { title: '堆叠组 · ' + list.length + ' 张', items })
}
function stackNodeIcon(sn) {
  if (!sn) return 'layout'
  if (sn.type === 'panel') {
    const m = { calendar: 'calendar', todo: 'checklist', ledger: 'wallet', notes: 'note', album: 'album', map: 'map-pin', backpack: 'backpack', steam: 'game', achievements: 'trophy' }
    return m[sn.panelKind] || 'layout'
  }
  const m = { task: 'check', memo: 'note', item: 'box', collection: 'star', location: 'map-pin', photo: 'album', ledger: 'wallet' }
  return m[sn.type] || 'dot'
}
function stackNodeTitle(sn) {
  if (!sn) return ''
  if (sn.type === 'panel') {
    const m = { calendar: '日历', todo: '待办', ledger: '记账', notes: '笔记', album: '相册', map: '足迹', backpack: '背包', steam: 'Steam', achievements: '成就' }
    return m[sn.panelKind] || '数据面板'
  }
  const e = resolve(sn)
  if (sn.type === 'memo') return (e && e.title) || '便利贴'
  if (sn.type === 'task') return (e && e.title) || '任务'
  if (sn.type === 'item') return (e && e.name) || '物品'
  if (sn.type === 'collection') return (e && e.title) || '收藏'
  if (sn.type === 'location') return (e && e.name) || '足迹'
  if (sn.type === 'photo') return (e && e.title) || (e && e.name) || '照片'
  return sn.type
}

// ---- 磁吸辅助线 ----
function computeGuides(mover, nx, ny) {
  const others = spaceNodes.value.filter((o) => o !== mover && !o.deletedAt && o.type !== 'panel')
  const mL = nx, mCx = nx + mover.w / 2, mR = nx + mover.w
  const mT = ny, mCy = ny + mover.h / 2, mB = ny + mover.h
  const v = [], h = []
  for (const o of others) {
    const op = absOf(o)
    const oL = op.x, oCx = op.x + o.w / 2, oR = op.x + o.w
    const oT = op.y, oCy = op.y + o.h / 2, oB = op.y + o.h
    if (Math.abs(mL - oL) < SNAP_GAP) { nx = oL; v.push(oL) }
    else if (Math.abs(mCx - oCx) < SNAP_GAP) { nx = oCx - mover.w / 2; v.push(oCx) }
    else if (Math.abs(mR - oR) < SNAP_GAP) { nx = oR - mover.w; v.push(oR) }
    if (Math.abs(mT - oT) < SNAP_GAP) { ny = oT; h.push(oT) }
    else if (Math.abs(mCy - oCy) < SNAP_GAP) { ny = oCy - mover.h / 2; h.push(oCy) }
    else if (Math.abs(mB - oB) < SNAP_GAP) { ny = oB - mover.h; h.push(oB) }
  }
  guideV.value = v; guideH.value = h
  return { x: nx, y: ny }
}

// ---- Resize ----
function startResize(n, e) {
  if (canvasLocked.value) return
  store.pushHistory()
  const s = scale.value
  const sx = e.clientX, sy = e.clientY, ow = n.w, oh = n.h
  // 堆叠组顶卡：拖拽尺寸时整组同步 —— 保证翻页过程中尺寸恒定不跳变（需求：后面切换过程保持不变）
  const sid = (n.stackId && isStackTop(n) && stackNodes(n.stackId).length > 1) ? n.stackId : null
  const mates = sid ? stackNodes(sid).filter((m) => m.id !== n.id) : []
  function mv(ev) {
    n.w = Math.min(1200, Math.max(140, snap(ow + ((ev.clientX - sx) / s) * 1.2)))
    n.h = Math.min(1200, Math.max(100, snap(oh + ((ev.clientY - sy) / s) * 1.2)))
    if (sid) mates.forEach((m) => { m.w = n.w; m.h = n.h })
  }
  function up() {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up)
    store.updateWhiteboardNode(n.id, { w: n.w, h: n.h })
    if (sid) mates.forEach((m) => store.updateWhiteboardNode(m.id, { w: n.w, h: n.h }))
  }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
}

// ---- 选中 / 连线 / 编辑 ----
function selectNode(n) { selectedNode.value = n }
function startConnectFrom(n) { selectedNode.value = n; connectMode.value = true; linkSource.value = n.id }
function onNodeSelectLike(n) {
  if (connectMode.value) {
    if (!linkSource.value) { linkSource.value = n.id; selectedNode.value = n; return }
    if (linkSource.value === n.id) { connectMode.value = false; linkSource.value = null; return }
    store.pushHistory()
    const r = store.connectNodes(linkSource.value, n.id)
    if (!r.ok && r.error) store.showToast(r.error)
    else flash(n.id)
    connectMode.value = false; linkSource.value = null
    return
  }
  selectNode(n)
}
function onNodeDbl(n) {
  if (canvasLocked.value) return
  connectMode.value = false; linkSource.value = null
  if (n.type === 'panel') return
  if (n.type === 'card') { openCardEditor(n); return }
  editNode(n)
}
function onBlankClick() {
  if (Date.now() < suppressClickUntil) return
  clearSel(); connectMode.value = false; linkSource.value = null
}
function flash(id) { flashingId.value = id; setTimeout(() => { if (flashingId.value === id) flashingId.value = null }, 1100) }

function onBlankDblClick(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault()
  if (connectMode.value) { connectMode.value = false; linkSource.value = null; return }
  if (!store.data.canvasDblClickCreate) return
  const c = clientToCanvas(e.clientX, e.clientY)
  createPos.value = { x: Math.round(c.x - 110), y: Math.round(c.y - 70) }
  createOpen.value = true
}

const OVERLAY_SEL = '.cs-mask, .cs-sheet, .ces-mask, .ces-panel, .esd-mask, .esd-dialog, .modal-mask, .modal, input, textarea, select, button, [contenteditable="true"]'
function inOverlay(e) { const t = e && e.target; return !!(t && t.closest && t.closest(OVERLAY_SEL)) }
function inInteractive(e) { const t = e && e.target; return !!(t && t.closest && t.closest('.eo-node, .wb-space-card, .wb-edges')) }
function onRootMouseDown(e) { if (!e || inOverlay(e) || inInteractive(e)) return; if (typeof e.preventDefault === 'function') e.preventDefault(); if (typeof e.stopPropagation === 'function') e.stopPropagation() }
function onRootDblClick(e) { if (!e || inOverlay(e) || inInteractive(e)) return; if (typeof e.preventDefault === 'function') e.preventDefault(); if (typeof e.stopPropagation === 'function') e.stopPropagation() }
function openCreateAtCenter() { const c = viewportCenterCanvas(); createPos.value = { x: Math.round(c.x - 110), y: Math.round(c.y - 70) }; createOpen.value = true }
function onCreateSheet(payload) {
  const r = store.createEntityAndNode(Object.assign({}, payload, { pos: createPos.value }))
  createOpen.value = false
  if (!r.ok) { store.showToast('创建失败，请检查必填项'); return }
  if (r.node) { flash(r.node.id); selectedNode.value = r.node; nextTick(() => focusNode(r.node)) }
  store.showToast('已创建并同步到对应模块')
}
function clearSel() { selected.value = new Set() }

function startBoxSelect(e) {
  const vp = viewport.value; if (!vp) return
  const r = vp.getBoundingClientRect()
  const x0 = e.clientX - r.left, y0 = e.clientY - r.top
  boxSel.value = { active: true, x0, y0, x1: x0, y1: y0 }
  function mv(ev) { boxSel.value.x1 = ev.clientX - r.left; boxSel.value.y1 = ev.clientY - r.top }
  function up(ev) {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up)
    const a = boxSel.value
    const minX = Math.min(a.x0, a.x1), maxX = Math.max(a.x0, a.x1)
    const minY = Math.min(a.y0, a.y1), maxY = Math.max(a.y0, a.y1)
    const set = new Set()
    spaceNodes.value.forEach((n) => {
      const p = absOf(n)
      const cx = p.x * scale.value + panX.value - r.left
      const cy = p.y * scale.value + panY.value - r.top
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) set.add(n.id)
    })
    selected.value = set
    boxSel.value = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 }
  }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
}

function persistNodePos(n) { store.updateWhiteboardNode(n.id, { x: n.x, y: n.y }) }

// ---- 一键整理（5 大布局引擎 + 网格，计算下沉到 Web Worker）----
// 红线：布局算法（尤其全局节点）必须在 Web Worker 中执行，严禁阻塞 UI 主线程。
const LAYOUT_MODES = [
  { mode: 'dagre', label: '自动去重叠', icon: 'layout', desc: 'DAG 自动排布 · 根治重叠' },
  { mode: 'mindmap', label: '思维导图', icon: 'tree', desc: '中心向两侧' },
  { mode: 'logic', label: '逻辑图', icon: 'flow', desc: '根向右逐层' },
  { mode: 'org', label: '组织架构', icon: 'org', desc: '自上而下层级' },
  { mode: 'radial', label: '放射状', icon: 'radial', desc: '根向四周' },
  { mode: 'tree', label: '树状图', icon: 'branch', desc: '自上而下树形' },
  { mode: 'grid', label: '网格', icon: 'layout', desc: '按标签聚拢' }
]
const layoutSpacing = reactive({ levelGap: 300, rowGap: 200 })
const layoutOpen = ref(false)
const layoutBusy = ref(false)

// ---- 绘图层（画笔 / 形状 / 抬笔成型 / 图层）----
const drawMode = ref(false)
const drawTool = ref('pen')
const drawColor = ref('#2C2C2C')
const drawWidth = ref(3)
const drawOpacity = ref(1)
const drawRecognize = ref(true)
const drawLayerRef = ref(null)
const DRAW_TOOLS = [
  { key: 'pen', label: '圆珠笔' }, { key: 'fountain', label: '钢笔' }, { key: 'pencil', label: '铅笔' },
  { key: 'hl', label: '荧光笔' }, { key: 'laser', label: '激光笔' },
  { key: 'line', label: '直线' }, { key: 'rect', label: '矩形' }, { key: 'circle', label: '圆' },
  { key: 'scalpel', label: '柳叶刀' }, { key: 'tri', label: '三角' }, { key: 'star', label: '星形' }, { key: 'erase', label: '橡皮' }
]
const DRAW_COLORS = ['#2C2C2C', '#8C8C8C', '#A97C72', '#7E9A7E', '#4A4A48', '#C7C4BE', '#333333']
function toggleDraw() { drawMode.value = !drawMode.value; if (drawMode.value) store.showToast('绘图模式：在画布上自由绘制，松手自动识别形状') }
function clearDraw() { if (drawLayerRef.value) drawLayerRef.value.clearSpace() }

// ---- AI 命令面板 + 外部媒体扫描 ----
const aiOpen = ref(false)
function openAI() { aiOpen.value = true }
function aiContextText() {
  const n = selectedNode.value
  if (!n) return ''
  if (n.type === 'card') return JSON.stringify(n.cardData || {})
  return n.text || (resolve(n) && (resolve(n).title || resolve(n).name)) || ''
}
function onAiCreate(payload) {
  // 命令面板产出的节点：对齐到视口中心一带，避免叠在 (100,100)
  const c = viewportCenterCanvas()
  const p = payload.pos && payload.pos.x ? payload.pos : { x: c.x - 110 + Math.random() * 60, y: c.y - 70 + Math.random() * 60 }
  const r = store.createEntityAndNode(Object.assign({}, payload, { pos: p }))
  if (r.ok && r.node) flash(r.node.id)
}
async function scanExternalFolder() {
  if (!window.showDirectoryPicker) { store.showToast('当前浏览器不支持文件夹选择，请用拖拽导入'); return }
  try {
    const dir = await window.showDirectoryPicker()
    const files = []
    async function walk(handle, depth) {
      if (depth > 5) return
      for await (const [, h] of handle.entries()) {
        if (h.kind === 'file') files.push(h)
        else if (h.kind === 'directory') await walk(h, depth + 1)
      }
    }
    await walk(dir, 0)
    const imgs = files.filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)).slice(0, 24)
    const auds = files.filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f.name)).slice(0, 6)
    let count = 0
    if (imgs.length) {
      const ok = []
      for (const f of imgs) {
        try {
          const buf = await f.getFile()
          const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(buf); r.onerror = () => res(null) })
          if (url) ok.push({ name: f.name, dataUrl: url })
        } catch (e) {}
      }
      // 「图片堆叠」卡片已于 2026-11-02 下线 ⇒ 批量导入的图片直接落入「相册」实体
      for (const it of ok) {
        const r = store.addPhoto({ name: it.name, dataUrl: it.dataUrl })
        if (r && r.ok) count++
      }
    }
    for (const f of auds) {
      try {
        const buf = await f.getFile()
        const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(buf); r.onerror = () => res(null) })
        if (url) { store.createEntityAndNode({ cardKind: 'audio', cardData: { title: f.name, src: url }, pos: viewportCenterCanvas() }); count++ }
      } catch (e) {}
    }
    store.showToast(count ? ('已递归扫描（最深 5 层）并导入 ' + count + ' 个媒体文件') : '未找到图片 / 音频文件')
  } catch (e) { if (e && e.name !== 'AbortError') store.showToast('扫描取消或失败') }
}

// 由当前空间的 biLinks 派生布局用的邻接边（node id → node id）
function buildLayoutEdges(list) {
  const byEntity = new Map()
  list.forEach((nd) => { if (nd.refId) byEntity.set(nd.type + ':' + nd.refId, nd.id) })
  const edges = []
  store.data.biLinks.forEach((b) => {
    if (b.deletedAt) return
    const a = byEntity.get(b.sourceType + ':' + b.sourceId)
    const c = byEntity.get(b.targetType + ':' + b.targetId)
    if (a && c && a !== c) edges.push({ from: a, to: c })
  })
  return edges
}
function layoutNodeList(subset) {
  const all = spaceNodes.value.filter((n) => !n.pinned && n.type !== 'panel')
  const list = (subset && subset.length) ? subset : all
  if (!list.length) return null
  const nodes = list.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, type: n.type, refId: n.refId, tags: n.tags }))
  const edges = buildLayoutEdges(list)
  const rootId = (selectedNode.value && list.includes(selectedNode.value)) ? selectedNode.value.id : null
  return { nodes, edges, rootId }
}
async function arrange(mode) {
  const payload = layoutNodeList(null)
  if (!payload) { store.showToast('没有可整理的节点'); return }
  animating.value = true
  layoutBusy.value = true
  clearSel()
  try {
    const positions = await requestLayout(mode, payload.nodes, payload.edges, payload.rootId, { levelGap: layoutSpacing.levelGap, rowGap: layoutSpacing.rowGap })
    payload.nodes.forEach((n) => {
      const p = positions[n.id]
      if (!p) return
      const node = spaceNodes.value.find((x) => x.id === n.id)
      if (!node) return
      node.x = snap(p.x); node.y = snap(p.y)
      persistNodePos(node)
    })
  } catch (e) {
    // 主线程兜底（Worker 不可用时已在 requestLayout 内处理，这里再保险一层）
    const positions = computeLayout(mode, payload.nodes, payload.edges, payload.rootId, { levelGap: layoutSpacing.levelGap, rowGap: layoutSpacing.rowGap })
    payload.nodes.forEach((n) => {
      const p = positions[n.id]; if (!p) return
      const node = spaceNodes.value.find((x) => x.id === n.id)
      if (!node) return
      node.x = snap(p.x); node.y = snap(p.y); persistNodePos(node)
    })
  }
  setTimeout(() => { animating.value = false; layoutBusy.value = false; fitView() }, 660)
  const m = LAYOUT_MODES.find((x) => x.mode === mode)
  store.showToast('已整理为' + (m ? m.label : mode) + (isWorkerLayoutEnabled() ? '' : '（本地计算）'))
}
// 局部：仅对选中的节点生效（在选中包围盒内重新排布）
function organizeSelected() {
  const list = spaceNodes.value.filter((n) => selected.value.has(n.id) && !n.pinned && n.type !== 'panel')
  if (!list.length) { store.showToast('请先框选要整理的节点'); return }
  animating.value = true
  const minX = Math.min.apply(null, list.map((n) => n.x))
  const minY = Math.min.apply(null, list.map((n) => n.y))
  list.forEach((n, i) => { n.x = snap(minX + (i % 4) * 280); n.y = snap(minY + Math.floor(i / 4) * 200); persistNodePos(n) })
  setTimeout(() => { animating.value = false }, 660)
  store.showToast('已整理选中的 ' + list.length + ' 个节点')
}

function ensureNode(type, id, opts) {
  const c = (opts && opts.center) ? viewportCenterCanvas() : { x: (opts && opts.x) || 60, y: (opts && opts.y) || 60 }
  const r = store.ensureWhiteboardNodeForEntity({ type, refId: id, x: Math.round(c.x - 110), y: Math.round(c.y - 70), color: (opts && opts.color) || 'amber' })
  if (r.ok && r.node) flash(r.node.id)
  return r.node
}
function focusNode(node) {
  if (node && node.spaceId && node.spaceId !== currentSpaceId.value) {
    transitionSpace(node.spaceId, () => doFocusNode(node))
  } else doFocusNode(node)
}
function doFocusNode(node) {
  const vp = viewport.value
  if (!vp || !node) return
  panX.value = vp.clientWidth / 2 - (node.x + node.w / 2) * scale.value
  panY.value = vp.clientHeight / 2 - (node.y + node.h / 2) * scale.value
  flash(node.id)
}
function onDrop(e) {
  e.preventDefault(); e.stopPropagation()
  const files = Array.from(e.dataTransfer.files || [])
  if (files.length) {
    files.forEach((f) => incubateFile(f, {}))
    store.showToast('已拖入 ' + files.length + ' 个文件并孵化节点')
    return
  }
  // 拖入纯文本 / 链接 → 在落点生成便利贴（Miro / tldraw 标配）
  const text = (e.dataTransfer.getData('text/plain') || '').trim()
  if (text) {
    store.pushHistory()
    const c = clientToCanvas(e.clientX, e.clientY)
    store.addWhiteboardNode({
      type: 'card', cardKind: 'note', text: text.slice(0, 2000),
      x: snap(Math.round(c.x - 110)), y: snap(Math.round(c.y - 70)),
      w: 220, h: 140, color: 'blue', spaceId: currentSpaceId.value || null
    })
    store.showToast('已生成便利贴')
  }
}

// ---- 连线几何 ----
// 连线端点 = 中心连线与卡片边框的交点（箭头贴边，不被卡片遮住）
function rectEdgePoint(cx, cy, tx, ty, w, h) {
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const sx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy) * 1.02 // 稍出边一点，箭头压在卡沿上
  return { x: cx + dx * s, y: cy + dy * s }
}
const edgeGeom = computed(() => {
  const vis = new Set(renderedNodes.value.map((n) => n.id))
  const dim = new Map(renderedNodes.value.map((n) => [n.id, n]))
  return edges.value.map((e) => {
    if (!vis.has(e.from) || !vis.has(e.to)) return null
    const a = absMap.value.get(e.from); const b = absMap.value.get(e.to)
    const na = dim.get(e.from), nb = dim.get(e.to)
    if (!a || !b || !na || !nb) return null
    const acx = a.x + na.w / 2, acy = a.y + na.h / 2
    const bcx = b.x + nb.w / 2, bcy = b.y + nb.h / 2
    const p1 = rectEdgePoint(acx, acy, bcx, bcy, na.w, na.h)
    const p2 = rectEdgePoint(bcx, bcy, acx, acy, nb.w, nb.h)
    // 水平主导的三次贝塞尔：平滑曲线（替代生硬直线）
    const dx = p2.x - p1.x
    const c = Math.min(160, Math.max(30, Math.abs(dx) * 0.42))
    const d = 'M ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) +
      ' C ' + (p1.x + c).toFixed(1) + ' ' + p1.y.toFixed(1) +
      ', ' + (p2.x - c).toFixed(1) + ' ' + p2.y.toFixed(1) +
      ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1)
    return { id: e.id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, d }
  }).filter(Boolean)
})
const edges = computed(() => store.data.whiteboardEdges.filter((e) => !e.deletedAt))

function bringToFront(n, silent) {
  const arr = store.data.whiteboardNodes
  const i = arr.findIndex((x) => x.id === n.id)
  if (i < 0 || i === arr.length - 1) return
  arr.splice(i, 1); arr.push(n); store.persist()
  if (!silent) store.showToast('已置顶')
}
function sendToBack(n) {
  const arr = store.data.whiteboardNodes
  const i = arr.findIndex((x) => x.id === n.id)
  if (i <= 0) return
  arr.splice(i, 1); arr.unshift(n); store.persist(); store.showToast('已置底')
}

// ---- 右键菜单（精简：画布专属操作 + 核心 4 项；备份在设置、搜索在侧栏，不在此重复）----
function onBlankMenu(e) {
  // 右键菜单只承载「系统 / 视图 / 画布状态」类动作；
  // 高频的「智能布局 / 一键配色 / 新建 / 绘图 / 导出」已上收到底部 Dock，避免两处职责重叠。
  const items = [
    { icon: 'folder', label: '新建空间', action: () => createSpace() },
    { icon: 'grid', label: gridOn.value ? '关闭网格' : '显示网格', action: toggleGrid },
    { icon: 'lock', label: canvasLocked.value ? '解锁画布' : '锁定画布', action: toggleLock },
    { icon: 'reset', label: '刷新数据', action: () => refreshData(store) },
    { icon: 'cloud', label: '立即备份', action: () => backupNow(store) },
    { icon: 'settings', label: '设置', action: () => router.push('/settings') }
  ]
  openContextMenu(e, items)
}
function onNodeMenu(node, e) {
  if (canvasLocked.value) return
  const items = [
    { icon: 'link', label: '连线到另一张卡', action: () => startConnectFrom(node) },
    { icon: 'chevup', label: '置顶', action: () => bringToFront(node) },
    { icon: 'chevdown', label: '置底', action: () => sendToBack(node) },
    { icon: 'pin', label: node.pinned ? '取消固定' : '固定位置', action: () => { const willPin = !node.pinned; store.updateWhiteboardNode(node.id, { pinned: willPin }); store.showToast(willPin ? '已固定位置' : '已取消固定') } },
    { icon: 'tag', label: '打标签', action: () => openTag(node) },
    { icon: 'trash', label: '删除', danger: true, action: () => { store.deleteWhiteboardNode(node.id); selected.value.delete(node.id); selectedNode.value = null } }
  ]
  if (node.stackId) {
    items.push({ icon: 'grid', label: '展开预览', action: () => openStackDrawer(node.stackId) })
    items.push({ icon: 'columns', label: '全部平铺', action: () => flattenStack(node.stackId) })
    items.push({ icon: 'arrowup', label: '移出顶层卡片', action: () => extractTopCard(node.stackId) })
    items.push({ icon: 'layers', label: '打散堆叠', action: () => scatterStack(node.stackId) })
  }
  openContextMenu(e, {
    title: '节点操作', items,
    colors: COLOR_KEYS.map((c) => ({ key: c.key, label: c.label })),
    onColor: (key) => store.updateWhiteboardNode(node.id, { color: key })
  })
}
function onSpaceMenu(sp, e) {
  openContextMenu(e, {
    title: '空间',
    items: [
      { icon: 'folder', label: '进入', action: () => enterSpace(sp.id) },
      { icon: 'edit', label: '重命名', action: () => openSpaceRename(sp) },
      { icon: 'trash', label: '删除空间', danger: true, action: () => deleteSpace(sp.id) }
    ]
  })
}
function onEdgeMenu(edge, e) {
  openContextMenu(e, [{ icon: 'trash', label: '删除连线', danger: true, action: () => deleteEdge(edge) }])
}
async function deleteEdge(edge) {
  store.pushHistory()
  const a = spaceNodes.value.find((n) => n.id === edge.from)
  const b = spaceNodes.value.find((n) => n.id === edge.to)
  if (a && b) store.disconnectNodes(a.id, b.id)
  else store.deleteWhiteboardEdge(edge.id)
}
async function onEdgeClick(e) {
  const ok = await dialog.confirm({ title: '删除连线', message: '确定删除这条关联连线吗？', confirmText: '删除', danger: true })
  if (ok) deleteEdge(e)
}

// ---- 标签 / 重命名 / 编辑 ----
const tagTarget = ref(null)
const tagText = ref('')
function openTag(n) { tagTarget.value = n; tagText.value = (n.tags || []).join(', ') }
function saveTag() { if (tagTarget.value) { store.setNodeTags(tagTarget.value.id, tagText.value); store.showToast('已更新标签') } tagTarget.value = null }
const spaceRename = ref(null)
function openSpaceRename(sp) { spaceRename.value = sp; tagText.value = sp.name }
function saveSpaceName() { if (spaceRename.value) { store.updateSpace(spaceRename.value.id, { name: tagText.value || '未命名空间' }); store.showToast('已重命名空间') } spaceRename.value = null }
const editNodeTarget = ref(null)
const editText = ref('')
function editNode(n) { editNodeTarget.value = n; editText.value = n.text || (resolve(n) && (resolve(n).title || resolve(n).name)) || ''; clearSel() }
function saveNodeEdit() {
  const n = editNodeTarget.value
  if (!n) return
  const text = editText.value
  store.updateWhiteboardNode(n.id, { text })
  if (n.refId) {
    if (n.type === 'memo') store.updateMemo(n.refId, { title: text.slice(0, 60) || '无标题' })
    else if (n.type === 'task') store.updateTask(n.refId, { title: text.slice(0, 60) || '未命名任务' })
    else if (n.type === 'item') store.updateItem(n.refId, { name: text.slice(0, 60) || '未命名物品' })
    else if (n.type === 'collection') store.updateCollection(n.refId, { title: text.slice(0, 60) || '未命名收藏' })
    else if (n.type === 'location') store.updateLocation(n.refId, { name: text.slice(0, 60) || '未命名地点' })
  }
  editNodeTarget.value = null
}

function doExport() { exportCanvas(spaceNodes.value, edges.value, resolve); store.showToast('已导出画布只读 HTML') }
function onNavigate(r) { if (typeof r === 'string') { router.push('/' + r); return } gotoEntity({ type: r.type, id: r.id, router }) }
function onJump(r) { if (r) router.push('/' + r) }

// ---- 卡片矩阵：内联 patch + 编辑 ----
function onCardPatch(n, patch) {
  const cur = Object.assign({}, n.cardData || {}, patch)
  store.updateWhiteboardNode(n.id, { cardData: cur })
}
const cardEditTarget = ref(null)
const cardEditText = ref('')
const cardEditJson = ref('')
function openCardEditor(n) {
  cardEditTarget.value = n
  const d2 = n.cardData || {}
  cardEditText.value = (n.cardKind === 'text' || n.cardKind === 'note') ? (d2.markdown || d2.text || '') : ''
  cardEditJson.value = JSON.stringify(d2, null, 2)
}
function saveCardEdit() {
  const n = cardEditTarget.value
  if (!n) return
  let data
  try { data = JSON.parse(cardEditJson.value || '{}') } catch (e) { store.showToast('JSON 格式错误'); return }
  if ((n.cardKind === 'text' || n.cardKind === 'note') && cardEditText.value) { data.markdown = cardEditText.value; data.text = cardEditText.value }
  store.updateWhiteboardNode(n.id, { cardData: data })
  cardEditTarget.value = null
  store.showToast('已更新卡片')
}

// ---- 空间（Space）导航 + 3D 动效 + 视口记忆 ----
function saveViewport(id) {
  if (!id) return
  store.updateSpace(id, { viewport: { panX: panX.value, panY: panY.value, scale: scale.value } })
}
function restoreViewport(id) {
  if (!id) { panX.value = 40; panY.value = 40; scale.value = 1; return }
  const sp = allSpaces.value.find((s) => s.id === id)
  if (sp && sp.viewport) { panX.value = sp.viewport.panX; panY.value = sp.viewport.panY; scale.value = sp.viewport.scale }
  else { panX.value = 40; panY.value = 40; scale.value = 1 }
}
function transitionSpace(targetId, after) {
  const leaving = currentSpaceId.value
  if (leaving) saveViewport(leaving)
  spaceAnim.value = 'out'
  setTimeout(() => {
    currentSpaceId.value = targetId || null
    nextTick(() => {
      if (targetId) restoreViewport(targetId)
      else { panX.value = 40; panY.value = 40; scale.value = 1 }
      spaceAnim.value = 'in'
      setTimeout(() => {
        spaceAnim.value = ''
        if (after) after()
        else fitView()
      }, 460)
    })
  }, 260)
}
// （已移除：顶部多标签页 —— 顶栏取消，空间切换统一走面包屑 / 空间卡片双击 / Esc 回根）
function enterSpace(id) { transitionSpace(id) }
function goUp() { if (currentSpaceId.value) { const pid = currentSpace.value ? currentSpace.value.parentId : null; transitionSpace(pid) } }
// Esc：直接回到根空间（跨越多级嵌套）
function goRoot() { if (currentSpaceId.value) { selectedSpaceId.value = null; transitionSpace(null) } }
function goCrumb(i) {
  const c = breadcrumb.value[i]
  if (!c) return
  transitionSpace(c.id || null)
}
function onSpaceCardDown(sp, e) {
  // 空间卡片可拖拽：与实体节点同一套「阈值 + 绝对坐标」手势；
  // 双击进入仍由 dblclick 处理，拖动结束用 suppressClickUntil 抑制误选中。
  if (e && e.button !== undefined && e.button !== 0) return
  if (connectMode.value || canvasLocked.value) return
  if (e && e.target && e.target.closest && e.target.closest('button, input, textarea, [contenteditable="true"]')) return
  const s = scale.value
  let sx = e.clientX, sy = e.clientY
  const ox = sp.x, oy = sp.y
  let dragging = false
  let aborted = false
  function mv(ev) {
    if (!dragging) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_THRESHOLD) return
      dragging = true
      sp._dragging = true
      store.pushHistory()
      sx = ev.clientX; sy = ev.clientY
    }
    if (aborted) return
    sp.x = ox + (ev.clientX - sx) / s
    sp.y = oy + (ev.clientY - sy) / s
  }
  function cleanup() {
    window.removeEventListener('pointermove', mv)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  function up() {
    cleanup()
    dragAbort = null
    sp._dragging = false
    if (aborted) return
    if (!dragging) { selectedSpaceId.value = sp.id; return }
    store.updateSpace(sp.id, { x: Math.round(sp.x), y: Math.round(sp.y) })
    suppressClickUntil = Date.now() + 220
    dragGuard.suppressJumpUntil = Date.now() + 260
  }
  dragAbort = () => { aborted = true; cleanup(); sp._dragging = false; dragAbort = null }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
}
function onSpaceClick(sp) {
  if (Date.now() < suppressClickUntil) return
  selectedSpaceId.value = sp.id
}
function createSpace() {
  const c = viewportCenterCanvas()
  // v2.1.0：空间图标统一为矢量线性图标（IconHub folder），不再写死 Emoji 字符
  const sp = store.addSpace({ name: '新空间', emoji: '', parentId: currentSpaceId.value || null, x: Math.round(c.x - 120), y: Math.round(c.y - 84) })
  if (sp.ok) store.showToast('已创建空间，双击进入')
}
function deleteSpace(id) {
  store.deleteSpace(id)
  if (currentSpaceId.value === id) currentSpaceId.value = null
  store.showToast('已删除空间（内容已上移）')
}
function spaceCardStyle(sp) { return { left: sp.x + 'px', top: sp.y + 'px', width: sp.w + 'px', height: sp.h + 'px' } }

// ---- 画布桥 ----
// ---- 画布启动骨架屏：铺版 + 首次自适应完成前不露出画布，杜绝切换路由时的跳变 ----
const wbReady = ref(false)
function revealCanvas() {
  if (wbReady.value) return
  requestAnimationFrame(() => requestAnimationFrame(() => { wbReady.value = true }))
}
// 画布是否已完成过一次「首屏自适应」—— KeepAlive 下组件不销毁，
// 从别的页面切回来时不能再 fitView()（否则用户的缩放/平移会被重置）。
let canvasFitted = false
// 首屏初始化进行中（KeepAlive 下 onMounted 与 onActivated 会连续触发，需去重）
let canvasBooting = false
function ensureCanvasReady() {
  store.reconcileCanvasPanels()
  store.setQuickAdd(() => openCreateAtCenter())
  if (canvasFitted) {
    // 返回主页：视口原样保留，只做数据对账与骨架屏收尾，绝不重置缩放/平移
    nextTick(() => { applyPendingFocus(); revealCanvas() })
    return
  }
  if (canvasBooting) return
  canvasBooting = true
  // 首屏：整版卡片一起适应视口（Bento 版式是完整一幅画，不能只框住日历）
  nextTick(() => { fitView(); applyPendingFocus(); revealCanvas() })
  // 版式可能在首帧后才对账完成 → 补一次自适应，保证整版居中
  setTimeout(() => { if (!currentSpaceId.value) fitView(); revealCanvas(); canvasFitted = true; canvasBooting = false }, 420)
}
function applyPendingFocus() {
  const p = consumeCanvasFocus()
  if (!p) return
  let node = store.data.whiteboardNodes.find((n) => !n.deletedAt && n.type === p.type && n.refId === p.id)
  if (!node) {
    const r = store.ensureWhiteboardNodeForEntity({ type: p.type, refId: p.id, x: 60, y: 60, color: 'amber' })
    node = r && r.node
  }
  if (node) { selectedNode.value = node; focusNode(node) }
}
function onSpaceKey(e) {
  if (e.code !== 'Space' && e.key !== ' ') return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.type === 'keydown') { e.preventDefault(); spaceDown.value = true }
  else { spaceDown.value = false }
}
function onCaptureSpacePan(e) {
  if (!spaceDown.value) return
  if (e.target.closest('.wb-dock') || e.target.closest('.modal') || e.target.closest('.cs-mask') || e.target.closest('.ces-mask') || e.target.closest('.search-mask')) return
  e.stopPropagation(); startSpacePan(e)
}
onMounted(() => {
  registerCanvas({ ensureNodeForEntity: ensureNode, focusNode, isCanvasActive: () => true })
  window.addEventListener('keydown', onSpaceKey)
  window.addEventListener('keyup', onSpaceKey)
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('paste', onWindowPaste)
  if (viewport.value) viewport.value.addEventListener('pointerdown', onCaptureSpacePan, true)
  if (store.ready) { ensureCanvasReady() }
  else { const stop = watch(() => store.ready, (v) => { if (v) { stop(); ensureCanvasReady() } }) }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('paste', onWindowPaste)
  window.removeEventListener('keydown', onSpaceKey)
  window.removeEventListener('keyup', onSpaceKey)
  if (stackIndicatorTimer) { clearTimeout(stackIndicatorTimer); stackIndicatorTimer = null }
  if (stackFlipTimer) { clearTimeout(stackFlipTimer); stackFlipTimer = null }
  clearStackHover()
})
onActivated(() => {
  registerCanvas({ ensureNodeForEntity: ensureNode, focusNode, isCanvasActive: () => true })
  if (viewport.value && !viewport.value.__eoSpaceBound) {
    viewport.value.addEventListener('pointerdown', onCaptureSpacePan, true)
    viewport.value.__eoSpaceBound = true
  }
  ensureCanvasReady()
})
onDeactivated(() => { unregisterCanvas(); store.setQuickAdd(null); spaceDown.value = false })
</script>

<template>
  <div class="wb-page" :class="{ 'eo-flat': flatMode, 'wb-booting': !wbReady }" :style="{ '--eo-card-a': cardAlpha }" @mousedown="onRootMouseDown" @dblclick="onRootDblClick">
    <!-- 启动骨架屏：画布完成铺版与首帧自适应前遮挡，杜绝路由切换时的闪烁 / 跳动 -->
    <transition name="fade">
      <div v-if="!wbReady" class="wb-boot" aria-hidden="true">
        <span class="wb-boot__ring"></span>
        <span class="wb-boot__t">正在铺开主页…</span>
      </div>
    </transition>
    <!-- 面包屑（模块二：路径导航；无顶栏，浮于画布之上） -->
    <div class="wb-crumbs glass" v-if="breadcrumb.length > 1">
      <button v-for="(c, i) in breadcrumb" :key="(c.id || 'root') + '-' + i" class="wb-crumb"
        :class="{ active: i === breadcrumb.length - 1 }" @click="goCrumb(i)">
        <span class="wb-crumb__ico"><Icon :name="c.id ? 'folder' : 'home'" :size="13" /></span>{{ c.name }}
      </button>
    </div>

    <div class="wb-viewport" ref="viewport"
      @pointerdown="startPan" @wheel="onWheel"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd"
      @contextmenu.prevent.stop="onBlankMenu" @dblclick="onBlankDblClick" @click="onBlankClick"
      @dragover.prevent @drop.prevent="onDrop">
      <div class="wb-fx" :class="spaceAnimClass">
        <div class="wb-layer" :class="{ 'wb-animating': animating, 'wb-stack-flipping': stackFlipping, 'wb-stack-dragging': stackDragging }" :style="layerStyle">
          <!-- 网格层（随画布平移缩放，Excalidraw 行为）：仅在开启时渲染 -->
          <div v-if="gridOn" class="wb-gridlayer" aria-hidden="true"></div>
          <!-- 空间卡片（枢纽 / 嵌套空间的入口）—— 图标统一矢量线性，支持拖拽 -->
          <div v-for="sp in childSpaces" :key="sp.id" class="wb-space-card glass"
            :class="['sp-' + sp.color, { 'is-selected': selectedSpaceId === sp.id, 'wb-dragging': sp._dragging }]"
            :style="spaceCardStyle(sp)" :data-space-id="sp.id"
            @dblclick.stop="enterSpace(sp.id)" @pointerdown="onSpaceCardDown(sp, $event)"
            @click.stop="onSpaceClick(sp)"
            @contextmenu.prevent.stop="onSpaceMenu(sp, $event)">
            <div class="wb-space-card__icon"><Icon name="folder" :size="26" /></div>
            <div class="wb-space-card__body">
              <div class="wb-space-card__name">{{ sp.name }}</div>
              <div class="wb-space-card__meta">{{ spaceNodeCount(sp.id) + spaceChildCount(sp.id) }} 项 · 双击进入</div>
            </div>
            <div class="wb-space-card__badge"><Icon name="compass" :size="15" /></div>
          </div>

          <!-- 连线 + 磁吸辅助线 -->
          <svg class="wb-edges" width="10" height="10">
            <defs>
              <marker id="wb-arrow" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(148, 145, 140, .95)" stroke="none" />
              </marker>
            </defs>
            <g v-for="g in edgeGeom" :key="g.id">
              <path class="wb-edge" :d="g.d" marker-end="url(#wb-arrow)" @click.stop="onEdgeClick(g)" @contextmenu.stop.prevent="onEdgeMenu(g, $event)" />
            </g>
            <line v-for="(x, i) in guideV" :key="'gv' + i" :x1="x" :y1="-99999" :x2="x" :y2="99999" stroke="rgba(44, 44, 44, .9)" stroke-width="1.5" stroke-dasharray="4 3" />
            <line v-for="(y, i) in guideH" :key="'gh' + i" :x1="-99999" :y1="y" :x2="99999" :y2="y" stroke="rgba(44, 44, 44, .9)" stroke-width="1.5" stroke-dasharray="4 3" />
          </svg>

          <!-- 节点（视口裁剪：屏幕外节点跳过渲染；深于第 3 层的堆叠卡不再渲染） -->
          <EntityNode
            v-for="n in visibleRenderNodes" :key="n.id"
            :node="n" :entity="resolve(n)" :pos="posOf(n)"
            :stack-beneath="isBeneathNode(n)" :stack-w="stackTopW(n)" :stack-h="stackTopH(n)"
            :stack-count="stackCountOf(n)" :stack-edge="isStackEdge(n)" :stack-deep="isStackDeep(n)"
            :stack-level="stackLevelOf(n)"
            :data-stack-top="isStackTop(n) ? '1' : '0'"
            :data-stack-beneath="isBeneathNode(n) ? '1' : '0'"
            :selected="(selectedNode && selectedNode.id === n.id)"
            :class="{ 'wb-flash': flashingId === n.id, 'wb-selected': (selectedNode && selectedNode.id === n.id) || selected.has(n.id) || n._sel, 'wb-link-src': linkSource === n.id, 'wb-dragging': n._dragging, 'wb-pinned': n.pinned, 'wb-settle': n._settle, 'eo-lift': n._lift, 'wb-stack-target': stackHoverId === n.id }"
            @resize-start="(e) => startResize(n, e)"
            @press-down="(e) => onNodePointerDown(n, e)"
            @menu="(ev) => onNodeMenu(n, ev)"
            @stack-menu="(ev) => onStackMenu(n, ev)"
            @stack-expand="openStackDrawer(n.stackId)"
            @select="onNodeSelectLike(n)"
            @connect="startConnectFrom(n)"
            @edit="onNodeDbl(n)"
            @patch="(p) => onCardPatch(n, p)"
            @navigate="onNavigate"
            @jump="(r) => onJump(r)" />

          <!-- 绘图层（画笔 / 形状 / 抬笔成型） -->
          <CanvasDrawLayer v-if="drawMode" ref="drawLayerRef"
            :space-id="currentSpaceId" :tool="drawTool" :color="drawColor"
            :width="drawWidth" :opacity="drawOpacity" :recognize="drawRecognize" :scale="scale" />
        </div>
      </div>

      <!-- 框选矩形 -->
      <div v-if="boxSel.active" class="wb-boxsel" :style="{ left: Math.min(boxSel.x0, boxSel.x1) + 'px', top: Math.min(boxSel.y0, boxSel.y1) + 'px', width: Math.abs(boxSel.x1 - boxSel.x0) + 'px', height: Math.abs(boxSel.y1 - boxSel.y0) + 'px' }"></div>

      <!-- v2.2.5：堆叠翻页进度指示器（滚轮翻页时浮现在卡片右侧） -->
      <transition name="wb-si">
        <div v-if="stackIndicator" class="wb-stack-ind" :style="{ left: stackIndicator.left + 'px', top: stackIndicator.top + 'px' }">
          <span class="wb-stack-ind__p">{{ stackIndicator.page }}</span>
          <span class="wb-stack-ind__sep">/</span>
          <span class="wb-stack-ind__t">{{ stackIndicator.total }}</span>
        </div>
      </transition>

      <div v-if="!spaceNodes.length && !childSpaces.length" class="wb-empty">
        <EmptyState icon="layout" title="这个空间还是空的" subtitle="双击空白处新建内容 · 或点击右下角 + 添加卡片" />
      </div>

    </div>

    <!-- 极简工具条：新建 / 绘图 / 导出（搜索在侧栏、适应视图在右下缩放控件，不在此重复） -->
    <div class="wb-dock glass">
      <button class="wb-btn primary" @click="openCreateAtCenter" title="新建卡片或便利贴"><Icon name="plus" :size="18" /></button>
      <button class="wb-btn" :class="{ 'wb-btn--on': drawMode }" @click="toggleDraw" :title="drawMode ? '退出绘图' : '自由绘图（松手自动识别形状）'"><Icon name="pen" :size="16" /></button>
      <button class="wb-btn" @click="layoutOpen = true" title="智能布局：一键整理画布排布"><Icon name="layout" :size="16" /></button>
      <button class="wb-btn" @click="colorOpen = true" title="一键配色：为选中卡片分配协调配色"><Icon name="palette" :size="16" /></button>
      <button class="wb-btn" @click="doExport" title="导出只读 HTML"><Icon name="download" :size="16" /></button>
    </div>

    <!-- 绘图工具栏：工具 / 颜色 / 笔宽 / 形状识别 / 清空 / 退出（drawMode 时浮现） -->
    <div v-if="drawMode" class="wb-drawbar glass">
      <div class="wb-drawbar__tools">
        <button v-for="t in DRAW_TOOLS" :key="t.key" class="wb-drawbar__t" :class="{ active: drawTool === t.key }" @click="drawTool = t.key">{{ t.label }}</button>
      </div>
      <div class="wb-drawbar__row">
        <span v-for="c in DRAW_COLORS" :key="c" class="wb-drawbar__c" :class="{ on: drawColor === c }" :style="{ background: c }" @click="drawColor = c"></span>
        <label class="wb-drawbar__chk"><input type="checkbox" v-model="drawRecognize" /> 识别</label>
        <input type="range" min="1" max="24" v-model.number="drawWidth" />
        <button class="wb-drawbar__x" @click="clearDraw">清空</button>
        <button class="wb-drawbar__x" @click="toggleDraw">退出</button>
      </div>
    </div>

    <!-- 缩放控件（右下角，tldraw / Excalidraw 标配） -->
    <div class="wb-zoomwrap">
      <button v-if="canvasLocked" class="wb-locktip glass" title="画布已锁定 · 点击解锁" @click="toggleLock">
        <Icon name="lock" :size="13" /><span>已锁定</span>
      </button>
      <div class="wb-zoom glass">
        <button class="wb-zoom__btn" @click="zoom(1)" title="放大"><Icon name="plus" :size="13" /></button>
        <button class="wb-zoom__val" @click="resetZoom" title="重置为 100%">{{ zoomPct }}%</button>
        <button class="wb-zoom__btn" @click="zoom(-1)" title="缩小"><Icon name="minus" :size="13" /></button>
        <button class="wb-zoom__btn" @click="fitView" title="适应视图"><Icon name="reset" :size="13" /></button>
      </div>
    </div>

    <!-- 小地图（右上角常驻缩略图，点击跳转） -->
    <div v-if="minimapOn && miniView.W" class="wb-minimap" title="小地图 · 点击跳转"
      @pointerdown.stop.prevent="minimapJump" @wheel.prevent>
      <span v-for="(m, i) in miniView.nodes" :key="i" class="wb-minimap__node"
        :style="{ left: (m.x * 100) + '%', top: (m.y * 100) + '%', width: Math.max(2, m.w * 100) + '%', height: Math.max(2, m.h * 100) + '%' }"></span>
      <span v-if="miniView.vp" class="wb-minimap__vp"
        :style="{ left: (miniView.vp.x * 100) + '%', top: (miniView.vp.y * 100) + '%', width: (miniView.vp.w * 100) + '%', height: (miniView.vp.h * 100) + '%' }"></span>
    </div>

    <StackDrawer :show="stackDrawer.open" :items="stackDrawerItems" :total="stackDrawerItems.length"
      @close="closeStackDrawer" @pick="drawerPick" @extract="drawerExtract" @flatten="onDrawerFlatten" />
    <CanvasCommandPalette :show="aiOpen" :context-text="aiContextText()" @close="aiOpen = false" @create="onAiCreate" />
    <CanvasCreateSheet :show="createOpen" @close="createOpen = false" @create="onCreateSheet" />
    <Modal title="编辑内容" :show="!!editNodeTarget" @close="editNodeTarget = null">
      <div class="field">
        <label>内容</label>
        <textarea v-model="editText" rows="4" placeholder="输入文本…" style="width:100%;resize:vertical"></textarea>
      </div>
      <button class="btn" style="width:100%" @click="saveNodeEdit"><Icon name="checklist" :size="16" /> 保存</button>
    </Modal>
    <Modal title="节点标签" :show="!!tagTarget" @close="tagTarget = null">
      <div class="field">
        <label>标签（逗号分隔，如 工作,生活）</label>
        <input v-model="tagText" placeholder="工作,生活" />
        <div class="muted" style="font-size:12px;margin-top:4px">同标签节点在「一键整理」时会自动聚拢成组。</div>
      </div>
      <button class="btn" style="width:100%" @click="saveTag"><Icon name="checklist" :size="16" /> 保存标签</button>
    </Modal>
    <Modal title="空间命名" :show="!!spaceRename" @close="spaceRename = null">
      <div class="field">
        <label>空间名称</label>
        <input v-model="tagText" placeholder="如 工作区 / 生活区" />
      </div>
      <button class="btn" style="width:100%" @click="saveSpaceName"><Icon name="checklist" :size="16" /> 保存</button>
    </Modal>

    <!-- 卡片编辑（结构化 cardData） -->
    <Modal title="编辑卡片" :show="!!cardEditTarget" @close="cardEditTarget = null">
      <div v-if="cardEditTarget" class="field">
        <label>卡片类型：{{ (cardEditTarget.cardKind) }}</label>
      </div>
      <div v-if="cardEditTarget && (cardEditTarget.cardKind === 'text' || cardEditTarget.cardKind === 'note')" class="field">
        <label>正文（Markdown）</label>
        <textarea v-model="cardEditText" rows="4" placeholder="写点什么…"></textarea>
      </div>
      <div class="field">
        <label>卡片数据（JSON，高级）</label>
        <textarea v-model="cardEditJson" rows="6" placeholder='{"key":"value"}' style="font-family:monospace;font-size:11px"></textarea>
      </div>
      <button class="btn" style="width:100%" @click="saveCardEdit"><Icon name="checklist" :size="16" /> 保存卡片</button>
    </Modal>

    <!-- 智能布局面板（5 大引擎 + 间距调节 + 连线优化） -->
    <Modal title="智能布局" :show="layoutOpen" @close="layoutOpen = false">
      <div class="lo-grid">
        <button v-for="m in LAYOUT_MODES" :key="m.mode" class="lo-item" :class="{ busy: layoutBusy }"
          @click="arrange(m.mode); layoutOpen = false">
          <Icon :name="m.icon" :size="18" />
          <span class="lo-item__t">{{ m.label }}</span>
          <span class="lo-item__d">{{ m.desc }}</span>
        </button>
      </div>
      <div class="lo-sp">
        <label>层级间距 <b>{{ layoutSpacing.levelGap }}</b></label>
        <input type="range" min="160" max="520" step="20" v-model.number="layoutSpacing.levelGap" />
        <label>节点间距 <b>{{ layoutSpacing.rowGap }}</b></label>
        <input type="range" min="120" max="320" step="20" v-model.number="layoutSpacing.rowGap" />
      </div>
      <div class="muted" style="font-size:11px;margin-top:8px">
        布局计算在 Web Worker 中执行（{{ isWorkerLayoutEnabled() ? '已启用，不阻塞界面' : '当前环境降级为主线程' }}），可对整个空间或仅对选中节点生效。
      </div>
    </Modal>


    <!-- 自动配色面板 -->
    <Modal title="一键自动配色" :show="colorOpen" @close="colorOpen = false">
      <div class="csp-list">
        <button v-for="s in COLOR_SCHEMES" :key="s.key" class="csp-item" :class="{ on: colorSchemeKey === s.key }" @click="colorSchemeKey = s.key">
          <span class="csp-item__name">{{ s.label }}</span>
          <span class="csp-item__dots">
            <i v-for="(c, i) in s.colors" :key="i" :class="'c-' + c"></i>
          </span>
        </button>
      </div>
      <div class="muted" style="font-size:11px;margin:6px 0 10px">将为选中的 {{ selected.size }} 张卡片按方案顺序分配协调色。</div>
      <button class="btn" style="width:100%" @click="autoColorSelected"><Icon name="palette" :size="16" /> 应用配色</button>
    </Modal>
  </div>
</template>

<style scoped>
.wb-page {
  position: fixed;
  top: 0;
  left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 86px);
}
@media (min-width: 900px) { .wb-page { left: var(--eo-sidebar-w); bottom: 0; } }

/* 启动骨架屏：铺版完成前遮挡画布（画布淡入，绝不出现跳变） */
.wb-boot {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(250, 248, 243, 0.72);
  backdrop-filter: blur(10px) saturate(150%);
  -webkit-backdrop-filter: blur(10px) saturate(150%);
}
[data-theme='dark'] .wb-boot { background: rgba(28, 28, 30, 0.72); }
.wb-boot__ring {
  width: 30px; height: 30px; border-radius: 50%;
  border: 2.5px solid var(--eo-glass-border); border-top-color: var(--eo-primary);
  animation: wbBootSpin .8s linear infinite;
}
.wb-boot__t { font-size: 12.5px; font-weight: 700; color: var(--eo-ink-soft); letter-spacing: .04em; }
@keyframes wbBootSpin { to { transform: rotate(360deg); } }
/* 铺版期间：画布整体静默，避免用户看到中途的缩放/位移 */
.wb-page.wb-booting .wb-viewport { opacity: 0; }
.wb-viewport { transition: opacity .3s ease; }

.wb-viewport {
  position: absolute; inset: 0; overflow: hidden; cursor: grab;
  /* 视觉净化：画布纯粹留白，透出应用级极浅暖珍珠白底 —— 无网格 / 圆点 / 噪点 */
  background: transparent;
}
[data-theme='dark'] .wb-viewport { background: transparent; }
.wb-viewport:active { cursor: grabbing; }
.wb-fx { position: absolute; inset: 0; transform-origin: 50% 58%; }
.wb-fx.wb-space-in { animation: eo-space-in .28s ease-out forwards; }
.wb-fx.wb-space-out { animation: eo-space-out .2s ease-out forwards; }
@keyframes eo-space-in {
  0% { transform: scale(.97); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes eo-space-out {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(.97); opacity: 0; }
}
.wb-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.wb-animating .eo-node, .wb-animating .wb-space-card { transition: left .2s ease-out, top .2s ease-out; }
/* 堆叠翻页过渡统一收口在 EntityNode.vue（.wb-stack-flipping：位移 + 透明度，全组对称） */
.wb-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.wb-edges g { pointer-events: stroke; }
.wb-edges line { pointer-events: stroke; }

/* 长按抽取弹起 */
.eo-node.eo-lift { z-index: 90; box-shadow: 0 18px 40px -16px rgba(44, 44, 44, .28); transition: box-shadow .15s ease-out; }

/* 空间卡片（3D 文件夹） */
.wb-space-card {
  position: absolute; box-sizing: border-box; border-radius: 14px; cursor: pointer; user-select: none; -webkit-user-select: none;
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: var(--eo-glass-strong);
  border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow), inset 0 1px 0 rgba(255, 255, 255, .5);
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
  overflow: hidden;
}
.wb-space-card::before {
  content: ''; position: absolute; inset: 0; border-radius: 18px;
  background: linear-gradient(135deg, rgba(255,255,255,.28), rgba(255,255,255,0) 46%); pointer-events: none;
}
.wb-space-card:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow), inset 0 1px 0 rgba(255, 255, 255, .5), var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-space-card__icon {
  width: 44px; height: 44px; border-radius: 14px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-primary);
  color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 4px 10px -6px rgba(44, 44, 44, .18);
}
.wb-space-card__body { min-width: 0; flex: 1; }
.wb-space-card__name { font-size: 15px; font-weight: 800; color: var(--eo-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-space-card__meta { font-size: 11px; color: var(--eo-ink-soft); margin-top: 2px; opacity: .8; }
.wb-space-card__badge { position: absolute; right: 10px; bottom: 8px; font-size: 13px; opacity: .5; }
/* 空间卡底色：取消彩色，改用 6 级暖灰明度阶区分（原色相编码已废弃） */
.wb-space-card.sp-amber { background: linear-gradient(135deg, rgba(255,255,255,.97), rgba(252,251,248,.94)); }
.wb-space-card.sp-blue { background: linear-gradient(135deg, rgba(248, 247, 244, .96), rgba(240, 239, 235, .93)); }
.wb-space-card.sp-pink { background: linear-gradient(135deg, rgba(251, 250, 247, .96), rgba(244, 243, 239, .93)); }
.wb-space-card.sp-green { background: linear-gradient(135deg, rgba(245, 244, 240, .96), rgba(236, 235, 231, .93)); }
.wb-space-card.sp-purple { background: linear-gradient(135deg, rgba(242, 241, 238, .96), rgba(232, 231, 227, .93)); }
.wb-space-card.sp-gray { background: linear-gradient(135deg, rgba(238, 237, 233, .96), rgba(228, 227, 223, .93)); }

/* 面包屑（无顶栏，浮于画布左上） */
.wb-crumbs {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 41;
  display: flex; align-items: center; gap: 2px; padding: 5px 10px; border-radius: 999px;
  max-width: calc(100% - 24px); overflow-x: auto; scrollbar-width: none;
}
.wb-crumbs::-webkit-scrollbar { display: none; }
.wb-crumb {
  border: none; background: transparent; color: var(--eo-ink-soft); cursor: pointer;
  font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.wb-crumb:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-crumb.active { color: #fff; background: var(--eo-primary); }
.wb-crumb__ico { font-size: 13px; }

.wb-boxsel { position: absolute; border: 1.5px solid var(--eo-primary); background: rgba(44, 44, 44, .12); border-radius: 6px; pointer-events: none; z-index: 45; }

/* v2.2.5：堆叠翻页进度指示器（3 / 15） */
.wb-stack-ind {
  position: absolute; z-index: 48; pointer-events: none;
  display: flex; align-items: baseline; gap: 2px;
  padding: 4px 9px; border-radius: 999px;
  background: rgba(28, 28, 30, 0.86); color: #F5F5F7;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 10px 24px -14px rgba(30, 30, 29, 0.8);
  -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
  font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 800; letter-spacing: .02em;
}
.wb-stack-ind__p { font-size: 13px; color: #FFFCF4; }
.wb-stack-ind__sep { opacity: .45; font-size: 10px; }
.wb-stack-ind__t { opacity: .7; font-size: 10.5px; }
.wb-si-enter-active, .wb-si-leave-active { transition: opacity .18s ease, transform .18s ease; }
.wb-si-enter-from, .wb-si-leave-to { opacity: 0; transform: translateY(3px) scale(.96); }
[data-theme='dark'] .wb-stack-ind { background: rgba(20, 20, 22, 0.9); border-color: rgba(44, 44, 44, 0.14); }

/* 主工具栏（底部居中胶囊 · Haze 液态玻璃） */
.wb-dock {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  z-index: 46; display: flex; flex-direction: row; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 999px; max-width: calc(100% - 24px);
  background: var(--eo-glass-strong); border: 1px solid var(--eo-glass-border);
  -webkit-backdrop-filter: blur(22px) saturate(165%); backdrop-filter: blur(22px) saturate(165%);
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
}
.wb-sep { width: 1px; height: 22px; background: var(--eo-glass-border); margin: 0 2px; flex: none; }
.wb-btn {
  width: 36px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent;
  color: var(--eo-ink-soft); cursor: pointer; flex: none;
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.wb-btn:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-btn.active { background: var(--eo-primary); color: #fff; border-color: transparent; }
.wb-btn.primary { background: var(--eo-primary); color: #fff; border-color: transparent; width: 40px; height: 40px; }
.wb-btn.primary:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-btn--export {
  width: auto; padding: 0 14px 0 11px; gap: 6px;
  background: var(--eo-primary);
  color: #fff; border-color: transparent;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .16) inset, 0 8px 18px -10px rgba(44, 44, 44, .5);
}
.wb-btn--export:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .16) inset, var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
/* Dock 激活态（绘图模式等） */
.wb-btn--on { background: var(--eo-primary); color: #fff; }
.wb-btn--on:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}

/* 连线：平滑曲线 + 贴边箭头（悬停加深） */
.wb-edge { fill: none; stroke: rgba(168, 166, 161, .7); stroke-width: 2; cursor: pointer; transition: stroke .15s ease; }
.wb-edge:hover { stroke: rgba(44, 44, 44, .9); stroke-width: 2.5; }
[data-theme='dark'] .wb-edge { stroke: rgba(150, 148, 142, .5); }
[data-theme='dark'] .wb-edge:hover { stroke: rgba(232, 230, 225, .9); }
.wb-btn__label { font-size: 13px; font-weight: 700; letter-spacing: .04em; }

/* 缩放 + 扁平模式 */
.wb-zoomwrap { position: absolute; right: 16px; bottom: 16px; z-index: 45; display: flex; flex-direction: column; align-items: center; gap: 8px; }
/* 画布锁定指示徽章：缩放控件上方的胶囊，点击即解锁 */
.wb-locktip {
  display: flex; align-items: center; gap: 5px; border-radius: 999px; padding: 6px 12px;
  border: 1px solid var(--eo-glass-border); background: var(--eo-glass-strong); color: var(--eo-ink);
  font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 18px -10px rgba(44, 44, 44, .18);
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.wb-locktip:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: 0 8px 18px -10px rgba(44, 44, 44, .18), var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-locktip svg { color: var(--eo-ink-soft); }
.wb-flat-toggle {
  display: flex; align-items: center; gap: 5px; border-radius: 999px; padding: 6px 12px;
  border: 1px solid var(--eo-glass-border); background: var(--eo-glass-strong); color: var(--eo-ink);
  font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 18px -10px rgba(44, 44, 44, .18);
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.wb-flat-toggle:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: 0 8px 18px -10px rgba(44, 44, 44, .18), var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-flat-toggle.active { background: var(--eo-primary); color: #fff; border-color: transparent; }
.wb-zoom {
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 8px; border-radius: 999px;
  border: 1px solid var(--eo-glass-border); box-shadow: 0 10px 26px -12px rgba(44, 44, 44, .18);
}
.wb-zoom__btn { width: 24px; height: 24px; border-radius: 50%; flex: none; border: 1px solid var(--eo-glass-border); background: rgba(255, 255, 255, .4); color: var(--eo-primary-deep); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)), box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1); }
.wb-zoom__btn:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.wb-zoom__range { width: 12px; height: 116px; accent-color: var(--eo-primary); cursor: pointer; writing-mode: vertical-lr; direction: rtl; }
.wb-zoom__val { font-size: 11px; font-weight: 700; color: var(--eo-primary-deep); flex: none; font-variant-numeric: tabular-nums; }

.wb-tip {
  position: absolute; left: 16px; bottom: 78px; z-index: 40;
  display: flex; align-items: center; gap: 12px; padding: 7px 14px; border-radius: 999px;
  font-size: 11px; color: var(--eo-ink-soft); pointer-events: none; flex-wrap: wrap; max-width: 52vw;
}
.wb-tip b { color: var(--eo-primary-deep); }

@media (max-width: 899px), (orientation: portrait) and (max-width: 1024px) {
  .wb-dock { left: 50%; right: auto; top: auto; bottom: 12px; transform: translateX(-50%); flex-direction: row; justify-content: flex-start; overflow-x: auto; overflow-y: hidden; padding: 8px 10px; border-radius: 999px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .wb-dock::-webkit-scrollbar { display: none; }
  .wb-tip { display: none; }
  .wb-crumbs { top: 10px; }
}
/* 窄屏：小地图占位过大，直接收起，保证顶部干净无遮挡 */
@media (max-width: 640px) {
  .wb-minimap { display: none; }
}

.wb-flash { animation: wbflash 1.1s ease; }
@keyframes wbflash { 0%,100% { box-shadow: 0 12px 30px -14px rgba(44, 44, 44, .18); } 30% { box-shadow: 0 0 0 3px var(--eo-primary), 0 12px 30px -10px rgba(44, 44, 44, .2); } }
.wb-selected { outline: 2px solid var(--eo-primary); }
.wb-link-src { outline: 2px dashed var(--eo-accent); }
.wb-dragging { outline: 2px solid var(--eo-primary); box-shadow: 0 22px 44px -18px rgba(44, 44, 44, .2); }
/* 悬停 1.2 秒合并提示：目标卡片浮出蓝色光环，走满一圈即自动合并成堆叠组 */
.wb-stack-target { outline: 2px dashed var(--eo-primary); outline-offset: 5px; animation: wbStackHint 1.2s linear forwards; }
@keyframes wbStackHint {
  0% { box-shadow: 0 0 0 0 rgba(44, 44, 44, 0), var(--eo-shadow); }
  100% { box-shadow: 0 0 0 9px rgba(44, 44, 44, .1), var(--eo-shadow); }
}
.wb-pinned { outline: 2px solid rgba(168, 166, 161, .6); }
.wb-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; pointer-events: none; }
.wb-viewport :deep(.eo-node) { cursor: pointer; }

/* 小地图（顶部右侧常驻缩略图） */
.wb-minimap {
  position: absolute; right: 14px; top: 12px; z-index: 44;
  width: 168px; height: 116px; border-radius: 14px; overflow: hidden; cursor: crosshair;
  padding: 0; background: var(--eo-glass-strong); border: 1px solid var(--eo-glass-border);
}
.wb-minimap__node { position: absolute; background: var(--eo-primary); opacity: .55; border-radius: 2px; min-width: 2px; min-height: 2px; }
.wb-minimap__vp { position: absolute; border: 1.5px solid rgba(200, 198, 192, .95); background: rgba(200, 198, 192, .18); border-radius: 3px; pointer-events: none; box-shadow: 0 0 0 2px rgba(200, 198, 192, .35); }

/* 网格层：随 wb-layer 平移缩放，点阵风（Excalidraw 行为） */
.wb-gridlayer {
  position: absolute; left: -100000px; top: -100000px; width: 200000px; height: 200000px;
  pointer-events: none; z-index: 0;
  background-image: radial-gradient(circle, rgba(44, 44, 44, .16) 1.2px, transparent 1.2px);
  background-size: 40px 40px; background-position: -20px -20px;
}
[data-theme='dark'] .wb-gridlayer { background-image: radial-gradient(circle, rgba(232, 230, 225, .14) 1.2px, transparent 1.2px); }
/* 画布模板面板 */
.wb-tpl {
  position: absolute; right: 14px; bottom: calc(env(safe-area-inset-bottom, 0px) + 86px); z-index: 47;
  width: 268px; border-radius: 18px; padding: 12px; color: var(--eo-ink);
  border: 1px solid var(--eo-glass-border); box-shadow: var(--eo-shadow-soft);
}
.wb-tpl__head { display: flex; align-items: center; justify-content: space-between; font-weight: 800; font-size: 13px; color: var(--eo-primary-deep); margin-bottom: 8px; }
.wb-tpl__x { width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--eo-ink-soft); cursor: pointer; }
.wb-tpl__row { display: flex; gap: 6px; margin-bottom: 8px; }
.wb-tpl__row input { flex: 1; min-width: 0; }
.wb-tpl__list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
.wb-tpl__item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.4); }
.wb-tpl__name { font-size: 12px; font-weight: 700; display: flex; flex-direction: column; }
.wb-tpl__name i { font-size: 10px; opacity: .6; font-style: normal; }
.wb-tpl__acts { display: flex; gap: 4px; flex: none; }
.wb-tpl__empty { font-size: 11px; opacity: .6; text-align: center; padding: 8px; }
.btn.sm { padding: 4px 9px; font-size: 12px; border-radius: 9px; }
.btn.ghost { background: transparent; border: 1px solid var(--eo-glass-border); }

/* 扁平模式：关闭阴影 / 毛玻璃 / 3D 悬浮，释放性能 */
.eo-flat .eo-node,
.eo-flat .wb-space-card,
.eo-flat .wb-zoom,
.eo-flat .wb-dock,
.eo-flat .wb-minimap,
.eo-flat .wb-tpl,
.eo-flat .wb-crumbs,
.eo-flat .wb-tip,
.eo-flat .wb-flat-toggle {
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.eo-flat .eo-node.eo-lift { transform: none !important; }
.eo-flat .wb-datacard { background: var(--eo-flat-bg, rgba(255, 255, 255, .96)) !important; }
.eo-flat .eo-sticky { box-shadow: 0 1px 2px rgba(44, 44, 44, .12) !important; }
.eo-flat .wb-space-card { background: var(--eo-flat-bg, rgba(255, 255, 255, .96)) !important; }
.eo-flat .wb-space-card::before { display: none; }
.eo-flat .wb-fx.wb-space-in, .eo-flat .wb-fx.wb-space-out { animation: none !important; }

/* 绘图工具栏 */
.wb-drawbar { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 47; padding: 8px 10px; border-radius: 16px; max-width: calc(100% - 24px); display: flex; flex-direction: column; gap: 6px; }
.wb-drawbar__tools { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.wb-drawbar__t { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: rgba(255,255,255,.4); font-size: 11px; font-weight: 700; color: var(--eo-ink); cursor: pointer; }
.wb-drawbar__t.active { background: var(--eo-primary); color: #fff; border-color: transparent; }
.wb-drawbar__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.wb-drawbar__c { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(44, 44, 44, .2); }
.wb-drawbar__c.on { outline: 2px solid var(--eo-primary-deep); }
.wb-drawbar__chk { font-size: 11px; font-weight: 700; color: var(--eo-ink-soft); display: flex; align-items: center; gap: 3px; }
.wb-drawbar__x { padding: 4px 9px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: rgba(255,255,255,.4); font-size: 11px; font-weight: 700; cursor: pointer; }
.wb-drawbar input[type=range] { width: 60px; accent-color: var(--eo-primary); }

/* 智能布局面板 */
.lo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.lo-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px; border-radius: 14px;
  border: 1px solid var(--eo-glass-border); background: rgba(255,255,255,.4); color: var(--eo-ink); cursor: pointer;
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.lo-item:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.lo-item.busy { opacity: .6; pointer-events: none; }
.lo-item__t { font-size: 13px; font-weight: 800; margin-top: 4px; }
.lo-item__d { font-size: 10px; opacity: .62; }
.lo-sp { display: flex; flex-direction: column; gap: 4px; margin-top: 14px; }
.lo-sp label { font-size: 12px; font-weight: 700; color: var(--eo-ink-soft); }
.lo-sp label b { color: var(--eo-primary-deep); }
.lo-sp input[type=range] { width: 100%; accent-color: var(--eo-primary); }

</style>
