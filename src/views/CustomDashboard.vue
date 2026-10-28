<script setup>
// ===== 终极自定义看板（需求 9 / 2）：grid-layout-plus 驱动的可拖拽 / 缩放 / 吸附看板 =====
// 模块通过 MODULES 注册表接入（不硬编码），布局位置序列化至 IndexedDB 并纳入 WebDAV 同步契约。
import { ref, computed, watch } from 'vue'
import { GridLayout, GridItem } from 'grid-layout-plus'
import { useAppStore } from '../stores/app.js'
import Icon from '../components/Icon.vue'
import { xpLevelInfo } from '../lib/model.js'

const store = useAppStore()

// 模块注册表（需求 9：看板内部模块通过注册制接入，不硬编码）
const REGISTRY = [
  { i: 'tasks', label: '任务', icon: 'tasks', w: 6, h: 4 },
  { i: 'chart', label: '收支趋势', icon: 'chart', w: 6, h: 4 },
  { i: 'calendar', label: '日历', icon: 'calendar', w: 7, h: 4 },
  { i: 'stats', label: '成长数据', icon: 'trophy', w: 5, h: 4 },
  { i: 'recent', label: '最近动态', icon: 'clock', w: 12, h: 3 }
]

const layout = ref([])
const ready = ref(false)

// 初始化：复用持久化布局（dashboardLayout 已纳入同步契约），缺省用注册表默认
layout.value = (store.data.dashboardLayout && store.data.dashboardLayout.length)
  ? store.data.dashboardLayout.slice()
  : REGISTRY.map((m) => ({ i: m.i, x: 0, y: 0, w: m.w, h: m.h, module: m.i }))
// 简单流式排布缺省布局
if (!store.data.dashboardLayout || !store.data.dashboardLayout.length) {
  let y = 0
  REGISTRY.forEach((m) => { const it = layout.value.find((l) => l.i === m.i); if (it) { it.x = 0; it.y = y; y += m.h } })
}
ready.value = true

let saveTimer = null
function commit() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store.saveDashboardLayout(layout.value), 400)
}
watch(layout, commit, { deep: true })

const level = computed(() => xpLevelInfo(store.xp))
const today = new Date()
const monthLabel = today.getFullYear() + '年' + (today.getMonth() + 1) + '月'
const calDays = computed(() => {
  const y = today.getFullYear(), m = today.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const arr = []
  for (let i = 0; i < first; i++) arr.push(null)
  for (let d = 1; d <= days; d++) arr.push(d)
  return arr
})
// 收支趋势（近 6 月，红支 / 绿收）—— 与洞察节点同源图表
const trend = computed(() => {
  const recs = store.data.ledger.records || []
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const inc = months.map((mk) => recs.filter((r) => r.type === 'income' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const exp = months.map((mk) => recs.filter((r) => r.type === 'expense' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const max = Math.max(1, ...inc, ...exp)
  return { months, inc, exp, max }
})
function resetLayout() {
  let y = 0
  REGISTRY.forEach((m) => {
    let it = layout.value.find((l) => l.i === m.i)
    if (!it) { it = { i: m.i, x: 0, y: 0, w: m.w, h: m.h, module: m.i }; layout.value.push(it) }
    it.x = 0; it.y = y; it.w = m.w; it.h = m.h; y += m.h
  })
  commit()
}
</script>

<template>
  <div class="page wide">
    <div class="section-title">
      自定义看板
      <span class="muted" style="font-size:12px">拖拽卡片排版，右下角缩放；布局自动保存并同步</span>
      <button class="btn ghost" style="margin-left:auto" @click="resetLayout"><Icon name="reset" :size="14" /> 重置</button>
    </div>
    <GridLayout
      v-if="ready"
      v-model:layout="layout"
      :col-num="12"
      :row-height="34"
      :is-draggable="true"
      :is-resizable="true"
      :vertical-compact="true"
      :margin="[10, 10]"
      :use-css-transforms="true"
      class="gl-wrap">
      <GridItem v-for="it in layout" :key="it.i" :i="it.i" :x="it.x" :y="it.y" :w="it.w" :h="it.h" drag-allow-from=".gl-head" drag-ignore-from=".gl-body">
        <div class="dash-item glass">
          <div class="gl-head">
            <span><Icon :name="(REGISTRY.find(m=>m.i===it.i)||{}).icon || 'tag'" :size="15" /> {{ (REGISTRY.find(m=>m.i===it.i)||{}).label || it.i }}</span>
          </div>
          <div class="gl-body">
            <template v-if="it.i === 'tasks'">
              <div v-for="t in store.live.tasks.slice(0, 8)" :key="t.id" class="dash-line">
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
              <div v-for="a in store.data.activities.slice(0, 6)" :key="a.id" class="dash-line">{{ a.text }}</div>
              <div v-if="!store.data.activities.length" class="muted" style="font-size:12px">暂无动态</div>
            </template>
            <template v-else-if="it.i === 'chart'">
              <svg viewBox="0 0 200 80" preserveAspectRatio="none" width="100%" height="100%">
                <g v-for="(m, i) in trend.months" :key="m">
                  <rect :x="8 + i * 32" :y="70 - (trend.exp[i] / trend.max) * 60" width="10" :height="(trend.exp[i] / trend.max) * 60" fill="rgba(255,99,71,.8)" />
                  <rect :x="20 + i * 32" :y="70 - (trend.inc[i] / trend.max) * 60" width="10" :height="(trend.inc[i] / trend.max) * 60" fill="rgba(52,199,89,.8)" />
                </g>
              </svg>
            </template>
          </div>
        </div>
      </GridItem>
    </GridLayout>
  </div>
</template>

<style scoped>
.gl-wrap { width: 100%; }
.dash-item { height: 100%; border-radius: var(--eo-radius-sm); padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.gl-head { display: flex; align-items: center; gap: 6px; padding: 9px 12px; font-size: 13px; font-weight: 700; color: var(--eo-primary-deep); border-bottom: 1px solid var(--eo-glass-border); cursor: move; }
.gl-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.dash-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--eo-ink); padding: 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
.dash-big { font-size: 26px; font-weight: 800; color: var(--eo-ink); }
.dash-cal-title { font-size: 12px; font-weight: 700; color: var(--eo-ink-soft); margin-bottom: 6px; }
.dash-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dash-cal-cell { text-align: center; font-size: 11px; padding: 3px 0; color: var(--eo-ink-soft); border-radius: 6px; }
.dash-cal-cell.today { background: var(--eo-primary); color: #fff; font-weight: 700; }
</style>
