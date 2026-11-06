<script setup>
// ===== 白板节点：按 entityType 渲染不同外观的便利贴（满血 Haze） =====
// 对应需求 2：全实体节点化 + 节点内的 @[Type:ID] 引用渲染 + 响应式断点自适应。
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { dragGuard } from '../lib/dragGuard.js'
import { parseEntityRefs } from '../services/CanvasNavigator.js'
import { steamGames } from '../services/steamCache.js'
import { cardMeta } from '../lib/cardMatrix.js'
import { MACARON_PALETTE as PALETTE, STICKY_COLORS, STICKY_COLORS_D } from '../lib/palette.js'
import { refreshData } from '../services/globalActions.js'
import CanvasPanelNode from './CanvasPanelNode.vue'
import CanvasCardBody from './CanvasCardBody.vue'
import Icon from './Icon.vue'

const props = defineProps({
  node: { type: Object, required: true },
  entity: { type: Object, default: null },
  // 模块二：绝对坐标（分区子节点为「分区位置 + 相对坐标」派生结果），由画布统一计算下发
  pos: { type: Object, default: null },
  // 模块四：是否被选中（选中后展示四向连线点）
  selected: { type: Boolean, default: false },
  // 模块一：是否为堆叠组中位于下层的卡片（只露出标题边，营造一叠纸的厚度）
  stackBeneath: { type: Boolean, default: false },
  // 千层饼：下层卡与组顶同宽
  stackW: { type: Number, default: 0 },
  // v2.2.4：下层卡与组顶同高（堆叠组视觉边界整齐划一）
  stackH: { type: Number, default: 0 },
  // v2.2.5：堆叠组卡片总数（顶层卡右上角数字角标）
  stackCount: { type: Number, default: 0 },
  // v2.2.5：是否为「最深可见层」——用实心错位阴影暗示纸堆厚度（超出层不再渲染）
  stackEdge: { type: Boolean, default: false },
  // v2.3.1：是否为「超出最深可见层」的卡片（翻页时仍留在 DOM，仅透明遮挡，
  // 用于让翻页动画在上下滚轮方向保持一致：离顶卡滑向背面 + 入顶卡从背面滑入）
  stackDeep: { type: Boolean, default: false },
  // v2.3.x：堆叠层级（0 = 组顶），驱动统一 transform 偏移（depth 即数据，照搬成熟卡片堆叠库）
  stackLevel: { type: Number, default: 0 }
})
const emit = defineEmits(['navigate', 'resize-start', 'menu', 'select', 'press-down', 'edit', 'connect', 'jump', 'day', 'patch', 'stack-menu', 'stack-expand'])

const store = useAppStore()
const TYPE_LABEL = {
  task: '任务', memo: '笔记', item: '物品', photo: '照片', collection: '收藏',
  location: '足迹', insight: '洞察', profile: '资料', game: '游戏',
  ledger: '记账', panel: '数据面板'
}
const PANEL_LABEL = {
  calendar: '日历聚合', todo: '待办清单', ledger: '近期记账',
  backpack: '背包统计', notes: '笔记列表', album: '相册预览',
  map: '足迹地图', steam: 'Steam 游戏库', achievements: '成就展示'
}
// ===== ArcMind 卡片系统（v2.5.0）：轻马卡龙改版 =====
// 色板唯一来源 = ../lib/palette.js（MACARON_PALETTE），右键选色板与便利贴同源消费；
// 保持暖白画布底不变，卡底换马卡龙浅色，accent 恢复彩色驱动图标芯片与卡片描边。
const WARM_WHITE = ['#FFFFFF', '#2A2A2C']      // 浅 / 深：纯白玻璃底（兜底）
// 仅这几类保留专属底（其余一律落到 PALETTE[color]，由用户选色决定）；专属底也收在中性家族内
const SPECIAL_TINT = {
  clock: ['#31302F', '#292927'],
  audio: ['#C20C0C', '#A31616'],   // 网易云风：整卡网易云红底 + 白字控件 + 旋转黑胶（accent 改为白，红底上才看得清）
  menu: ['#FBDDE9', '#3A3938']
}
// 面板 / 卡片类不再写死纯白 —— 默认回到 PALETTE[color]，让右键选色真正生效
const PANEL_TINT = {}
const CARD_TINT = {}
// 这些卡片不需要外层标题栏（内部自带标题 / 纯图形）
// 注：chart / countdown / imageStack 已于 2026-11-02 下线，不再出现在此处
const NO_HEAD_KINDS = ['menu', 'clock', 'audio']
// ===== 模块二：便利贴（Sticky Note）与数据卡片（Data Card）视觉强解耦 =====
// 便利贴：无标题栏 + 微旋转，保留「随手贴」姿态；底色与 MACARON_PALETTE 同源（lib/palette.js）。
const PANEL_ICONS = {
  calendar: 'calendar', todo: 'checklist', ledger: 'wallet', notes: 'note',
  album: 'album', backpack: 'backpack', map: 'map-pin', steam: 'game', achievements: 'trophy'
}
const isSticky = computed(() => props.node.type === 'memo' && !props.node._merged)
const isDataCard = computed(() => props.node.type === 'panel')
// 足迹地图：无边框地图卡 —— 去掉玻璃卡框与外层标题栏，瓦片地图直接铺满卡面（内部面板自带标签行）
const isBorderlessMap = computed(() => props.node.type === 'panel' && props.node.panelKind === 'map')
// v2.5.3：照片也走无边框 —— 图片铺满整卡（去玻璃框/描边/内边距），仅保留悬停反馈
const isBorderlessPhoto = computed(() => props.node.type === 'photo')
const isBorderless = computed(() => isBorderlessMap.value || isBorderlessPhoto.value)
// 无外层标题栏的卡片（内部自带标题 / 纯图形）
const noHead = computed(() => isBorderless.value || (props.node.type === 'card' && NO_HEAD_KINDS.includes(props.node.cardKind)))
// v2.2.0 卡片矩阵：节点头部标签（卡片用 cardKind 名称）
const headLabel = computed(() => {
  if (props.node._merged) {
    const map = { memo: '笔记', task: '待办', item: '物品', photo: '照片', collection: '收藏', location: '足迹', ledger: '记账', insight: '洞察', game: '游戏' }
    const name = map[props.node.mergedType] || '聚合'
    return name + ' · ' + (props.node.mergedIds ? props.node.mergedIds.length : 0)
  }
  if (props.node.type === 'card') {
    const cd = props.node.cardData || {}
    if (cd.headLabel) return cd.headLabel
    const m = cardMeta(props.node.cardKind)
    return m ? m.label : '卡片'
  }
  if (props.node.type === 'panel') return PANEL_LABEL[props.node.panelKind] || '数据面板'
  return TYPE_LABEL[props.node.type] || props.node.type
})
// 模块二：头部线性图标（ArcMind 风格 —— 统一图标 + 标题）
const headIcon = computed(() => {
  if (props.node.type === 'panel') return PANEL_ICONS[props.node.panelKind] || 'layout'
  if (props.node._merged) return 'stack'
  if (props.node.type === 'card') { const m = cardMeta(props.node.cardKind); return (m && m.icon) || 'grid' }
  const m = { task: 'check', memo: 'note', item: 'box', photo: 'album', collection: 'star', location: 'map-pin', ledger: 'wallet', insight: 'chart', game: 'game', profile: 'user' }
  return m[props.node.type] || 'dot'
})
// 模块一：堆叠组下层卡片 —— 只露一条标签边，边内显示它自己的图标与标题
const beneathIcon = computed(() => {
  if (props.node.type === 'panel') return PANEL_ICONS[props.node.panelKind] || 'layout'
  const m = { task: 'check', memo: 'note', item: 'box', collection: 'star', location: 'map-pin', photo: 'album', ledger: 'wallet', insight: 'chart', game: 'game', profile: 'user' }
  return m[props.node.type] || 'dot'
})
const beneathTitle = computed(() => {
  if (props.node.type === 'panel') return PANEL_LABEL[props.node.panelKind] || '数据面板'
  if (props.node.type === 'card') {
    const cd = props.node.cardData || {}
    const m = cardMeta(props.node.cardKind)
    return cd.headLabel || (m && m.label) || '卡片'
  }
  const e = props.entity
  if (e) return e.title || e.name || TYPE_LABEL[props.node.type] || props.node.type
  const first = String(props.node.text || '').split('\n')[0].trim()
  return (first || TYPE_LABEL[props.node.type] || props.node.type).slice(0, 24)
})
// 由节点 id 稳定派生的微小旋转角：刷新不变，保留「随手贴」的自然感
const stickyHash = computed(() => {
  const id = String(props.node.id || '')
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973
  return h
})
const stickyTilt = computed(() => {
  const h = stickyHash.value
  // 约三分之一的便利贴走「随手贴」加强版：更大倾角（-4° ~ +4°），像随手拍在画布上
  if (h % 3 === 0) return ((h % 80) / 10 - 4).toFixed(2)
  return ((h % 37) / 10 - 1.8).toFixed(2)
})
// 随手贴加强版：顶部胶带条 + 更大倾角（仅部分便利贴，避免满屏歪斜）
const casualSticky = computed(() => isSticky.value && stickyHash.value % 3 === 0)
const stickyText = computed(() => {
  const t = props.entity ? (props.entity.markdown || props.entity.content || '') : (props.node.text || '')
  return String(t).slice(0, 400) || '写点什么…'
})
const nodeStyle = computed(() => {
  const p = props.pos || { x: props.node.x, y: props.node.y }
  const w = (props.stackBeneath && props.stackW) ? props.stackW : props.node.w
  // v2.2.4：堆叠组统一以组顶卡尺寸为准，下层卡同宽同高（超出裁切，不撑破组边界）
  const h = (props.stackBeneath && props.stackH) ? props.stackH : props.node.h
  const box = {
    left: p.x + 'px',
    top: p.y + 'px',
    width: w + 'px',
    height: h + 'px',
    // depth 即数据：层级由父组件按「环序」下发，偏移完全由此派生（与翻页方向无关）
    '--stack-k': props.stackLevel || 0,
    // 显式层级 z-index：组顶最高、越深越低，脱离 DOM 顺序依赖，确保纸堆层叠稳定
    zIndex: props.stackBeneath ? Math.max(1, 4 - (props.stackLevel || 0)) : undefined
  }
  if (isSticky.value) {
    return Object.assign(box, {
      '--eo-paper': STICKY_COLORS[props.node.color] || STICKY_COLORS.amber,
      '--eo-paper-d': STICKY_COLORS_D[props.node.color] || STICKY_COLORS_D.amber,
      '--eo-tilt': stickyTilt.value + 'deg'
    })
  }
  const pal = PALETTE[props.node.color] || PALETTE.amber
  // 音频卡（黑胶 / 网易云）：整卡红底 → accent 改为白，保证进度条 / 播放键在红底上清晰可见
  const isAudio = props.node.type === 'card' && props.node.cardKind === 'audio'
  const accent = isAudio ? '#FFFFFF' : pal.accent
  const deep = isAudio ? 'rgba(255,255,255,.92)' : pal.deep
  // 轻马卡龙：描边由 accent 派生（38% 透明），深色模式由 CSS 端降到 26%
  const cardBorder = 'color-mix(in srgb, ' + accent + ' 38%, transparent)'
  // 合并总览卡：本体即选色玻璃，强调色取首张卡的分类色
  if (props.node._merged) {
    return Object.assign(box, { '--eo-card': pal.card, '--eo-card-d': pal.cardD, '--eo-accent': accent, '--eo-accent-deep': deep, '--eo-card-border': cardBorder })
  }
  const kindTint = props.node.type === 'card' ? (SPECIAL_TINT[props.node.cardKind] || null) : null
  const panelTint = props.node.type === 'panel' ? (PANEL_TINT[props.node.panelKind] || null) : null
  const pair = kindTint || panelTint || [pal.card, pal.cardD]
  // 音频卡：网易云黑胶风，需要近黑实底（关掉玻璃透明度，否则白底透出变灰白、白字又看不见）
  if (isAudio) return Object.assign(box, { '--eo-card': pair[0], '--eo-card-d': pair[1], '--eo-accent': accent, '--eo-accent-deep': deep, '--eo-card-border': cardBorder, '--eo-card-a': '1' })
  return Object.assign(box, { '--eo-card': pair[0], '--eo-card-d': pair[1], '--eo-accent': accent, '--eo-accent-deep': deep, '--eo-card-border': cardBorder })
})

const refs = computed(() => parseEntityRefs(props.node.text || (props.entity && (props.entity.markdown || props.entity.content)) || ''))

function onNavigate(r) { emit('navigate', r) }
function resizeDown(e) { emit('resize-start', e) }
function onMenu(e) { emit('menu', e) }
// v2.2.5：堆叠组角标 —— 数量下拉（展开 / 全部平铺 / 移出顶层）+ 悬停/点击展开预览
function onStackMenu(e) { emit('stack-menu', e) }
function onStackExpand() { emit('stack-expand') }
let expandTimer = null
function onExpandEnter() {
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = setTimeout(() => { expandTimer = null; emit('stack-expand') }, 280)
}
function onExpandLeave() { if (expandTimer) { clearTimeout(expandTimer); expandTimer = null } }
// 数据面板：头部一键刷新（替代面板内部重复的刷新按钮，保持单头部）
function onRefresh() { refreshData(store) }
// 手势层：整块区域可拖（阈值由画布侧判定）· 单击选中 · 双击编辑
// 模块一：数据卡片（面板）单击 → 跳转对应功能全屏页（与边缘连线点解耦）
const PANEL_ROUTE = {
  calendar: 'tasks', todo: 'tasks', ledger: 'ledger', notes: 'notes',
  album: 'album', map: 'map', backpack: 'backpack', steam: 'steam', achievements: 'achievements'
}
function onSelect(e) {
  // 拖拽刚结束的补发 click 不触发跳转（与画布卡片点击解耦）
  if (Date.now() < dragGuard.suppressJumpUntil) { if (e && e.stopPropagation) e.stopPropagation(); return }
  // 模块二：所有卡片一律不跳全屏页 —— 卡片本身就是可交互小组件，交互全部内联完成
  emit('select', e)
}
// 模块一：日历日期格 → 当天详情（逐层回传给画布，就地弹层）
function onDay(key) { if (key) emit('day', key) }
function onPressDown(e) { emit('press-down', e) }
function onEdit() { emit('edit') }
// 模块四：选中后点击连线点 → 从此节点发起连线（不再强制单击进入连线）
function onConnect(e) { if (e) { e.stopPropagation && e.stopPropagation(); e.preventDefault && e.preventDefault() } emit('connect') }
// 模块一：画布数据卡片（面板）点击主体 → 跳转对应功能全屏页（与边缘连线点解耦）
function onJump(route) { emit('jump', route) }

// 模块二：鼠标悬停态 —— 配合 wheel 事件精确判断「指针是否在卡片 / 便利贴内部」
// 红线：触控板双指捏合（ctrl+wheel）始终交给画布缩放，穿透卡片；
// 触控板两指上下滑动（常规 wheel）在卡片内只滚动内部内容，绝不触发画布缩放。
const hovering = ref(false)
function onEnter() { hovering.value = true }
function onLeave() { hovering.value = false }
// 模块二：独立滚动区 —— 数据卡片（面板）与长文本便利贴可内部翻页
const scrollable = computed(() => {
  if (props.node._merged) return true
  if (props.node.type === 'panel') return true
  if (props.node.type === 'memo') {
    const t = props.entity ? (props.entity.markdown || props.entity.content || '') : (props.node.text || '')
    return String(t).length > 120
  }
  return false
})
function onWheel(e) {
  // 触控板双指捏合（ctrl+wheel）→ 交给画布缩放，卡片内部不拦截
  if (e.ctrlKey) return
  // 堆叠组成员（顶层或可见下层）：滚轮一律交给画布翻页，绝不吞事件
  if (props.stackBeneath || props.stackCount > 1) return
  // 堆叠组顶卡：滚轮必须冒泡给画布 → 触发整组翻页（红线：事件不可被卡片吞掉）
  if (rootEl.value && rootEl.value.getAttribute('data-stack-top') === '1') return
  // 指针不在卡片 / 便利贴内部 → 放行给画布（缩放）
  if (!hovering.value) return
  const t = e.target
  const box = t && t.closest ? t.closest('[data-scroll]') : null
  if (!box) return
  const max = box.scrollHeight - box.clientHeight
  if (max <= 0) return
  // 严格拦截：一旦在卡片内滚动，preventDefault + stopPropagation，
  // 即便已滚到顶/底也绝不冒泡到画布去缩放
  e.preventDefault()
  e.stopPropagation()
  box.scrollTop = Math.max(0, Math.min(max, box.scrollTop + e.deltaY))
}

// 任务内联勾选
function toggleTask() {
  if (props.node.type === 'task' && props.entity) store.toggleTaskDone(props.entity.id)
}
// 同类合并总览卡：把散落同类型节点聚合成一张可滚动卡片
const mergedList = computed(() => {
  if (!props.node._merged) return []
  const ids = props.node.mergedIds || []
  const all = store.live || {}
  const pick = (arr) => (arr || []).filter((e) => ids.includes(e.id) && !e.deletedAt)
  switch (props.node.mergedType) {
    case 'task': return pick(all.tasks).map((t) => ({ id: t.id, title: t.title, done: t.status === 'done', sub: t.dueDate || '' }))
    case 'memo': return pick(all.memos).map((t) => ({ id: t.id, title: t.title, sub: '' }))
    case 'item': return pick(all.items).map((t) => ({ id: t.id, title: t.name, sub: (t.category || '未分类') + ' ×' + (t.count || 1) }))
    case 'photo': return pick(all.photos).map((t) => ({ id: t.id, title: '照片', sub: '' }))
    case 'collection': return pick(all.collections).map((t) => ({ id: t.id, title: t.title, sub: '' }))
    case 'location': return pick(all.locations).map((t) => ({ id: t.id, title: t.name, sub: (t.lat != null ? t.lat.toFixed(2) : '') + ',' + (t.lng != null ? t.lng.toFixed(2) : '') }))
    case 'ledger': return ((store.data.ledger && store.data.ledger.records) || []).filter((t) => !t.deletedAt && ids.includes(t.id)).map((t) => ({ id: t.id, title: t.category || '记账', sub: t.date, amount: (t.type === 'income' ? '+' : '-') + t.amount }))
    case 'game': return (steamGames.value || []).filter((g) => ids.includes(String(g.appid))).map((g) => ({ id: String(g.appid), title: g.name, sub: Math.round(g.playtimeHours || 0) + 'h' }))
    default: return []
  }
})
function toggleMerged(m) {
  if (props.node.mergedType === 'task') store.toggleTaskDone(m.id)
}
// 迷你图表（洞察节点）：近 6 个月收支（内联 SVG，零额外依赖，避免破坏构建红线）
const chart = computed(() => {
  if (props.node.type !== 'insight') return null
  const recs = store.data.ledger.records || []
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const inc = months.map((mk) => recs.filter((r) => r.type === 'income' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const exp = months.map((mk) => recs.filter((r) => r.type === 'expense' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const max = Math.max(1, ...inc, ...exp)
  return { months, inc, exp, max }
})

// 模块二：响应式断点 —— 监听节点真实渲染尺寸（ResizeObserver），落为 sz-xs/sm/md/lg/xl，
// 卡片内容随尺寸伸缩（极小尺寸隐藏次要信息，绝不遮挡 / 错位）。
const rootEl = ref(null)
const sizeClass = ref('sz-md')
let ro = null
function applySize() {
  const el = rootEl.value
  if (!el) return
  const w = el.offsetWidth || props.node.w || 240
  const h = el.offsetHeight || props.node.h || 160
  let c = 'sz-md'
  if (w <= 160 || (w <= 200 && h <= 120)) c = 'sz-xs'
  else if (w < 260) c = 'sz-sm'
  else if (w >= 360 || h >= 260) c = 'sz-lg'
  if (c === 'sz-md' && w >= 300) c = 'sz-xl'
  sizeClass.value = c
}
onMounted(() => { applySize(); ro = new ResizeObserver(applySize); if (rootEl.value) ro.observe(rootEl.value) })
onUnmounted(() => { if (ro) ro.disconnect(); if (expandTimer) { clearTimeout(expandTimer); expandTimer = null } })

// 模块二：Steam 游戏节点 —— 优先取画布节点自带 game 数据，否则从 Steam 缓存按 appid 匹配
const gameData = computed(() => {
  if (props.node.type !== 'game') return null
  if (props.node.game) return props.node.game
  if (props.node.refId) {
    const g = (steamGames.value || []).find((x) => String(x.appid) === String(props.node.refId))
    if (g) return g
  }
  return props.entity || null
})
</script>

<template>
  <div
    ref="rootEl"
    class="eo-node glass"
    :class="[sizeClass, 'kind-' + (node.cardKind || node.panelKind || node.type), { 'eo-sticky': isSticky, 'eo-datacard': isDataCard, 'eo-borderless': isBorderless, 'eo-taped': casualSticky, 'eo-bump': node._bump, 'eo-beneath': stackBeneath, 'eo-stack-edge': stackEdge, 'eo-stack-deep': stackDeep, 'eo-no-head': noHead }]"
    :data-node-id="node.id"
    :data-stack-id="node.stackId || null"
    :style="nodeStyle"
    @pointerdown.stop="onPressDown"
    @click.stop="onSelect"
    @dblclick.stop.prevent="onEdit"
    @wheel="onWheel"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @contextmenu.prevent.stop="onMenu">
    <!-- 模块四：四向连线点（点击即从此节点发起连线）；数据卡片（面板）始终在悬停时可见，与「点击主体跳转」解耦 -->
    <template v-if="selected || node.type === 'panel'">
      <span class="eo-handle eo-handle--t" @pointerdown.stop @click.stop="onConnect"></span>
      <span class="eo-handle eo-handle--r" @pointerdown.stop @click.stop="onConnect"></span>
      <span class="eo-handle eo-handle--b" @pointerdown.stop @click.stop="onConnect"></span>
      <span class="eo-handle eo-handle--l" @pointerdown.stop @click.stop="onConnect"></span>
    </template>
    <!-- 模块四：右上「...」更多操作（悬停浮现，与连线点解耦） -->
    <button class="eo-node-more" @pointerdown.stop @click.stop="onMenu" title="更多">
      <Icon name="more" :size="14" />
    </button>
    <!-- v2.2.5：堆叠组角标（右上角）—— 总张数 + 下拉操作 + 展开预览 -->
    <div v-if="!stackBeneath && stackCount > 1" class="eo-stack-badge" @pointerdown.stop @click.stop>
      <button class="eo-stack-badge__count" title="堆叠组操作：展开 / 全部平铺 / 移出顶层" @click.stop="onStackMenu">
        <Icon name="layers" :size="10" />
        <b>{{ stackCount > 99 ? '99+' : stackCount }}</b>
        <Icon name="chevdown" :size="8" />
      </button>
      <button v-if="stackCount > 5" class="eo-stack-badge__expand" title="展开预览全部卡片"
        @click.stop="onStackExpand" @mouseenter="onExpandEnter" @mouseleave="onExpandLeave">
        <Icon name="grid" :size="10" />
      </button>
    </div>
    <!-- 头部（模块三：不再单独承担拖拽，整块容器均可拖） -->
    <div class="eo-node-head">
      <!-- 堆叠组下层卡片：整卡渲染，仅被组顶卡压住一部分（错位重叠，不折叠内容） -->
      <span class="eo-node-ico"><Icon :name="headIcon" :size="13" /></span>
      <span class="eo-node-type">{{ headLabel }}</span>
      <span class="eo-node-id">{{ node.id.slice(0, 6) }}</span>
      <button v-if="isDataCard" class="eo-node-refresh" title="刷新数据" @pointerdown.stop @click.stop="onRefresh">
        <Icon name="reset" :size="12" />
      </button>
    </div>

    <!-- 内容区（按类型渲染） -->
    <div class="eo-node-body" :class="{ scrollable: scrollable }" :data-scroll="scrollable ? '' : undefined">
      <!-- 同类合并总览卡（home 空间自动去重，优先于类型分支） -->
      <div v-if="node._merged" class="nb-merge">
        <div v-if="!mergedList.length" class="nb-text">（暂无内容）</div>
        <div v-for="m in mergedList" :key="m.id" class="nb-merge__row" :class="{ done: m.done }">
          <button v-if="node.mergedType === 'task'" class="nb-check" :class="{ done: m.done }" @pointerdown.stop @click.stop="toggleMerged(m)">
            <Icon v-if="m.done" name="check" :size="13" />
          </button>
          <span class="nb-merge__title">{{ m.title }}</span>
          <span v-if="m.sub" class="nb-merge__sub">{{ m.sub }}</span>
          <span v-if="m.amount != null" class="nb-merge__amt" :class="m.amount[0] === '+' ? 'inc' : 'exp'">{{ m.amount }}</span>
        </div>
      </div>

      <!-- 任务 -->
      <div v-else-if="node.type === 'task'" class="nb-task">
        <button class="nb-check" :class="{ done: entity && entity.status === 'done' }" @pointerdown.stop @click.stop="toggleTask">
          <Icon v-if="entity && entity.status === 'done'" name="check" :size="14" />
        </button>
        <div class="nb-task-main">
          <div class="nb-title" :class="{ strike: entity && entity.status === 'done' }">{{ entity ? entity.title : '（任务已删除）' }}</div>
          <div v-if="entity && entity.dueDate" class="nb-sub">截止 {{ entity.dueDate }}{{ entity.dueTime ? ' ' + entity.dueTime : '' }}</div>
        </div>
      </div>

      <!-- 笔记 / 便利贴（支持纯文本节点：无关联实体时直接展示 node.text） -->
      <div v-else-if="node.type === 'memo'">
        <div v-if="entity" class="nb-title">{{ entity.title }}</div>
        <div class="nb-text">{{ entity ? (entity.markdown || '').slice(0, 400) : (node.text || '写点什么…') }}</div>
      </div>

      <!-- 物品 -->
      <div v-else-if="node.type === 'item'">
        <div class="nb-title">{{ entity ? entity.name : '（物品已删除）' }}</div>
        <div class="nb-sub">×{{ entity ? entity.count : 1 }} · {{ entity && entity.category ? entity.category : '未分类' }}</div>
        <div v-if="entity && entity.cover" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.cover + ')' }"></div>
      </div>

      <!-- 照片 -->
      <div v-else-if="node.type === 'photo'" class="nb-photo">
        <img v-if="entity" :src="entity.dataUrl" alt="" />
        <div v-else class="nb-text">（照片已删除）</div>
      </div>

      <!-- 收藏 / 媒体（音频带播放控件） -->
      <div v-else-if="node.type === 'collection'">
        <div class="nb-title">{{ entity ? entity.title : '（收藏已删除）' }}</div>
        <div v-if="entity && entity.url" class="nb-link">{{ entity.url }}</div>
        <div v-if="entity && entity.fileMeta && entity.fileMeta.mime && entity.fileMeta.mime.startsWith('audio/')" class="nb-audio">
          <audio :src="entity.fileMeta.dataUrl" controls preload="none"></audio>
        </div>
        <div v-else-if="entity && entity.fileMeta && entity.fileMeta.mime && entity.fileMeta.mime.startsWith('image/')" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.fileMeta.dataUrl + ')' }"></div>
        <div v-else-if="entity && entity.cover" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.cover + ')' }"></div>
      </div>

      <!-- 足迹 -->
      <div v-else-if="node.type === 'location'">
        <div class="nb-title">{{ entity ? entity.name : '（足迹已删除）' }}</div>
        <div class="nb-sub" v-if="entity">{{ entity.lat.toFixed(3) }}, {{ entity.lng.toFixed(3) }}</div>
      </div>

      <!-- 洞察（迷你 SVG 图表） -->
      <div v-else-if="node.type === 'insight'" class="nb-insight">
        <div v-if="chart" class="nb-chart">
          <svg viewBox="0 0 200 80" preserveAspectRatio="none" width="100%" height="100%">
            <g v-for="(m, i) in chart.months" :key="m">
              <rect :x="8 + i * 32" y="70 - (chart.exp[i] / chart.max) * 60" width="10" height="(chart.exp[i] / chart.max) * 60" fill="rgba(169, 124, 114, .8)" />
              <rect :x="20 + i * 32" y="70 - (chart.inc[i] / chart.max) * 60" width="10" height="(chart.inc[i] / chart.max) * 60" fill="rgba(126, 154, 126, .8)" />
            </g>
          </svg>
          <div class="nb-chart-cap">近 6 月收支（红支 / 绿收）</div>
        </div>
        <div v-else class="nb-text">暂无数据</div>
      </div>

      <!-- 资料 -->
      <div v-else-if="node.type === 'profile'">
        <div class="nb-title">{{ store.data.profile.name || '未命名旅人' }}</div>
        <div class="nb-text">{{ store.data.profile.signature || '这个人很神秘' }}</div>
      </div>

      <!-- 记账（画布 ↔ 记账页双向生成） -->
      <div v-else-if="node.type === 'ledger'">
        <div class="nb-ledger" :class="entity && entity.type === 'income' ? 'inc' : 'exp'">
          <span class="nb-ledger-amt">{{ entity && entity.type === 'income' ? '+' : '-' }}{{ entity ? entity.amount : 0 }}</span>
          <span class="nb-ledger-unit">元</span>
        </div>
        <div class="nb-title">{{ entity ? (entity.category || '未分类') : '（账目已删除）' }}</div>
        <div class="nb-sub">{{ entity ? entity.date : '' }}{{ entity && entity.note ? ' · ' + entity.note : '' }}</div>
      </div>

      <!-- 数据面板（模块二：原数据中心看板搬到画布）；地图卡默认整卡拖动，由卡内锁按钮切换地图交互 -->
      <div v-else-if="node.type === 'panel'" class="nb-panel">
        <CanvasPanelNode :kind="node.panelKind" />
      </div>

      <!-- 卡片矩阵（17 种画布原生卡片） -->
      <div v-else-if="node.type === 'card'" class="nb-card">
        <CanvasCardBody :node="node" @patch="(p) => emit('patch', p)" @navigate="(r) => emit('navigate', r)" />
      </div>

      <!-- 游戏（Steam 游戏库节点）：小尺寸仅名称 + 总时长；大尺寸展示封面 / 近期时长 -->
      <div v-else-if="node.type === 'game'" class="nb-game">
        <div v-if="gameData && gameData.coverUrl && sizeClass !== 'sz-xs' && sizeClass !== 'sz-sm'" class="nb-game__cover" :style="{ backgroundImage: 'url(' + gameData.coverUrl + ')' }"></div>
        <div class="nb-game__main">
          <div class="nb-title">{{ gameData ? (gameData.name || '游戏数据') : '游戏数据' }}</div>
          <div v-if="gameData" class="nb-sub">总 {{ Math.round(gameData.playtimeHours || 0) }}h<span v-if="gameData.recentHours"> · 近 {{ Math.round(gameData.recentHours || 0) }}h</span></div>
          <div v-else class="nb-text">Steam 游戏库节点</div>
        </div>
      </div>

      <!-- 其他 -->
      <div v-else>
        <div class="nb-title">{{ entity ? (entity.name || '游戏数据') : '游戏数据' }}</div>
        <div class="nb-text">Steam 游戏库节点</div>
      </div>

      <!-- 双向链接引用标签 -->
      <div v-if="refs.length" class="nb-refs">
        <button v-for="(r, i) in refs" :key="i" class="nb-ref" @pointerdown.stop @click.stop="onNavigate(r)">@[{{ r.type }}]</button>
      </div>
    </div>

    <!-- 缩放手柄（模块三：抬到最上层 + 加大命中区域，避免被内容遮住抓不住） -->
    <div class="eo-node-resize" @pointerdown.stop="resizeDown" @click.stop title="拖拽调整大小"></div>
  </div>
</template>

<style scoped>
/* ============================================================
   ArcMind 卡片系统（v2.3.0 全量重写）
   · 无边框卡片 + 柔和投影 + 粉彩色块（对标 ArcMind 卡片语言）
   · 顶部一行「图标 + 标签」紧凑头部，右上角悬浮更多按钮
   · 便利贴回归纸片：实色纸 + 微旋转 + 纸片投影
   ============================================================ */
.eo-node {
  --ink: #1F1F1F;
  --ink-2: #626266;
  --line: rgba(44, 44, 44, 0.06);
  --eo-card-a: .82;
  position: absolute; box-sizing: border-box;
  display: flex; flex-direction: column; overflow: visible;
  border-radius: var(--eo-card-radius, 18px);
  background: color-mix(in srgb, var(--eo-card, #FFFFFF) calc(var(--eo-card-a) * 100%), transparent);
  border: 1px solid var(--eo-card-border, var(--eo-glass-border, rgba(44, 44, 44, 0.05)));
  box-shadow: var(--eo-shadow, 0 14px 30px -16px rgba(44, 44, 44, 0.24)), inset 0 1px 0 var(--eo-glass-hi, rgba(255,255,255,.55));
  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  transition: box-shadow .2s cubic-bezier(.22, 1, .36, 1), border-color .2s ease, transform .2s cubic-bezier(.22, 1, .36, 1);
}
/* 卡片静置阴影（仿参考稿）：比全局 --eo-shadow 更明确的一档 —— 卡片是「浮」在画布上的纸片 */
.eo-node { --eo-node-shadow: 0 18px 40px -14px rgba(44, 44, 44, 0.30); box-shadow: var(--eo-node-shadow), inset 0 1px 0 var(--eo-glass-hi, rgba(255,255,255,.55)); }
[data-theme='dark'] .eo-node { --eo-node-shadow: 0 18px 40px -14px rgba(0, 0, 0, 0.72); }
.eo-node:active { cursor: grabbing; }
/* v2.5.x：悬浮「确定感」—— 明确上浮 + 阴影 + 同色系 accent 描边环，给出「可交互 / 可抓取」反馈 */
.eo-node:hover:not(.wb-dragging):not(.eo-beneath):not([data-stack-id]) {
  transform: translateY(-6px) scale(1.03);
  cursor: grab !important;
  border-color: var(--eo-accent, rgba(44, 44, 44, 0.55));
  box-shadow:
    0 42px 72px -18px rgba(44, 44, 44, 0.38),
    0 0 0 2px var(--eo-accent, rgba(44, 44, 44, 0.4)),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
/* 便利贴保留自身倾角，上浮时叠加位移与微放大而不丢失旋转 */
.eo-sticky:hover:not(.wb-dragging):not(.eo-beneath) {
  transform: rotate(var(--eo-tilt, 0deg)) translateY(-6px) scale(1.03);
}
[data-theme='dark'] .eo-node:hover:not(.wb-dragging):not(.eo-beneath):not([data-stack-id]) {
  border-color: var(--eo-accent, rgba(255, 255, 255, 0.4));
  box-shadow: 0 42px 72px -18px rgba(0, 0, 0, 0.85), 0 0 0 2px var(--eo-accent, rgba(255, 255, 255, 0.28));
}

/* 覆盖全局 .glass：ArcMind 卡片 = 统一 Haze 暖白玻璃（与侧栏 / 工具栏同语言） */
.eo-node.glass {
  background: color-mix(in srgb, var(--eo-card, #FFFFFF) calc(var(--eo-card-a, .82) * 100%), transparent);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border: 1px solid var(--eo-card-border, var(--eo-glass-border));
  box-shadow: var(--eo-node-shadow, var(--eo-shadow)), inset 0 1px 0 var(--eo-glass-hi);
}
.eo-node.glass::before { content: none !important; }
.eo-node.glass::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  opacity: 1;
}
[data-theme='dark'] .eo-node,
[data-theme='dark'] .eo-node.glass {
  --ink: #F2F1ED;
  --ink-2: #8C8C8C;
  --line: rgba(255, 255, 255, 0.10);
  background: color-mix(in srgb, var(--eo-card-d, #262624) calc(var(--eo-card-a, .82) * 100%), transparent);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  /* 轻马卡龙深色：描边随 accent 降到 26%，避免暗底上彩色描边过亮产生光晕 */
  border-color: color-mix(in srgb, var(--eo-accent, #98989C) 26%, transparent);
  box-shadow:
    0 1px 1px rgba(44, 44, 44, 0.28),
    0 2px 6px rgba(44, 44, 44, 0.22),
    0 16px 32px -18px rgba(44, 44, 44, 0.7);
}
[data-theme='dark'] .eo-node.glass::after { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10); }

/* 拖拽中：只加一层轻投影，不缩放不变形（跟手第一） */
.eo-node.wb-dragging {
  box-shadow:
    0 2px 4px rgba(44, 44, 44, 0.06),
    0 22px 42px -18px rgba(44, 44, 44, 0.34);
  transition: none !important;
}
.eo-node.wb-selected { box-shadow: 0 0 0 2px var(--eo-primary), 0 14px 30px -16px rgba(44, 44, 44, 0.26); }
.eo-node.wb-settle { transition: left .16s cubic-bezier(.22, 1, .36, 1), top .16s cubic-bezier(.22, 1, .36, 1); }

/* ---- 头部：图标 + 标签（ArcMind 式紧凑一行）----
   ⚠️ 标题区必须留出上边距：设计稿要求「卡片上沿 → 标题」约 23px 的呼吸空间，
   头部图标距卡顶约 7px。若头部零上边距（紧贴卡顶）：
     · 右上角的操作图标会被卡片上沿切掉（图标只露出下半截）；
     · 内容多的面板（如成就展示）标题行会与内容区挤在一起，像「被顶上去」。
   padding-top 提供该留白（height 含 padding，box-sizing: border-box）。 */
.eo-node-head {
  display: flex; align-items: center; gap: 7px; flex: none;
  height: 42px; padding: 10px 34px 0 13px;
  font-size: 11.5px; font-weight: 650; letter-spacing: .01em;
  color: var(--ink-2);
  border-bottom: none;
  background: transparent;
  border-radius: var(--eo-card-radius, 18px) var(--eo-card-radius, 18px) 0 0;
}
.eo-node-ico {
  flex: none; width: 22px; height: 22px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  color: var(--eo-accent-deep, #2C2C2C);
  background: color-mix(in srgb, var(--eo-accent, #2C2C2C) 22%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--eo-accent, #2C2C2C) 38%, transparent);
  transition: background .2s ease, color .2s ease;
}
[data-theme='dark'] .eo-node-ico {
  color: var(--eo-accent, #2C2C2C);
  background: color-mix(in srgb, var(--eo-accent, #2C2C2C) 24%, transparent);
}
.eo-node-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eo-node-id { display: none; }
/* 头部右侧的刷新键（仅数据面板） */
.eo-node-refresh {
  margin-left: auto; width: 20px; height: 20px; border-radius: 999px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: var(--ink-2); cursor: pointer;
  opacity: .5; transition: opacity .16s ease, background .16s ease, transform .2s cubic-bezier(.22, 1, .36, 1);
}
.eo-node:hover .eo-node-refresh { opacity: .85; }
.eo-node-refresh:hover { opacity: 1; background: rgba(44, 44, 44, .08); }

/* ---- 内容区 ---- */
.eo-node-body {
  flex: 1; min-height: 0; padding: 2px 14px 14px; overflow: hidden;
  font-size: 12px; color: var(--ink); line-height: 1.5;
  border-radius: 0 0 var(--eo-card-radius, 18px) var(--eo-card-radius, 18px);
}
.eo-node-body.scrollable { overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.eo-node-body.scrollable::-webkit-scrollbar { width: 4px; }
.eo-node-body.scrollable::-webkit-scrollbar-thumb { background: rgba(44, 44, 44, .16); border-radius: 999px; }
.eo-node-body.scrollable .nb-text { display: block; -webkit-line-clamp: unset; overflow: visible; }
.eo-node-body.scrollable .nb-panel { height: auto; min-height: 100%; }

/* ---- 内容排版 ---- */
.nb-title { font-weight: 650; font-size: 13px; line-height: 1.35; color: var(--ink); letter-spacing: -.005em; }
.nb-text { margin-top: 4px; font-size: 11.5px; line-height: 1.55; color: var(--ink-2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.nb-sub { font-size: 10.5px; color: var(--ink-2); margin-top: 3px; opacity: .92; }
.nb-link { font-size: 10.5px; color: #8C8C8C; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-thumb { margin-top: 7px; height: 48px; border-radius: 10px; background-size: cover; background-position: center; background-color: rgba(44, 44, 44, .06); }
.nb-photo { height: 100%; }
.nb-photo img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
.nb-task { display: flex; gap: 9px; align-items: flex-start; }
.nb-check {
  width: 18px; height: 18px; border-radius: 6px; flex: none;
  border: 1.5px solid rgba(44, 44, 44, .22); background: rgba(255, 255, 255, .55);
  display: flex; align-items: center; justify-content: center; color: #fff;
  transition: background .15s ease, border-color .15s ease, transform .12s ease;
}
.nb-check:hover { border-color: rgba(44, 44, 44, .38); }
.nb-check:active { opacity: .6; }
.nb-check.done { background: var(--eo-primary); border-color: var(--eo-primary); }
[data-theme='dark'] .nb-check { border-color: rgba(255, 255, 255, .26); background: rgba(255, 255, 255, .08); }
.nb-task-main { flex: 1; min-width: 0; }
.nb-insight { height: 100%; }
.nb-chart { height: calc(100% - 14px); }
.nb-chart svg { display: block; }
.nb-chart-cap { font-size: 9.5px; color: var(--ink-2); text-align: center; }
.nb-audio audio { width: 100%; height: 28px; margin-top: 4px; }
.nb-refs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.nb-ref {
  font-size: 10px; padding: 2px 7px; border-radius: 999px; border: none; cursor: pointer;
  background: rgba(44, 44, 44, .07); color: var(--ink-2);
}
.nb-ref:hover { background: rgba(44, 44, 44, .12); color: var(--ink); }
[data-theme='dark'] .nb-ref { background: rgba(255, 255, 255, .10); }
.strike { text-decoration: line-through; opacity: .5; }
.nb-ledger { display: flex; align-items: baseline; gap: 4px; }
.nb-ledger-amt { font-size: 26px; font-weight: 800; line-height: 1.05; letter-spacing: -.02em; color: var(--ink); }
.nb-ledger-unit { font-size: 11px; color: var(--ink-2); }
.nb-ledger.inc .nb-ledger-amt { color: #8F8D89; }
.nb-ledger.exp .nb-ledger-amt { color: #A97C72; }
.nb-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.nb-panel > * { flex: 1 1 auto; min-height: 0; }
.nb-card { height: 100%; min-height: 0; }
/* 足迹地图卡：高度链必须确定（覆盖上面的 scrollable auto 规则），
   否则地图区永远只有 min-height，无法随卡片拖拽伸缩铺满 */
.eo-node.kind-map .nb-panel { height: 100%; }

/* ---- 同类合并总览卡 ---- */
.nb-merge { display: flex; flex-direction: column; gap: 2px; }
.nb-merge__row {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 10px;
  background: color-mix(in srgb, var(--eo-accent, #B8B5B0) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--eo-accent, #B8B5B0) 14%, transparent);
}
.nb-merge__row + .nb-merge__row { margin-top: 2px; }
.nb-merge__row.done { opacity: .5; }
.nb-merge__row.done .nb-merge__title { text-decoration: line-through; }
.nb-merge__title { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-merge__sub { flex: none; font-size: 10px; color: var(--ink-2); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-merge__amt { flex: none; font-size: 12px; font-weight: 700; }
.nb-merge__amt.inc { color: #8F8D89; }
.nb-merge__amt.exp { color: #A97C72; }
[data-theme='dark'] .nb-merge__row { background: color-mix(in srgb, var(--eo-accent, #B8B5B0) 14%, transparent); }

/* ---- 便利贴：暖白玻璃纸片（与卡片同族材质 + 微旋转 + 无头部）---- */
.eo-sticky {
  border-radius: var(--eo-card-radius, 18px);
  transform: rotate(var(--eo-tilt, 0deg));
}
/* 随手贴加强版（部分便利贴）：顶部半透明胶带 + 更纸感的投影 */
.eo-node.eo-taped.glass::before {
  content: "" !important;
  position: absolute; top: -9px; left: 50%;
  width: 68px; height: 20px;
  transform: translateX(-50%) rotate(calc(var(--eo-tilt, 0deg) * -0.6));
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.42));
  border: 1px solid rgba(44, 44, 44, 0.07);
  border-radius: 2px;
  box-shadow: 0 2px 5px rgba(44, 44, 44, 0.08);
  pointer-events: none;
  z-index: 3;
}
[data-theme='dark'] .eo-node.eo-taped.glass::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.20), rgba(255, 255, 255, 0.10));
  border-color: rgba(255, 255, 255, 0.10);
}
.eo-node.eo-taped { box-shadow: 0 14px 26px -12px rgba(44, 44, 44, 0.32), inset 0 1px 0 var(--eo-glass-hi, rgba(255,255,255,.55)); }
.eo-sticky.glass {
  background: color-mix(in srgb, var(--eo-paper, #F4F3EF) calc(var(--eo-card-a, .82) * 100%), transparent);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
}
.eo-sticky.glass::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 1px 0 var(--eo-glass-hi, rgba(255, 255, 255, 0.55));
}
/* 深色模式：同一材质体系换深色底，字色随主题走 */
[data-theme='dark'] .eo-sticky.glass {
  background: color-mix(in srgb, var(--eo-paper-d, #262624) calc(var(--eo-card-a, .82) * 100%), transparent);
}
[data-theme='dark'] .eo-sticky.glass::after { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10); }
.eo-sticky.wb-dragging { transform: rotate(0deg); }
.eo-sticky .eo-node-head { display: none; }
.eo-sticky .eo-node-body {
  padding: 15px 14px 13px; font-size: 12.5px; line-height: 1.55; font-weight: 500;
  color: var(--ink, #2C2C2C); border-radius: inherit;
}
.eo-sticky .nb-title { color: var(--ink, #2C2C2C); font-size: 12.5px; }
.eo-sticky .nb-text { color: var(--ink-2, #86868B); -webkit-line-clamp: 8; }

/* 无标题栏卡片：内容直接铺满 */
.eo-no-head .eo-node-head { display: none; }
.eo-no-head .eo-node-body { padding: 14px 14px 14px; border-radius: var(--eo-card-radius, 18px); }

/* 足迹地图：无边框地图卡 —— 瓦片地图直接铺满卡面（去玻璃底 / 描边 / 阴影 / 统计文本行） */
.eo-node.eo-borderless { background: transparent !important; border-color: transparent !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
.eo-node.eo-borderless.glass::after { content: none !important; }
.eo-node.eo-borderless .eo-node-body { padding: 0; border-radius: var(--eo-card-radius, 18px); }
.eo-node.eo-borderless .nb-panel :deep(.pn-big),
.eo-node.eo-borderless .nb-panel :deep(.pn-foot) { display: none; }
.eo-node.eo-borderless .nb-panel :deep(.pn-map) { margin-top: 0; border-radius: 0; }
/* 照片无边框：图片按卡片圆角铺满整卡 */
.eo-node.eo-borderless .nb-photo img { border-radius: var(--eo-card-radius, 18px); }
/* 无边框卡仍要有「确定感」：悬停描边环 + 轻投影，选中实线环（可交互 / 可抓取） */
.eo-node.eo-borderless:hover:not(.wb-dragging):not(.eo-beneath):not([data-stack-id]) {
  box-shadow: 0 24px 44px -18px rgba(44, 44, 44, .22), 0 0 0 1.5px var(--eo-accent, rgba(44, 44, 44, .4)) !important;
}
[data-theme='dark'] .eo-node.eo-borderless:hover:not(.wb-dragging):not(.eo-beneath):not([data-stack-id]) {
  box-shadow: 0 24px 44px -18px rgba(0, 0, 0, .6), 0 0 0 1.5px var(--eo-accent, rgba(255, 255, 255, .28)) !important;
}
.eo-node.eo-borderless.wb-selected { box-shadow: 0 0 0 2px var(--eo-primary) !important; }

/* 深色底卡片（时钟 / 黑胶）：墨色转白 */
.kind-clock, .kind-audio { --ink: #ffffff; --ink-2: rgba(255, 255, 255, 0.66); --line: rgba(255, 255, 255, 0.14); }
/* 粉色导航面板：深玫红墨色 */
.kind-menu { --ink: #4A4947; --ink-2: rgba(74, 73, 71, 0.66); }
[data-theme='dark'] .kind-menu { --ink: #f7e8ed; --ink-2: rgba(247, 232, 237, 0.62); }

/* ---- 数据卡片（面板）：暖白卡片 ---- */
.eo-datacard.glass { border-radius: var(--eo-card-radius, 18px); }
/* 面板内部不再重复一层头部（外层卡片已提供「图标 + 标签 + 刷新 + 更多」） */
.nb-panel :deep(.pn-head) { display: none; }
.nb-panel :deep(.pn-body) { margin-top: 0; }

/* 堆叠层级：组顶卡永远压在下层卡之上 */
.eo-node { z-index: 1; }
.eo-node.eo-beneath { z-index: 0; }
/* ---- 堆叠组下层：整卡压在组顶卡下面，只向右下错开一小段（错位重叠） ---- */
.eo-node.eo-beneath {
  border-radius: 18px; overflow: hidden;
  border: 1px solid rgba(44, 44, 44, 0.14);
  /* 下层纸整体压暗一档：露出的一圈边缘必须明显区别于组顶卡，
     否则浅底浅边 → 看起来只是一张卡，看不出「下面还压着几张」。
     只做亮度调整，不加饱和、不引入任何色相。 */
  filter: brightness(0.945);
  /* ⚠️ 下层卡只露出一条窄边（错位 ~18px），任何弥散阴影（blur ≥ 14px）都会
     糊在窄边外侧，把层与层之间的界线泡开 → 看起来「边缘发虚、看不出压了几张」。
     故下层卡【不用弥散阴影】，改用与错位量等长的实心错位描边，
     每层露出一条清晰的「纸片切口」，层数一眼可辨。 */
  box-shadow:
    1px 1px 0 0 rgba(44, 44, 44, 0.055),
    2px 2px 0 0 rgba(44, 44, 44, 0.045),
    3px 3px 0 0 rgba(44, 44, 44, 0.035);
}
/* 过渡动画的归属必须明确，否则「跟手」与「翻页动画」会互相打架：
   · 常态：下层卡不做 left/top 过渡 —— 拖拽时组顶卡立即到位，
     若下层卡还带 160ms 缓动，就会比组顶滞后一帧队列（视觉上「不跟手」）。
   · 翻页中（.wb-stack-flipping）：整组（含组顶与最深层）统一做 180ms 位移 + 透明度过渡，
     保证上滚轮 / 下滚轮翻页呈现完全一致的动画：离顶卡滑向背面并淡出、入顶卡从背面滑入并淡入。
   · 落位吸附（.wb-settle）：落到网格时平滑归位。 */
.wb-stack-flipping .eo-node {
  transition: left .18s cubic-bezier(.22, 1, .36, 1), top .18s cubic-bezier(.22, 1, .36, 1), opacity .18s ease;
}
/* 超出最深可见层的卡片：常态完全透明遮挡（不参与堆叠厚度表现），
   翻页时随 data 重算自动失去该类 → 立即纳入过渡，从背面滑入正面；
   反之入背面的卡获得该类 → 滑向背面并淡出。两类翻页观感因此完全对称。 */
.eo-node.eo-stack-deep { opacity: 0; pointer-events: none; }
/* 拖拽堆叠组期间：整组刚体同步，关闭一切过渡，组顶与下层卡同帧到位 */
.wb-stack-dragging .eo-node,
.wb-stack-dragging .eo-node.eo-beneath {
  transition: none !important;
}
[data-theme='dark'] .eo-node.eo-beneath {
  border-color: rgba(255, 255, 255, 0.18);
  filter: brightness(1.14);
  box-shadow:
    1px 1px 0 0 rgba(255, 255, 255, 0.06),
    2px 2px 0 0 rgba(255, 255, 255, 0.05),
    3px 3px 0 0 rgba(255, 255, 255, 0.04);
}
/* 下层卡片不可单独操作：拖拽 / 缩放 / 更多全部交给组顶卡 */
.eo-node.eo-beneath .eo-node-more,
.eo-node.eo-beneath .eo-node-resize,
.eo-node.eo-beneath .eo-handle { display: none !important; }
/* 堆叠组视觉降维：组顶（第一张）之外的内容一律不渲染 —— 只露出错位边缘表示「纸堆厚度」。
   玻璃卡半透明，若保留下层文字会从组顶透出，堆叠看起来像多张卡叠印，故必须屏蔽。 */
.eo-node.eo-beneath .eo-node-head,
.eo-node.eo-beneath .eo-node-body { visibility: hidden; }
.eo-node.eo-beneath.eo-sticky { transform: none; }
/* v2.2.5：视觉降维 —— 超过 3 张时只保留 3 层错位边缘，其余用实心错位阴影暗示纸堆厚度（右下对角线）
   ⚠️ 全部用 0 模糊的实心错位层：任何弥散阴影都会把层间界线泡开，纸堆会显得发虚、层数难辨。 */
.eo-node.eo-beneath.eo-stack-edge {
  box-shadow:
    6px 6px 0 -1px rgba(44, 44, 44, 0.10),
    12px 12px 0 -2px rgba(44, 44, 44, 0.07),
    18px 18px 0 -3px rgba(44, 44, 44, 0.04);
}
[data-theme='dark'] .eo-node.eo-beneath.eo-stack-edge {
  box-shadow:
    6px 6px 0 -1px rgba(28, 28, 30, 0.92),
    12px 12px 0 -2px rgba(28, 28, 30, 0.76),
    18px 18px 0 -3px rgba(28, 28, 30, 0.6);
}

/* ---- v2.x：堆叠组「顶层第一张」视觉净化 ----
   · 绝对最高图层（压在底层卡与所有常规卡之上）
   · 单一柔和投影 + 极细高光，杜绝多重边框 / 异常底纹 / 下方渗出的阴影
   · 内容区强制截断，绝不溢出卡片边缘 */
.eo-node[data-stack-top="1"] {
  z-index: 5;
  border-color: rgba(44, 44, 44, 0.5);
  box-shadow:
    0 18px 40px -18px rgba(44, 44, 44, 0.10),
    0 0 0 1px rgba(255, 255, 255, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
/* 顶层卡内容区：锁死溢出，内容过多时截断（非可滚动类型）而非撑破卡片 */
.eo-node[data-stack-top="1"] .eo-node-body { overflow: hidden; }
.eo-node[data-stack-top="1"] .eo-node-body .nb-text {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 顶层卡悬浮：仅轻浮 + 干净高光，不变形、不加多重描边 */
.eo-node[data-stack-top="1"]:hover:not(.wb-dragging) {
  box-shadow:
    0 22px 44px -18px rgba(44, 44, 44, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.65),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
[data-theme='dark'] .eo-node[data-stack-top="1"] {
  border-color: rgba(44, 44, 44, 0.45);
  box-shadow:
    0 18px 40px -18px rgba(44, 44, 44, 0.7),
    0 0 0 1px rgba(44, 44, 44, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
[data-theme='dark'] .eo-node[data-stack-top="1"]:hover:not(.wb-dragging) {
  box-shadow:
    0 22px 44px -18px rgba(44, 44, 44, 0.72),
    0 0 0 1px rgba(255, 255, 255, 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

/* ---- v2.2.5 堆叠组角标：数量 + 展开（>5 张时出现）---- */
.eo-stack-badge {
  position: absolute; top: -9px; right: -9px; z-index: 9;
  display: flex; align-items: center; gap: 4px; pointer-events: auto;
}
.eo-stack-badge__count,
.eo-stack-badge__expand {
  display: flex; align-items: center; gap: 3px;
  height: 19px; padding: 0 6px; border-radius: 999px;
  border: 1px solid rgba(44, 44, 44, 0.06);
  background: rgba(255, 255, 255, 0.92);
  color: #2C2C2C; font-size: 10px; font-weight: 800;
  cursor: pointer; font-variant-numeric: tabular-nums;
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  box-shadow: 0 4px 10px -6px rgba(44, 44, 44, 0.12);
  transition: background .16s ease, transform .16s ease, border-color .16s ease;
}
.eo-stack-badge__count b { font-size: 10.5px; letter-spacing: -.01em; line-height: 1; }
.eo-stack-badge__count:hover,
.eo-stack-badge__expand:hover {
  background: #F2F1ED; border-color: rgba(44, 44, 44, 0.5); transform: translateY(-1px);
}
.eo-stack-badge__expand { padding: 0 5px; }
[data-theme='dark'] .eo-stack-badge__count,
[data-theme='dark'] .eo-stack-badge__expand {
  background: rgba(44, 44, 44, 0.92); border-color: rgba(44, 44, 44, 0.2); color: #B8B5B0;
}
[data-theme='dark'] .eo-stack-badge__count:hover,
[data-theme='dark'] .eo-stack-badge__expand:hover {
  background: rgba(44, 44, 44, 0.96); border-color: rgba(44, 44, 44, 0.45);
}

/* ---- 右上「更多」按钮：默认隐形，悬停浮现 ---- */
.eo-node-more {
  /* ⚠️ 与标题栏内容对齐：标题栏已有 10px 上内边距（见 .eo-node-head），
     此按钮若仍贴卡顶 7px，会与刷新键上下错位、且在紧凑卡上被上沿切。
     16px = 10px 上内边距 + 按钮在 32px 内容带内的居中偏移。 */
  position: absolute; top: 16px; right: 7px; z-index: 7;
  width: 20px; height: 20px; border-radius: 999px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: var(--ink-2);
  cursor: pointer; opacity: .5; transform: translateY(0);
  transition: opacity .16s ease, transform .16s ease, background .16s ease;
}
.eo-node:hover .eo-node-more { opacity: .85; transform: translateY(0); }
.eo-node-more:hover { opacity: 1 !important; background: rgba(44, 44, 44, .08); }
[data-theme='dark'] .eo-node-more:hover { background: rgba(255, 255, 255, .12); }

/* ---- 四向连线点 ---- */
.eo-handle {
  position: absolute; width: 10px; height: 10px; border-radius: 50%;
  background: var(--eo-primary-deep); border: 2px solid #fff; z-index: 6;
  cursor: crosshair; box-shadow: 0 1px 3px rgba(44, 44, 44, .25);
  transition: transform .14s ease;
}
.eo-node:not(.wb-selected) .eo-handle { opacity: 0; pointer-events: none; transition: opacity .16s ease, transform .14s ease; }
.eo-node:not(.wb-selected):hover .eo-handle { opacity: 1; pointer-events: auto; }
.eo-handle:hover { opacity: .7; }
.eo-handle--t { top: -5px; left: 50%; margin-left: -5px; }
.eo-handle--b { bottom: -5px; left: 50%; margin-left: -5px; }
.eo-handle--l { left: -5px; top: 50%; margin-top: -5px; }
.eo-handle--r { right: -5px; top: 50%; margin-top: -5px; }

/* ---- 缩放手柄 ---- */
.eo-node-resize {
  position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; z-index: 5;
  cursor: nwse-resize; touch-action: none;
  display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;
  opacity: 0; transition: opacity .16s ease;
}
.eo-node:hover .eo-node-resize { opacity: 1; }
.eo-node-resize::after {
  content: ''; width: 11px; height: 11px; border-radius: 3px;
  background: linear-gradient(135deg, transparent 0 50%, rgba(44, 44, 44, .35) 50% 60%, transparent 60% 72%, rgba(44, 44, 44, .35) 72% 82%, transparent 82%);
}
.eo-node-resize:hover::after {
  background: linear-gradient(135deg, transparent 0 50%, var(--eo-primary-deep) 50% 60%, transparent 60% 72%, var(--eo-primary-deep) 72% 82%, transparent 82%);
}

/* ---- 响应式断点 ---- */
.eo-node.sz-xs .nb-sub, .eo-node.sz-xs .nb-refs { display: none; }
/* 便利贴再小也要能看到字 */
.eo-node.sz-xs:not(.eo-sticky) .nb-text { display: none; }
/* 紧凑档：上内边距同步收紧（主档 10px → 紧凑档 6px），more 按钮跟随 */
.eo-node.sz-xs .eo-node-head { height: 34px; padding: 6px 28px 0 10px; }
.eo-node.sz-xs .eo-node-more { top: 12px; right: 5px; }
.eo-node.sz-xs .nb-title { font-size: 12px; }
.eo-node.sz-sm .nb-refs { display: none; }
.eo-node.sz-sm .nb-text { -webkit-line-clamp: 2; }

/* ---- 游戏节点（Steam 游戏库）---- */
.nb-game { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.nb-game__cover { height: 58px; border-radius: 10px; background-size: cover; background-position: center; background-color: rgba(44, 44, 44, .08); flex: none; }
.nb-game__main { min-width: 0; }
</style>
