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

// ---- 快捷操作台（不再复制侧边栏，改为动作 + 数据看板） ----
const quickActions = [
  { label: '写笔记', icon: 'note', tint: '#7A6FA8', bg: '#ECE9F4', to: '/notes' },
  { label: '记一笔', icon: 'wallet', tint: '#4E9668', bg: '#E3EFE6', to: '/ledger' },
  { label: '新任务', icon: 'tasks', tint: '#B08553', bg: '#F5E9DA', to: '/tasks' },
  { label: '传照片', icon: 'album', tint: '#5F8F63', bg: '#E5F0E2', to: '/album' },
  { label: '留足迹', icon: 'map-pin', tint: '#5B7E9E', bg: '#E2EAF2', to: '/map' },
  { label: '看数据', icon: 'chart', tint: '#C4634C', bg: '#F6E5DF', to: '/stats' }
]
function go(to) { router.push(to) }

// ---- 今日数据看板（与侧边栏信息互补：只看「今天」+「最新」） ----
const dash = computed(() => {
  const todayDue = store.data.tasks.filter((t) => t.dueDate === today && t.status !== 'done').length
  const todayDone = store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === today).length
  let inc = 0, exp = 0
  store.data.ledger.records.forEach((r) => { if (r.date === today) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  const lastPhoto = (store.data.photos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  return { todayDue, todayDone, balance: inc - exp, lastPhoto, lastMemo }
})

// ---- 空状态判定（新手引导 CTA） ----
const isNewbie = computed(() => !store.data.tasks.length && !store.data.memos.length && !store.data.photos.length && !store.data.locations.length)
const needBirth = computed(() => !store.data.birthDate)

// ---- 日历视图（与任务截止结合） ----
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

// ---- 数据卡片堆叠：CSS 3D 前后层叠 + 鼠标/触摸拖拽切换（需求 #10） ----
const stack = computed(() => {
  const cards = []
  const todayDueList = (dueMap.value[todayKey] || []).filter((t) => t.status !== 'done')
  cards.push({
    icon: 'tasks', tint: 'primary', title: '今日任务',
    big: String(todayDueList.length), unit: '项待完成',
    sub: todayDueList.length ? todayDueList.slice(0, 2).map((t) => t.title).join('、') : '',
    empty: !todayDueList.length,
    to: '/tasks'
  })
  const mk = todayKey.slice(0, 7)
  let exp = 0, inc = 0
  store.data.ledger.records.forEach((r) => { if (r.date.startsWith(mk)) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  cards.push({
    icon: 'wallet', tint: 'bad', title: '本月支出',
    big: exp.toFixed(0), unit: '元 · 收入 ' + inc.toFixed(0),
    sub: inc + exp ? '收支明细一目了然' : '还没有记账，点这里记第一笔', empty: !(inc + exp),
    to: '/ledger'
  })
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  cards.push({
    icon: 'note', tint: 'accent', title: '最新笔记',
    big: String(store.data.memos.length), unit: '篇',
    sub: lastMemo ? (lastMemo.title || '无标题') : '记录你的每一个灵感', empty: !store.data.memos.length, to: '/notes'
  })
  const lastLoc = (store.data.locations || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  cards.push({
    icon: 'map-pin', tint: 'good', title: '最近足迹',
    big: String(store.data.locations.length), unit: '个地点',
    sub: lastLoc ? lastLoc.name + ' · ' + lastLoc.date : '去地图留下第一个足迹', empty: !store.data.locations.length, to: '/map'
  })
  return cards
})
const stackIdx = ref(0)
function stackShift(n) { stackIdx.value = (stackIdx.value + n + stack.value.length) % stack.value.length }
const TINT = { primary: 'var(--eo-primary-deep)', bad: 'var(--eo-bad)', accent: 'var(--eo-accent)', good: 'var(--eo-good)' }
function relPos(i) {
  const n = stack.value.length
  return (i - stackIdx.value + n) % n // 0=front, 1..n-1 = behind
}
function cardStyle(i) {
  const k = relPos(i)
  if (k > 2) return 'display:none'
  const base = { 0: 'translate3d(0,0,0) scale(1)', 1: 'translate3d(0,-12px,-46px) scale(.965)', 2: 'translate3d(0,-22px,-88px) scale(.93)' }[k]
  const opacity = { 0: 1, 1: .6, 2: .3 }[k]
  let t = base
  if (k === 0 && dragX.value) t = 'translate3d(' + dragX.value + 'px,0,0) rotate(' + (dragX.value * 0.04) + 'deg) scale(1)'
  const pos = k === 0 ? 'position:relative;z-index:3' : 'position:absolute;left:0;right:0;top:0;z-index:' + (k === 1 ? 2 : 1) + ';pointer-events:auto'
  return 'display:block;' + pos + ';transform:' + t + ';opacity:' + opacity + (k === 0 && dragging.value ? ';transition:none' : '')
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
    <!-- 新手欢迎（全空数据时的引导 CTA） -->
    <div v-if="isNewbie" class="glass card welcome-card">
      <div style="font-size:30px">🌏</div>
      <div style="font-size:17px;font-weight:800;margin-top:6px">欢迎来到地球！</div>
      <div class="muted" style="font-size:13px;margin-top:4px">新手教程已开启：先设置你的生日，再添加第一个任务，人生游戏正式开局。</div>
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center">
        <button class="btn" @click="go('/settings')"><Icon name="user" :size="16" /> 设置生日</button>
        <button class="btn ghost" @click="go('/tasks')"><Icon name="plus" :size="16" /> 添加第一个任务</button>
      </div>
    </div>

    <!-- 问候 + 人生进度 -->
    <div class="glass card">
      <div class="row between">
        <div>
          <div class="muted" style="font-size:13px">{{ greeting }}{{ store.data.profile.name ? '，' + store.data.profile.name : '' }}</div>
          <div style="font-size:20px;font-weight:800;margin-top:2px">人生进度 {{ Math.round(life.progress * 100) }}%</div>
        </div>
        <div class="avatar" style="width:52px;height:52px"><Icon :name="stage.icon" :size="26" /></div>
      </div>
      <div class="bar" style="margin:12px 0 6px"><i :style="{ width: (life.progress * 100) + '%' }"></i></div>
      <div class="row between muted" style="font-size:12px">
        <span>已活 {{ life.daysLived }} 天</span>
        <span>{{ stage.label }} · {{ store.xp }} XP</span>
      </div>
      <!-- 空状态 CTA：未设生日 -->
      <div v-if="needBirth" class="row between" style="margin-top:10px;padding:10px 12px;background:var(--eo-chip);border-radius:14px;gap:8px">
        <span class="muted" style="font-size:13px">设置生日后，这里会展示你的人生进度</span>
        <button class="chip" @click="go('/settings')" style="flex:none">去设置</button>
      </div>
    </div>

    <!-- 数据卡片堆叠（3D 层叠 + 拖拽滑动切换） -->
    <div v-if="stack.length" class="stack-wrap">
      <div
        v-for="(c, i) in stack" :key="c.title" class="glass card stack-card"
        :data-idx="i" :style="cardStyle(i)"
        @pointerdown="onPointerDown" @click="onCardClick(i, c)">
        <div class="row between">
          <span class="row" style="gap:8px">
            <span class="avatar" style="width:36px;height:36px;background:var(--eo-chip)" :style="'color:' + TINT[c.tint]"><Icon :name="c.icon" :size="19" /></span>
            <span style="font-weight:700">{{ c.title }}</span>
          </span>
          <Icon name="chevron" :size="16" />
        </div>
        <div class="row" style="gap:8px;margin-top:10px;align-items:baseline">
          <span style="font-size:34px;font-weight:800;line-height:1" :style="'color:' + TINT[c.tint]">{{ c.big }}</span>
          <span class="muted" style="font-size:13px">{{ c.unit }}</span>
        </div>
        <div v-if="!c.empty" class="muted" style="font-size:12px;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.sub }}</div>
        <!-- 空状态 CTA：引导添加第一条数据 -->
        <button v-else class="btn" style="width:100%;margin-top:10px" @click.stop="go(c.to)">
          <Icon name="plus" :size="16" /> {{ c.title === '今日任务' ? '添加你的第一个任务' : (c.title === '最新笔记' ? '写下第一篇笔记' : (c.title === '最近足迹' ? '留下第一个足迹' : '记下第一笔账')) }}
        </button>
      </div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:12px">
        <button class="chip" @click="stackShift(-1)"><Icon name="chevron" :size="13" style="transform:rotate(180deg)" /></button>
        <span v-for="(c, i) in stack" :key="'d' + i" class="stack-dot" :style="i === stackIdx ? 'background:var(--eo-primary)' : ''"></span>
        <button class="chip" @click="stackShift(1)"><Icon name="chevron" :size="13" /></button>
      </div>
      <div class="muted" style="text-align:center;font-size:11px;margin-top:2px">拖拽卡片左右滑动切换</div>
    </div>

    <!-- 快捷操作台（动作入口，非导航复制） -->
    <div class="section-title">快捷操作</div>
    <div class="qa-grid">
      <button v-for="a in quickActions" :key="a.label" class="glass card qa-item" @click="go(a.to)">
        <span class="qa-icon" :style="'background:' + a.bg + ';color:' + a.tint"><Icon :name="a.icon" :size="21" /></span>
        <span style="font-weight:600;font-size:12.5px;color:var(--eo-ink)">{{ a.label }}</span>
      </button>
    </div>

    <!-- 今日数据看板（与侧边栏互补：今日待办 / 今日结余 / 最新照片） -->
    <div class="section-title">今日看板</div>
    <div class="dash-grid">
      <button class="glass card dash-tile" @click="go('/tasks')">
        <div class="muted" style="font-size:12px">今日待办</div>
        <div style="font-size:24px;font-weight:800;color:var(--eo-primary-deep)">{{ dash.todayDue }}</div>
        <div class="muted" style="font-size:11px">已完成 {{ dash.todayDone }}</div>
      </button>
      <button class="glass card dash-tile" @click="go('/ledger')">
        <div class="muted" style="font-size:12px">今日结余</div>
        <div style="font-size:24px;font-weight:800" :style="'color:' + (dash.balance >= 0 ? 'var(--eo-good)' : 'var(--eo-bad)')">{{ dash.balance >= 0 ? '+' : '' }}{{ dash.balance.toFixed(0) }}</div>
        <div class="muted" style="font-size:11px">元 · 去记账</div>
      </button>
      <button class="glass card dash-tile dash-photo" @click="go('/album')">
        <div class="muted" style="font-size:12px">最近照片</div>
        <img v-if="dash.lastPhoto && dash.lastPhoto.dataUrl" :src="dash.lastPhoto.dataUrl" alt="" class="dash-thumb" />
        <div v-else class="muted" style="font-size:11px;margin-top:6px">去相册传一张</div>
      </button>
      <button class="glass card dash-tile" @click="go('/notes')">
        <div class="muted" style="font-size:12px">最新笔记</div>
        <div style="font-size:13px;font-weight:700;margin-top:4px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">{{ dash.lastMemo ? (dash.lastMemo.title || '无标题') : '还没有笔记' }}</div>
      </button>
    </div>

    <!-- 电脑端三栏：日历 / 时间轴 / 最近动态（手机端纵向堆叠） -->
    <div class="home-lower">
    <div>
    <!-- 日历视图 × 任务 -->
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
        <button class="btn ghost" style="width:100%;margin-top:8px" @click="go('/tasks')"><Icon name="tasks" :size="16" /> 去任务页管理</button>
      </div>
      <div v-else class="muted" style="font-size:13px;padding:8px 0">该日暂无截止任务，点击日历日期查看其他天。</div>
    </div>
    </div>

    <div>
    <!-- 人生时间轴 -->
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
    <!-- 最近动态 -->
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
.welcome-card { text-align: center; padding: 22px 16px; }
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

/* 卡片堆叠：CSS 3D 前后层叠 + 拖拽（定位由 cardStyle 内联控制） */
.stack-wrap { margin: 14px 0 4px; position: relative; perspective: 1000px; }
.stack-card {
  transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .35s ease;
  cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none;
}
.stack-card:active { cursor: grabbing; }
.stack-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--eo-glass-border); display: inline-block; }

/* 快捷操作台：彩色低饱和背景瓷砖 */
.qa-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.qa-item { display: flex; flex-direction: column; align-items: center; gap: 7px; margin: 0; padding: 12px 4px; }
.qa-icon { width: 42px; height: 42px; border-radius: 14px; display: flex; align-items: center; justify-content: center; }
@media (max-width: 640px) { .qa-grid { grid-template-columns: repeat(3, 1fr); } }

/* 今日看板 */
.dash-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.dash-tile { margin: 0; padding: 12px; text-align: left; display: flex; flex-direction: column; gap: 2px; }
.dash-thumb { width: 100%; height: 52px; object-fit: cover; border-radius: 10px; margin-top: 4px; }
@media (max-width: 640px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
