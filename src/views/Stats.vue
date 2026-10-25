<script setup>
// 数据中心：等级概览 + 六宫格 + 周期报告（日报/周报/年报合一，任务与记账整合）
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { todayStr, xpLevelInfo } from '../lib/model.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const p2 = (n) => String(n).padStart(2, '0')
const today = todayStr()
const level = computed(() => xpLevelInfo(store.xp))

const overview = computed(() => ([
  { icon: 'tasks', label: '任务', value: store.live.tasks.length, sub: store.live.tasks.filter((t) => t.status === 'done').length + ' 已完成' },
  { icon: 'note', label: '笔记', value: store.live.memos.length, sub: '条记录' },
  { icon: 'backpack', label: '物品/收藏', value: store.live.items.length + store.live.collections.length, sub: store.live.collections.length + ' 项收藏' },
  { icon: 'image', label: '照片', value: store.live.photos.length, sub: '张回忆' },
  { icon: 'map-pin', label: '足迹', value: store.live.locations.length, sub: '个地点' },
  { icon: 'trophy', label: '成就', value: store.data.achievements.length, sub: store.xp + ' XP' }
]))

// ================= 周期报告（日报 / 周报 / 年报 合一面板） =================
const period = ref('daily')
const PERIODS = [
  { key: 'daily', label: '日报', icon: 'calendar' },
  { key: 'weekly', label: '周报', icon: 'chart' },
  { key: 'yearly', label: '年报', icon: 'calendar' }
]

// 区间工具
function inRange(dateStr, from, to) { return dateStr && dateStr >= from && dateStr <= to }
function rangeFor(key) {
  if (key === 'daily') { return { from: today, to: today } }
  if (key === 'weekly') {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return { from: todayStr(d), to: today }
  }
  const y = new Date().getFullYear()
  return { from: y + '-01-01', to: y + '-12-31' }
}
// 聚合一个区间的任务/笔记/照片/足迹/记账
function aggregate(from, to) {
  const a = {
    tasksDone: 0, memos: 0, photos: 0, locations: 0, ledRecords: 0,
    income: 0, expense: 0, xp: 0
  }
  store.live.tasks.forEach((t) => { if (t.status === 'done' && inRange((t.doneAt || '').slice(0, 10), from, to)) { a.tasksDone++; a.xp += 10 } })
  store.live.memos.forEach((m) => { if (inRange(m.createdAt, from, to)) { a.memos++; a.xp += 5 } })
  store.live.photos.forEach((p) => { if (inRange(p.createdAt, from, to)) { a.photos++; a.xp += 8 } })
  store.live.locations.forEach((l) => { if (inRange(l.date, from, to)) { a.locations++; a.xp += 8 } })
  store.data.ledger.records.forEach((r) => {
    if (!inRange(r.date, from, to)) return
    a.ledRecords++
    a.xp += 2
    if (r.type === 'income') a.income += r.amount; else a.expense += r.amount
  })
  a.balance = a.income - a.expense
  a.total = a.tasksDone + a.memos + a.photos + a.locations + a.ledRecords
  return a
}
const report = computed(() => {
  const key = period.value
  const { from, to } = rangeFor(key)
  const agg = aggregate(from, to)
  // 活跃度分布：日报=近 24 小时（按记录时间戳，缺时间戳的归入「今天」）；周报=7 天；年报=12 个月
  let bars = [], title = '', subtitle = ''
  if (key === 'daily') {
    title = '今日活跃分布'
    subtitle = today
    for (let h = 0; h < 24; h++) bars.push({ label: h % 6 === 0 ? String(h) : '', v: 0 })
    const bump = (ts) => {
      if (!ts) return
      const m = String(ts).match(/T(\d{2}):/)
      if (m) { const h = Number(m[1]); if (bars[h]) bars[h].v++ ; return }
      // 无时间戳：按「有记录」计在当前小时
      const h = new Date().getHours(); if (bars[h]) bars[h].v++
    }
    store.live.tasks.forEach((t) => { if (t.status === 'done' && (t.doneAt || '').slice(0, 10) === today) bump(t.doneAt) })
    store.live.memos.forEach((m) => { if (m.createdAt === today) bump(m.createdAt + 'T' + new Date().getHours() + ':00') })
    store.live.photos.forEach((p) => { if (p.createdAt === today) bump(p.createdAt + 'T' + new Date().getHours() + ':00') })
    store.live.locations.forEach((l) => { if (l.date === today) bump(l.date + 'T' + new Date().getHours() + ':00') })
    store.data.ledger.records.forEach((r) => { if (r.date === today) bump(r.createdAt || r.date) })
  } else if (key === 'weekly') {
    title = '近 7 天活跃分布'
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = todayStr(d)
      const v = aggregate(k, k).total
      days.push({ label: i === 0 ? '今天' : p2(d.getMonth() + 1) + '/' + p2(d.getDate()), v })
    }
    bars = days
  } else {
    title = new Date().getFullYear() + ' 年逐月活跃分布'
    subtitle = new Date().getFullYear() + ' 年'
    const y = new Date().getFullYear()
    const months = []
    for (let m = 1; m <= 12; m++) {
      const mk = y + '-' + p2(m)
      const from = mk + '-01', to = mk + '-31'
      months.push({ label: String(m), v: aggregate(from, to).total })
    }
    bars = months
  }
  const maxV = Math.max(1, ...bars.map((b) => b.v))
  // 一句话总结（覆盖任务/笔记/照片/足迹/记账 全部数据）
  let summary = ''
  if (!agg.total) {
    summary = key === 'daily' ? '今天还没有任何记录，写下第一条吧！' : (key === 'weekly' ? '本周还没有记录，从今天开始积累。' : '今年还没有记录，人生游戏正等你开局。')
  } else {
    const parts = []
    if (agg.tasksDone) parts.push('完成任务 ' + agg.tasksDone + ' 个')
    if (agg.memos) parts.push('笔记 ' + agg.memos + ' 篇')
    if (agg.photos) parts.push('照片 ' + agg.photos + ' 张')
    if (agg.locations) parts.push('足迹 ' + agg.locations + ' 处')
    if (agg.ledRecords) parts.push('记账 ' + agg.ledRecords + ' 笔')
    const ledPart = (agg.income || agg.expense) ? '，收入 ' + agg.income.toFixed(0) + ' 元 / 支出 ' + agg.expense.toFixed(0) + ' 元' : ''
    if (key === 'daily') summary = '今天共 ' + agg.total + ' 次记录' + (parts.length ? '：' + parts.join('、') : '') + ledPart + '。'
    else {
      const top = bars.reduce((a, b) => (b.v > a.v ? b : a), bars[0])
      const topLabel = key === 'weekly' ? (top.label === '今天' ? '今天' : top.label) : top.label + ' 月'
      summary = (key === 'weekly' ? '本周' : '今年') + '共 ' + agg.total + ' 次记录，最活跃的是 ' + topLabel + (parts.length ? '。' + parts.join('、') : '') + ledPart + '。'
    }
  }
  const rangeLabel = key === 'daily' ? today : (key === 'weekly' ? from + ' ~ ' + to : new Date().getFullYear() + ' 年')
  return { key, rangeLabel, agg, bars, maxV, title, summary }
})
</script>

<template>
  <div class="page wide">
    <!-- 等级概览 -->
    <div class="glass card">
      <div class="row between">
        <div>
          <div style="font-size:22px;font-weight:800">Lv.{{ level.level }} · {{ level.stage.label }}</div>
          <div class="muted" style="font-size:13px">{{ store.xp }} XP{{ level.isMax ? ' · 已满级' : ' · 距下一级 ' + (level.nextMin - store.xp) + ' XP' }}</div>
        </div>
        <div class="avatar" style="width:52px;height:52px"><Icon :name="level.stage.icon" :size="26" /></div>
      </div>
      <div class="bar" style="margin-top:10px"><i :style="{ width: level.pct + '%' }"></i></div>
    </div>

    <!-- 六宫格概览 -->
    <div class="grid3">
      <div v-for="o in overview" :key="o.label" class="glass card" style="margin:0;padding:14px">
        <div class="row" style="gap:8px">
          <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon :name="o.icon" :size="18" /></span>
          <span class="muted" style="font-size:12px">{{ o.label }}</span>
        </div>
        <div style="font-size:22px;font-weight:800;margin-top:6px">{{ o.value }}</div>
        <div class="muted" style="font-size:11px">{{ o.sub }}</div>
      </div>
    </div>

    <!-- 周期报告：日报 / 周报 / 年报 合一面板（任务 + 记账整合） -->
    <div class="section-title">周期报告</div>
    <div class="glass card">
      <div class="capsule pr-tabs">
        <button v-for="pd in PERIODS" :key="pd.key" class="btn ghost pr-tab"
          :style="period === pd.key ? 'background:var(--eo-primary);color:#fff' : ''" @click="period = pd.key">
          {{ pd.label }}
        </button>
      </div>

      <div class="row between" style="margin-top:12px">
        <span class="row" style="gap:8px;font-weight:800;font-size:15px">
          <span class="avatar" style="width:30px;height:30px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="calendar" :size="16" /></span>
          {{ report.key === 'daily' ? '日报' : (report.key === 'weekly' ? '周报' : '年报') }}
        </span>
        <span class="muted" style="font-size:12px">{{ report.rangeLabel }}</span>
      </div>

      <!-- 四宫格指标：任务 + 记账整合 -->
      <div class="pr-grid">
        <div class="pr-tile"><b>{{ report.agg.tasksDone }}</b><span>完成任务</span><i>+10/个</i></div>
        <div class="pr-tile"><b>{{ report.agg.memos }}</b><span>新增灵感</span><i>+5/条</i></div>
        <div class="pr-tile"><b>{{ report.agg.photos + report.agg.locations }}</b><span>影像足迹</span><i>+8/处</i></div>
        <div class="pr-tile">
          <b :style="'color:' + (report.agg.balance >= 0 ? 'var(--eo-good)' : 'var(--eo-bad)')">{{ report.agg.balance.toFixed(0) }}</b>
          <span>收支结余</span>
          <i>+{{ report.agg.income.toFixed(0) }} / -{{ report.agg.expense.toFixed(0) }}</i>
        </div>
      </div>
      <div class="row between" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--eo-glass-border);font-size:13px">
        <span class="muted">获得经验值</span>
        <b style="color:var(--eo-primary-deep)">+{{ report.agg.xp }} XP</b>
      </div>

      <!-- 活跃度分布（适配全部数据类型，含记账） -->
      <div style="font-weight:700;margin-top:14px">{{ report.title }}</div>
      <div class="chart-row">
        <div v-for="(b, i) in report.bars" :key="i" class="chart-col">
          <div class="chart-bars"><i class="b-act" :style="{ height: (b.v / report.maxV * 64) + 'px' }" :title="b.v + ' 次记录'"></i></div>
          <span class="muted">{{ b.label }}</span>
        </div>
      </div>

      <!-- 一句话总结 -->
      <div class="pr-summary">
        <span class="pr-dot"></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">一句话总结</div>
          <div class="muted" style="font-size:13px;margin-top:2px;line-height:1.7">{{ report.summary }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 周期报告 Tab */
.pr-tabs { display: inline-flex; padding: 4px; gap: 4px; }
.pr-tab { min-width: 84px; }
.pr-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.pr-tile {
  background: var(--eo-chip); border-radius: 14px; padding: 12px 6px;
  display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center;
}
.pr-tile b { font-size: 22px; font-weight: 800; color: var(--eo-primary-deep); }
.pr-tile span { font-size: 12px; color: var(--eo-ink); }
.pr-tile i { font-size: 10px; font-style: normal; color: var(--eo-ink-soft); }
@media (max-width: 560px) { .pr-grid { grid-template-columns: repeat(2, 1fr); } }

.pr-summary {
  display: flex; gap: 10px; align-items: flex-start; margin-top: 14px;
  padding: 12px 14px; border-radius: 14px; background: var(--eo-chip);
}
.pr-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--eo-good); flex: none; margin-top: 4px; }

.chart-row { display: flex; align-items: flex-end; gap: 6px; margin-top: 10px; }
.chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.chart-col .muted { font-size: 10px; white-space: nowrap; }
.chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
.chart-bars i { width: 8px; border-radius: 4px 4px 0 0; min-height: 2px; display: block; transition: height .4s cubic-bezier(.22,1,.36,1); }
.b-act { background: linear-gradient(180deg, var(--eo-primary-soft), var(--eo-primary)); }
</style>
