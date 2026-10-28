<script setup>
// ===== 画布式白板主页（需求 7）：无限画布 + 便利贴 + 自定义连线 =====
// 零依赖实现无限画布（transform 平移/缩放）；便利贴映射内部数据模型；连线持久化至 IndexedDB 并纳入 WebDAV 契约。
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useContextMenu } from '../composables/useContextMenu.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const { open: openCtx } = useContextMenu()

const panX = ref(0)
const panY = ref(0)
const zoom = ref(1)
const world = ref(null)
const connecting = ref(null) // 正在连线的起点节点 id
const drag = ref(null)
const colorOpts = [
  { key: 'amber', c: '#E3BE97' }, { key: 'rose', c: '#E0A6A0' },
  { key: 'sage', c: '#A9C2A0' }, { key: 'sky', c: '#A6C0D6' },
  { key: 'lilac', c: '#C2A9CE' }
]

const nodes = computed(() => store.data.whiteboardNodes.filter((n) => !n.deletedAt))
const edges = computed(() => store.data.whiteboardEdges.filter((e) => !e.deletedAt))

// 屏幕坐标 → 世界坐标
function toWorld(clientX, clientY) {
  const rect = world.value.getBoundingClientRect()
  return {
    x: (clientX - rect.left - panX.value) / zoom.value,
    y: (clientY - rect.top - panY.value) / zoom.value
  }
}

function onWheel(e) {
  e.preventDefault()
  const next = Math.min(2.2, Math.max(0.4, zoom.value - (e.deltaY > 0 ? 0.08 : -0.08)))
  zoom.value = next
}

// 背景平移
function onBgDown(e) {
  if (e.button !== 0) return
  const start = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value }
  const move = (ev) => { panX.value = start.px + (ev.clientX - start.x); panY.value = start.py + (ev.clientY - start.y) }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// 便利贴拖动
function onNodeDown(e, node) {
  if (connecting.value) return
  e.stopPropagation()
  const start = toWorld(e.clientX, e.clientY)
  const orig = { x: node.x, y: node.y }
  const move = (ev) => {
    const w = toWorld(ev.clientX, ev.clientY)
    node.x = Math.round(orig.x + (w.x - start.x))
    node.y = Math.round(orig.y + (w.y - start.y))
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commitNode(node) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function commitNode(node) { store.updateWhiteboardNode(node.id, { x: node.x, y: node.y }) }

function addNote() {
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2)
  const r = store.addWhiteboardNode({ type: 'note', x: Math.round(center.x - 100), y: Math.round(center.y - 70), text: '新便利贴', color: 'amber' })
  if (r.ok) store.showToast('已添加便利贴')
}

function toggleConnect(node) {
  if (!connecting.value) { connecting.value = node.id; return }
  if (connecting.value === node.id) { connecting.value = null; return }
  const r = store.addWhiteboardEdge({ from: connecting.value, to: node.id })
  if (r.ok) store.showToast('已连线')
  connecting.value = null
}

function onNodeContext(e, node) {
  openCtx(e, [
    { label: '编辑文字', icon: 'edit', action: () => editNote(node) },
    { label: '改色', icon: 'palette', action: () => cycleColor(node) },
    { label: '连线', icon: 'link', action: () => toggleConnect(node) },
    { label: '删除', icon: 'trash', danger: true, action: () => { store.deleteWhiteboardNode(node.id); store.showToast('已删除') } }
  ])
}
function cycleColor(node) {
  const idx = colorOpts.findIndex((c) => c.key === node.color)
  const next = colorOpts[(idx + 1) % colorOpts.length].key
  store.updateWhiteboardNode(node.id, { color: next })
}
const editing = ref(null)
const editText = ref('')
function editNote(node) { editing.value = node.id; editText.value = node.text }
function saveEdit() {
  if (editing.value) store.updateWhiteboardNode(editing.value, { text: editText.value })
  editing.value = null
}

function nodeColor(node) { return (colorOpts.find((c) => c.key === node.color) || colorOpts[0]).c }
function edgePath(e) {
  const a = nodes.value.find((n) => n.id === e.from)
  const b = nodes.value.find((n) => n.id === e.to)
  if (!a || !b) return ''
  return 'M' + (a.x + a.w / 2) + ' ' + (a.y + a.h / 2) + ' L' + (b.x + b.w / 2) + ' ' + (b.y + b.h / 2)
}
onMounted(() => { /* 白板挂载即激活 */ })
</script>

<template>
  <div class="wb" @wheel="onWheel" @pointerdown="onBgDown" @contextmenu.prevent>
    <div
      ref="world"
      class="wb-world"
      :style="{ transform: 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')' }"
    >
      <svg class="wb-edges" :width="4000" :height="3000">
        <path v-for="e in edges" :key="e.id" :d="edgePath(e)" class="wb-edge" />
      </svg>
      <div
        v-for="n in nodes" :key="n.id"
        class="wb-note glass"
        :class="{ connecting: connecting === n.id }"
        :style="{ left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px', '--note': nodeColor(n) }"
        @pointerdown="onNodeDown($event, n)"
        @contextmenu.prevent="onNodeContext($event, n)"
        @click="connecting && toggleConnect(n)"
      >
        <textarea v-if="editing === n.id" v-model="editText" class="wb-textarea" @pointerdown.stop @blur="saveEdit" />
        <div v-else class="wb-note-text">{{ n.text }}</div>
      </div>
    </div>

    <div class="wb-toolbar">
      <button class="wb-btn" @click="addNote"><Icon name="plus" :size="18" /> 便利贴</button>
      <button class="wb-btn" :class="{ active: connecting }" @click="connecting = connecting ? null : (connecting || '待选')">
        <Icon name="link" :size="18" /> {{ connecting ? '选择终点' : '连线' }}
      </button>
      <span class="wb-zoom">{{ Math.round(zoom * 100) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.wb { position: absolute; inset: 0; overflow: hidden; background:
  radial-gradient(circle at 1px 1px, rgba(176,133,83,.12) 1px, transparent 0) 0 0 / 28px 28px; }
.wb-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; width: 4000px; height: 3000px; }
.wb-edges { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.wb-edge { stroke: var(--eo-primary-deep); stroke-width: 2; fill: none; stroke-dasharray: 6 5; opacity: .7; }
.wb-note { position: absolute; padding: 12px; border-radius: 16px; border-left: 5px solid var(--note); cursor: grab; user-select: none; }
.wb-note:active { cursor: grabbing; }
.wb-note.connecting { outline: 2px dashed var(--eo-primary); }
.wb-note-text { font-size: 14px; line-height: 1.6; color: var(--eo-ink); white-space: pre-wrap; overflow: hidden; }
.wb-textarea { width: 100%; height: 100%; border: none; background: transparent; outline: none; resize: none; font-size: 14px; color: var(--eo-ink); font-family: inherit; }
.wb-toolbar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 50; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: var(--eo-glass-strong); backdrop-filter: blur(24px) saturate(165%); -webkit-backdrop-filter: blur(24px) saturate(165%); border: 1px solid var(--eo-glass-border); box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi); }
.wb-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--eo-ink); transition: all .16s ease; }
.wb-btn:hover { background: var(--eo-chip); }
.wb-btn.active { color: #fff; background: linear-gradient(135deg, var(--eo-primary), var(--eo-primary-deep)); }
.wb-zoom { font-size: 12px; color: var(--eo-ink-soft); font-variant-numeric: tabular-nums; }
</style>
