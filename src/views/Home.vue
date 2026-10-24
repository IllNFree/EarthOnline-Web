<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { getLifeStats, growthStageOf, todayStr } from '../lib/model.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const router = useRouter()
const p2d = (n) => String(n).padStart(2, '0')
const today = todayStr()

// ---- 速览 = 唯一快捷操作入口：跳转主页面并自动弹开对应操作窗口（?add=1） ----
const quickActions = [
  { label: '写笔记', icon: 'note', tint: '#7A6FA8', bg: '#ECE9F4', to: '/notes?add=1' },
  { label: '记一笔', icon: 'wallet', tint: '#4E9668', bg: '#E3EFE6', to: '/ledger?add=1' },
  { label: '新任务', icon: 'tasks', tint: '#B08553', bg: '#F5E9DA', to: '/tasks?add=1' },
  { label: '传照片', icon: 'album', tint: '#5F8F63', bg: '#E5F0E2', to: '/album?add=1' },
  { label: '留足迹', icon: 'map-pin', tint: '#5B7E9E', bg: '#E2EAF2', to: '/map?add=1' },
  { label: '看数据', icon: 'chart', tint: '#C4634C', bg: '#F6E5DF', to: '/stats' }
]
function go(to) { router.push(to) }

// ---- 今日数据看板 ----
const dash = computed(() => {
  const todayDue = store.data.tasks.filter((t) => t.dueDate === today && t.status !== 'done').length
  const todayDone = store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === today).length
  let inc = 0, exp = 0
  store.data.ledger.records.forEach((r) => { if (r.date === today) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  const lastPhoto = (store.data.photos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  return { todayDue, todayDone, balance: inc - exp, lastPhoto, lastMemo }
})

// ---- 日历视图 ----
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const calBase = ref(new Date())
const selDay = ref('')
const fmt = (d) => d.getFullYear() + '-' + p2d(d.getMonth() + 1) + '-' + p2d(d.getDate())
const calTitle = computed(() => calBase.value.getFullYear() + ' 年 ' + (calBase.value.getMonth() + 1) + ' 月')
const dueMap = computed(() => {
  const m = {}
  store.data.tasks.forEach((t) => {
    if (t.dueDate) { if (!m[t.dueDate]) m[t.dueDate] = []; m[t.dueDate].push(t) }
  })
  return m
})
const calCells = computed(() => {
  const y = calBase.value.getFullYear(), mo = calBase.value.getMonth()
  const first = new Date(y, mo, 1)
  const start = new Date(y, mo, 1 - first.getDay())
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = fmt(d)
    cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === mo, isToday: key === today, due: (dueMap.value[key] || []).length })
  }
  return cells
})
const todayKey = today
if (!selDay.value) selDay.value = todayKey
const selTasks = computed(() => dueMap.value[selDay.value] || [])
function calShift(n) { const d = new Date(calBase.value); d.setMonth(d.getMonth() + n); calBase.value = d }
function pickDay(c) { selDay.value = c.key }

const life = computed(() => getLifeStats(store.data.birthDate))
const stage = computed(() => growthStageOf(store.xp))
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})
const recent = computed(() => (store.data.activities || []).slice(0, 8))
const timeline = computed(() => {
  const arr = []
  ;(store.data.memos || []).forEach((m) => arr.push({ date: m.createdAt, icon: 'note', text: '笔记：' + (m.title || '无标题') }))
  ;(store.data.locations || []).forEach((l) => arr.push({ date: l.date, icon: 'map-pin', text: '足迹：' + l.name }))
  return arr.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10)
})
function statusLabelOf(s) { return ({ planning: '规划中', active: '进行中', paused: '搁置', done: '已完成' })[s] || s }

// ---- 核心数据卡片堆叠：纯主展示（只看不操作，点击进详情）+ CSS 3D 层叠 ----
const stack = computed(() => {
  const cards = []
  // 人生进度
  if (store.data.birthDate) {
    cards.push({
      icon: stage.value.icon, tint: 'primary', title: '人生进度',
      bar: life.value.progress, big: Math.round(life.value.progress * 100) + '%', unit: stage.value.label,
      sub: '已活 ' + life.value.daysLived + ' 天 · ' + store.xp + ' XP', to: '/settings'
    })
  } else {
    cards.push({ icon: 'egg', tint: 'primary', title: '人生进度', big: '—', unit: '未开启', sub: '在「设置」中填写生日后开启', to: '/settings' })
  }
  // 今日任务
  const todayDueList = (dueMap.value[todayKey] || []).filter((t) => t.status !== 'done')
  cards.push({
    icon: 'tasks', tint: 'bad', title: '今日任务',
    big: String(todayDueList.length), unit: '项待完成',
    sub: todayDueList.length ? todayDueList.slice(0, 3).map((t) => t.title).join('、') : '今天没有截止任务',
    to: '/tasks'
  })
  // 本月收支
  const mk = todayKey.slice(0, 7)
  let exp = 0, inc = 0
  store.data.ledger.records.forEach((r) => { if (r.date.startsWith(mk)) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  cards.push({
    icon: 'wallet', tint: 'good', title: '本月收支',
    big: (inc - exp).toFixed(0), unit: '元结余',
    sub: '收入 ' + inc.toFixed(0) + ' · 支出 ' + exp.toFixed(0), to: '/ledger'
  })
  // 笔记与相册
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  cards.push({
    icon: 'note', tint: 'accent', title: '笔记',
    big: String(store.data.memos.length), unit: '篇',
    sub: lastMemo ? (lastMemo.title || '无标题') : '还没有笔记', to: '/notes'
  })
  const lastPhoto = (store.data.photos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  cards.push({
    icon: 'album', tint: 'primary', title: '相册',
    big: String(store.data.photos.length), unit: '张回忆',
    sub: lastPhoto ? '最近一张：' + (lastPhoto.name || '') : '还没有照片', to: '/album'
  })
  // 足迹
  const lastLoc = (store.data.locations || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  cards.push({
    icon: 'map-pin', tint: 'good', title: '足迹',
    big: String(store.data.locations.length), unit: '个地点',
    sub: lastLoc ? lastLoc.name + ' · ' + lastLoc.date : '还没有足迹', to: '/map'
  })
  return cards
})
const stackIdx = ref(0)
function stackShift(n) { stackIdx.value = (stackIdx.value + n + stack.value.length) % stack.value.length }
const TINT = { primary: 'var(--eo-primary-deep)', bad: 'var(--eo-bad)', accent: 'var(--eo-accent)', good: 'var(--eo-good)' }
function relPos(i) {
  const n = stack.value.length
  return (i - stackIdx.value + n) % n
}
function cardStyle(i) {
  const k = relPos(i)
  if (k > 2) return 'display:none'
  // 后方卡片微微上移缩进露出边缘（景深层叠），前面卡片带深阴影
  const t = { 0: 'translate3d(0,0,0) scale(1)', 1: 'translate3d(0,-16px,-52px) scale(.955)', 2: 'translate3d(0,-30px,-100px) scale(.91)' }[k]
  const opacity = { 0: 1, 1: .8, 2: .55 }[k]
  const shadow = { 0: '0 22px 44px -18px rgba(154,124,88,.45)', 1: '0 12px 26px -16px rgba(154,124,88,.28)', 2: '0 8px 18px -14px rgba(154,124,88,.2)' }[k]
  let tf = t
  if (k === 0 && dragX.value) tf = 'translate3d(' + dragX.value + 'px,0,0) rotate(' + (dragX.value * 0.04) + 'deg) scale(1)'
  const pos = k === 0 ? 'position:relative;z-index:3' : 'position:absolute;left:0;right:0;top:0;z-index:' + (k === 1 ? 2 : 1) + ';pointer-events:auto'
  return 'display:block;' + pos + ';transform:' + tf + ';opacity:' + opacity + ';box-shadow:' + shadow + (k === 0 && dragging.value ? ';transition:none' : '')
}
// 拖拽（鼠标 + 触摸统一走 Pointer Events）
const dragX = ref(0)
const dragging = ref(false)
const didDrag = ref(false)
let dragStartX = 0, dragPid = -1
function onPointerDown(e) {
  if (relPos(Number(e.currentTarget.dataset.idx)) !== 0) return
  dragging.value = true; dragStartX = e.clientX; dragPid = e.pointerId
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}
function onPointerMove(e) {
  if (!dragging.value || e.pointerId !== dragPid) return
  dragX.value = e.clientX - dragStartX
}
function onPointerUp(e) {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  if (!dragging.value) return
  const dx = e.pointerId === dragPid ? (e.clientX - dragStartX) : dragX.value
  dragging.value = false; dragPid = -1
  didDrag.value = Math.abs(dx) > 6
  if (Math.abs(dx) > 72) stackShift(dx < 0 ? 1 : -1)
  dragX.value = 0
  setTimeout(() => { didDrag.value = false }, 80)
}
function onCardClick(i, c) {
  if (didDrag.value) return
  if (relPos(i) === 0) go(c.to)
  else stackShift(1)
}
</script>

<template>
  <div class="page wide">
    <!-- 问候 -->
    <div class="muted" style="font-size:14px;margin:0 4px 8px">{{ greeting }}{{ store.data.profile.name ? '，' + store.data.profile.name : '' }}</div>

    <!-- 核心卡片堆叠（纯展示 + 3D 层叠 + 拖拽切换，点击进详情） -->
    <div v-if="stack.length" class="stack-wrap">
      <div
        v-for="(c, i) in stack" :key="c.title" class="glass card stack-card"
        :data-idx="i" :style="cardStyle(i)"
        @pointerdown="onPointerDown" @click="onCardClick(i, c)">
        <div class="row between">
          <span class="row" style="gap:8px">
            <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip)" :style="'color:' + TINT[c.tint]"><Icon :name="c.icon" :size="18" /></span>
            <span style="font-weight:700;font-size:14px">{{ c.title }}</span>
          </span>
          <span class="row" style="gap:8px">
            <span class="muted" style="font-size:11px">{{ (i - stackIdx + stack.length) % stack.length + 1 }} / {{ stack.length }}</span>
            <Icon name="chevron" :size="15" />
          </span>
        </div>
        <div class="row" style="gap:8px;margin-top:8px;align-items:baseline">
          <span style="font-size:30px;font-weight:800;line-height:1" :style="'color:' + TINT[c.tint]">{{ c.big }}</span>
          <span class="muted" style="font-size:12px">{{ c.unit }}</span>
        </div>
        <div v-if="c.bar != null" class="bar" style="margin:8px 0 4px"><i :style="{ width: (c.bar * 100) + '%' }"></i></div>
        <div class="muted" style="font-size:12px;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.sub }}</div>
      </div>
      <!-- 左右箭头暗示切换 -->
      <div class="row" style="justify-content:center;gap:14px;margin-top:12px">
        <button class="stack-arrow" @click="stackShift(-1)" aria-label="上一张"><Icon name="chevron" :size="15" style="transform:rotate(180deg)" /></button>
        <span v-for="(c, i) in stack" :key="'d' + i" class="stack-dot" :style="i === stackIdx ? 'background:var(--eo-primary);width:16px' : ''"></span>
        <button class="stack-arrow" @click="stackShift(1)" aria-label="下一张"><Icon name="chevron" :size="15" /></button>
      </div>
    </div>

    <!-- 速览 = 快捷操作区（一键直达 + 自动弹开操作窗） -->
    <div class="section-title">速览 · 快捷操作</div>
    <div class="qa-grid">
      <button v-for="a in quickActions" :key="a.label" class="glass card qa-item" @click="go(a.to)">
        <span class="qa-icon" :style="'background:' + a.bg + ';color:' + a.tint"><Icon :name="a.icon" :size="19" /></span>
        <span style="font-weight:600;font-size:12px;color:var(--eo-ink)">{{ a.label }}</span>
      </button>
    </div>

    <!-- 今日看板（低高度高密度） -->
    <div class="section-title">今日看板</div>
    <div class="dash-grid">
      <button class="glass card dash-tile" @click="go('/tasks')">
        <div class="muted dash-cap">今日待办</div>
        <div class="dash-num" style="color:var(--eo-primary-deep)">{{ dash.todayDue }}</div>
        <div class="muted dash-foot">已完成 {{ dash.todayDone }}</div>
      </button>
      <button class="glass card dash-tile" @click="go('/ledger')">
        <div class="muted dash-cap">今日结余</div>
        <div class="dash-num" :style="'color:' + (dash.balance >= 0 ? 'var(--eo-good)' : 'var(--eo-bad)')">{{ dash.balance >= 0 ? '+' : '' }}{{ dash.balance.toFixed(0) }}</div>
        <div class="muted dash-foot">元 · 去记账</div>
      </button>
      <button class="glass card dash-tile dash-photo" @click="go('/album')">
        <div class="muted dash-cap">最近照片</div>
        <img v-if="dash.lastPhoto && dash.lastPhoto.dataUrl" :src="dash.lastPhoto.dataUrl" alt="" class="dash-thumb" />
        <div v-else class="muted dash-foot" style="margin-top:4px">去相册传一张</div>
      </button>
      <button class="glass card dash-tile" @click="go('/notes')">
        <div class="muted dash-cap">最新笔记</div>
        <div class="dash-note">{{ dash.lastMemo ? (dash.lastMemo.title || '无标题') : '还没有笔记' }}</div>
      </button>
    </div>

    <!-- 电脑端三栏：日历 / 时间轴 / 最近动态 -->
    <div class="home-lower">
    <div>
    <div class="section-title">日历 · 任务</div>
    <div class="glass card">
      <div class="row between" style="margin-bottom:8px">
        <button class="btn ghost" style="padding:6px 12px" @click="calShift(-1)"><Icon name="chevron" :size="16" style="transform:rotate(180deg)" /></button>
        <span style="font-weight:700">{{ calTitle }}</span>
        <button class="btn ghost" style="padding:6px 12px" @click="calShift(1)"><Icon name="chevron" :size="16" /></button>
      </div>
      <div class="cal-week">
        <span v-for="w in WEEK" :key="w" class="muted">{{ w }}</span>
      </div>
      <div class="cal-grid">
        <button v-for="c in calCells" :key="c.key" class="cal-cell"
          :class="{ out: !c.inMonth, today: c.isToday, sel: c.key === selDay }" @click="pickDay(c)">
          {{ c.day }}
          <i v-if="c.due" class="cal-dot"></i>
        </button>
      </div>
      <div class="row between" style="margin-top:10px">
        <span class="muted" style="font-size:13px">{{ selDay === todayKey ? '今日待办' : selDay + ' 截止' }}</span>
        <span class="chip" v-if="selTasks.length">{{ selTasks.length }} 项</span>
      </div>
      <div v-if="selTasks.length">
        <div v-for="t in selTasks" :key="t.id" class="row" style="padding:7px 0;border-top:1px solid var(--eo-glass-border)">
          <Icon name="checklist" :size="16" />
          <span style="font-size:14px;flex:1" :style="t.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''">{{ t.title }}</span>
          <span class="chip">{{ statusLabelOf(t.status) }}</span>
        </div>
        <button class="btn ghost" style="width:100%;margin-top:8px" @click="go('/tasks?add=1')"><Icon name="plus" :size="16" /> 新建任务</button>
      </div>
      <div v-else class="muted" style="font-size:13px;padding:8px 0">该日暂无截止任务，点击日历日期查看其他天。</div>
    </div>
    </div>

    <div>
    <div class="section-title">人生时间轴</div>
    <div class="glass card">
      <div v-if="!timeline.length" class="muted" style="font-size:14px">还没有记录，去添加第一篇笔记或足迹吧。</div>
      <div v-for="(t, i) in timeline" :key="i" class="row" style="padding:8px 0;border-bottom:1px solid var(--eo-glass-border)" :style="i === timeline.length - 1 ? 'border:none' : ''">
        <span class="avatar" style="width:34px;height:34px"><Icon :name="t.icon" :size="18" /></span>
        <div style="flex:1">
          <div style="font-size:14px">{{ t.text }}</div>
          <div class="muted" style="font-size:12px">{{ t.date }}</div>
        </div>
      </div>
    </div>
    </div>

    <div>
    <div class="section-title">最近动态</div>
    <div class="glass card">
      <div v-if="!recent.length" class="muted" style="font-size:14px">暂无动态。</div>
      <transition-group name="fade">
        <div v-for="(a, i) in recent" :key="a.id" class="row" style="padding:7px 0">
          <Icon :name="a.icon" :size="18" />
          <span style="font-size:14px;flex:1">{{ a.text }}</span>
          <span class="muted" style="font-size:12px">{{ a.time }}</span>
        </div>
      </transition-group>
    </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 11px; margin-bottom: 4px; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-cell {
  position: relative; height: 34px; border-radius: 10px; font-size: 12.5px;
  color: var(--eo-ink); display: flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.cal-cell:hover { background: var(--eo-chip); }
.cal-cell.out { opacity: .32; }
.cal-cell.today { box-shadow: inset 0 0 0 1.5px var(--eo-primary); font-weight: 700; }
.cal-cell.sel { background: linear-gradient(135deg, var(--eo-primary), var(--eo-primary-soft)); color: #fff; font-weight: 700; }
.cal-dot {
  position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 4px; border-radius: 50%; background: var(--eo-primary-deep);
}
.cal-cell.sel .cal-dot { background: #fff; }

/* 卡片堆叠：CSS 3D 景深层叠（后方卡片露出上缘）+ 拖拽 */
.stack-wrap { margin: 0 0 4px; position: relative; perspective: 1100px; }
.stack-card {
  transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .35s ease, box-shadow .35s ease;
  cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none;
}
.stack-card:active { cursor: grabbing; }
.stack-arrow {
  width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
  transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s ease;
}
.stack-arrow:hover { transform: scale(1.08); background: rgba(212, 163, 115, 0.3); }
.stack-dot { width: 5px; height: 5px; border-radius: 99px; background: var(--eo-glass-border); display: inline-block; transition: all .3s ease; }

/* 快捷操作：紧凑瓷砖 */
.qa-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.qa-item { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0; padding: 10px 2px; }
.qa-icon { width: 38px; height: 38px; border-radius: 13px; display: flex; align-items: center; justify-content: center; }
@media (max-width: 640px) { .qa-grid { grid-template-columns: repeat(3, 1fr); } }

/* 今日看板：低高度高密度 */
.dash-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.dash-tile { margin: 0; padding: 9px 11px; text-align: left; display: flex; flex-direction: column; gap: 1px; }
.dash-cap { font-size: 11px; }
.dash-num { font-size: 19px; font-weight: 800; line-height: 1.25; }
.dash-foot { font-size: 10px; }
.dash-thumb { width: 100%; height: 40px; object-fit: cover; border-radius: 8px; margin-top: 3px; }
.dash-note {
  font-size: 12px; font-weight: 700; margin-top: 2px; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
@media (max-width: 640px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
