<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { getLifeStats, growthStageOf, todayStr } from '../lib/model.js'
import { achievementMeta } from '../lib/achievements.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'
import GlassUploader from '../components/GlassUploader.vue'

const store = useAppStore()
const router = useRouter()
const p2d = (n) => String(n).padStart(2, '0')
const today = todayStr()
const go = (to) => router.push(to)

// ---- 速览 = 主页内悬浮快捷操作（不跳转，弹 GlassDialog 内联表单） ----
// 顺序：① 新任务 → ② 装背包 → ③ 写笔记 → ④ 传照片 → ⑤ 记一笔 → ⑥ 回收站
const quickActions = [
  { key: 'task', label: '新任务', icon: 'tasks', tint: '#B08553', bg: '#F5E9DA' },
  { key: 'backpack', label: '装背包', icon: 'backpack', tint: '#8C7AC4', bg: '#ECE8F5' },
  { key: 'note', label: '写笔记', icon: 'note', tint: '#7A6FA8', bg: '#ECE9F4' },
  { key: 'album', label: '传照片', icon: 'album', tint: '#5F8F63', bg: '#E5F0E2' },
  { key: 'ledger', label: '记一笔', icon: 'wallet', tint: '#4E9668', bg: '#E3EFE6' },
  { key: 'trash', label: '回收站', icon: 'trash', tint: '#C4634C', bg: '#F6E5DF' }
]
const qTitles = { task: '新建任务', backpack: '添加物品', note: '写笔记', album: '添加照片', ledger: '记一笔', trash: '回收站' }
const qOpen = ref(false)
const qKey = ref('')
const qTitle = computed(() => qTitles[qKey.value] || '')
function openQuick(key) {
  qKey.value = key
  noteForm.value = { title: '', tags: '', markdown: '' }
  ledForm.value = { type: 'expense', amount: '', category: '', date: today, note: '' }
  taskForm.value = { title: '', category: 'side', dueDate: '', dueTime: '', note: '' }
  photoForm.value = { name: '', tags: '', dataUrl: '' }
  itemForm.value = { name: '', count: 1, description: '', cover: '', tags: '' }
  if (key === 'trash') { qOpen.value = false; router.push('/trash'); return }
  qOpen.value = true
}
function closeQuick() { qOpen.value = false }
function goMap() { qOpen.value = false; router.push('/map') }
function goStats() { qOpen.value = false; router.push('/stats') }

// 内联快捷表单
const noteForm = ref({ title: '', tags: '', markdown: '' })
function saveNote() {
  const r = store.addMemo({ title: noteForm.value.title, tags: noteForm.value.tags, markdown: noteForm.value.markdown })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已保存笔记'); closeQuick()
}
const ledForm = ref({ type: 'expense', amount: '', category: '', date: '', note: '' })
function saveLed() {
  const r = store.addLedgerRecord({ ...ledForm.value, amount: Number(ledForm.value.amount) })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已记账'); closeQuick()
}
const taskForm = ref({ title: '', category: 'side', dueDate: '', dueTime: '', note: '' })
const taskDueLocal = computed({
  get() { return (taskForm.value.dueDate || '') + (taskForm.value.dueTime ? 'T' + taskForm.value.dueTime : '') },
  set(v) {
    if (!v) { taskForm.value.dueDate = ''; taskForm.value.dueTime = ''; return }
    const [d, t] = String(v).split('T')
    taskForm.value.dueDate = d || ''; taskForm.value.dueTime = t ? t.slice(0, 5) : ''
  }
})
function saveTask() {
  const f = taskForm.value
  if (!String(f.title || '').trim()) return store.showToast('标题不能为空')
  const r = store.addTask({ title: f.title, category: f.category, status: 'active', note: f.note, dueDate: f.dueDate, dueTime: f.dueTime, parentId: null, tags: f.tags })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已创建任务'); closeQuick()
}
const photoForm = ref({ name: '', tags: '', dataUrl: '' })
function pickPhoto(f) {
  if (!f) return
  const r = new FileReader()
  r.onload = () => { photoForm.value.dataUrl = r.result }
  r.readAsDataURL(f)
}
function savePhoto() {
  if (!photoForm.value.dataUrl) return store.showToast('请选择图片')
  const r = store.addPhoto({ ...photoForm.value, category: '' })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已存入相册'); closeQuick()
}
// 装背包：主页内联添加物品
const itemForm = ref({ name: '', count: 1, description: '', cover: '', tags: '' })
function pickItemCover(f) {
  if (!f) return
  if (!f.type.startsWith('image/')) { store.showToast('封面请选择图片文件'); return }
  const r = new FileReader()
  r.onload = () => { itemForm.value.cover = r.result }
  r.readAsDataURL(f)
}
function saveItem() {
  if (!itemForm.value.name.trim()) return store.showToast('名称不能为空')
  const r = store.addItem({ ...itemForm.value })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已收入背包'); closeQuick()
}

// ---- 今日数据看板 ----
const dash = computed(() => {
  const todayDue = store.data.tasks.filter((t) => t.dueDate === today && t.status !== 'done').length
  const todayDone = store.data.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) === today).length
  let inc = 0, exp = 0
  store.data.ledger.records.forEach((r) => { if (r.date === today) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  const todayAch = (store.data.achievements || []).filter((a) => a.unlockedAt === today)
  const lastAch = todayAch.slice().sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))[0]
  return { todayDue, todayDone, balance: inc - exp, todayAch, lastAch, lastMemo }
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

// ---- 主页底部三卡（日历 / 时间轴 / 动态）：拖拽任意底边统一调整高度 ----
// 三者同处 grid 一行，align-items:stretch 保证绝对等高；拖拽任一卡片底边即改整行高度
const lowerH = ref(Number(localStorage.getItem('eo-lower-h')) || 440)
let lowerDrag = false, lowerStartY = 0, lowerStartH = 0
function onLowerDown(e) {
  lowerDrag = true
  lowerStartY = e.clientY
  lowerStartH = lowerH.value
  window.addEventListener('pointermove', onLowerMove)
  window.addEventListener('pointerup', onLowerUp)
  e.preventDefault(); e.stopPropagation()
}
function onLowerMove(e) {
  if (!lowerDrag) return
  lowerH.value = Math.max(300, Math.min(760, lowerStartH + (e.clientY - lowerStartY)))
}
function onLowerUp() {
  lowerDrag = false
  window.removeEventListener('pointermove', onLowerMove)
  window.removeEventListener('pointerup', onLowerUp)
  try { localStorage.setItem('eo-lower-h', String(Math.round(lowerH.value))) } catch { /* 隐私模式忽略 */ }
}

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
function achTitle(key) { return (achievementMeta(key) || {}).title || key }

// ---- 核心数据卡片堆叠：纯主展示（只看不操作）+ 真 3D 层叠（当前居中、后方露边、景深阴影） ----
const stack = computed(() => {
  const cards = []
  if (store.data.birthDate) {
    cards.push({
      icon: stage.value.icon, tint: 'primary', title: '人生进度',
      bar: life.value.progress, big: Math.round(life.value.progress * 100) + '%', unit: stage.value.label,
      sub: '已活 ' + life.value.daysLived + ' 天 · ' + store.xp + ' XP'
    })
  } else {
    cards.push({ icon: 'egg', tint: 'primary', title: '人生进度', big: '—', unit: '未开启', sub: '在「设置」中填写生日后开启' })
  }
  const todayDueList = (dueMap.value[todayKey] || []).filter((t) => t.status !== 'done')
  cards.push({
    icon: 'tasks', tint: 'bad', title: '今日任务',
    big: String(todayDueList.length), unit: '项待完成',
    sub: todayDueList.length ? todayDueList.slice(0, 3).map((t) => t.title).join('、') : '今天没有截止任务'
  })
  const mk = todayKey.slice(0, 7)
  let exp = 0, inc = 0
  store.data.ledger.records.forEach((r) => { if (r.date.startsWith(mk)) { if (r.type === 'income') inc += r.amount; else exp += r.amount } })
  cards.push({
    icon: 'wallet', tint: 'good', title: '本月收支',
    big: (inc - exp).toFixed(0), unit: '元结余',
    sub: '收入 ' + inc.toFixed(0) + ' · 支出 ' + exp.toFixed(0)
  })
  const lastMemo = (store.data.memos || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  cards.push({
    icon: 'note', tint: 'accent', title: '笔记',
    big: String(store.data.memos.length), unit: '篇',
    sub: lastMemo ? (lastMemo.title || '无标题') : '还没有笔记'
  })
  const lastPhoto = (store.data.photos || []).slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0]
  cards.push({
    icon: 'album', tint: 'primary', title: '相册',
    big: String(store.data.photos.length), unit: '张回忆',
    sub: lastPhoto ? '最近一张：' + (lastPhoto.name || '') : '还没有照片'
  })
  const lastLoc = (store.data.locations || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  cards.push({
    icon: 'map-pin', tint: 'good', title: '足迹',
    big: String(store.data.locations.length), unit: '个地点',
    sub: lastLoc ? lastLoc.name + ' · ' + lastLoc.date : '还没有足迹'
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
// 卡片完全透明时，景深后层的文字会透上来互相重叠 → 后层透明度随玻璃质感一起收敛
const stackSheen = computed(() => {
  const raw = Number(store.data.cardAlpha)
  const a = isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5
  return Math.min(1, a * 2)
})
function cardStyle(i) {
  const k = relPos(i)
  if (k > 2) return 'display:none'
  // 真 3D 层叠：当前卡居中，后方卡片向下微移+缩小+退到 z 轴后方，露出上缘形成景深
  const t = {
    0: 'translate3d(0,0,0) scale(1)',
    1: 'translate3d(0,16px,-46px) scale(.94)',
    2: 'translate3d(0,30px,-92px) scale(.88)'
  }[k]
  const opacity = { 0: 1, 1: .82, 2: .55 }[k] * (k === 0 ? 1 : stackSheen.value)
  const shadow = {
    0: '0 24px 48px -20px rgba(154,124,88,.5)',
    1: '0 14px 30px -18px rgba(154,124,88,.3)',
    2: '0 10px 22px -16px rgba(154,124,88,.22)'
  }[k]
  let tf = t
  if (k === 0 && dragX.value) tf = 'translate3d(' + dragX.value + 'px,0,0) rotate(' + (dragX.value * 0.035) + 'deg) scale(1)'
  // 卡片近乎全透明时，景深后层的文字会与前层重叠 → 直接隐藏后层，只保留当前卡
  if (k > 0 && stackSheen.value < 0.3) return 'display:none'
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
</script>

<template>
  <div class="page wide">
    <!-- 问候 -->
    <div class="muted" style="font-size:14px;margin:0 4px 8px">{{ greeting }}{{ store.data.profile.name ? '，' + store.data.profile.name : '' }}</div>

    <!-- 核心卡片堆叠（纯展示 + 真 3D 层叠 + 拖拽/箭头切换） -->
    <div v-if="stack.length" class="stack-wrap">
      <div
        v-for="(c, i) in stack" :key="c.title" class="glass card stack-card"
        :data-idx="i" :style="cardStyle(i)"
        @pointerdown="onPointerDown">
        <div class="row between">
          <span class="row" style="gap:8px">
            <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip)" :style="'color:' + TINT[c.tint]"><Icon :name="c.icon" :size="18" /></span>
            <span style="font-weight:700;font-size:14px">{{ c.title }}</span>
          </span>
          <span class="row" style="gap:8px">
            <span class="muted" style="font-size:11px">{{ stackIdx + 1 }} / {{ stack.length }}</span>
            <Icon name="layers" :size="14" :style="'color:' + TINT[c.tint]" />
          </span>
        </div>
        <div class="row" style="gap:8px;margin-top:8px;align-items:baseline">
          <span style="font-size:30px;font-weight:800;line-height:1" :style="'color:' + TINT[c.tint]">{{ c.big }}</span>
          <span class="muted" style="font-size:12px">{{ c.unit }}</span>
        </div>
        <div v-if="c.bar != null" class="bar" style="margin:8px 0 4px"><i :style="{ width: (c.bar * 100) + '%' }"></i></div>
        <div class="muted" style="font-size:12px;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.sub }}</div>
      </div>
      <!-- 拖拽切换（已删除生硬箭头与底部圆点；滑动时页码随 stackIdx 动态更新） -->
      <div class="muted" style="text-align:center;font-size:11px;margin-top:12px;opacity:.7">左右拖拽切换卡片</div>
    </div>

    <!-- 速览 = 快捷操作区（主页内弹悬浮对话框，不跳转） -->
    <div class="section-title">速览 · 快捷操作</div>
    <div class="qa-grid">
      <button v-for="a in quickActions" :key="a.key" class="glass card qa-item" @click="openQuick(a.key)">
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
      <button class="glass card dash-tile" @click="go('/stats')">
        <div class="muted dash-cap">今日成就</div>
        <div class="dash-num" :style="'color:var(--eo-primary-deep)'">{{ dash.todayAch.length }}</div>
        <div class="muted dash-foot">{{ dash.lastAch ? achTitle(dash.lastAch.key) : '今日暂无解锁' }}</div>
      </button>
      <button class="glass card dash-tile" @click="go('/notes')">
        <div class="muted dash-cap">最新笔记</div>
        <div class="dash-note">{{ dash.lastMemo ? (dash.lastMemo.title || '无标题') : '还没有笔记' }}</div>
      </button>
    </div>

    <!-- 电脑端三卡等高：日历 · 任务 / 人生时间轴 / 最近动态（拖拽任一底边统一调高，align-items:stretch 保证三者绝对等高；内容过多卡内滚动） -->
    <div class="home-lower" :style="{ minHeight: lowerH + 'px' }">
      <!-- 日历 · 任务 -->
      <div class="home-col">
        <div class="section-title">日历 · 任务</div>
        <div class="glass card cal-card">
          <div class="row between" style="margin-bottom:8px">
            <div class="row" style="gap:6px">
              <button class="btn ghost" style="padding:6px 12px" @click="calShift(-1)"><Icon name="chevron" :size="16" style="transform:rotate(180deg)" /></button>
              <span style="font-weight:700">{{ calTitle }}</span>
              <button class="btn ghost" style="padding:6px 12px" @click="calShift(1)"><Icon name="chevron" :size="16" /></button>
            </div>
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
          <div class="cal-foot">
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
              <button class="btn ghost" style="width:100%;margin-top:8px" @click="openQuick('task')"><Icon name="plus" :size="16" /> 新建任务</button>
            </div>
            <div v-else class="muted" style="font-size:13px;padding:8px 0">该日暂无截止任务，点击日历日期查看其他天。</div>
          </div>
        </div>
        <div class="card-resizer" @pointerdown="onLowerDown" title="拖拽调节卡片高度"></div>
      </div>

      <!-- 人生时间轴 -->
      <div class="home-col">
        <div class="section-title">人生时间轴</div>
        <div class="glass card home-col-card">
          <div v-if="!timeline.length" class="empty-state" style="padding:16px 8px">
            <span class="empty-illu"><Icon name="map-pin" :size="28" /></span>
            <div class="es-title">时间轴还空着</div>
            <div class="es-sub">添加笔记或足迹，记录人生坐标</div>
          </div>
          <div v-else v-for="(t, i) in timeline" :key="i" class="row" style="padding:8px 0;border-bottom:1px solid var(--eo-glass-border)" :style="i === timeline.length - 1 ? 'border:none' : ''">
            <span class="avatar" style="width:34px;height:34px"><Icon :name="t.icon" :size="18" /></span>
            <div style="flex:1">
              <div style="font-size:14px">{{ t.text }}</div>
              <div class="muted" style="font-size:12px">{{ t.date }}</div>
            </div>
          </div>
        </div>
        <div class="card-resizer" @pointerdown="onLowerDown" title="拖拽调节卡片高度"></div>
      </div>

      <!-- 最近动态 -->
      <div class="home-col">
        <div class="section-title">最近动态</div>
        <div class="glass card home-col-card">
          <div v-if="!recent.length" class="empty-state" style="padding:16px 8px">
            <span class="empty-illu"><Icon name="sparkles" :size="28" /></span>
            <div class="es-title">还没有动态</div>
            <div class="es-sub">使用任意功能，这里会留下足迹</div>
          </div>
          <transition-group v-else name="fade">
            <div v-for="(a, i) in recent" :key="a.id" class="row" style="padding:7px 0">
              <Icon :name="a.icon" :size="18" />
              <span style="font-size:14px;flex:1">{{ a.text }}</span>
              <span class="muted" style="font-size:12px">{{ a.time }}</span>
            </div>
          </transition-group>
        </div>
        <div class="card-resizer" @pointerdown="onLowerDown" title="拖拽调节卡片高度"></div>
      </div>
    </div>

    <!-- 速览快捷操作弹窗（主页内悬浮，不跳转） -->
    <Modal :title="qTitle" :show="qOpen" @close="closeQuick">
      <!-- 写笔记 -->
      <template v-if="qKey === 'note'">
        <div class="field"><label>标题</label><input v-model="noteForm.title" placeholder="标题" /></div>
        <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="noteForm.tags" placeholder="如：复盘 灵感" /></div>
        <div class="field"><label>内容（支持 Markdown）</label><textarea v-model="noteForm.markdown" placeholder="写点什么…" style="min-height:90px"></textarea></div>
        <button class="btn" style="width:100%" @click="saveNote"><Icon name="edit" :size="16" /> 保存笔记</button>
      </template>
      <!-- 记一笔 -->
      <template v-else-if="qKey === 'ledger'">
        <div class="capsule" style="display:inline-flex;padding:4px;gap:4px;margin-bottom:12px">
          <button class="btn ghost" :style="ledForm.type === 'expense' ? 'background:var(--eo-primary);color:#fff;padding:6px 16px' : 'padding:6px 16px'" @click="ledForm.type = 'expense'">支出</button>
          <button class="btn ghost" :style="ledForm.type === 'income' ? 'background:var(--eo-primary);color:#fff;padding:6px 16px' : 'padding:6px 16px'" @click="ledForm.type = 'income'">收入</button>
        </div>
        <div class="field"><label>金额</label><input type="number" min="0" step="0.01" v-model="ledForm.amount" placeholder="0.00" /></div>
        <div class="field"><label>分类</label><input v-model="ledForm.category" placeholder="如：餐饮" /></div>
        <div class="field"><label>日期</label><input type="date" v-model="ledForm.date" /></div>
        <div class="field"><label>备注</label><input v-model="ledForm.note" placeholder="可选" /></div>
        <button class="btn" style="width:100%" @click="saveLed"><Icon name="wallet" :size="16" /> 保存</button>
      </template>
      <!-- 新任务 -->
      <template v-else-if="qKey === 'task'">
        <div class="field"><label>标题</label><input v-model="taskForm.title" placeholder="要做点什么？" /></div>
        <div class="field"><label>类型</label>
          <select v-model="taskForm.category">
            <option value="side">日常</option>
            <option value="todo">Todo</option>
          </select>
        </div>
        <div class="field"><label>截止日期与时间</label><input type="datetime-local" v-model="taskDueLocal" /></div>
        <div class="field"><label>备注</label><textarea v-model="taskForm.note" placeholder="补充说明" style="min-height:60px"></textarea></div>
        <button class="btn" style="width:100%" @click="saveTask"><Icon name="checklist" :size="16" /> 创建</button>
      </template>
      <!-- 传照片 -->
      <template v-else-if="qKey === 'album'">
        <div class="field"><label>选择图片</label><GlassUploader @file="pickPhoto" /></div>
        <div v-if="photoForm.dataUrl" style="height:120px;border-radius:12px;background-size:cover;background-position:center;margin-bottom:10px" :style="{ backgroundImage: 'url(' + photoForm.dataUrl + ')' }"></div>
        <div class="field"><label>名称</label><input v-model="photoForm.name" /></div>
        <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="photoForm.tags" placeholder="如：旅行 美食" /></div>
        <button class="btn" style="width:100%" :disabled="!photoForm.dataUrl" @click="savePhoto"><Icon name="plus" :size="16" /> 存入</button>
      </template>
      <!-- 装背包：主页内联添加物品 -->
      <template v-else-if="qKey === 'backpack'">
        <div class="field"><label>名称</label><input v-model="itemForm.name" placeholder="物品名" /></div>
        <div class="field"><label>数量</label><input type="number" v-model.number="itemForm.count" /></div>
        <div class="field"><label>描述</label><textarea v-model="itemForm.description" placeholder="备注" style="min-height:50px"></textarea></div>
        <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="itemForm.tags" placeholder="如：纪念 礼物" /></div>
        <div class="field">
          <label>封面</label>
          <GlassUploader label="点击或拖拽设置封面（支持图片）" @file="pickItemCover" />
          <div v-if="itemForm.cover" style="margin-top:8px;height:80px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + itemForm.cover + ')' }"></div>
        </div>
        <button class="btn" style="width:100%" @click="saveItem"><Icon name="backpack" :size="16" /> 收入背包</button>
      </template>
    </Modal>
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

/* 日历卡：高度可调（桌面端撑满 min-height，右栏卡片随 grid stretch 自动对齐） */
.cal-card { display: flex; flex-direction: column; }
.cal-foot { flex: 1; min-height: 0; }
/* 主页底部三卡：每列 flex 列，卡片撑满列高；拖拽底边统一调高 */
.home-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.card-resizer {
  height: 14px; margin-top: 2px; flex: none; cursor: ns-resize; position: relative;
  border-radius: 999px; transition: background .2s ease;
}
.card-resizer::after {
  content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 40px; height: 5px; border-radius: 999px; background: var(--eo-glass-border); transition: background .2s ease, box-shadow .2s ease;
}
.card-resizer:hover::after, .card-resizer:active::after {
  background: var(--eo-primary); box-shadow: 0 0 12px rgba(212, 163, 115, 0.6);
}

/* 卡片堆叠：真 3D 景深层叠（后方卡片向下露边）+ 拖拽 */
.stack-wrap { margin: 0 0 4px; position: relative; perspective: 1100px; }
.stack-card {
  transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .35s ease, box-shadow .35s ease;
  cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none;
}
.stack-card:active { cursor: grabbing; }
.stack-arrow {
  width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
  transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s ease;
}
.stack-arrow:hover { transform: scale(1.08); background: rgba(212, 163, 115, 0.3); }

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
