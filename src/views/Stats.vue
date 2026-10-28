<script setup>
// ===== 数据中心（模块二）：等级概览 + 六宫格 + 周期报告（日报/周报/月报/年报） + 自定义看板 =====
// 说明：
//   · 「周期报告」四档由 AI 统一生成并展示（AI 不可用时回落到本地聚合数据，保证功能不中断）
//   · 「自定义看板」为 grid-layout-plus 拖拽/缩放看板，布局持久化并纳入 WebDAV 同步契约
//   · 满血 Haze：不使用纯色降级
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { todayStr, xpLevelInfo } from '../lib/model.js'
import { chat } from '../lib/ai.js'
import Icon from '../components/Icon.vue'
import DashboardBoard from '../components/DashboardBoard.vue'
import ReportRenderer from '../components/ReportRenderer.vue'

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

// ================= 周期报告：日报 / 周报 / 月报 / 年报 =================
const period = ref('daily')
const PERIODS = [
  { key: 'daily', label: '日报', icon: 'calendar' },
  { key: 'weekly', label: '周报', icon: 'chart' },
  { key: 'monthly', label: '月报', icon: 'calendar' },
  { key: 'yearly', label: '年报', icon: 'trophy' }
]

function inRange(dateStr, from, to) { return !!dateStr && dateStr >= from && dateStr <= to }
function rangeFor(key) {
  if (key === 'daily') return { from: today, to: today }
  if (key === 'weekly') {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return { from: todayStr(d), to: today }
  }
  if (key === 'monthly') {
    const d = new Date()
    const mk = d.getFullYear() + '-' + p2(d.getMonth() + 1)
    return { from: mk + '-01', to: mk + '-31' }
  }
  const y = new Date().getFullYear()
  return { from: y + '-01-01', to: y + '-12-31' }
}
function aggregate(from, to) {
  const a = { tasksDone: 0, memos: 0, photos: 0, locations: 0, ledRecords: 0, income: 0, expense: 0, xp: 0 }
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
  let bars = [], title = '', subtitle = ''
  if (key === 'daily') {
    title = '今日活跃分布'
    subtitle = today
    for (let h = 0; h < 24; h++) bars.push({ label: h % 6 === 0 ? String(h) : '', v: 0 })
    const bump = (ts) => {
      if (!ts) return
      const m = String(ts).match(/T(\d{2}):/)
      if (m) { const h = Number(m[1]); if (bars[h]) bars[h].v++; return }
      const h = new Date().getHours(); if (bars[h]) bars[h].v++
    }
    store.live.tasks.forEach((t) => { if (t.status === 'done' && (t.doneAt || '').slice(0, 10) === today) bump(t.doneAt) })
    store.live.memos.forEach((m) => { if (m.createdAt === today) bump(m.createdAt) })
    store.live.photos.forEach((p) => { if (p.createdAt === today) bump(p.createdAt) })
    store.live.locations.forEach((l) => { if (l.date === today) bump(l.date) })
    store.data.ledger.records.forEach((r) => { if (r.date === today) bump(r.createdAt || r.date) })
  } else if (key === 'weekly') {
    title = '近 7 天活跃分布'
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = todayStr(d)
      days.push({ label: i === 0 ? '今天' : p2(d.getMonth() + 1) + '/' + p2(d.getDate()), v: aggregate(k, k).total })
    }
    bars = days
  } else if (key === 'monthly') {
    title = '本月逐日活跃分布'
    subtitle = rangeFor('monthly').from.slice(0, 7)
    const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const k = rangeFor('monthly').from.slice(0, 7) + '-' + p2(d)
      bars.push({ label: d % 5 === 0 ? String(d) : '', v: aggregate(k, k).total })
    }
  } else {
    title = new Date().getFullYear() + ' 年逐月活跃分布'
    subtitle = new Date().getFullYear() + ' 年'
    const y = new Date().getFullYear()
    for (let m = 1; m <= 12; m++) {
      const mk = y + '-' + p2(m)
      bars.push({ label: String(m), v: aggregate(mk + '-01', mk + '-31').total })
    }
  }
  const maxV = Math.max(1, ...bars.map((b) => b.v))
  let summary = ''
  if (!agg.total) {
    summary = key === 'daily' ? '今天还没有任何记录，写下第一条吧！'
      : key === 'weekly' ? '本周还没有记录，从今天开始积累。'
        : key === 'monthly' ? '本月还没有记录，换个目标重新开局。'
          : '今年还没有记录，人生游戏正等你开局。'
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
      const topLabel = key === 'weekly' ? top.label : (key === 'monthly' ? top.label + ' 日' : top.label + ' 月')
      const scope = key === 'weekly' ? '本周' : (key === 'monthly' ? '本月' : '今年')
      summary = scope + '共 ' + agg.total + ' 次记录，最活跃的是 ' + topLabel + (parts.length ? '。' + parts.join('、') : '') + ledPart + '。'
    }
  }
  const rangeLabel = key === 'daily' ? today
    : key === 'weekly' ? from + ' ~ ' + to
      : key === 'monthly' ? from.slice(0, 7)
        : new Date().getFullYear() + ' 年'
  return { key, rangeLabel, agg, bars, maxV, title, summary }
})

// ---- AI 统一生成周期报告（模块二：报告由 AI 生成并展示；未配置 AI 时回落本地聚合）----
const aiBusy = ref(false)
const aiReport = ref(null)
const aiError = ref('')
const PERIOD_CN = { daily: '日报', weekly: '周报', monthly: '月报', yearly: '年报' }
async function generateReport() {
  const r = report.value
  if (!store.data.aiConfig.apiKey || !store.data.aiConfig.model) {
    aiError.value = '尚未配置 AI，请在「设置 → AI 对话」填写 Base URL / API Key / 模型名'
    aiReport.value = null
    return
  }
  aiBusy.value = true
  aiError.value = ''
  const trendPts = r.bars.map((b) => ({ date: b.label || '', value: b.v }))
  const sys = `你是地球Online的数据复盘助手。请基于给定的真实统计数据，生成一份${PERIOD_CN[r.key]}。
只回一行严格 JSON，不要解释、不要 Markdown 代码块。
格式：{"summary":"一句话总结","letter":"给用户的一段话，40-120字，语气温暖像朋友"}。`
  const user = `统计区间：${r.rangeLabel}
完成任务 ${r.agg.tasksDone} 个；新增笔记 ${r.agg.memos} 篇；照片 ${r.agg.photos} 张；足迹 ${r.agg.locations} 处；记账 ${r.agg.ledRecords} 笔；收入 ${r.agg.income.toFixed(0)} 元 / 支出 ${r.agg.expense.toFixed(0)} 元；获得 ${r.agg.xp} XP。
活跃度序列（标签:次数）：${trendPts.map((p) => p.date + ':' + p.value).join('、')}。`
  const res = await chat(store.data.aiConfig, [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { timeout: 30000 })
  aiBusy.value = false
  if (!res.ok) { aiError.value = 'AI 生成失败：' + res.error; aiReport.value = null; return }
  const m = res.text.match(/\{[\s\S]*\}/)
  let out = null
  try { out = m ? JSON.parse(m[0]) : null } catch (e) { out = null }
  if (!out || !out.summary) {
    aiError.value = 'AI 返回内容无法解析，请稍后再试'
    aiReport.value = null
    return
  }
  aiReport.value = {
    title: r.rangeLabel + ' · ' + PERIOD_CN[r.key],
    summary: out.summary,
    letter: out.letter || '',
    trends: [
      { label: '活跃度分布', unit: ' 次', points: trendPts }
    ]
  }
  // 模块六：周期报告生成里程碑（触发 Web 专属成就）
  store.bumpMilestone('periodReport')
}
function clearAi() { aiReport.value = null; aiError.value = '' }
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

    <!-- 周期报告：日报 / 周报 / 月报 / 年报（AI 统一生成 + 本地聚合兜底） -->
    <div class="section-title">周期报告</div>
    <div class="glass card">
      <div class="row wrap" style="gap:6px">
        <button v-for="pd in PERIODS" :key="pd.key" class="chip" :style="period === pd.key ? 'background:var(--eo-primary);color:#fff' : ''" @click="period = pd.key; clearAi()">
          <Icon :name="pd.icon" :size="13" /> {{ pd.label }}
        </button>
        <button class="chip pr-ai" :disabled="aiBusy" @click="generateReport">
          <Icon name="sparkles" :size="13" /> {{ aiBusy ? 'AI 生成中…' : 'AI 生成本期报告' }}
        </button>
      </div>

      <div class="row between" style="margin-top:12px">
        <span class="row" style="gap:8px;font-weight:800;font-size:15px">
          <span class="avatar" style="width:30px;height:30px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="calendar" :size="16" /></span>
          {{ PERIOD_CN[report.key] }}
        </span>
        <span class="muted" style="font-size:12px">{{ report.rangeLabel }}</span>
      </div>

      <!-- 四宫格指标 -->
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

      <!-- 活跃度分布 -->
      <div style="font-weight:700;margin-top:14px">{{ report.title }}</div>
      <div class="chart-row">
        <div v-for="(b, i) in report.bars" :key="i" class="chart-col">
          <div class="chart-bars"><i class="b-act" :style="{ height: (b.v / report.maxV * 64) + 'px' }" :title="b.v + ' 次记录'"></i></div>
          <span class="muted">{{ b.label }}</span>
        </div>
      </div>

      <!-- 一句话总结（本地聚合兜底，始终可见） -->
      <div class="pr-summary">
        <span class="pr-dot"></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">数据总结</div>
          <div class="muted" style="font-size:13px;margin-top:2px;line-height:1.7">{{ report.summary }}</div>
        </div>
      </div>

      <div v-if="aiError" class="pr-err">
        <Icon name="warning" :size="15" /> {{ aiError }}
      </div>
    </div>

    <!-- AI 生成的报告（满血 Haze，ReportRenderer 全局组件） -->
    <ReportRenderer v-if="aiReport" :report="aiReport" style="margin-top:14px" />

    <!-- 自定义看板（grid-layout-plus 拖拽 / 缩放 / 布局持久化） -->
    <div class="section-title">看板</div>
    <DashboardBoard />
  </div>
</template>

<style scoped>
.pr-ai { margin-left: auto; }
.pr-ai:disabled { opacity: .6; }
.pr-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.pr-tile {
  background: var(--eo-chip); border-radius: 14px; padding: 12px 6px;
  display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center;
}
.pr-tile b { font-size: 22px; font-weight: 800; color: var(--eo-primary-deep); }
.pr-tile span { font-size: 12px; color: var(--eo-ink); }
.pr-tile i { font-size: 10px; font-style: normal; color: var(--eo-ink-soft); }
@media (max-width: 560px) { .pr-grid { grid-template-columns: repeat(2, 1fr); } .pr-ai { margin-left: 0; } }

.pr-summary {
  display: flex; gap: 10px; align-items: flex-start; margin-top: 14px;
  padding: 12px 14px; border-radius: 14px; background: var(--eo-chip);
}
.pr-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--eo-good); flex: none; margin-top: 4px; }
.pr-err {
  display: flex; align-items: center; gap: 6px; margin-top: 10px;
  padding: 9px 12px; border-radius: 12px; font-size: 12px;
  color: var(--eo-bad); background: rgba(196, 99, 76, .1);
  border: 1px solid rgba(196, 99, 76, .25);
}

.chart-row { display: flex; align-items: flex-end; gap: 6px; margin-top: 10px; overflow-x: auto; }
.chart-col { flex: 1 0 auto; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.chart-col .muted { font-size: 10px; white-space: nowrap; }
.chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
.chart-bars i { width: 8px; border-radius: 4px 4px 0 0; min-height: 2px; display: block; transition: height .4s cubic-bezier(.22,1,.36,1); }
.b-act { background: linear-gradient(180deg, var(--eo-primary-soft), var(--eo-primary)); }
</style>
