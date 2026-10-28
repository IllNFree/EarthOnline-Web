<script setup>
// ===== 终极自定义看板（需求 10）：可拖拽排版 + 吸附对齐，布局序列化持久化并纳入 WebDAV 同步 =====
// 零依赖：自研 12 列网格 + 指针拖拽 + 角点缩放 + 落点吸附（替代 grid-layout-plus，规避构建风险）。
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useContextMenu } from '../composables/useContextMenu.js'
import Icon from '../components/Icon.vue'
import { xpLevelInfo } from '../lib/model.js'

const store = useAppStore()
const { open: openCtx } = useContextMenu()
const ROW_H = 84
const COLS = 12

const layout = ref([])
const container = ref(null)

const MODULES = [
  { i: 'tasks', x: 0, y: 0, w: 6, h: 4, label: '任务', icon: 'tasks' },
  { i: 'chart', x: 6, y: 0, w: 6, h: 4, label: '趋势', icon: 'chart' },
  { i: 'calendar', x: 0, y: 4, w: 7, h: 4, label: '日历', icon: 'calendar' },
  { i: 'stats', x: 7, y: 4, w: 5, h: 4, label: '数据', icon: 'trophy' },
  { i: 'recent', x: 0, y: 8, w: 12, h: 3, label: '动态', icon: 'clock' }
]

onMounted(() => {
  layout.value = store.data.dashboardLayout && store.data.dashboardLayout.length
    ? store.data.dashboardLayout.slice()
    : MODULES.slice()
})

function itemStyle(it) {
  return {
    left: (it.x / COLS * 100) + '%',
    top: (it.y * ROW_H) + 'px',
    width: (it.w / COLS * 100) + '%',
    height: (it.h * ROW_H - 10) + 'px'
  }
}
const containerHeight = computed(() => {
  const maxY = layout.value.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  return maxY * ROW_H + 'px'
})

function colWidth() { return container.value ? container.value.clientWidth / COLS : 60 }

let dragState = null
function onDragStart(e, it) {
  e.stopPropagation()
  const startX = e.clientX, startY = e.clientY
  const orig = { x: it.x, y: it.y }
  const cw = colWidth()
  const move = (ev) => {
    const dx = Math.round((ev.clientX - startX) / cw)
    const dy = Math.round((ev.clientY - startY) / ROW_H)
    it.x = Math.max(0, Math.min(COLS - it.w, orig.x + dx))
    it.y = Math.max(0, orig.y + dy)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit() }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function onResizeStart(e, it) {
  e.stopPropagation()
  const startX = e.clientX, startY = e.clientY
  const orig = { w: it.w, h: it.h }
  const cw = colWidth()
  const move = (ev) => {
    const dw = Math.round((ev.clientX - startX) / cw)
    const dh = Math.round((ev.clientY - startY) / ROW_H)
    it.w = Math.max(2, Math.min(COLS - it.x, orig.w + dw))
    it.h = Math.max(2, orig.h + dh)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit() }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function commit() { store.saveDashboardLayout(layout.value) }

function onItemContext(e, it) {
  openCtx(e, [
    { label: '重置布局', icon: 'reset', action: () => { layout.value = MODULES.slice(); commit() } }
  ])
}

const level = computed(() => xpLevelInfo(store.xp))
// 简易当月日历
const today = new Date()
const calDays = computed(() => {
  const y = today.getFullYear(), m = today.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const arr = []
  for (let i = 0; i < first; i++) arr.push(null)
  for (let d = 1; d <= days; d++) arr.push(d)
  return arr
})
const monthLabel = today.getFullYear() + '年' + (today.getMonth() + 1) + '月'
</script>

<template>
  <div class="page wide">
    <div class="section-title">自定义看板 <span class="muted" style="font-size:12px">拖拽卡片排版，右下角缩放</span></div>
    <div ref="container" class="dash" :style="{ height: containerHeight }">
      <div
        v-for="it in layout" :key="it.i"
        class="dash-item glass"
        :style="itemStyle(it)"
        @pointerdown="onDragStart($event, it)"
        @contextmenu.prevent="onItemContext($event, it)"
      >
        <div class="dash-item__head">
          <span><Icon :name="(MODULES.find(m=>m.i===it.i)||{}).icon || 'tag'" :size="15" /> {{ (MODULES.find(m=>m.i===it.i)||{}).label || it.i }}</span>
        </div>
        <div class="dash-item__body">
          <template v-if="it.i === 'tasks'">
            <div v-for="t in store.live.tasks.slice(0, 6)" :key="t.id" class="dash-line">
              <span class="dash-dot" :class="'cat-' + t.category"></span>{{ t.title }}
            </div>
            <div v-if="!store.live.tasks.length" class="muted" style="font-size:12px">暂无任务</div>
          </template>
          <template v-else-if="it.i === 'stats'">
            <div class="dash-big">Lv.{{ level.level }}</div>
            <div class="muted">{{ level.stage.label }} · {{ store.xp }} XP</div>
          </template>
          <template v-else-if="it.i === 'calendar'">
            <div class="dash-cal-title">{{ monthLabel }}</div>
            <div class="dash-cal">
              <span v-for="(d,i) in calDays" :key="i" class="dash-cal-cell" :class="{ today: d === today.getDate() }">{{ d || '' }}</span>
            </div>
          </template>
          <template v-else-if="it.i === 'recent'">
            <div v-for="a in store.data.activities.slice(0, 5)" :key="a.id" class="dash-line">{{ a.text }}</div>
            <div v-if="!store.data.activities.length" class="muted" style="font-size:12px">暂无动态</div>
          </template>
          <template v-else>
            <div class="muted" style="font-size:12px">拖入图表 / 模块占位</div>
          </template>
        </div>
        <span class="dash-resize" @pointerdown="onResizeStart($event, it)"></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash { position: relative; width: 100%; }
.dash-item { position: absolute; border-radius: var(--eo-radius-sm); padding: 0; overflow: hidden; display: flex; flex-direction: column; cursor: grab; }
.dash-item:active { cursor: grabbing; }
.dash-item__head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; font-size: 13px; font-weight: 700; color: var(--eo-primary-deep); border-bottom: 1px solid var(--eo-glass-border); }
.dash-item__body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.dash-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--eo-ink); padding: 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
.dash-big { font-size: 26px; font-weight: 800; color: var(--eo-ink); }
.dash-cal-title { font-size: 12px; font-weight: 700; color: var(--eo-ink-soft); margin-bottom: 6px; }
.dash-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dash-cal-cell { text-align: center; font-size: 11px; padding: 3px 0; color: var(--eo-ink-soft); border-radius: 6px; }
.dash-cal-cell.today { background: var(--eo-primary); color: #fff; font-weight: 700; }
.dash-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, var(--eo-primary) 50%); border-bottom-right-radius: var(--eo-radius-sm); opacity: .5; }
.dash-resize:hover { opacity: 1; }
</style>
