<script setup>
// ===== 画布主页：无限画布 + 全实体节点 + 语义连线 + 双向跳转 =====
// 对应需求 1/2/3/4/5/11/12：主页画布模式、节点化、连线、文件拖入、剪贴板、检索。
import { ref, computed, onMounted, onActivated, onDeactivated } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useRouter } from 'vue-router'
import { useDialogStore } from '../stores/dialog.js'
import EntityNode from '../components/EntityNode.vue'
import CanvasEntitySearch from '../components/CanvasEntitySearch.vue'
import { registerCanvas, unregisterCanvas, canvasFocus } from '../services/canvasBridge.js'
import { canvasNavigate } from '../services/CanvasNavigator.js'
import { incubateFile } from '../services/FileNodeFactory.js'
import { exportCanvas } from '../composables/useHtmlExport.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const router = useRouter()
const dialog = useDialogStore()
const viewport = ref(null)

const panX = ref(0)
const panY = ref(0)
const scale = ref(1)
const ZOOM_MIN = 0.2
const ZOOM_MAX = 2.5

const nodes = computed(() => store.data.whiteboardNodes.filter((n) => !n.deletedAt))
const edges = computed(() => store.data.whiteboardEdges.filter((e) => !e.deletedAt))

const layerStyle = computed(() => ({
  transform: 'translate(' + panX.value + 'px,' + panY.value + 'px) scale(' + scale.value + ')'
}))

const COLOR_KEYS = ['amber', 'blue', 'pink', 'green', 'purple', 'gray']
const selectedNode = ref(null)
const flashingId = ref(null)
const connectMode = ref(false)
const linkSource = ref(null)
const searchOpen = ref(false)
const menu = ref({ show: false, x: 0, y: 0, node: null })

function resolve(n) {
  const map = {
    task: () => store.live.tasks.find((t) => t.id === n.refId),
    memo: () => store.live.memos.find((m) => m.id === n.refId),
    item: () => store.live.items.find((i) => i.id === n.refId),
    photo: () => store.live.photos.find((p) => p.id === n.refId),
    collection: () => store.live.collections.find((c) => c.id === n.refId),
    location: () => store.live.locations.find((l) => l.id === n.refId),
    profile: () => store.data.profile,
    game: () => null,
    insight: () => null
  }
  return map[n.type] ? map[n.type]() : null
}

// ---- 坐标换算 ----
function viewportCenterCanvas() {
  const vp = viewport.value
  if (!vp) return { x: 200, y: 150 }
  return {
    x: (vp.clientWidth / 2 - panX.value) / scale.value,
    y: (vp.clientHeight / 2 - panY.value) / scale.value
  }
}

// ---- 平移 ----
let panning = false
function startPan(e) {
  if (e.target.closest('.eo-node')) return
  panning = true
  const sx = e.clientX, sy = e.clientY, ox = panX.value, oy = panY.value
  function mv(ev) { panX.value = ox + (ev.clientX - sx); panY.value = oy + (ev.clientY - sy) }
  function up() { panning = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
}

// ---- 缩放（围绕光标） ----
function onWheel(e) {
  e.preventDefault()
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

// ---- 节点拖拽 / 缩放 ----
function startDrag(n, e) {
  if (connectMode.value) return
  const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y, s = scale.value
  function mv(ev) { n.x = ox + (ev.clientX - sx) / s; n.y = oy + (ev.clientY - sy) / s }
  function up() {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up)
    store.updateWhiteboardNode(n.id, { x: Math.round(n.x), y: Math.round(n.y) })
  }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
}
function startResize(n, e) {
  const sx = e.clientX, sy = e.clientY, ow = n.w, oh = n.h, s = scale.value
  function mv(ev) { n.w = Math.max(120, ow + (ev.clientX - sx) / s); n.h = Math.max(80, oh + (ev.clientY - sy) / s) }
  function up() {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up)
    store.updateWhiteboardNode(n.id, { w: Math.round(n.w), h: Math.round(n.h) })
  }
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
}

// ---- 选中 / 连线 ----
function onNodeSelect(n) {
  if (connectMode.value) {
    if (!linkSource.value) { linkSource.value = n.id; selectedNode.value = n }
    else {
      if (linkSource.value !== n.id) store.addWhiteboardEdge({ from: linkSource.value, to: n.id, label: '' })
      linkSource.value = null; connectMode.value = false
    }
    return
  }
  selectedNode.value = n
}
function flash(id) {
  flashingId.value = id
  setTimeout(() => { if (flashingId.value === id) flashingId.value = null }, 1100)
}

// ---- 节点右键菜单（改色 / 删除 / 连线 / 打开详情） ----
function onNodeMenu(node, e) {
  menu.value = { show: true, x: e.clientX, y: e.clientY, node }
}
function setColor(c) { if (menu.value.node) store.updateWhiteboardNode(menu.value.node.id, { color: c }); menu.value.show = false }
function delNode() { if (menu.value.node) { store.deleteWhiteboardNode(menu.value.node.id); menu.value.show = false } }
function connectFrom() { if (menu.value.node) { connectMode.value = true; linkSource.value = menu.value.node.id; menu.value.show = false } }
function openDetail() {
  const n = menu.value.node; menu.value.show = false
  const route = { task: '/tasks', memo: '/notes', item: '/backpack', photo: '/album', collection: '/notes', location: '/map' }[n.type]
  if (route) router.push(route)
}

// ---- 工具栏动作 ----
function addFreeNote() {
  const c = viewportCenterCanvas()
  store.addWhiteboardNode({ type: 'memo', x: Math.round(c.x - 110), y: Math.round(c.y - 70), w: 220, h: 150, color: 'amber', text: '新便利贴' })
}
function fitView() { panX.value = 40; panY.value = 40; scale.value = 1 }
function zoom(delta) { scale.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale.value * (delta > 0 ? 1.1 : 0.9))) }

// ---- 画布桥：供 Tool Calling / 导入 / 剪贴板 落节点 ----
function ensureNode(type, id, opts) {
  const c = (opts && opts.center) ? viewportCenterCanvas() : { x: (opts && opts.x) || 60, y: (opts && opts.y) || 60 }
  const r = store.ensureWhiteboardNodeForEntity({ type, refId: id, x: Math.round(c.x - 110), y: Math.round(c.y - 70), color: (opts && opts.color) || 'amber' })
  if (r.ok && r.node) flash(r.node.id)
  return r.node
}
function focusNode(node) {
  const vp = viewport.value
  if (!vp) return
  panX.value = vp.clientWidth / 2 - (node.x + node.w / 2) * scale.value
  panY.value = vp.clientHeight / 2 - (node.y + node.h / 2) * scale.value
  flash(node.id)
}

// ---- 文件拖入孵化 ----
function onDrop(e) {
  e.preventDefault(); e.stopPropagation()
  const files = Array.from(e.dataTransfer.files || [])
  files.forEach((f) => incubateFile(f, {}))
  if (files.length) store.showToast('已拖入 ' + files.length + ' 个文件并孵化节点')
}

// ---- 连线几何 ----
const edgeGeom = computed(() => edges.value.map((e) => {
  const a = nodes.value.find((n) => n.id === e.from)
  const b = nodes.value.find((n) => n.id === e.to)
  if (!a || !b) return null
  return { id: e.id, x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 }
}).filter(Boolean))

async function onEdgeClick(e) {
  const ok = await dialog.confirm({ title: '删除连线', message: '确定删除这条关联连线吗？', confirmText: '删除', danger: true })
  if (ok) store.deleteWhiteboardEdge(e.id)
}

// ---- 导出只读 HTML ----
function doExport() {
  exportCanvas(nodes.value, edges.value, resolve)
  store.showToast('已导出画布只读 HTML')
}

onMounted(() => {
  registerCanvas({ ensureNodeForEntity: ensureNode, focusNode, isCanvasActive: () => true })
})
onActivated(() => {
  registerCanvas({ ensureNodeForEntity: ensureNode, focusNode, isCanvasActive: () => true })
})
onDeactivated(() => { unregisterCanvas() })

function onNavigate(r) { canvasNavigate({ type: r.type, id: r.id, router }) }
</script>

<template>
  <div class="wb-page">
    <!-- 工具栏 -->
    <div class="wb-toolbar glass">
      <button class="wb-btn" :class="{ active: connectMode }" @click="connectMode = !connectMode; linkSource = null" title="连线模式">
        <Icon name="link" :size="16" /> {{ connectMode ? '连线中…' : '连线' }}
      </button>
      <button class="wb-btn" @click="addFreeNote" title="新建空白便利贴"><Icon name="plus" :size="16" /> 便利贴</button>
      <button class="wb-btn" @click="searchOpen = true" title="实体检索"><Icon name="search" :size="16" /> 检索</button>
      <div class="wb-sep"></div>
      <button class="wb-btn" @click="zoom(1)" title="放大"><Icon name="plus" :size="14" /></button>
      <button class="wb-btn" @click="zoom(-1)" title="缩小"><Icon name="minus" :size="14" /></button>
      <button class="wb-btn" @click="fitView" title="复位"><Icon name="reset" :size="16" /> 复位</button>
      <div class="wb-sep"></div>
      <button class="wb-btn" @click="doExport" title="导出只读 HTML"><Icon name="download" :size="16" /> 导出</button>
      <span class="wb-hint">滚轮缩放 · 拖拽空白平移 · 右键节点改色</span>
    </div>

    <!-- 画布视口 -->
    <div class="wb-viewport" ref="viewport" @pointerdown="startPan" @wheel="onWheel" @dragover.prevent @drop.prevent="onDrop">
      <div class="wb-layer" :style="layerStyle">
        <!-- 连线层 -->
        <svg class="wb-edges" width="10" height="10">
          <line v-for="g in edgeGeom" :key="g.id" :x1="g.x1" :y1="g.y1" :x2="g.x2" :y2="g.y2"
            stroke="rgba(123,111,168,.7)" stroke-width="2" @click.stop="onEdgeClick(g)" style="cursor:pointer" />
        </svg>
        <!-- 节点层 -->
        <EntityNode
          v-for="n in nodes" :key="n.id"
          :node="n" :entity="resolve(n)"
          :class="{ 'wb-flash': flashingId === n.id, 'wb-selected': selectedNode && selectedNode.id === n.id, 'wb-link-src': linkSource === n.id }"
          @drag-start="(e) => startDrag(n, e)"
          @resize-start="(e) => startResize(n, e)"
          @menu="(ev) => onNodeMenu(n, ev)"
          @select="onNodeSelect(n)"
          @navigate="onNavigate" />
      </div>
      <div v-if="!nodes.length" class="wb-empty">
        <span class="empty-illu"><Icon name="layout" :size="34" /></span>
        <div class="es-title">画布还是空的</div>
        <div class="es-sub">点工具栏「便利贴」开始，或拖入文件 / 粘贴剪贴板自动孵化节点</div>
      </div>
    </div>

    <!-- 节点右键菜单 -->
    <div v-if="menu.show" class="wb-menu glass" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @pointerdown.stop>
      <div class="wb-menu-title">节点颜色</div>
      <div class="wb-swatches">
        <button v-for="c in COLOR_KEYS" :key="c" class="wb-swatch" :class="'sw-' + c" @click="setColor(c)"></button>
      </div>
      <div class="wb-menu-actions">
        <button @click="connectFrom"><Icon name="link" :size="14" /> 从此连线</button>
        <button @click="openDetail"><Icon name="arrow" :size="14" /> 打开详情</button>
        <button class="danger" @click="delNode"><Icon name="trash" :size="14" /> 删除节点</button>
      </div>
    </div>

    <!-- 实体检索面板 -->
    <CanvasEntitySearch v-if="searchOpen" @close="searchOpen = false" />
  </div>
</template>

<style scoped>
.wb-page { position: fixed; inset: 0; display: flex; flex-direction: column; }
.wb-toolbar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px; }
.wb-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: var(--eo-glass); color: var(--eo-ink); font-size: 12px; font-weight: 600; cursor: pointer; }
.wb-btn.active { background: var(--eo-primary); color: #fff; }
.wb-sep { width: 1px; height: 20px; background: var(--eo-glass-border); margin: 0 2px; }
.wb-hint { font-size: 11px; opacity: 0.6; margin-left: 4px; }
.wb-viewport { position: absolute; inset: 0; overflow: hidden; background:
  radial-gradient(circle at 20% 20%, rgba(212,163,115,.08), transparent 40%),
  radial-gradient(circle at 80% 70%, rgba(123,111,168,.08), transparent 40%); cursor: grab; }
.wb-viewport:active { cursor: grabbing; }
.wb-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.wb-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.wb-edges line { pointer-events: stroke; }
.wb-flash { animation: wbflash 1.1s ease; }
@keyframes wbflash { 0%,100% { box-shadow: 0 12px 30px -14px rgba(120,90,50,.5); } 30% { box-shadow: 0 0 0 3px var(--eo-primary), 0 12px 30px -10px rgba(212,163,115,.7); } }
.wb-selected { outline: 2px solid var(--eo-primary); }
.wb-link-src { outline: 2px dashed var(--eo-accent); }
.wb-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; pointer-events: none; }
.empty-illu { color: var(--eo-primary-deep); opacity: .5; }
.es-title { font-weight: 700; font-size: 15px; color: var(--eo-ink); }
.es-sub { font-size: 12px; opacity: .6; color: var(--eo-ink); }
.wb-menu { position: fixed; z-index: 80; padding: 10px; border-radius: 14px; width: 180px; }
.wb-menu-title { font-size: 11px; opacity: .6; margin-bottom: 6px; }
.wb-swatches { display: flex; gap: 6px; margin-bottom: 8px; }
.wb-swatch { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0,0,0,.1); cursor: pointer; }
.sw-amber { background: #F5E9DA; } .sw-blue { background: #DCE8F5; } .sw-pink { background: #F5DEE8; }
.sw-green { background: #E1F0E2; } .sw-purple { background: #ECE8F5; } .sw-gray { background: #E8E8E8; }
.wb-menu-actions { display: flex; flex-direction: column; gap: 4px; }
.wb-menu-actions button { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border: none; background: transparent; border-radius: 8px; font-size: 12px; color: var(--eo-ink); cursor: pointer; }
.wb-menu-actions button:hover { background: var(--eo-chip); }
.wb-menu-actions .danger { color: var(--eo-bad); }
</style>
