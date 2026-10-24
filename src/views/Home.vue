<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { getLifeStats, growthStageOf } from '../lib/model.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const router = useRouter()
const showMore = ref(false)

// 速览：任务拆「日常/Todo」，背包拆「物品/收藏」（参考需求 #7）
const waffle = [
  { name: 'daily', icon: 'tasks', label: '日常', to: '/tasks' },
  { name: 'todo', icon: 'checklist', label: 'Todo', to: '/tasks?tab=todo' },
  { name: 'item', icon: 'backpack', label: '物品', to: '/backpack' },
  { name: 'collection', icon: 'star', label: '收藏', to: '/backpack?sub=collection' },
  { name: 'notes', icon: 'note', label: '笔记', to: '/notes' },
  { name: 'album', icon: 'album', label: '相册', to: '/album' },
  { name: 'map', icon: 'map-pin', label: '足迹', to: '/map' },
  { name: 'achievements', icon: 'trophy', label: '成就', to: '/achievements' }
]
const moreWaffle = [
  { name: 'ledger', icon: 'wallet', label: '记账', to: '/ledger' },
  { name: 'stats', icon: 'chart', label: '数据中心', to: '/stats' },
  { name: 'trash', icon: 'trash', label: '回收站', to: '/trash' },
  { name: 'steam', icon: 'cloud', label: 'Steam', to: '/steam' },
  { name: 'settings', icon: 'settings', label: '设置', to: '/settings' }
]
function go(to) { router.push(to) }

// ---- 日历视图（与任务截止结合） ----
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const calBase = ref(new Date())
const selDay = ref('')
const p2 = (n) => String(n).padStart(2, '0')
const fmt = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
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
    cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === mo, isToday: key === fmt(new Date()), due: (dueMap.value[key] || []).length })
  }
  return cells
})
const todayKey = fmt(new Date())
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

// ---- 主页卡片堆叠（支持左右滑动切换 / 层叠展示，需求 #8） ----
const stack = computed(() => {
  const cards = []
  const todayDue = (dueMap.value[todayKey] || []).filter((t) => t.status !== 'done')
  cards.push({
    icon: 'tasks', tint: 'primary', title: '今日任务',
    big: String(todayDue.length), unit: '项待完成',
    sub: todayDue.length ? todayDue.slice(0, 2).map((t) => t.title).join('、') : '今天没有截止任务，享受当下吧',
    to: '/tasks'
  })
  const mk = todayKey.slice(0, 7)
  let exp = 0, inc = 0
  store.data.ledger.records.forEach((r) => { if (r.date.startsWith(mk)) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  cards.push({
    icon: 'wallet', tint: 'bad', title: '本月支出',
    big: exp.toFixed(0), unit: '元 · 收入 ' + inc.toFixed(0),
    sub: '收支明细一目了然', to: '/ledger'
  })
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  cards.push({
    icon: 'note', tint: 'accent', title: '最新笔记',
    big: String(store.data.memos.length), unit: '篇',
    sub: lastMemo ? (lastMemo.title || '无标题') : '写下第一篇笔记', to: '/notes'
  })
  const lastLoc = (store.data.locations || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  cards.push({
    icon: 'map-pin', tint: 'good', title: '最近足迹',
    big: String(store.data.locations.length), unit: '个地点',
    sub: lastLoc ? lastLoc.name + ' · ' + lastLoc.date : '去地图留下第一个足迹', to: '/map'
  })
  return cards
})
const stackIdx = ref(0)
function stackShift(n) { stackIdx.value = (stackIdx.value + n + stack.value.length) % stack.value.length }
let touchX = 0
function stackTouchStart(e) { touchX = e.changedTouches[0].clientX }
function stackTouchEnd(e) {
  const dx = e.changedTouches[0].clientX - touchX
  if (Math.abs(dx) > 36) stackShift(dx > 0 ? -1 : 1)
}
const TINT = { primary: 'var(--eo-primary-deep)', bad: 'var(--eo-bad)', accent: 'var(--eo-accent)', good: 'var(--eo-good)' }
function relPos(i) {
  const n = stack.value.length
  return (i - stackIdx.value + n) % n // 0=front, 1..n-1 = behind
}
</script>

<template>
  <div class="page wide">
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
    </div>

    <!-- 卡片堆叠（左右滑动 / 点按切换） -->
    <div v-if="stack.length" class="stack-wrap" @touchstart.passive="stackTouchStart" @touchend.passive="stackTouchEnd">
      <div
        v-for="(c, i) in stack" :key="c.title" class="glass card stack-card" :class="'pos-' + relPos(i)"
        :style="relPos(i) < 3 ? 'display:block' : 'display:none'"
        @click="relPos(i) === 0 ? go(c.to) : stackShift(1)">
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
        <div class="muted" style="font-size:12px;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.sub }}</div>
      </div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:10px">
        <button class="chip" @click="stackShift(-1)"><Icon name="chevron" :size="13" style="transform:rotate(180deg)" /></button>
        <span v-for="(c, i) in stack" :key="'d' + i" class="stack-dot" :style="i === stackIdx ? 'background:var(--eo-primary)' : ''"></span>
        <button class="chip" @click="stackShift(1)"><Icon name="chevron" :size="13" /></button>
      </div>
    </div>

    <!-- 华夫饼菜单 -->
    <div class="section-title">速览</div>
    <div class="grid4">
      <button v-for="w in waffle" :key="w.name" class="glass card list-item" style="flex-direction:column;gap:8px;margin:0" @click="go(w.to)">
        <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon :name="w.icon" :size="24" /></span>
        <span style="font-weight:600;font-size:13px">{{ w.label }}</span>
      </button>
    </div>
    <transition name="fade">
      <div v-if="showMore" class="grid4" style="margin-top:12px">
        <button v-for="w in moreWaffle" :key="w.name" class="glass card list-item" style="flex-direction:column;gap:8px;margin:0" @click="go(w.to)">
          <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon :name="w.icon" :size="24" /></span>
          <span style="font-weight:600;font-size:13px">{{ w.label }}</span>
        </button>
      </div>
    </transition>
    <button class="btn ghost" style="width:100%;margin-top:12px" @click="showMore = !showMore">
      <Icon :name="showMore ? 'chevdown' : 'more'" /> {{ showMore ? '收起' : '更多功能' }}
    </button>

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

/* 卡片堆叠：层叠展示 + 平滑切换 */
.stack-wrap { margin: 14px 0 4px; position: relative; }
.stack-card { transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .35s ease; cursor: pointer; }
.stack-card.pos-0 { transform: translateY(0) scale(1); opacity: 1; z-index: 3; position: relative; }
.stack-card.pos-1 { transform: translateY(-8px) scale(.96); opacity: .55; z-index: 2; position: absolute; left: 0; right: 0; top: 0; pointer-events: none; }
.stack-card.pos-2 { transform: translateY(-14px) scale(.92); opacity: .28; z-index: 1; position: absolute; left: 0; right: 0; top: 0; pointer-events: none; }
.stack-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--eo-glass-border); display: inline-block; }

/* 速览 4 列（8 个入口两行） */
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
</style>
