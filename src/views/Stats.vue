<script setup>
// 数据中心：概览统计 + 14 日任务完成趋势 + 记账月度柱状 + 年报
import { computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { todayStr, xpLevelInfo } from '../lib/model.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const p2 = (n) => String(n).padStart(2, '0')
const today = todayStr()
const level = computed(() => xpLevelInfo(store.xp))

const overview = computed(() => ([
  { icon: 'tasks', label: '任务', value: store.data.tasks.length, sub: store.data.tasks.filter((t) => t.status === 'done').length + ' 已完成' },
  { icon: 'note', label: '笔记', value: store.data.memos.length, sub: '条记录' },
  { icon: 'backpack', label: '物品/收藏', value: store.data.items.length + store.data.collections.length, sub: store.data.collections.length + ' 项收藏' },
  { icon: 'image', label: '照片', value: store.data.photos.length, sub: '张回忆' },
  { icon: 'map-pin', label: '足迹', value: store.data.locations.length, sub: '个地点' },
  { icon: 'trophy', label: '成就', value: store.data.achievements.length, sub: store.xp + ' XP' }
]))

// 近 14 日：每日新建/完成任务数
const trend = computed(() => {
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = todayStr(d)
    days.push({
      key, label: p2(d.getMonth() + 1) + '/' + p2(d.getDate()),
      done: store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === key).length,
      created: store.data.tasks.filter((t) => t.createdAt === key).length
    })
  }
  return days
})
const trendMax = computed(() => Math.max(1, ...trend.value.map((d) => Math.max(d.done, d.created))))

// 近 6 个月记账（收入/支出柱状）
const ledgerMonths = computed(() => {
  const out = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
    const mk = d.getFullYear() + '-' + p2(d.getMonth() + 1)
    let inc = 0, exp = 0
    store.data.ledger.records.forEach((r) => {
      if (!r.date.startsWith(mk)) return
      if (r.type === 'income') inc += r.amount; else exp += r.amount
    })
    out.push({ label: (d.getMonth() + 1) + '月', inc, exp })
  }
  return out
})
const ledMax = computed(() => Math.max(1, ...ledgerMonths.value.map((m) => Math.max(m.inc, m.exp))))

// 日报：今日概览（需求：补日报）
const daily = computed(() => {
  const tasksDone = store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === today).length
  const memos = store.data.memos.filter((m) => m.createdAt === today).length
  const photos = store.data.photos.filter((p) => p.createdAt === today).length
  let inc = 0, exp = 0
  store.data.ledger.records.forEach((r) => {
    if (r.date !== today) return
    if (r.type === 'income') inc += r.amount; else exp += r.amount
  })
  return { tasksDone, memos, photos, income: inc, expense: exp, balance: inc - exp }
})

// 周报：近 7 日逐日任务/笔记/记账（需求：补周报）
const weekly = computed(() => {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = todayStr(d)
    let inc = 0, exp = 0
    store.data.ledger.records.forEach((r) => {
      if (r.date !== key) return
      if (r.type === 'income') inc += r.amount; else exp += r.amount
    })
    days.push({
      key, label: i === 0 ? '今天' : p2(d.getMonth() + 1) + '/' + p2(d.getDate()),
      done: store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === key).length,
      memos: store.data.memos.filter((m) => m.createdAt === key).length,
      net: inc - exp
    })
  }
  return days
})
const weekMax = computed(() => Math.max(1, ...weekly.value.map((d) => Math.abs(d.net)), ...weekly.value.map((d) => d.done + d.memos)))

// 年报：本年度聚合
const yearReport = computed(() => {
  const y = new Date().getFullYear()
  const inYear = (s) => s && String(s).startsWith(String(y))
  const led = { inc: 0, exp: 0 }
  store.data.ledger.records.forEach((r) => { if (inYear(r.date)) { if (r.type === 'income') led.inc += r.amount; else led.exp += r.amount } })
  return {
    year: y,
    tasksDone: store.data.tasks.filter((t) => t.doneAt && inYear(t.doneAt.slice(0, 10))).length,
    memos: store.data.memos.filter((m) => inYear(m.createdAt)).length,
    photos: store.data.photos.filter((p) => inYear(p.createdAt)).length,
    footprints: store.data.locations.filter((l) => inYear(l.date)).length,
    ledIncome: led.inc, ledExpense: led.exp
  }
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

    <!-- 日报：今日概览 -->
    <div class="section-title">今日概览（日报）</div>
    <div class="glass card">
      <div class="grid3" style="text-align:center">
        <div><div class="muted" style="font-size:12px">完成任务</div><div style="font-weight:800;font-size:18px">{{ daily.tasksDone }}</div></div>
        <div><div class="muted" style="font-size:12px">写下笔记</div><div style="font-weight:800;font-size:18px">{{ daily.memos }}</div></div>
        <div><div class="muted" style="font-size:12px">存入照片</div><div style="font-weight:800;font-size:18px">{{ daily.photos }}</div></div>
      </div>
      <div class="row between" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--eo-glass-border);font-size:13px">
        <span class="muted">今日收支</span>
        <span class="row" style="gap:10px">
          <b style="color:var(--eo-good)">+{{ daily.income.toFixed(2) }}</b>
          <b style="color:var(--eo-bad)">-{{ daily.expense.toFixed(2) }}</b>
          <b>结余 {{ daily.balance.toFixed(2) }}</b>
        </span>
      </div>
    </div>

    <!-- 周报：近 7 日 -->
    <div class="section-title">近 7 日回顾（周报）</div>
    <div class="glass card">
      <div class="chart-row">
        <div v-for="d in weekly" :key="d.key" class="chart-col">
          <div class="chart-bars">
            <i class="b-done" :style="{ height: (d.done / weekMax * 56) + 'px' }" :title="d.done + ' 任务完成'"></i>
            <i class="b-memo" :style="{ height: (d.memos / weekMax * 56) + 'px' }" :title="d.memos + ' 笔记'"></i>
            <i :class="d.net >= 0 ? 'b-inc' : 'b-exp'" :style="{ height: (Math.abs(d.net) / weekMax * 56) + 'px' }" :title="'收支净额 ' + d.net.toFixed(0)"></i>
          </div>
          <span class="muted">{{ d.label }}</span>
        </div>
      </div>
      <div class="row" style="gap:14px;margin-top:8px;font-size:12px">
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-primary)"></i>完成任务</span>
        <span class="row" style="gap:5px"><i class="dot" style="background:#9A8FB0"></i>笔记</span>
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-good)"></i>收大于支</span>
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-bad)"></i>支大于收</span>
      </div>
    </div>

    <!-- 14 日任务趋势 -->
    <div class="section-title">近 14 日任务趋势</div>
    <div class="glass card">
      <div class="chart-row">
        <div v-for="d in trend" :key="d.key" class="chart-col">
          <div class="chart-bars">
            <i class="b-done" :style="{ height: (d.done / trendMax * 64) + 'px' }" :title="d.done + ' 完成'"></i>
            <i class="b-new" :style="{ height: (d.created / trendMax * 64) + 'px' }" :title="d.created + ' 新建'"></i>
          </div>
          <span class="muted">{{ d.label }}</span>
        </div>
      </div>
      <div class="row" style="gap:14px;margin-top:8px;font-size:12px">
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-primary)"></i>完成</span>
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-glass-border)"></i>新建</span>
      </div>
    </div>

    <!-- 近 6 个月收支 -->
    <div class="section-title">近 6 个月收支</div>
    <div class="glass card">
      <div class="chart-row">
        <div v-for="m in ledgerMonths" :key="m.label" class="chart-col">
          <div class="chart-bars">
            <i class="b-inc" :style="{ height: (m.inc / ledMax * 64) + 'px' }" :title="'收入 ' + m.inc.toFixed(0)"></i>
            <i class="b-exp" :style="{ height: (m.exp / ledMax * 64) + 'px' }" :title="'支出 ' + m.exp.toFixed(0)"></i>
          </div>
          <span class="muted">{{ m.label }}</span>
        </div>
      </div>
      <div class="row" style="gap:14px;margin-top:8px;font-size:12px">
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-good)"></i>收入</span>
        <span class="row" style="gap:5px"><i class="dot" style="background:var(--eo-bad)"></i>支出</span>
      </div>
      <div v-if="!store.data.ledger.records.length" class="muted" style="font-size:12px;margin-top:6px">还没有记账数据，去「记账」页添加后这里会自动生成图表。</div>
    </div>

    <!-- 年报 -->
    <div class="section-title">{{ yearReport.year }} 年度报告</div>
    <div class="glass card">
      <div class="grid2">
        <div class="yr-item"><span class="muted">完成任务</span><b>{{ yearReport.tasksDone }}</b></div>
        <div class="yr-item"><span class="muted">写下笔记</span><b>{{ yearReport.memos }}</b></div>
        <div class="yr-item"><span class="muted">存入照片</span><b>{{ yearReport.photos }}</b></div>
        <div class="yr-item"><span class="muted">留下足迹</span><b>{{ yearReport.footprints }}</b></div>
        <div class="yr-item"><span class="muted">年度收入</span><b style="color:var(--eo-good)">{{ yearReport.ledIncome.toFixed(2) }}</b></div>
        <div class="yr-item"><span class="muted">年度支出</span><b style="color:var(--eo-bad)">{{ yearReport.ledExpense.toFixed(2) }}</b></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-row { display: flex; align-items: flex-end; gap: 6px; }
.chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.chart-col .muted { font-size: 10px; white-space: nowrap; }
.chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
.chart-bars i { width: 8px; border-radius: 4px 4px 0 0; min-height: 2px; display: block; transition: height .4s cubic-bezier(.22,1,.36,1); }
.b-done { background: var(--eo-primary); }
.b-new { background: var(--eo-glass-border); }
.b-memo { background: #9A8FB0; }
.b-inc { background: var(--eo-good); }
.b-exp { background: var(--eo-bad); }
.dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.yr-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--eo-glass-border); font-size: 14px; }
.yr-item:last-child, .yr-item:nth-last-child(2) { border-bottom: none; }
</style>
