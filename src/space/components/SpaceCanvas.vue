<script setup>
// ===== 无限画布舞台 =====
// 渲染：Canvas 2D + 四叉树裁剪（renderer.js）
// 交互：平移 / 缩放 / 框选 / 拖拽 / 缩放节点 / 拉线 / 绘画 / 抬笔成型 / 图层
// UI 只通过 ui（视图状态）与 ws（状态层）通信，不反向污染画布引擎。
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import CanvasPanelNode from '../../components/CanvasPanelNode.vue'
import CanvasCardBody from '../../components/CanvasCardBody.vue'
import { SpaceRenderer, preloadImage } from '../core/renderer.js'
import { CARD_SWATCHES } from '../core/homeSeed.js'
import { defaultCardData } from '../../lib/cardMatrix.js'
import { screenToWorld, zoomAt, clampScale, animateCamera, visibleWorldRect } from '../core/camera.js'
import { recognizeStroke } from '../core/recognizer.js'
import { FpsMeter } from '../core/perf.js'
import { parse } from 'marked'
import { useAppStore } from '../../stores/app.js'
import { usePreview } from '../../stores/preview.js'
import { entityOf, unlinkEdge } from '../core/entityRefs.js'

// 竖屏：单指空白直接平移 + 降低同屏 DOM 卡上限（流畅性）
let portraitPan = false
if (typeof window !== 'undefined' && window.matchMedia) {
  const pmq = window.matchMedia('(max-width: 899px) and (orientation: portrait)')
  portraitPan = pmq.matches
  if (pmq.addEventListener) pmq.addEventListener('change', (e) => { portraitPan = e.matches })
}
const props = defineProps({
  ws: { type: Object, required: true },
  ui: { type: Object, required: true },
  lite: { type: Boolean, default: false }
})
const emit = defineEmits(['space-enter', 'space-new', 'open-media', 'toast', 'selection-change', 'stats', 'ai-summary', 'import-files', 'import-folder', 'tidy-current', 'tidy-all'])
const store = useAppStore()
const { open: openPreview } = usePreview()
// 绑定了功能实体的卡片右上角显示关联角标，点击就地预览（不跳页）
function relCount(n) {
  const e = entityOf(n)
  return e ? store.relatedEntitiesFor(e.type, e.id).length : 0
}
function openBoundEntity(n) {
  const e = entityOf(n)
  if (e) openPreview(e.type, e.id)
}
function openFolderPreview(n) {
  const e = entityOf(n)
  if (e) openPreview(e.type, e.id)
  else emit('toast', '该卡未绑定实体，右键可展开连接卡片')
}

const root = ref(null)
const canvasEl = ref(null)
const cardLayer = ref(null)
const paging = ref(false)
let pagingTimer = null
const pressingId = ref(null)
const linkSourceId = ref(null)
let cardPress = null
// 触屏按住不动 250ms 才算拖动；鼠标不需要等待，按下去一动就直接拖（见 armCardPress / armEmptyPress）
const LONG_PRESS_MS = 250
// 空白区域按下状态：鼠标按住移动 = 平移画布；未移动就抬起 = 清空选择
let emptyPress = null
// 真正开始拖动（长按到点，或鼠标移动超过容差时立即触发）
function armCardPress() {
  const cp = cardPress
  if (!cp || cp.armed) return
  cp.armed = true
  if (!props.ui.selection.includes(cp.id)) {
    selectOnly(cp.id)
    const peers = props.ws.stackPeers(cp.id)
    if (peers.length > 1) {
      props.ui.selection = peers.map((x) => x.id)
      emit('selection-change', props.ui.selection)
    }
  }
  // 从当前指针位置起算，避免卡片在起拖瞬间「跳一下」
  startMove(toWorld(cp.cx, cp.cy), cp.node)
  invalidate()
}
function armEmptyPress() {
  const ep = emptyPress
  if (!ep || ep.armed) return
  ep.armed = true
  // 从当前指针位置起算，避免画布在起拖瞬间「跳一下」
  startPan(null, { x: ep.cx, y: ep.cy })
  if (root.value) root.value.classList.add('is-panning')
}
// 长按拖动前记录按下前的选中项，用于「已选一张时点击另一张 = 连线」
function beginCardPress(n, sp, prior, pointerType) {
  if (cardPress) { clearTimeout(cardPress.timer); cardPress = null }
  pressingId.value = n.id
  cardPress = {
    id: n.id, node: n, sx: sp.x, sy: sp.y, cx: sp.x, cy: sp.y,
    prior: prior || [], armed: false,
    // 触屏手指天然抖动：允许更大的位移容差，否则长按还没到时计时就被取消（长按拖不动）
    touch: pointerType === 'touch',
    slop: pointerType === 'touch' ? 16 : 6,
    timer: setTimeout(() => {
      if (!cardPress || cardPress.id !== n.id) return
      armCardPress()
    }, LONG_PRESS_MS)
  }
  invalidate()
}
function beginEmptyPress(sp, pointerType) {
  if (emptyPress) { clearTimeout(emptyPress.timer); emptyPress = null }
  emptyPress = {
    sx: sp.x, sy: sp.y, cx: sp.x, cy: sp.y, armed: false,
    touch: pointerType === 'touch',
    // 长按期间手指/鼠标必然有轻微位移，容差太小会让长按提前作废
    slop: pointerType === 'touch' ? 16 : 10,
    timer: setTimeout(() => {
      armEmptyPress()
    }, LONG_PRESS_MS)
  }
}
// 单击卡片：只切换选中。连线必须先在工具栏开启「连线模式（L）」再依次点两张卡片，
// 避免「想选第二张卡却意外连出线」（用户明确要求左键单击仅选中）。
function resolveCardClick(press) {
  if (!press || press.armed) return
  const n = props.ws.nodeById(press.id)
  if (!n) return
  if (props.ui.multiMode === 'click') {
    toggleSelect(n.id)
    return
  }
  if (!props.ui.selection.includes(n.id)) selectOnly(n.id)
}
const cardSettings = reactive({ open: false, nodeId: null, title: '', color: '', w: 0, h: 0, cardKind: null, body: '' })
const groupEdit = reactive({ open: false, id: null, name: '', x: 0, y: 0 })
const dropSpaceName = ref('')
// ---------- 空空间引导卡（首次出现，可关闭，localStorage 记忆） ----------
const EMPTY_HINT_KEY = 'eo_hint_canvas_empty'
const emptyHintDismissed = ref(false)
try { emptyHintDismissed.value = !!localStorage.getItem(EMPTY_HINT_KEY) } catch (e) { /* 隐私模式忽略 */ }
const spaceEmpty = computed(() => {
  void props.ui.tick
  const hidden = props.ui.hiddenPanelKinds || []
  return !props.ws.nodes.some((n) => n.spaceId === props.ws.currentId && !hidden.includes(n.panelKind))
})
const showEmptyGuide = computed(() => !emptyHintDismissed.value && spaceEmpty.value)
function closeEmptyGuide() {
  emptyHintDismissed.value = true
  try { localStorage.setItem(EMPTY_HINT_KEY, '1') } catch (e) { /* ignore */ }
}
function guideNewCard() {
  closeEmptyGuide()
  const sx = Math.round(stage.w / 2)
  const sy = Math.round(stage.h / 2)
  const p = toWorld(sx, sy)
  newMenu.open = true
  newMenu.wx = Math.round(p.x)
  newMenu.wy = Math.round(p.y)
  newMenu.sx = Math.max(12, Math.min(stage.w - 300, sx - 140))
  newMenu.sy = Math.max(64, Math.min(stage.h - 340, sy - 140))
}
const stage = reactive({ w: 0, h: 0, dpr: 1 })
let renderer = null
let dirty = true
let rafId = 0
let ro = null
const meter = new FpsMeter()
const imagesPending = new Set()
// Canvas 绘制卡片的悬停补间（0.2s 内逐帧插值，与 DOM 卡手感一致）
const hoverLifts = new Map()
let lastHoverAt = 0

const selectedIds = computed(() => new Set(props.ui.selection || []))
const cam = computed(() => props.ws.space.camera)

// ---------- 交互瞬时状态 ----------
const editor = reactive({ open: false, nodeId: '', title: '', body: '', mode: 'visual' })
const editorBodyEl = ref(null)
const visualEl = ref(null)
// 可视化模式工具条：点按钮即见效果，不懂 Markdown 也能排版
const VISUAL_TOOLS = [
  { key: 'bold', label: '加粗' },
  { key: 'italic', label: '斜体' },
  { key: 'h', label: '标题' },
  { key: 'list', label: '列表' },
  { key: 'quote', label: '引用' },
  { key: 'link', label: '链接' },
  { key: 'image', label: '图片' },
  { key: 'clear', label: '清除格式' }
]
// 源码模式工具条：面向会写 Markdown 的用户
const MD_TOOLS = [
  { key: 'h', label: '标题', prefix: '# ' },
  { key: 'bold', label: '加粗', wrap: ['**', '**'], placeholder: '加粗文字' },
  { key: 'list', label: '列表', prefix: '- ' },
  { key: 'quote', label: '引用', prefix: '> ' },
  { key: 'todo', label: '待办', prefix: '- [ ] ' },
  { key: 'link', label: '链接', wrap: ['[', '](https://)'], placeholder: '链接文字' },
  { key: 'image', label: '图片', wrap: ['![', '](https://)'], placeholder: '图片描述' }
]
const ctxMenu = reactive({ open: false, x: 0, y: 0, items: [], target: null })
const drag = {
  mode: 'none',
  sx: 0, sy: 0,
  startCam: null,
  moved: false,
  historyReady: false,
  startNodes: [],
  startDraws: [],
  startBounds: null,
  marquee: null,
  resize: null,
  connect: null,
  primary: null,
  groupId: null,
  groupStart: null
}
const pointers = new Map()
let pinch = null
let spaceDown = false
let hoverHandle = null
// 2026-11-04：拖卡悬停 1 秒自动堆叠
const STACK_HOVER_MS = 600
const stackTargetId = ref(null)
let stackHover = { targetId: null, fromId: null, timer: null }
function resetStackHover() {
  if (stackHover.timer) clearTimeout(stackHover.timer)
  stackHover = { targetId: null, fromId: null, timer: null }
  if (stackTargetId.value) { stackTargetId.value = null; invalidate() }
}
// 指针下方的卡片（忽略拖动中的卡片自身与堆叠下层的卡；空间卡不参与堆叠）
function nodeAtPoint(p, exclude) {
  const hidden = props.ws.hiddenPanelKinds || []
  const list = props.ws.nodes
    .filter((n) => n.spaceId === props.ws.currentId && !exclude.has(n.id) && !(n.stackIdx > 0)
      && n.kind !== 'space' && !hidden.includes(n.panelKind))
    .sort((a, b) => (b.z || 0) - (a.z || 0))
  for (const n of list) {
    if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n
  }
  return null
}
// 指针下方的组（虚线容器）；excludeId 用于拖出时跳过原组
function groupAtPoint(p, excludeId) {
  const list = Object.values(props.ws.groups)
    .filter((g) => g.spaceId === props.ws.currentId && g.id !== excludeId)
  for (let i = list.length - 1; i >= 0; i--) {
    const b = props.ws.groupBounds(list[i].id)
    if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return list[i]
  }
  return null
}
// 指针下方的空间卡（用于拖入另一个空间）
function spaceNodeAtPoint(p) {
  const hidden = props.ws.hiddenPanelKinds || []
  const list = props.ws.nodes
    .filter((n) => n.spaceId === props.ws.currentId && n.kind === 'space' && n.targetSpaceId && !hidden.includes(n.panelKind))
    .sort((a, b) => (b.z || 0) - (a.z || 0))
  for (const n of list) {
    if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n
  }
  return null
}
// 拖放目标空间卡：指针命中优先；否则看被拖卡片的中心是否落在空间卡上
// （用户常从卡片边角抓起，指针可能落在卡外，但卡片本身已盖在空间卡上）
function spaceNodeForDrop(p, ids) {
  const hit = spaceNodeAtPoint(p)
  if (hit && !ids.includes(hit.id)) return hit
  const hidden = props.ws.hiddenPanelKinds || []
  const list = props.ws.nodes
    .filter((n) => n.spaceId === props.ws.currentId && n.kind === 'space' && n.targetSpaceId && !hidden.includes(n.panelKind))
    .sort((a, b) => (b.z || 0) - (a.z || 0))
  for (const n of list) {
    if (ids.includes(n.id)) continue
    for (const id of ids) {
      const m = props.ws.nodeById(id)
      if (!m || m.kind === 'space') continue
      const cx = m.x + m.w / 2
      const cy = m.y + m.h / 2
      if (cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) return n
    }
  }
  return null
}
function updateStackHover(p, draggedId) {
  // 明确规则：空间卡是容器，不参与任何堆叠（既不能被叠，也不能去叠别人）
  const dragged = props.ws.nodeById(draggedId)
  if (!dragged || dragged.kind === 'space') {
    if (stackHover.targetId) resetStackHover()
    return
  }
  const target = nodeAtPoint(p, new Set(props.ui.selection))
  if (!target || target.id === draggedId) {
    if (stackHover.targetId) resetStackHover()
    return
  }
  // 只有拖到目标卡片「中心 60% 区域」才算成堆，避免边缘掠过就合堆、卡片像「丢了」
  const cw = target.w * 0.6, chh = target.h * 0.6
  const cx0 = target.x + (target.w - cw) / 2
  const cy0 = target.y + (target.h - chh) / 2
  if (p.x < cx0 || p.x > cx0 + cw || p.y < cy0 || p.y > cy0 + chh) {
    if (stackHover.targetId) resetStackHover()
    return
  }
  if (stackHover.targetId === target.id) return
  resetStackHover()
  stackHover.targetId = target.id
  stackHover.fromId = draggedId
  stackTargetId.value = target.id
  invalidate()
  stackHover.timer = setTimeout(() => {
    const toId = stackHover.targetId
    const fromId = stackHover.fromId
    if (!toId || !fromId) return
    const gid = props.ws.stackNodes(toId, fromId)
    resetStackHover()
    if (!gid) return
    const peers = props.ws.stackPeers(fromId)
    props.ui.selection = peers.map((x) => x.id)
    emit('selection-change', props.ui.selection)
    emit('toast', '已合并为堆叠组 · 滚轮翻页，右键可打散')
    // 堆叠完成即结束本次拖动，避免继续拖散
    drag.mode = 'none'
    drag.moved = false
    drag.startBounds = null
    props.ui.guides = []
    props.ui.tick++
    props.ws.saveDebounced()
    invalidate()
  }, STACK_HOVER_MS)
}
const tempEdge = reactive({ fromId: null, x: 0, y: 0 })
// 双击空白后的“新建卡片”类型选择浮层（2026-11-04 P2：分「文件夹 / 单个」两页）
const newMenu = reactive({ open: false, sx: 0, sy: 0, wx: 0, wy: 0 })
const MENU_PAGE = ref('folder')
// 二级选择：单页里「笔记」一项下钻为 文档卡 / 便利贴
const MENU_SUB = ref(null)
const PANEL_COLORS = {
  notes: '#E18A9E', task: '#79B596', todo: '#79B596', calendar: '#F0A05A', album: '#E7B65E',
  map: '#6FAFC6', backpack: '#B58BD8', collections: '#9C8FD1', ledger: '#9C8FD1',
  achievements: '#E2A132', stats: '#F0A05A', steam: '#5F82A6', weather: '#7FB3C8'
}
// 文件夹页：能「装东西」的容器型条目（空间 / 组 / 各类数据面板）
// 文件夹页：9 项 3×3 —— 空间 / 组 / 任务单 / 待办集 / 背包 / 收藏夹 / 笔记本 / 相册 / 账本
const FOLDER_TYPES = computed(() => [
  { key: '__space', label: '空间', icon: 'folder', desc: '新建子空间，双击空间卡进入', type: 'space' },
  { key: '__group', label: '组', icon: 'layers', desc: '虚线分类容器，把卡片拖进来收纳', type: 'group', w: 300, h: 220 },
  { key: 'task', label: '任务单', icon: 'tasks', desc: '任务清单与截止日期', type: 'panel', w: 368, h: 208 },
  { key: 'todo', label: '待办集', icon: 'checklist', desc: '待办分组', type: 'panel', w: 368, h: 208 },
  { key: 'backpack', label: '背包', icon: 'backpack', desc: '背包包含物品与收藏的分类统计', type: 'panel', w: 280, h: 208 },
  { key: 'collections', label: '收藏夹', icon: 'star', desc: '收藏清单，可在面板内新建', type: 'panel', w: 280, h: 208 },
  { key: 'notes', label: '笔记本', icon: 'note', desc: '笔记列表 / 阅读', type: 'panel', w: 280, h: 208 },
  { key: 'album', label: '相册', icon: 'album', desc: '照片瀑布流', type: 'panel', w: 280, h: 208 },
  { key: 'ledger', label: '账本', icon: 'wallet', desc: '近期收支明细', type: 'panel', w: 368, h: 208 }
])
// 「笔记」一项下钻：文档卡 / 便利贴
const NOTE_SUB_TYPES = [
  { key: 'doc', label: '文档卡', icon: 'file', desc: '整篇长文，卡片内滚动阅读', type: 'card', w: 340, h: 300, color: '#DCD6C8' },
  { key: '__memo', label: '便利贴', icon: 'sticky', desc: '随手贴一段文字', type: 'memo', w: 228, h: 152 }
]
// 单个页：13 项 —— 任务 / Todo / 物品 / 收藏 / 笔记（文档+便利贴）/ 图片 / 记账 / 音乐 / 时间 / 日历 / 天气 / 地图 / 图表
const SINGLE_TYPES = computed(() => {
  const hidden = props.ui.hiddenPanelKinds || []
  const list = [
    { key: 'task', label: '任务', icon: 'tasks', desc: '任务清单与截止日期', type: 'panel', w: 368, h: 208 },
    { key: 'todo', label: 'Todo', icon: 'checklist', desc: '待办分组', type: 'panel', w: 368, h: 208 },
    { key: 'backpack', label: '物品', icon: 'backpack', desc: '物品分类统计（属于背包）', type: 'panel', w: 280, h: 208 },
    { key: 'collections', label: '收藏', icon: 'star', desc: '收藏清单（属于背包）', type: 'panel', w: 280, h: 208 },
    { key: '__notes', label: '笔记', icon: 'note', desc: '文档卡 / 便利贴，点选后二选一', type: 'none' },
    { key: 'image', label: '图片', icon: 'image', desc: '单张图片，点击查看大图', type: 'card', w: 248, h: 196, color: '#CFC8BA' },
    { key: 'ledger', label: '记账', icon: 'wallet', desc: '近期收支明细', type: 'panel', w: 368, h: 208 },
    { key: 'audio', label: '音乐', icon: 'music', desc: '单卡歌单：本地 / 收藏 / 网易云', type: 'card', w: 292, h: 188, color: '#B3201F' },
    { key: 'clock', label: '时间', icon: 'clock', desc: '实时本地时间', type: 'card', w: 236, h: 132, color: '#2C2C2C' },
    { key: 'calendar', label: '日历', icon: 'calendar', desc: '月历 + 当日任务/Todo/记账', type: 'panel', w: 620, h: 440 },
    { key: 'weather', label: '天气', icon: 'cloud', desc: '实况 + 三日预报（定位 / Open-Meteo）', type: 'panel', w: 300, h: 214 },
    { key: 'map', label: '地图', icon: 'map-pin', desc: '瓦片地图足迹', type: 'panel', w: 480, h: 440 },
    { key: 'stats', label: '图表', icon: 'chart', desc: '六宫格指标 + 近 7 天活跃', type: 'panel', w: 480, h: 300 }
  ]
  // 插件面板：插件关闭时整项从菜单移除（默认关闭，故默认正好 13 项）
  if (!hidden.includes('steam')) list.push({ key: 'steam', label: 'Steam', icon: 'game', desc: 'Steam 游戏库插件', type: 'panel', w: 280, h: 208 })
  return list
})
// 非 DOM 渲染的节点（空间卡 / 媒体卡）以及低缩放下：仍然给一个可缩放的右下角抓手，
// 保证「所有卡片都能缩放」不被渲染方式限制。抓手握把做反向缩放，屏幕上恒定 24px。
const overlayHandles = computed(() => {
  void props.ui.tick
  const c = props.ws.space.camera
  const inv = 1 / (c.s || 1)
  const domIds = new Set(domNodes.value.map((n) => n.id))
  const sel = props.ui.selection || []
  const out = []
  for (let i = 0; i < sel.length; i++) {
    if (domIds.has(sel[i])) continue
    const n = props.ws.nodes.find((x) => x.id === sel[i])
    if (n) out.push({ node: n, inv })
  }
  return out
})
const menuTypes = computed(() => {
  if (MENU_SUB.value === 'notes') return NOTE_SUB_TYPES
  return MENU_PAGE.value === 'folder' ? FOLDER_TYPES.value : SINGLE_TYPES.value
})
const preview = ref(null)
let eraseStart = false
let rafDrawPreview = 0
let lastDrawAt = 0

const flat = computed(() => props.ui.flat || props.ws.settings.flat)

// ---------- 数据卡片 DOM 叠层 ----------
// 方案 B：屏幕内的面板 / 卡片 / 便利贴用真实 DOM 渲染（保留原作组件与全部交互），
// 画布只绘制空白与占位；任何缩放级别都渲染真实卡片（不做 LOD 降级），
// 仅靠可视剔除 + 数量上限控制开销。
const DOM_KINDS = ['panel', 'card', 'memo']
const domNodes = computed(() => {
  void props.ui.tick
  const c = props.ws.space.camera
  const pad = 40 / c.s
  const v = visibleWorldRect(c, stage.w, stage.h, pad)
  const list = []
  const nodes = props.ws.nodes
  const hiddenKinds = props.ui.hiddenPanelKinds || []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.spaceId !== props.ws.currentId || !DOM_KINDS.includes(n.kind)) continue
    // 关闭的内置插件（如 Steam）整卡不渲染
    if (hiddenKinds.includes(n.panelKind)) continue
    if (n.x + n.w < v.x || n.x > v.x + v.w || n.y + n.h < v.y || n.y > v.y + v.h) continue
    list.push(n)
  }
  const max = props.ui.lite ? 12 : (portraitPan ? 8 : 16)
  let keep = list
  if (keep.length > max) {
    keep = list.slice()
      .sort((a, b) => Math.min(a.w, v.w) * Math.min(a.h, v.h) - Math.min(b.w, v.w) * Math.min(b.h, v.h))
      .slice(-max)
  }
  keep.sort((a, b) => (a.z || 0) - (b.z || 0))
  return keep
})
const domIds = computed(() => new Set(domNodes.value.map((n) => n.id)))
watch(() => props.ui.linkMode, (v) => { if (!v) linkSourceId.value = null })
watch(() => props.ui.selection.length, (n) => { if (!n) linkSourceId.value = null })
function hexA(hex, a) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return 'rgba(232,184,109,' + a + ')'
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'
}
function isDarkTheme() {
  const de = document.documentElement
  return (de.dataset && de.dataset.theme) === 'dark' || de.getAttribute('data-theme') === 'dark'
}
// 主题切换时让卡片的行内底色重新计算
const themeDark = ref(isDarkTheme())
function mixHex(hex, white = 0.62) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#F6EFE6'
  const ch = (i) => parseInt(h.slice(i, i + 2), 16)
  const mix = (c) => Math.round(c * (1 - white) + 252 * white)
  return '#' + [mix(ch(0)), mix(ch(2)), mix(ch(4))].map((v) => v.toString(16).padStart(2, '0')).join('')
}
// 深色卡片：主题色少量混入 #26262A，避免浅色底发亮
function mixDarkHex(hex, ratio = 0.18) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#26262A'
  const ch = (i) => parseInt(h.slice(i, i + 2), 16)
  const mix = (c, i) => Math.round(c * ratio + [38, 38, 42][i] * (1 - ratio))
  return '#' + [mix(ch(0), 0), mix(ch(2), 1), mix(ch(4), 2)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
// 按底色亮度给正文墨色（时钟卡浅/深主题、自定义色都适用）
function contrastInk(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return { main: '#2A2A2C', sub: 'rgba(42, 42, 44, .58)' }
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const L = 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16))
  return L > 0.55
    ? { main: '#26262A', sub: 'rgba(38, 38, 42, .58)' }
    : { main: '#FFFFFF', sub: 'rgba(255, 255, 255, .72)' }
}
function cardStyle(n) {
  const accent = n.color || '#E8B86D'
  const st = {
    left: n.x + 'px',
    top: n.y + 'px',
    width: n.w + 'px',
    height: n.h + 'px',
    zIndex: String(Math.round(n.z || 1)),
    '--accent': accent,
    background: themeDark.value
      ? mixDarkHex(accent, n.kind === 'memo' ? 0.24 : 0.18)
      : mixHex(accent, n.kind === 'memo' ? 0.5 : 0.62)
  }
  // 堆叠组展开（双击切换）：从锚点向左依次排开，收起时回到 18px 错位叠放
  if (n.stackId && stackOpen(n.stackId)) {
    const idx = n.stackIdx || 0
    const baseX = n.x - idx * 18
    const baseY = n.y - idx * 18
    st.left = (baseX + idx * (n.w + 12)) + 'px'
    st.top = baseY + 'px'
    st.zIndex = String(Math.round((n.z || 1) + 20))
  }
  // 地图 / 天气卡无外框，节点容器透明，视觉由内部组件承担
  if (n.panelKind === 'map' || n.panelKind === 'weather') st.background = 'transparent'
  // 照片卡：白边相纸，背景固定白色（不受节点自定义色影响）
  if (n.kind === 'image') st.background = '#FFFFFF'
  // 时钟：浅/深主题两版（用户自定义色优先）；音乐：固定红卡
  if (n.cardKind === 'clock') {
    const custom = n.color && n.color !== '#3B3A37'
    const bg = custom ? n.color : (themeDark.value ? '#3B3A37' : '#F2F0EB')
    st.background = 'linear-gradient(158deg, ' + hexA(bg, 1) + ' 0%, ' + mixDarkHex(bg, custom ? 0.92 : 0.96) + ' 100%)'
    const ink = contrastInk(bg)
    st['--cb-ink'] = ink.main
    st['--cb-ink-2'] = ink.sub
  } else if (n.cardKind === 'audio') {
    st.background = 'linear-gradient(158deg, #D64747 0%, #B72F35 100%)'
  }
  return st
}
function syncCardLayer() {
  const el = cardLayer.value
  if (!el) return
  const c = props.ws.space.camera
  el.style.transform = 'translate(' + (stage.w / 2 - c.x * c.s) + 'px,' + (stage.h / 2 - c.y * c.s) + 'px) scale(' + c.s + ')'
}

function invalidate() { dirty = true }

function setSize() {
  const el = root.value
  if (!el) return
  const r = el.getBoundingClientRect()
  stage.w = Math.max(1, Math.round(r.width))
  stage.h = Math.max(1, Math.round(r.height))
  stage.dpr = Math.min(2, window.devicePixelRatio || 1)
  if (renderer) {
    renderer.resize(stage.w, stage.h, stage.dpr)
    dirty = true
  }
  syncCardLayer()
}

onMounted(() => {
  renderer = new SpaceRenderer(canvasEl.value, props.ws)
  renderer.onImageLoad = invalidate
  setSize()
  ro = new ResizeObserver(() => setSize())
  ro.observe(root.value)
  unsub = props.ws.on(() => invalidate())
  window.addEventListener('keydown', onSpaceKey)
  window.addEventListener('keyup', onSpaceKey)
  loop(performance.now())
  // 预加载媒体缩略图
  refreshImageSubscriptions()
  themeObserver = new MutationObserver(() => { themeDark.value = isDarkTheme() })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

let unsub = null
let themeObserver = null
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  ro && ro.disconnect()
  themeObserver && themeObserver.disconnect()
  window.removeEventListener('keydown', onSpaceKey)
  window.removeEventListener('keyup', onSpaceKey)
  stopDrag()
  unsub && unsub()
})

function onSpaceKey(e) {
  if (e.type === 'keydown' && e.key === 'Escape' && newMenu.open) { newMenu.open = false; return }
  if (e.code === 'Space' && !props.ui.editing) {
    if (e.type === 'keydown') spaceDown = true
    else spaceDown = false
  }
}

function refreshImageSubscriptions() {
  const nodes = props.ws.nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.spaceId !== props.ws.currentId) continue
    const src = n.kind === 'image' && n.media && (n.media.thumb || n.media.src)
    if (src && !imagesPending.has(src) && !imagesPending.has(n.id)) {
      imagesPending.add(n.id)
      preloadImage(src, () => { imagesPending.delete(n.id); invalidate() })
    }
  }
}

function loop(now) {
  rafId = requestAnimationFrame(loop)
  if (meter.tick(now)) {
    props.ui.fps = meter.fps
    if (meter.low && !props.ui.lite) props.ui.lite = true
  }
  // 悬停补间：从 0 → 1 平滑上浮，移出后回落；约 0.2s 收敛
  const hoverId = props.ui.hoverId
  if (hoverId && !hoverLifts.has(hoverId)) hoverLifts.set(hoverId, 0)
  const dt = Math.min(80, now - (lastHoverAt || now))
  lastHoverAt = now
  let hoverAnim = false
  for (const [id, v] of hoverLifts) {
    const target = id === hoverId ? 1 : 0
    if (Math.abs(target - v) > 0.002) {
      const k = 1 - Math.exp(-dt / 65)
      const nv = v + (target - v) * k
      hoverLifts.set(id, Math.abs(target - nv) < 0.01 ? target : nv)
      hoverAnim = true
    } else if (target === 0) {
      hoverLifts.delete(id)
    }
  }
  if (hoverAnim) dirty = true
  if (!dirty) return
  dirty = false
  refreshImageSubscriptions()
  syncCardLayer()
  const state = {
    cam: props.ws.space.camera,
    selection: selectedIds.value,
    hoverId: props.ui.hoverId,
    marquee: drag.marquee,
    guides: props.ui.guides,
    tempEdge: tempEdge.fromId ? tempEdge : null,
    preview: preview.value,
    flat: flat.value,
    lite: props.lite || props.ui.lite,
    activeGroup: props.ui.activeGroup,
    domIds: domIds.value,
    hoverLifts,
    forceVisible: drag.mode === 'move' ? props.ui.selection : []
  }
  renderer.draw(state)
}

// ---------- 坐标 ----------
function screenPoint(e) {
  const r = canvasEl.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function toWorld(sx, sy) {
  return screenToWorld(props.ws.space.camera, sx, sy, stage.w, stage.h)
}
function canvasCenterOn(wx, wy) {
  const c = props.ws.space.camera
  c.x = wx; c.y = wy
  props.ui.tick++
  invalidate()
}

// ---------- 指针 ----------
function onPointerDown(e) {
  if (e.button === 2) return
  const t0 = e.target
  if (t0 && t0.closest && t0.closest('[data-sp-ui],button,input,textarea,select,a,label')) return
  if (newMenu.open) newMenu.open = false
  if (cardSettings.open) closeCardSettings()
  if (groupEdit.open) groupEdit.open = false
  closeCtxMenu()
  closeEditorOnBlur(e)
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  pointers.set(e.pointerId, { x: sp.x, y: sp.y })
  try { canvasEl.value.setPointerCapture(e.pointerId) } catch (err) {}

  if (pointers.size === 2) {
    startPinch()
    return
  }
  if (e.button === 1 || spaceDown) {
    startPan(e, sp)
    return
  }
  if (props.ui.tool === 'eraser') {
    startErase(p)
    return
  }
  if (isDrawTool(props.ui.tool)) {
    startDraw(p)
    return
  }

  // 选择工具 / 文本工具
  const handle = handleAt(p)
  if (handle && props.ui.selection.length === 1) {
    const id = props.ui.selection[0]
    const n = props.ws.nodeById(id)
    if (handle.type === 'resize') { startResize(n, handle.corner, sp) ; return }
    if (handle.type === 'connect') { startConnect(n, handle.side) ; return }
  }
  const hit = props.ws.hitTest(p.x, p.y)
  if (hit) {
    const n = hit.data
    if (hit.type === 'node' && props.ui.linkMode) { handleLinkClick(n); return }
    // 堆叠成员必须整组一起拖：否则画布层渲染的媒体卡（图片/视频）会被单独拖出堆叠，看起来「掉下去了」
    const peers = props.ws.stackPeers(n.id)
    const prior = props.ui.selection.slice()
    if (props.ui.multiMode !== 'click') {
      if (e.shiftKey) {
        const set = new Set(prior.concat(peers.map((x) => x.id)))
        props.ui.selection = Array.from(set)
        emit('selection-change', props.ui.selection)
      } else if (!prior.includes(n.id)) {
        selectOnly(n.id)
        if (peers.length > 1) {
          props.ui.selection = peers.map((x) => x.id)
          emit('selection-change', props.ui.selection)
        }
      } else if (prior.length > 1) {
        // 保持多选拖拽
      } else {
        selectOnly(n.id)
      }
    }
    beginCardPress(n, sp, prior, e.pointerType)
    return
  }
  // 点在组的虚线框内（但没点到卡片）：整组移动
  if (!e.shiftKey && props.ui.multiMode !== 'click') {
    const g = groupAtPoint(p)
    if (g) { startGroupMove(p, g); return }
  }
  // 框选模式：空白拖动 = 框选；其余模式：空白长按后拖动 = 平移，单击 = 清空选择
  if (props.ui.multiMode === 'box') {
    if (!e.shiftKey) clearSelection()
    startMarquee(p)
    return
  }
  beginEmptyPress(sp, e.pointerType)
}

function onPointerMove(e) {
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: sp.x, y: sp.y })

  if (pinch) { updatePinch(e); return }

  if (cardPress) {
    cardPress.cx = sp.x
    cardPress.cy = sp.y
    if (!cardPress.armed && Math.hypot(sp.x - cardPress.sx, sp.y - cardPress.sy) > cardPress.slop) {
      clearTimeout(cardPress.timer)
      // 鼠标：按住后一移动就直接拖，不再等长按；触屏仍要求长按，避免滑动误拖
      if (cardPress.touch) {
        cardPress = null
        pressingId.value = null
        invalidate()
      } else {
        armCardPress()
      }
    }
  }
  if (emptyPress) {
    emptyPress.cx = sp.x
    emptyPress.cy = sp.y
    if (!emptyPress.armed && Math.hypot(sp.x - emptyPress.sx, sp.y - emptyPress.sy) > emptyPress.slop) {
      clearTimeout(emptyPress.timer)
      // 鼠标：按住移动即平移；触屏仍要求长按
      if (emptyPress.touch && !portraitPan) emptyPress = null
      else armEmptyPress()
    }
  }

  // hover 反馈
  if (drag.mode === 'none') {
    const h = props.ws.hitTest(p.x, p.y)
    const nh = h && h.type === 'node' ? h.data.id : null
    if (nh !== props.ui.hoverId) props.ui.hoverId = nh
    const handle = handleAt(p)
    hoverHandle = handle
    updateCursor(handle)
    if (h) invalidate()
    return
  }

  const dxScreen = sp.x - drag.sx
  const dyScreen = sp.y - drag.sy

  if (drag.mode === 'pan') {
    const c = props.ws.space.camera
    c.x = drag.startCam.x - dxScreen / c.s
    c.y = drag.startCam.y - dyScreen / c.s
    props.ui.tick++
    invalidate()
    return
  }
  if (drag.mode === 'marquee') {
    drag.moved = drag.moved || Math.abs(dxScreen) + Math.abs(dyScreen) > 3
    const x1 = Math.min(drag.startWorld.x, p.x)
    const y1 = Math.min(drag.startWorld.y, p.y)
    const w = Math.abs(p.x - drag.startWorld.x)
    const h = Math.abs(p.y - drag.startWorld.y)
    drag.marquee = { x: x1, y: y1, w, h }
    invalidate()
    return
  }
  if (drag.mode === 'move') {
    if (!drag.moved && Math.abs(dxScreen) + Math.abs(dyScreen) < 3) return
    drag.moved = true
    ensureHistory()
    const camS = props.ws.space.camera.s
    let dx = dxScreen / camS
    let dy = dyScreen / camS
    const snapped = computeSnap(dx, dy)
    dx = snapped.dx; dy = snapped.dy
    applyMove(dx, dy)
    // 跨空间投放提示：卡片压住别的空间卡（指针或卡片中心命中）
    const spNode = spaceNodeForDrop(p, drag.startNodes.map((s) => s.id))
    const canDrop = !!spNode
    dropSpaceName.value = canDrop ? ((props.ws.spaces[spNode.targetSpaceId] || {}).name || '空间') : ''
    // 单卡拖动时检测悬停目标：停留 1 秒成堆叠
    if (drag.startNodes.length === 1) updateStackHover(p, drag.startNodes[0].id)
    else if (stackHover.targetId) resetStackHover()
    props.ui.tick++
    invalidate()
    return
  }
  if (drag.mode === 'resize') {
    const camS = props.ws.space.camera.s
    const n = drag.resize.node
    const initial = drag.resize.initial
    let w = initial.w + dxScreen / camS
    let h = initial.h + dyScreen / camS
    if (drag.resize.corner === 'nw' || drag.resize.corner === 'sw') w = initial.w - dxScreen / camS
    if (drag.resize.corner === 'nw' || drag.resize.corner === 'ne') h = initial.h - dyScreen / camS
    w = Math.max(120, w); h = Math.max(64, h)
    if (props.ws.settings.snap) { w = Math.round(w / 10) * 10; h = Math.round(h / 10) * 10 }
    n.w = w; n.h = h
    if (drag.resize.corner === 'nw' || drag.resize.corner === 'sw') n.x = initial.x + (initial.w - w)
    if (drag.resize.corner === 'nw' || drag.resize.corner === 'ne') n.y = initial.y + (initial.h - h)
    drag.moved = true
    props.ui.tick++
    invalidate()
    return
  }
  if (drag.mode === 'draw') {
    updateDraw(p)
    return
  }
  if (drag.mode === 'connect') {
    tempEdge.x = p.x; tempEdge.y = p.y
    const h = props.ws.hitTest(p.x, p.y)
    props.ui.connectTarget = h && h.type === 'node' && h.data.id !== drag.connect.fromId ? h.data.id : null
    invalidate()
    return
  }
  if (drag.mode === 'erase') {
    eraseAt(p)
    return
  }
}

function onPointerUp(e) {
  resetStackHover()
  pointers.delete(e.pointerId)
  const isLeave = e.type === 'pointerleave'
  let pressClick = null
  if (cardPress) {
    clearTimeout(cardPress.timer)
    if (!isLeave && !cardPress.armed) pressClick = cardPress
    cardPress = null
    pressingId.value = null
    invalidate()
  }
  let emptyClick = false
  if (emptyPress) {
    clearTimeout(emptyPress.timer)
    emptyClick = !isLeave && !emptyPress.armed
    emptyPress = null
    if (root.value) root.value.classList.remove('is-panning')
  }
  if (pinch) {
    pressClick = null
    emptyClick = false
    if (pointers.size < 2) { pinch = null; drag.mode = 'none' }
    return
  }
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  const mode = drag.mode
  if (mode === 'move') {
    if (drag.moved) {
      settleMoveDrop(p)
      props.ws.rebuildIndex()
      props.ws.saveDebounced()
    }
    props.ui.guides = []
    dropSpaceName.value = ''
  } else if (mode === 'resize') {
    if (drag.moved) { props.ws.rebuildIndex(); props.ws.saveDebounced() }
  } else if (mode === 'marquee') {
    finishMarquee(e.shiftKey)
  } else if (mode === 'draw') {
    finishDraw()
  } else if (mode === 'connect') {
    finishConnect(p)
  } else if (mode === 'erase') {
    props.ws.saveNow()
  } else if (mode === 'pan') {
    props.ws.saveDebounced()
  }
  // 未进入拖动/框选：抬起视为单击（卡片：选中或连线；空白：清空选择）
  if (mode === 'none') {
    if (pressClick) resolveCardClick(pressClick)
    else if (emptyClick) clearSelection()
  }
  drag.mode = 'none'
  drag.marquee = null
  drag.startBounds = null
  drag.moved = false
  drag.groupId = null
  drag.groupStart = null
  dropSpaceName.value = ''
  props.ui.guides = []
  tempEdge.fromId = null
  props.ui.connectTarget = null
  if (root.value) root.value.classList.remove('is-panning')
  invalidate()
  setCursorDefault()
}

// 指针离开整个画布（如移到侧边栏）：清除悬停，避免卡片一直保持上浮
function onPointerLeave(e) {
  onPointerUp(e)
  if (drag.mode === 'none' && props.ui.hoverId) {
    props.ui.hoverId = null
    hoverHandle = null
    invalidate()
  }
}

// 指针被系统取消（触屏滚动接管 / 来电 / 手势冲突）：安全落地，不当作点击
function onPointerCancel(e) {
  pointers.delete(e.pointerId)
  resetStackHover()
  if (cardPress) { clearTimeout(cardPress.timer); cardPress = null }
  if (emptyPress) { clearTimeout(emptyPress.timer); emptyPress = null }
  pressingId.value = null
  if (drag.mode === 'move' && drag.moved) { props.ws.rebuildIndex(); props.ws.saveDebounced() }
  if (drag.mode === 'pan') props.ws.saveDebounced()
  drag.mode = 'none'
  drag.marquee = null
  drag.startBounds = null
  drag.moved = false
  drag.groupId = null
  drag.groupStart = null
  dropSpaceName.value = ''
  props.ui.guides = []
  tempEdge.fromId = null
  props.ui.connectTarget = null
  if (root.value) root.value.classList.remove('is-panning')
  if (pointers.size < 2) pinch = null
  setCursorDefault()
  invalidate()
}

function stopDrag() {
  if (cardPress) { clearTimeout(cardPress.timer); cardPress = null }
  if (emptyPress) { clearTimeout(emptyPress.timer); emptyPress = null }
  pressingId.value = null
  if (root.value) root.value.classList.remove('is-panning')
  drag.mode = 'none'
  drag.marquee = null
  tempEdge.fromId = null
  preview.value = null
  pointers.clear()
  pinch = null
}

// ---------- 数据卡片（DOM 叠层）交互 ----------
// 单击 = 选中（已选一张时点另一张 = 连线）；长按 250ms 后才能拖动卡片；空白长按后拖动 = 平移画布
function handleLinkClick(n) {
  if (!linkSourceId.value || linkSourceId.value === n.id) {
    linkSourceId.value = n.id
    selectOnly(n.id)
    emit('toast', '已选起点，再点击另一张卡片完成连线')
    invalidate()
    return
  }
  const from = linkSourceId.value
  linkSourceId.value = null
  props.ws.connect(from, n.id)
  emit('toast', '已创建连线')
  props.ui.tick++
  invalidate()
}
function onCardPointerDown(e, n) {
  if (e.button !== 0) return
  const t = e.target
  if (t && t.closest && t.closest('button,input,textarea,select,a,label,[data-sp-ui]')) return
  e.stopPropagation()
  e.preventDefault()
  closeCtxMenu()
  if (editor.open) closeEditor()
  if (cardSettings.open) closeCardSettings()
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  if (spaceDown) {
    try { canvasEl.value.setPointerCapture(e.pointerId) } catch (err) {}
    pointers.set(e.pointerId, { x: sp.x, y: sp.y })
    startPan(e, sp)
    return
  }
  const prior = props.ui.selection.slice()
  const peers = props.ws.stackPeers(n.id)
  // 多选（自定义）：抬起时切换，不在按下时改选中
  if (props.ui.multiMode !== 'click') {
    if (e.shiftKey && prior.includes(n.id)) {
      toggleSelect(n.id)
    } else if (e.shiftKey) {
      const set = new Set(prior.concat(peers.map((x) => x.id)))
      props.ui.selection = Array.from(set)
      emit('selection-change', props.ui.selection)
    } else if (!prior.includes(n.id)) {
      selectOnly(n.id)
      if (peers.length > 1) {
        props.ui.selection = peers.map((x) => x.id)
        emit('selection-change', props.ui.selection)
      }
    }
  }
  if (props.ui.linkMode) { handleLinkClick(n); return }
  // 捕获到卡片本身：保证 pointer 事件仍冒泡到舞台，同时不劫持 dblclick 目标
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
  pointers.set(e.pointerId, { x: sp.x, y: sp.y })
  // 单击选中，长按 250ms 后才进入拖动（鼠标 / 触屏一致）
  beginCardPress(n, sp, prior, e.pointerType)
}
function patchCard(n, patch) {
  if (!patch) return
  const next = Object.assign({}, n.cardData || {}, patch)
  props.ws.updateNode(n.id, { cardData: next }, { save: true })
  // 工作区是纯 JS 实例（非响应式），cardData 变更不会自动刷新 DOM 卡片，用版本号驱动重渲染
  bumpCardRev(n.id)
  invalidate()
}
// DOM 卡片内容版本：patch 后自增，CanvasCardBody 依赖它重新计算
const cardRev = reactive({})
function bumpCardRev(id) { cardRev[id] = (cardRev[id] || 0) + 1 }
// ---------- 双击数据卡片：便利贴直接编辑文字，其余打开卡片设置 ----------
// 堆叠组：双击水平展开 / 再次双击收起（150ms 过渡），滚轮翻页不受影响
const expandedStacks = ref([])
const stackAnim = ref(false)
let stackAnimTimer = null
function stackOpen(stackId) { return expandedStacks.value.includes(stackId) }
function toggleStackExpand(stackId) {
  const arr = expandedStacks.value
  const i = arr.indexOf(stackId)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(stackId)
  stackAnim.value = true
  clearTimeout(stackAnimTimer)
  stackAnimTimer = setTimeout(() => { stackAnim.value = false }, 180)
  invalidate()
}
function onCardDblClick(e, n) {
  if (!n) return
  if (n.stackId) { toggleStackExpand(n.stackId); return }
  if (n.kind === 'memo') { openEditor(n.id); return }
  openCardSettings(e, n)
}
// ---------- 卡片设置（双击数据卡片） ----------
function openCardSettings(e, n) {
  if (e && e.stopPropagation) e.stopPropagation()
  if (editor.open) closeEditor()
  cardSettings.open = true
  cardSettings.nodeId = n.id
  cardSettings.title = n.title || ''
  cardSettings.color = n.color || CARD_SWATCHES[0]
  cardSettings.w = n.w
  cardSettings.h = n.h
  cardSettings.cardKind = n.cardKind || null
  cardSettings.body = (n.cardData && n.cardData.body) || ''
  invalidate()
}
function closeCardSettings() {
  cardSettings.open = false
  cardSettings.nodeId = null
}
function applyCardSettings() {
  const n = cardSettings.nodeId ? props.ws.nodeById(cardSettings.nodeId) : null
  if (!n) { closeCardSettings(); return }
  const patch = {
    title: cardSettings.title,
    color: cardSettings.color,
    w: Math.max(120, Math.round(cardSettings.w || n.w)),
    h: Math.max(64, Math.round(cardSettings.h || n.h))
  }
  // 文档卡：正文跟随设置保存
  if (n.cardKind === 'doc') patch.cardData = { ...(n.cardData || {}), body: cardSettings.body }
  props.ws.updateNode(n.id, patch)
  if (n.cardKind === 'doc') bumpCardRev(n.id)
  props.ws.rebuildIndex()
  props.ws.saveNow()
  props.ui.tick++
  invalidate()
  emit('toast', '卡片设置已保存')
  closeCardSettings()
}
// 整理空间卡内部卡片：把落在卡内的卡片按行铺成统一间距网格（可撤销）
function tidySpace(n) {
  const ws = props.ws
  const pad = 20
  const gap = 16
  const top = n.y + 52
  const innerR = n.x + n.w - pad
  const innerB = n.y + n.h - pad
  const members = ws.nodes.filter((m) =>
    m.id !== n.id && m.kind !== 'space' && !m.stackId && !m.groupId &&
    m.x + m.w / 2 > n.x && m.x + m.w / 2 < n.x + n.w &&
    m.y + m.h / 2 > n.y && m.y + m.h / 2 < n.y + n.h)
  if (!members.length) { emit('toast', '这个空间卡里还没有卡片'); return }
  ws.pushUndo()
  members.sort((a, b) => (Math.round(a.y / 40) - Math.round(b.y / 40)) || (a.x - b.x))
  let cx = n.x + pad
  let cy = top
  let rowH = 0
  members.forEach((m) => {
    if (cx + m.w > innerR && cx > n.x + pad) { cx = n.x + pad; cy += rowH + gap; rowH = 0 }
    m.x = Math.round(cx)
    m.y = Math.round(cy)
    cx += m.w + gap
    rowH = Math.max(rowH, m.h)
  })
  // 内容超出卡片高度时：至少保证第一行落在卡内，其余继续向下排（不强行压缩卡片尺寸）
  if (cy + rowH > innerB) emit('toast', '卡片较多，部分已排在卡片外，可拉高空间卡')
  ws.saveNow()
  invalidate()
  emit('toast', '已整理 ' + members.length + ' 张卡片')
}

// 组改名：小浮层输入（右键组框 / 右键组内卡片）
function openGroupEdit(id, sx, sy) {
  const g = props.ws.groups[id]
  if (!g) return
  groupEdit.open = true
  groupEdit.id = id
  groupEdit.name = g.name || '组'
  groupEdit.x = Math.max(12, Math.min(stage.w - 236, sx))
  groupEdit.y = Math.max(64, Math.min(stage.h - 150, sy))
  invalidate()
}
function saveGroupEdit() {
  if (groupEdit.id) props.ws.renameGroup(groupEdit.id, groupEdit.name)
  groupEdit.open = false
  invalidate()
}
// 选中卡片右下角的缩放手柄（DOM 卡片盖住了画布角点，这里补一个真实手柄）
function onCardResize(e, n) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const sp = screenPoint(e)
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
  pointers.set(e.pointerId, { x: sp.x, y: sp.y })
  startResize(n, 'se', sp)
  invalidate()
}

// ---------- 平移 / 缩放 ----------
function startPan(e, sp) {
  drag.mode = 'pan'
  drag.sx = sp.x; drag.sy = sp.y
  drag.startCam = { x: props.ws.space.camera.x, y: props.ws.space.camera.y, s: props.ws.space.camera.s }
  if (root.value) root.value.classList.add('is-panning')
}
function onWheel(e) {
  if (newMenu.open) newMenu.open = false
  const sp = screenPoint(e)
  const c = props.ws.space.camera
  const world = toWorld(sp.x, sp.y)
  const hit = props.ws.hitTest(world.x, world.y)
  const stackNode = hit && hit.type === 'node' && hit.data.stackId ? hit.data : null
  // 堆叠卡片上滚轮 = 翻页（下一张 / 上一张翻到顶），不缩放
  if (stackNode && !e.ctrlKey && !e.metaKey && !e.shiftKey && Math.abs(e.deltaY) > 0) {
    e.preventDefault()
    const dir = e.deltaY > 0 ? 1 : -1
    props.ws.rotateStack(stackNode.stackId, dir)
    paging.value = true
    clearTimeout(pagingTimer)
    pagingTimer = setTimeout(() => { paging.value = false }, 220)
    props.ui.tick++
    invalidate()
    return
  }
  e.preventDefault()
  if (e.shiftKey) {
    const k = 1 / c.s
    c.x += (e.deltaY || e.deltaX) * k
  } else {
    // 空白处滚轮直接缩放（Ctrl 仍可用，兼容旧习惯）
    const factor = Math.exp(-e.deltaY * 0.0016)
    const next = zoomAt(c, factor, sp.x, sp.y, stage.w, stage.h)
    c.x = next.x; c.y = next.y; c.s = next.s
  }
  invalidate()
  props.ui.tick++
  props.ws.saveDebounced()
}
function startPinch() {
  const pts = Array.from(pointers.values())
  pinch = {
    dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    cam: { ...props.ws.space.camera }
  }
  drag.mode = 'none'
}
function updatePinch() {
  const pts = Array.from(pointers.values())
  if (pts.length < 2 || !pinch) return
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
  const c = props.ws.space.camera
  const factor = dist / (pinch.dist || 1)
  const next = zoomAt({ ...pinch.cam }, factor, pinch.mid.x, pinch.mid.y, stage.w, stage.h)
  c.s = next.s
  c.x = next.x - (mid.x - pinch.mid.x) / c.s
  c.y = next.y - (mid.y - pinch.mid.y) / c.s
  invalidate(); props.ui.tick++
}

function zoomBy(factor) {
  const c = props.ws.space.camera
  const next = zoomAt(c, factor, stage.w / 2, stage.h / 2, stage.w, stage.h)
  animateCameraLocal({ x: next.x, y: next.y, s: next.s }, 180)
}
function animateCameraLocal(target, dur = 320) {
  const c = props.ws.space.camera
  animateCamera(c, target, dur, () => { invalidate(); props.ui.tick++ })
}
function fitView() {
  const b = props.ws.contentBounds()
  if (!b) return
  // 非对称安全区：避开顶栏、左下缩放条与右侧属性面板，避免「适应全部」后内容压在 UI 上
  const padL = 72
  const padR = props.ui.inspector && stage.w >= 1100 ? 336 : 72
  const padT = 96
  const padB = 112
  const availW = Math.max(160, stage.w - padL - padR)
  const availH = Math.max(160, stage.h - padT - padB)
  let s = clampScale(Math.min(availW / Math.max(1, b.w), availH / Math.max(1, b.h)))
  // 竖屏：整板宽度远大于视口，强行「适应全部」只能缩到 12%（卡片变方块），
  // 抬到 0.45 又会把左右卡片齐刷刷裁掉。首屏改为聚焦主视觉卡，其余靠单指平移浏览。
  if (stage.w < 720) {
    const list = (props.ws.nodes || []).filter((n) => n.spaceId === props.ws.currentId && !n.deletedAt && n.kind !== 'space')
    const main = list.slice().sort((a, c) => (c.w * c.h) - (a.w * a.h))[0]
    if (main) {
      const fs = clampScale(Math.max(0.32, Math.min((stage.w - 32) / Math.max(1, main.w), 0.62)))
      animateCameraLocal({ s: fs, x: main.x + main.w / 2, y: main.y + main.h / 2 }, 380)
      return
    }
    s = Math.max(s, 0.45)
  }
  const cx = padL + availW / 2
  const cy = padT + availH / 2
  animateCameraLocal({
    s,
    x: b.x + b.w / 2 - (cx - stage.w / 2) / s,
    y: b.y + b.h / 2 - (cy - stage.h / 2) / s
  }, 380)
}
function resetView() {
  animateCameraLocal({ x: 0, y: 0, s: 1 }, 320)
}
function focusOnNode(id) {
  const n = props.ws.nodeById(id)
  if (!n) return
  animateCameraLocal({ x: n.x + n.w / 2, y: n.y + n.h / 2, s: Math.max(props.ws.space.camera.s, 0.85) }, 320)
}

// ---------- 选择 ----------
function selectOnly(id) {
  props.ui.selection = [id]
  props.ui.activeGroup = null
  const n = props.ws.nodeById(id)
  if (n && n.groupId) props.ui.activeGroup = n.groupId
  emit('selection-change', props.ui.selection)
  invalidate()
}
function toggleSelect(id) {
  const arr = props.ui.selection.slice()
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(id)
  props.ui.selection = arr
  const n = props.ws.nodeById(id)
  props.ui.activeGroup = arr.length && n && n.groupId ? n.groupId : null
  emit('selection-change', arr)
  invalidate()
}
function clearSelection() {
  props.ui.selection = []
  props.ui.activeGroup = null
  emit('selection-change', [])
  invalidate()
}
function startMarquee(p) {
  drag.mode = 'marquee'
  drag.startWorld = p
  drag.sx = (p.x - props.ws.space.camera.x) * props.ws.space.camera.s + stage.w / 2
  drag.sy = (p.y - props.ws.space.camera.y) * props.ws.space.camera.s + stage.h / 2
  drag.moved = false
  drag.marquee = { x: p.x, y: p.y, w: 0, h: 0 }
}
function finishMarquee(additive) {
  const m = drag.marquee
  if (!m || !drag.moved) { drag.marquee = null; invalidate(); return }
  const hits = props.ws.query(m)
    .filter((h) => !(h.x + h.w < m.x || h.x > m.x + m.w || h.y + h.h < m.y || h.y > m.y + m.h))
    .map((h) => h.id)
  if (additive) {
    const set = new Set(props.ui.selection.concat(hits))
    props.ui.selection = Array.from(set)
  } else {
    props.ui.selection = hits
  }
  emit('selection-change', props.ui.selection)
  props.ui.activeGroup = null
  drag.marquee = null
  invalidate()
}

// ---------- 移动 / 缩放 ----------
function startMove(p, node) {
  resetStackHover()
  drag.mode = 'move'
  drag.moved = false
  drag.historyReady = false
  drag.sx = (p.x - props.ws.space.camera.x) * props.ws.space.camera.s + stage.w / 2
  drag.sy = (p.y - props.ws.space.camera.y) * props.ws.space.camera.s + stage.h / 2
  drag.startNodes = props.ui.selection.map((id) => props.ws.nodeById(id)).filter(Boolean).map((n) => ({ id: n.id, x: n.x, y: n.y }))
  drag.startDraws = props.ui.selection.map((id) => props.ws.drawingById(id)).filter(Boolean).map((d) => ({
    id: d.id,
    pts: d.pts ? d.pts.map((q) => [q[0], q[1]]) : null,
    x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2
  }))
  const ns = props.ui.selection.map((id) => props.ws.nodeById(id)).filter(Boolean)
  if (ns.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    ns.forEach((n) => {
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y)
      x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h)
    })
    drag.startBounds = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
}
function ensureHistory() {
  if (drag.historyReady) return
  drag.historyReady = true
  props.ws.pushUndo()
}
// 拖动组：选中全部成员一起移动，并把组框本身同步位移
function startGroupMove(p, g) {
  const ids = (g.nodeIds || []).filter((id) => !!props.ws.nodeById(id))
  props.ui.selection = ids
  props.ui.activeGroup = g.id
  emit('selection-change', ids)
  startMove(p, null)
  drag.groupId = g.id
  drag.groupStart = props.ws.groupRect(g.id)
  invalidate()
}
// 拖动结束：跨空间投放 / 组收纳（拖入、拖出）
function settleMoveDrop(p) {
  const ids = drag.startNodes.map((s) => s.id)
  if (!ids.length) return
  // 1) 投到空间卡上 → 整批移入该空间
  const spNode = spaceNodeForDrop(p, ids)
  if (spNode) {
    const mv = ids.filter((id) => {
      const n = props.ws.nodeById(id)
      return n && n.kind !== 'space'
    })
    const moved = mv.length ? props.ws.moveNodesToSpace(mv, spNode.targetSpaceId) : 0
    if (moved) {
      const spName = (props.ws.spaces[spNode.targetSpaceId] || {}).name || '目标空间'
      props.ui.selection = []
      emit('selection-change', [])
      emit('toast', '已移入「' + spName + '」')
      props.ui.tick++
      invalidate()
      return
    }
  }
  // 2) 整组移动不改变成员归属
  if (drag.groupId) return
  // 3) 单卡 / 多选：拖出原组、拖入新组
  ids.forEach((id) => {
    const n = props.ws.nodeById(id)
    if (!n) return
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    const from = n.groupId
    if (from) {
      const r = props.ws.groupRect(from)
      const inside = r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
      if (!inside) props.ws.removeFromGroup(id)
    }
    if (!n.groupId) {
      const g = groupAtPoint({ x: cx, y: cy }, from)
      if (g) props.ws.addToGroup(g.id, id)
    }
  })
}
function applyMove(dx, dy) {
  drag.startNodes.forEach((s) => {
    const n = props.ws.nodeById(s.id)
    if (n) { n.x = s.x + dx; n.y = s.y + dy }
  })
  // 整组移动：组框跟随一起位移，保持成员与框的相对关系
  if (drag.groupId && drag.groupStart) {
    const g = props.ws.groups[drag.groupId]
    if (g) { g.x = drag.groupStart.x + dx; g.y = drag.groupStart.y + dy }
  }
  drag.startDraws.forEach((s) => {
    const d = props.ws.drawingById(s.id)
    if (!d) return
    if (s.pts) d.pts = s.pts.map((q) => [q[0] + dx, q[1] + dy])
    d.x1 = s.x1 + dx; d.y1 = s.y1 + dy; d.x2 = s.x2 + dx; d.y2 = s.y2 + dy
    props.ws.recomputeDrawingBounds(d)
  })
}
// 对齐吸附：先网格，再与其他元素的边/中线对齐（阈值 6px 屏幕）
function computeSnap(dx, dy) {
  const guides = []
  const c = props.ws.space.camera
  const grid = props.ws.settings.gridSize || 10
  if (props.ws.settings.snap && drag.startBounds && drag.startNodes.length === 1) {
    const s = drag.startNodes[0]
    const nx = Math.round((s.x + dx) / grid) * grid
    const ny = Math.round((s.y + dy) / grid) * grid
    dx = nx - s.x
    dy = ny - s.y
  }
  if (!props.ws.settings.guides || !drag.startBounds) { props.ui.guides = guides; return { dx, dy } }
  const b = {
    x: drag.startBounds.x + dx,
    y: drag.startBounds.y + dy,
    w: drag.startBounds.w,
    h: drag.startBounds.h
  }
  const sel = new Set(props.ui.selection)
  const others = props.ws.nodes.filter((n) => n.spaceId === props.ws.currentId && !sel.has(n.id))
  const tol = Math.max(2, 6 / c.s)
  const vLines = []
  const hLines = []
  const myV = [b.x, b.x + b.w / 2, b.x + b.w]
  const myH = [b.y, b.y + b.h / 2, b.y + b.h]
  others.forEach((n) => {
    const v = [n.x, n.x + n.w / 2, n.x + n.w]
    const h = [n.y, n.y + n.h / 2, n.y + n.h]
    v.forEach((vx) => myV.forEach((mx, i) => {
      if (Math.abs(vx - mx) <= tol) vLines.push({ v: vx, delta: vx - mx, rank: i })
    }))
    h.forEach((hy) => myH.forEach((my, i) => {
      if (Math.abs(hy - my) <= tol) hLines.push({ h: hy, delta: hy - my, rank: i })
    }))
  })
  if (vLines.length) {
    const best = vLines.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]
    dx += best.delta
    const uniq = Array.from(new Set(vLines.map((x) => x.v))).slice(0, 4)
    uniq.forEach((v) => guides.push({ v }))
  }
  if (hLines.length) {
    const best = hLines.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]
    dy += best.delta
    const uniq = Array.from(new Set(hLines.map((x) => x.h))).slice(0, 4)
    uniq.forEach((h) => guides.push({ h }))
  }
  props.ui.guides = guides
  return { dx, dy }
}
function startResize(node, corner, sp) {
  drag.mode = 'resize'
  drag.moved = false
  drag.historyReady = false
  drag.sx = sp.x; drag.sy = sp.y
  drag.resize = { node, corner, initial: { x: node.x, y: node.y, w: node.w, h: node.h } }
}

function handleAt(p) {
  if (props.ui.selection.length !== 1) return null
  const n = props.ws.nodeById(props.ui.selection[0])
  if (!n) return null
  const c = props.ws.space.camera
  const tol = 10 / c.s
  const corners = [
    { type: 'resize', corner: 'nw', x: n.x, y: n.y },
    { type: 'resize', corner: 'ne', x: n.x + n.w, y: n.y },
    { type: 'resize', corner: 'sw', x: n.x, y: n.y + n.h },
    { type: 'resize', corner: 'se', x: n.x + n.w, y: n.y + n.h }
  ]
  const sides = [
    { type: 'connect', side: 'top', x: n.x + n.w / 2, y: n.y },
    { type: 'connect', side: 'bottom', x: n.x + n.w / 2, y: n.y + n.h },
    { type: 'connect', side: 'left', x: n.x, y: n.y + n.h / 2 },
    { type: 'connect', side: 'right', x: n.x + n.w, y: n.y + n.h / 2 }
  ]
  // 连线点优先（半径更大，避免和角点抢）
  for (const h of sides) if (Math.hypot(p.x - h.x, p.y - h.y) <= tol) return h
  for (const h of corners) if (Math.hypot(p.x - h.x, p.y - h.y) <= tol) return h
  return null
}

// ---------- 连线 ----------
function startConnect(node, side) {
  drag.mode = 'connect'
  drag.connect = { fromId: node.id, side }
  tempEdge.fromId = node.id
  tempEdge.x = node.x + node.w / 2
  tempEdge.y = node.y + node.h / 2
  invalidate()
}
function finishConnect(p) {
  if (!drag.connect) return
  const hit = props.ws.hitTest(p.x, p.y)
  if (hit && hit.type === 'node' && hit.data.id !== drag.connect.fromId) {
    const e = props.ws.connect(drag.connect.fromId, hit.data.id, props.ws.settings.edgeStyle)
    if (e) emit('toast', '已创建连线')
  }
  drag.connect = null
}

// ---------- 绘画 ----------
function isDrawTool(t) {
  return ['ballpoint', 'fountain', 'pencil', 'highlighter', 'laser', 'line', 'rect', 'circle', 'scalpel'].includes(t)
}
function startDraw(p) {
  drag.mode = 'draw'
  drag.moved = false
  drag.historyReady = false
  const st = props.ui.stroke
  const freehand = ['ballpoint', 'fountain', 'pencil', 'highlighter', 'laser'].includes(props.ui.tool)
  preview.value = {
    id: '__preview', tool: props.ui.tool, color: st.color, width: st.width,
    opacity: st.opacity, dash: st.dash, smooth: st.smooth,
    pts: freehand ? [[p.x, p.y]] : [], x1: p.x, y1: p.y, x2: p.x, y2: p.y
  }
  invalidate()
}
function updateDraw(p) {
  const d = preview.value
  if (!d) return
  const isFreehand = ['ballpoint', 'fountain', 'pencil', 'highlighter', 'laser'].includes(d.tool)
  if (isFreehand) {
    const last = d.pts[d.pts.length - 1]
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.2) d.pts.push([p.x, p.y])
  } else {
    d.x2 = p.x; d.y2 = p.y
  }
  drag.moved = true
  invalidate()
}
function finishDraw() {
  const d = preview.value
  lastDrawAt = Date.now()
  preview.value = null
  if (!d || !drag.moved) { drag.mode = 'none'; invalidate(); return }
  const freehand = ['ballpoint', 'fountain', 'pencil', 'highlighter', 'laser'].includes(d.tool)
  let out = Object.assign({}, d)
  if (props.ui.recognize && ['ballpoint', 'fountain', 'pencil'].includes(d.tool)) {
    const shape = recognizeStroke(d.pts)
    if (shape) {
      if (shape.type === 'line') {
        out = Object.assign({}, d, { tool: 'line', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, pts: [] })
      } else if (shape.type === 'rect') {
        out = Object.assign({}, d, { tool: 'rect', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, pts: [] })
      } else if (shape.type === 'circle') {
        out = Object.assign({}, d, { tool: 'circle', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, pts: [] })
      } else if (shape.type === 'triangle') {
        out = Object.assign({}, d, { tool: 'triangle', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, pts: [] })
      } else if (shape.type === 'star') {
        out = Object.assign({}, d, { tool: 'star', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, pts: [] })
      }
    }
  }
  // 合并模式：把这一笔并入当前选中的绘画（同工具）
  if (props.ui.mergeMode && out.pts && out.pts.length) {
    const sel = props.ui.selection.map((id) => props.ws.drawingById(id)).find((x) => x && x.tool === out.tool)
    if (sel) {
      props.ws.pushUndo()
      sel.pts = (sel.pts || []).concat(out.pts)
      props.ws.recomputeDrawingBounds(sel)
      props.ws.updateDrawing(sel.id, {})
      drag.mode = 'none'
      return
    }
  }
  props.ws.pushUndo()
  const created = props.ws.addDrawing(Object.assign(out, { id: undefined, spaceId: props.ws.currentId, pts: out.pts }))
  if (out.tool === 'laser') {
    const id = created.id
    setTimeout(() => {
      props.ws.drawings = props.ws.drawings.filter((x) => x.id !== id)
      props.ws.rebuildIndex()
      props.ws.touch('laser:clear')
      if (props.ui.selection.includes(id)) {
        props.ui.selection = []
        emit('selection-change', [])
      }
    }, 1600)
  }
  props.ui.selection = [created.id]
  emit('selection-change', props.ui.selection)
  drag.mode = 'none'
}
function startErase(p) {
  drag.mode = 'erase'
  eraseStart = true
  props.ws.pushUndo()
  eraseAt(p)
}
function eraseAt(p) {
  const tol = 9 / props.ws.space.camera.s
  const victims = props.ws.drawingsInSpace.filter((d) => {
    if (!d.w) return false
    if (p.x < d.x - tol || p.x > d.x + d.w + tol || p.y < d.y - tol || p.y > d.y + d.h + tol) return false
    if (d.pts && d.pts.length) {
      for (let i = 0; i < d.pts.length - 1; i++) {
        const [ax, ay] = d.pts[i], [bx, by] = d.pts[i + 1]
        if (distToSeg(p, ax, ay, bx, by) < tol) return true
      }
      return false
    }
    return true
  }).map((d) => d.id)
  if (victims.length) {
    props.ws.deleteDrawings(victims)
    props.ui.selection = props.ui.selection.filter((id) => !victims.includes(id))
    invalidate()
  }
}
function distToSeg(p, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy || 1
  let t = ((p.x - ax) * dx + (p.y - ay) * dy) / L
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
}

// ---------- 双击 / 右键 ----------
function onDoubleClick(e) {
  // 刚结束一笔绘画时的双击视为误触，不新建节点
  if (Date.now() - lastDrawAt < 350) return
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  const hit = props.ws.hitTest(p.x, p.y)
  if (hit && hit.type === 'node') {
    const n = hit.data
    if (n.kind === 'space' && n.targetSpaceId) { emit('space-enter', n.targetSpaceId); return }
    if (n.kind === 'image' || n.kind === 'video') { emit('open-media', n); return }
    if (DOM_KINDS.includes(n.kind)) return
    openEditor(n.id)
    return
  }
  // 空白双击：弹出类型选择浮层（鼠标优先，不要求长按/快捷组合键）
  if (props.ui.tool === 'select') {
    newMenu.open = true
    newMenu.wx = Math.round(p.x)
    newMenu.wy = Math.round(p.y)
    newMenu.sx = Math.max(12, Math.min(stage.w - 300, sp.x + 8))
    newMenu.sy = Math.max(64, Math.min(stage.h - 340, sp.y + 8))
  }
}
function createCardFromMenu(key) {
  // 「笔记」先下钻：菜单不关，切到 文档卡 / 便利贴 两个选项
  if (key === '__notes') { MENU_SUB.value = 'notes'; return }
  const wx = newMenu.wx
  const wy = newMenu.wy
  newMenu.open = false
  MENU_SUB.value = null
  const def = [...FOLDER_TYPES.value, ...SINGLE_TYPES.value, ...NOTE_SUB_TYPES].find((c) => c.key === key)
  if (!def) return
  // 空间：新建子空间并落一张空间卡
  if (def.type === 'space') {
    const r = props.ws.createSpace('新空间', props.ws.currentId, { position: { x: wx, y: wy } })
    if (r && r.card) selectOnly(r.card.id)
    invalidate()
    emit('toast', '已新建空间，双击空间卡进入')
    return
  }
  // 组：画布上放一个空的虚线分类容器
  if (def.type === 'group') {
    const g = props.ws.createGroupAt(wx, wy, def.w || 300, def.h || 220)
    props.ui.selection = []
    props.ui.activeGroup = g ? g.id : null
    emit('selection-change', [])
    invalidate()
    emit('toast', '已新建组：把卡片拖进虚线框即可收纳，拖框可整组移动')
    return
  }
  props.ws.pushUndo()
  let node
  if (def.type === 'panel') {
    node = props.ws.addNode({
      spaceId: props.ws.currentId,
      kind: 'panel',
      panelKind: key,
      title: def.label,
      x: wx, y: wy,
      w: def.w || 368,
      h: def.h || 208,
      color: PANEL_COLORS[key] || '#E8B86D'
    })
  } else if (def.type === 'memo') {
    node = props.ws.addNode({
      spaceId: props.ws.currentId,
      kind: 'memo',
      title: '便利贴',
      text: '双击编辑内容',
      x: wx, y: wy, w: def.w || 248, h: def.h || 160,
      color: '#F2C74F'
    })
  } else {
    node = props.ws.addNode({
      spaceId: props.ws.currentId,
      kind: 'card',
      cardKind: key,
      title: def.label,
      x: wx, y: wy,
      w: def.w || 260,
      h: def.h || 180,
      color: def.color || null,
      cardData: defaultCardData(key)
    })
  }
  if (!node) return
  // 新节点必须重建索引，否则不在四叉树里、当前帧不会绘制
  props.ws.rebuildIndex()
  props.ws.touch('card:new')
  selectOnly(node.id)
  invalidate()
  if (def.type === 'memo') nextTick(() => openEditor(node.id))
}
function onContextMenu(e) {
  e.preventDefault()
  const sp = screenPoint(e)
  const p = toWorld(sp.x, sp.y)
  const hit = props.ws.hitTest(p.x, p.y)
  if (hit) {
    if (!props.ui.selection.includes(hit.data.id)) {
      props.ui.selection = [hit.data.id]
      emit('selection-change', props.ui.selection)
    }
    const isNode = hit.type === 'node'
    const n = isNode ? hit.data : null
    const isData = isNode && DOM_KINDS.includes(n.kind)
    const items = []
    if (isNode) {
      if (!isData) items.push({ label: '编辑内容', icon: 'edit', action: () => openEditor(n.id) })
      if (n.kind === 'space' && n.targetSpaceId) items.push({ label: '进入空间', icon: 'folder', action: () => emit('space-enter', n.targetSpaceId) })
      if (n.kind === 'space') items.push({ label: '整理内部卡片', icon: 'layers', action: () => tidySpace(n) })
      if (n.kind !== 'space') items.push({ label: 'AI 总结', icon: 'sparkles', action: () => emit('ai-summary', n.id) })
      if (!isData) {
        items.push({ label: '添加子节点 (Tab)', icon: 'branch', action: () => { const c = props.ws.addChildNode(n.id); if (c) { selectOnly(c.id); nextTick(() => openEditor(c.id)) } } })
        items.push({ label: '添加同级 (Enter)', icon: 'plus', action: () => { const c = props.ws.addSiblingNode(n.id); if (c) selectOnly(c.id) } })
      }
      if (isData && n.stackId) items.push({ label: '解散堆叠', icon: 'layers', action: () => { props.ws.unstack(n.stackId); invalidate() } })
      if (n.groupId && props.ws.groups[n.groupId]) {
        const gid = n.groupId
        items.push({ label: '移出组', icon: 'close', action: () => { props.ws.removeFromGroup(n.id); invalidate() } })
        items.push({ label: '重命名组', icon: 'edit', action: () => openGroupEdit(gid, sp.x, sp.y) })
        items.push({ label: '解散组', icon: 'trash', action: () => { props.ws.ungroup(gid); if (props.ui.activeGroup === gid) props.ui.activeGroup = null; invalidate() } })
      }
      const hasEdges = (props.ws.edges || []).some((x) => x.fromId === n.id || x.toId === n.id)
      if (hasEdges) {
        const anyCollapsed = props.ws.nodes.some((x) => x.folderCollapsed)
        items.push({
          label: anyCollapsed ? '展开连接卡片' : '收起连接卡片（文件夹）',
          icon: 'layers',
          action: () => { if (anyCollapsed) props.ws.expandConnected(n.id); else props.ws.collapseConnected(n.id); invalidate() }
        })
      }
      items.push({ label: '复制 (Ctrl+C)', icon: 'copy', action: () => copyCtx(n) })
      items.push({ label: '粘贴到此处 (Ctrl+V)', icon: 'copy', action: () => pasteHere(p.x, p.y) })
      // 关联连线（biLinks 派生）可在此断开：两端同步消失；纯装饰连线不在此列
      const relEdges = (props.ws.edges || []).filter((x) => (x.fromId === n.id || x.toId === n.id) && x.source === 'relation')
      relEdges.forEach((edge) => {
        const oid = edge.fromId === n.id ? edge.toId : edge.fromId
        const other = props.ws.nodeById(oid)
        const label = other && (other.title || other.text) ? String(other.title || other.text).slice(0, 12) : '关联卡片'
        items.push({
          label: '断开与「' + label + '」的连线', icon: 'close', danger: true,
          action: () => { unlinkEdge(props.ws, store, edge.id); invalidate() }
        })
      })
      items.push({ divider: true })
    } else {
      items.push({ label: '粘贴到此处 (Ctrl+V)', icon: 'copy', action: () => pasteHere(p.x, p.y) })
    }
    items.push(
      { label: '上移一层', icon: 'arrowup', action: () => props.ws.reorder(hit.data.id, 'up') },
      { label: '下移一层', icon: 'arrowdown', action: () => props.ws.reorder(hit.data.id, 'down') },
      { label: '置于顶层', icon: 'layers', action: () => props.ws.reorder(hit.data.id, 'front') },
      { label: '置于底层', icon: 'layers', action: () => props.ws.reorder(hit.data.id, 'back') },
      { divider: true },
      { label: '删除', icon: 'trash', danger: true, action: () => { if (isNode) props.ws.deleteNodes([n.id]); else props.ws.deleteDrawings([hit.data.id]); clearSelection() } }
    )
    ctxMenu.items = items
  } else {
    const g = groupAtPoint(p)
    ctxMenu.items = g
      ? [
        { label: '重命名组', icon: 'edit', action: () => openGroupEdit(g.id, sp.x, sp.y) },
        { label: '解散组', icon: 'trash', action: () => { props.ws.ungroup(g.id); props.ui.activeGroup = null; invalidate() } },
        { divider: true },
        { label: '新建子空间', icon: 'folder', action: () => emit('space-new') },
        { label: '适应全部内容', icon: 'frame', action: fitView },
        { label: '重置视口', icon: 'reset', action: resetView }
      ]
      : [
        { label: '新建节点', icon: 'plus', action: () => { props.ws.pushUndo(); const n = props.ws.addNode({ x: p.x, y: p.y, title: '新节点', body: '' }); selectOnly(n.id); nextTick(() => openEditor(n.id)) } },
        { label: '新建子空间', icon: 'folder', action: () => emit('space-new') },
        { label: '粘贴到此处 (Ctrl+V)', icon: 'copy', action: () => pasteHere(p.x, p.y) },
        { divider: true },
        // 3.0 一键整理：本空间按类型分列整理 / 跨空间统一整理（主页版式保留）
        { label: '一键整理本空间卡片', icon: 'layout', action: () => emit('tidy-current') },
        { label: '一键整理全部空间', icon: 'layers', action: () => emit('tidy-all') },
        { divider: true },
        { label: '适应全部内容', icon: 'frame', action: fitView },
        { label: '重置视口', icon: 'reset', action: resetView },
        { label: '切换背景图案', icon: 'grid', action: () => { const arr = ['dots', 'grid', 'lines', 'none']; const cur = props.ws.settings.background.pattern; props.ws.settings.background.pattern = arr[(arr.indexOf(cur) + 1) % arr.length]; props.ws.touch('bg') } }
      ]
  }
  ctxMenu.open = true
  ctxMenu.x = Math.min(sp.x, stage.w - 220)
  ctxMenu.y = Math.min(sp.y, stage.h - 280)
  ctxMenu.target = hit ? hit.data.id : null
}
function closeCtxMenu() { ctxMenu.open = false }
function runCtxItem(it) {
  if (it.divider) return
  closeCtxMenu()
  try { it.action && it.action() } catch (e) { console.error(e) }
}
// 右键复制：右键卡片已在选中集合内则复制整个选择，否则只复制该卡（与 Ctrl+C 共用剪贴板）
function copyCtx(n) {
  const sel = props.ui.selection.filter((id) => props.ws.nodeById(id))
  const ids = sel.includes(n.id) && sel.length > 1 ? sel : [n.id]
  props.ui.clipboard = ids.slice()
  props.ui.tick++
  emit('toast', '已复制 ' + ids.length + ' 个节点')
}
function pasteHere(x, y) {
  const ids = props.ui.clipboard || []
  if (!ids.length) { emit('toast', '剪贴板为空'); return }
  const copies = props.ws.duplicateNodes(ids, { x: 0, y: 0 })
  if (!copies.length) return
  // 让副本中心落到右键点
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  copies.forEach((n) => { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h) })
  const dx = x - (x1 + x2) / 2, dy = y - (y1 + y2) / 2
  copies.forEach((n) => { n.x += dx; n.y += dy })
  props.ui.selection = copies.map((n) => n.id)
  props.ws.rebuildIndex(); props.ws.touch('paste'); props.ws.saveDebounced(); invalidate()
  emit('toast', '已粘贴 ' + copies.length + ' 个节点')
}

// ---------- 编辑器 ----------
function openEditor(id) {
  const n = props.ws.nodeById(id)
  if (!n) return
  editor.nodeId = id
  editor.title = n.title
  // 便利贴的正文存在 text 字段，普通节点在 body
  editor.body = n.kind === 'memo' ? (n.text || '') : (n.body || '')
  // 默认进入「可视化」：直接看到排版结果，选中文字点按钮即可，不需要懂 Markdown
  editor.mode = 'visual'
  editor.open = true
  props.ui.editing = true
  nextTick(() => {
    const input = root.value && root.value.querySelector('.node-editor__title')
    if (input) input.focus()
    setVisualHtml()
  })
}
function saveEditor() {
  const n = props.ws.nodeById(editor.nodeId)
  if (!n) { closeEditor(); return }
  props.ws.pushUndo()
  // 可视化模式的正文先序列化回 Markdown，保证跨端 / 备份仍是 Markdown 文本
  const body = editor.mode === 'visual' ? visualToMarkdown() : editor.body
  const patch = { title: editor.title || '未命名节点' }
  if (n.kind === 'memo') patch.text = body
  else patch.body = body
  props.ws.updateNode(editor.nodeId, patch, { save: true })
  closeEditor()
  emit('toast', '已保存')
}
function insertMd(tool) {
  const el = editorBodyEl.value
  const body = editor.body || ''
  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : body.length
  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : body.length
  const sel = body.slice(start, end)
  let next = ''
  let caret = start
  if (tool.wrap) {
    const ph = sel || tool.placeholder || '文字'
    next = body.slice(0, start) + tool.wrap[0] + ph + tool.wrap[1] + body.slice(end)
    caret = start + tool.wrap[0].length
  } else {
    // 行首前缀（标题 / 列表 / 引用 / 待办）
    const lineStart = body.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    next = body.slice(0, lineStart) + tool.prefix + body.slice(lineStart)
    caret = start + tool.prefix.length
  }
  editor.body = next
  nextTick(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(caret, caret + (tool.wrap ? (sel || tool.placeholder || '文字').length : 0))
  })
}
function closeEditor() {
  editor.open = false
  props.ui.editing = false
  invalidate()
}
function deleteEditorNode() {
  const id = editor.nodeId
  closeEditor()
  props.ws.deleteNodes([id])
  clearSelection()
}
function onEditorKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeEditor() }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEditor() }
}
function closeEditorOnBlur(e) {
  if (!editor.open) return
  const t = e.target
  if (t && root.value && root.value.querySelector('.node-editor') && root.value.querySelector('.node-editor').contains(t)) return
  // 点画布其它地方视为取消
  if (e.target === canvasEl.value) closeEditor()
}
function mdToHtml(md) {
  try { return parse(md || '', { breaks: true }) } catch (e) { return '' }
}
// 切换「可视化 / 源码」：两边都以 Markdown 为唯一真源，切换时做一次双向转换
function setEditorMode(mode) {
  if (mode === editor.mode) return
  if (editor.mode === 'visual') editor.body = visualToMarkdown()
  editor.mode = mode
  if (mode === 'visual') nextTick(() => setVisualHtml())
}
function setVisualHtml() {
  const el = visualEl.value
  if (!el) return
  el.innerHTML = mdToHtml(editor.body)
}
function onVisualInput() {
  const el = visualEl.value
  if (el) editor.body = visualToMarkdown()
}
// 可视化工具条：基于浏览器原生 execCommand，选区保留在 contenteditable 内
function applyVisual(key) {
  const el = visualEl.value
  if (!el) return
  el.focus()
  try {
    if (key === 'link') {
      const url = window.prompt('链接地址（https://…）')
      if (url) document.execCommand('createLink', false, url)
    } else if (key === 'image') {
      const url = window.prompt('图片地址（https://…）')
      if (url) document.execCommand('insertImage', false, url)
    } else if (key === 'h') {
      document.execCommand('formatBlock', false, '<h3>')
    } else if (key === 'quote') {
      document.execCommand('formatBlock', false, '<blockquote>')
    } else if (key === 'list') {
      document.execCommand('insertUnorderedList', false, null)
    } else if (key === 'clear') {
      document.execCommand('removeFormat', false, null)
    } else {
      document.execCommand(key, false, null)
    }
  } catch (e) { /* 老浏览器不支持命令时静默忽略 */ }
  onVisualInput()
}
// HTML → Markdown：只覆盖可视化编辑器能产生的结构，其他标签按纯文本展开
function serializeMdNode(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, ' ')
  if (node.nodeType !== 1) return ''
  const tag = node.tagName.toLowerCase()
  const inner = () => Array.from(node.childNodes).map(serializeMdNode).join('')
  const compact = () => inner().replace(/\s+/g, ' ').trim()
  switch (tag) {
    case 'br': return '\n'
    case 'strong': case 'b': { const s = compact(); return s ? '**' + s + '**' : '' }
    case 'em': case 'i': { const s = compact(); return s ? '*' + s + '*' : '' }
    case 'del': case 's': case 'strike': { const s = compact(); return s ? '~~' + s + '~~' : '' }
    case 'code': return '`' + inner().replace(/\u00a0/g, ' ') + '`'
    case 'a': {
      const href = node.getAttribute('href') || ''
      const text = compact() || href
      return href ? '[' + text + '](' + href + ')' : text
    }
    case 'img': return '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')'
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return '#'.repeat(Number(tag[1])) + ' ' + compact() + '\n\n'
    case 'blockquote':
      return inner().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n'
    case 'ul': case 'ol': {
      const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === 'li')
      return items.map((li, i) => {
        const prefix = tag === 'ol' ? (i + 1) + '. ' : '- '
        return prefix + Array.from(li.childNodes).map(serializeMdNode).join('').trim()
      }).join('\n') + '\n\n'
    }
    case 'pre': return '```\n' + inner().replace(/\n+$/, '') + '\n```\n\n'
    case 'hr': return '\n---\n\n'
    case 'p': case 'div': {
      const s = inner().trim()
      return s ? s + '\n\n' : ''
    }
    default: return inner()
  }
}
function visualToMarkdown() {
  const el = visualEl.value
  if (!el) return editor.body
  const md = Array.from(el.childNodes).map(serializeMdNode).join('')
  return md.replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- 样式小工具 ----------
function updateCursor(handle) {
  if (!root.value) return
  if (props.ui.tool === 'eraser' || isDrawTool(props.ui.tool)) { root.value.style.cursor = 'crosshair'; return }
  if (handle) {
    if (handle.type === 'connect') root.value.style.cursor = 'crosshair'
    else if (handle.corner === 'nw' || handle.corner === 'se') root.value.style.cursor = 'nwse-resize'
    else root.value.style.cursor = 'nesw-resize'
    return
  }
  const h = props.ui.hoverId
  root.value.style.cursor = h ? 'move' : 'default'
}
function setCursorDefault() {
  if (root.value) root.value.style.cursor = 'default'
}

function resetForSpace() {
  editor.open = false
  props.ui.editing = false
  drag.mode = 'none'
  preview.value = null
  props.ui.selection = []
  props.ui.hoverId = null
  props.ui.guides = []
  props.ui.activeGroup = null
  setSize()
  invalidate()
}

defineExpose({ openEditor, fitView, resetView, focusOnNode, invalidate, zoomBy, resetForSpace, getStage: () => stage })
watch(() => props.ui.tick, () => {
  invalidate()
})
watch(() => props.ws.currentId, () => {
  editor.open = false
  props.ui.editing = false
  drag.mode = 'none'
  preview.value = null
  props.ui.hoverId = null
  props.ui.selection = []
  props.ui.guides = []
  setSize(); invalidate()
})
watch(() => props.ws.settings.background, () => invalidate(), { deep: true })
</script>

<template>
  <div ref="root" class="space-stage" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
    @pointercancel="onPointerCancel" @pointerleave="onPointerLeave" @wheel="onWheel" @dblclick="onDoubleClick" @contextmenu.prevent.stop="onContextMenu">
    <canvas ref="canvasEl" class="space-canvas"></canvas>

    <!-- 数据卡片真实 DOM 叠层：随相机整体变换，任意缩放都保持真卡渲染 -->
    <div ref="cardLayer" class="sp-card-layer" :class="{ passive: ui.tool !== 'select', paging, 'stack-anim': stackAnim }">
      <div v-for="n in domNodes" :key="n.id" class="sp-dom-card"
        :class="['kind-' + (n.panelKind || n.cardKind || n.kind), { selected: selectedIds.has(n.id), hovered: ui.hoverId === n.id, stacked: (n.stackIdx || 0) > 0, 'sp-folder-collapsed': n.folderCollapsed, pressing: pressingId === n.id, 'link-source': linkSourceId === n.id, 'stack-target': stackTargetId === n.id }]"
        :title="n.panelKind === 'map' ? '拖动整张地图卡；点右上角锁按钮后由地图接管拖动' : ''"
        :style="cardStyle(n)" @pointerdown="onCardPointerDown($event, n)" @dblclick.stop.prevent="onCardDblClick($event, n)">
        <CanvasPanelNode v-if="n.kind === 'panel'" :kind="n.panelKind" />
        <CanvasCardBody v-else-if="n.kind === 'card'" :node="n" :rev="cardRev[n.id] || 0" @patch="patchCard(n, $event)" />
        <template v-else>
          <div class="sp-note-text">{{ n.text }}</div>
          <div class="sp-note-fold"></div>
        </template>
        <button v-if="entityOf(n)" class="sp-rel-badge" :title="'绑定实体 · ' + relCount(n) + ' 条关联（点击预览）'"
          @pointerdown.stop @click.stop="openBoundEntity(n)">⇄ {{ relCount(n) }}</button>
        <button v-if="n.folderCollapsed" class="sp-folder-open" title="展开预览" @pointerdown.stop @click.stop="openFolderPreview(n)">展开预览</button>
        <div v-if="selectedIds.has(n.id)" class="sp-resize-grip" title="拖动缩放卡片"
          @pointerdown.stop="onCardResize($event, n)" @dblclick.stop></div>
      </div>

      <!-- 空间卡 / 媒体卡 / 低缩放场景：同样给右下角缩放抓手 -->
      <div v-for="h in overlayHandles" :key="'og-' + h.node.id" class="sp-handle-ov"
        :style="{ left: h.node.x + 'px', top: h.node.y + 'px', width: h.node.w + 'px', height: h.node.h + 'px', zIndex: Math.round(h.node.z || 1) }">
        <div class="sp-resize-grip" title="拖动缩放卡片"
          :style="{ transform: 'scale(' + h.inv + ')', transformOrigin: '100% 100%' }"
          @pointerdown.stop="onCardResize($event, h.node)" @dblclick.stop></div>
      </div>
    </div>

    <!-- 空空间引导卡：首次进入空空间时出现，关闭后不再打扰 -->
    <div v-if="showEmptyGuide" class="empty-guide" @pointerdown.stop @wheel.stop>
      <div class="eg-head">
        <span class="eg-ico"><Icon name="sparkles" :size="16" /></span>
        <div class="eg-txt">
          <div class="eg-title">这个空间还是空的</div>
          <div class="eg-sub">新建卡片、导入媒体，或把文件夹直接拖进画布</div>
        </div>
        <button class="eg-close" title="不再显示" @click="closeEmptyGuide"><Icon name="close" :size="14" /></button>
      </div>
      <div class="eg-actions">
        <button class="eg-btn primary" @click="guideNewCard">新建卡片</button>
        <button class="eg-btn" @click="closeEmptyGuide(); emit('import-files')">导入媒体</button>
        <button class="eg-btn" @click="closeEmptyGuide(); emit('import-folder')">导入文件夹</button>
      </div>
      <div class="eg-tip">空白处双击也能新建 · 按住空格拖动可平移画布</div>
    </div>

    <!-- 卡片设置：居中二级弹窗 -->
    <Teleport to="body">
      <div v-if="cardSettings.open" class="eo-modal-scrim" @pointerdown.self="closeCardSettings" @wheel.stop>
        <div class="sp-card-settings" role="dialog" aria-label="卡片设置" @pointerdown.stop>
          <div class="sp-cs-head">
            <span>卡片设置</span>
            <button class="sp-cs-close" title="关闭" @click="closeCardSettings">×</button>
          </div>
          <label class="sp-cs-field">标题
            <input v-model="cardSettings.title" type="text" maxlength="40" />
          </label>
          <label v-if="cardSettings.cardKind === 'doc'" class="sp-cs-field">正文
            <textarea v-model="cardSettings.body" class="sp-cs-body" rows="8"
              placeholder="粘贴或输入整篇长文，卡片内可滚动阅读"></textarea>
          </label>
          <div class="sp-cs-row">
            <label class="sp-cs-field sp-cs-num">宽
              <input v-model.number="cardSettings.w" type="number" min="120" max="2400" step="10" />
            </label>
            <label class="sp-cs-field sp-cs-num">高
              <input v-model.number="cardSettings.h" type="number" min="64" max="2000" step="10" />
            </label>
          </div>
          <div class="sp-cs-label">配色</div>
          <div class="sp-cs-swatches">
            <button v-for="c in CARD_SWATCHES" :key="c" class="sp-cs-swatch" :class="{ on: cardSettings.color === c }"
              :style="{ background: c }" :title="c" @click="cardSettings.color = c"></button>
          </div>
          <div class="sp-cs-actions">
            <button class="sp-cs-cancel" @click="closeCardSettings">取消</button>
            <button class="sp-cs-apply" @click="applyCardSettings">应用</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 组改名 -->
    <div v-if="groupEdit.open" class="sp-group-edit" :style="{ left: groupEdit.x + 'px', top: groupEdit.y + 'px' }"
      @pointerdown.stop @keydown.enter.stop.prevent="saveGroupEdit">
      <div class="sp-cs-head">
        <span>重命名组</span>
        <button class="sp-cs-close" title="关闭" @click="groupEdit.open = false">×</button>
      </div>
      <label class="sp-cs-field">组名
        <input v-model="groupEdit.name" type="text" maxlength="24" placeholder="给这个组起个名字" />
      </label>
      <div class="sp-cs-actions">
        <button class="sp-cs-cancel" @click="groupEdit.open = false">取消</button>
        <button class="sp-cs-apply" @click="saveGroupEdit">保存</button>
      </div>
    </div>

    <div v-if="dropSpaceName" class="sp-drop-hint">释放放入「{{ dropSpaceName }}」</div>

    <!-- 双击空白：新建卡片类型选择 -->
    <div v-if="newMenu.open" class="sp-new-menu" :style="{ left: newMenu.sx + 'px', top: newMenu.sy + 'px' }"
      @pointerdown.stop @wheel.stop @dblclick.stop>
      <div class="sp-nm-head">
        <span>{{ MENU_SUB === 'notes' ? '笔记' : '新建' }}</span>
        <button v-if="MENU_SUB === 'notes'" class="sp-nm-back" title="返回" @click="MENU_SUB = null">← 返回</button>
        <button class="sp-nm-close" title="关闭" @click="newMenu.open = false; MENU_SUB = null">×</button>
      </div>
      <div v-if="!MENU_SUB" class="sp-nm-tabs">
        <button :class="{ on: MENU_PAGE === 'folder' }" @click="MENU_PAGE = 'folder'; MENU_SUB = null">
          <Icon name="folder" :size="13" /> 文件夹
        </button>
        <button :class="{ on: MENU_PAGE === 'single' }" @click="MENU_PAGE = 'single'; MENU_SUB = null">
          <Icon name="file" :size="13" /> 单个
        </button>
      </div>
      <div class="sp-nm-grid" :class="{ cols3: !MENU_SUB && MENU_PAGE === 'folder' }">
        <button v-for="it in menuTypes" :key="it.key" class="sp-nm-item" :title="it.desc"
          @click="createCardFromMenu(it.key)">
          <span class="sp-nm-ico"><Icon :name="it.icon || 'note'" :size="16" /></span>
          <span class="sp-nm-label">{{ it.label }}</span>
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div v-if="ctxMenu.open" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @pointerdown.stop>
      <div class="ctx-head">元素操作</div>
      <button v-for="(it, i) in ctxMenu.items" :key="i" class="ctx-item" :class="{ danger: it.danger, divider: it.divider }"
        :disabled="it.divider" @click="runCtxItem(it)">
        <template v-if="!it.divider">
          <span class="ctx-ico"><Icon :name="it.icon || 'dot'" :size="15" /></span>
          <span>{{ it.label }}</span>
        </template>
      </button>
    </div>

    <!-- 节点编辑器：居中二级弹窗 -->
    <Teleport to="body">
      <div v-if="editor.open" class="eo-modal-scrim" @pointerdown.self="closeEditor" @keydown="onEditorKey">
        <div class="node-editor" role="dialog" aria-label="编辑卡片" @pointerdown.stop>
          <div class="ne-head">
            <span class="ne-dot"></span>
            <input class="node-editor__title" v-model="editor.title" placeholder="节点标题" maxlength="80" />
            <button class="ne-close" title="关闭" @click="closeEditor"><Icon name="close" :size="15" /></button>
          </div>
          <div class="ne-tabs">
            <button class="ne-tab" :class="{ on: editor.mode === 'visual' }" @click="setEditorMode('visual')">可视化</button>
            <button class="ne-tab" :class="{ on: editor.mode === 'source' }" @click="setEditorMode('source')">Markdown 源码</button>
            <span class="ne-hint">Ctrl/⌘ + Enter 保存</span>
          </div>
          <template v-if="editor.mode === 'source'">
            <div class="ne-tools">
              <button v-for="t in MD_TOOLS" :key="t.key" class="ne-tool" @click="insertMd(t)">{{ t.label }}</button>
            </div>
            <textarea ref="editorBodyEl" class="node-editor__body" v-model="editor.body"
              placeholder="用上方工具条插入标题 / 加粗 / 列表 / 引用 / 链接 / 图片" spellcheck="false"></textarea>
          </template>
          <template v-else>
            <div class="ne-tools">
              <button v-for="t in VISUAL_TOOLS" :key="t.key" class="ne-tool" @mousedown.prevent @click="applyVisual(t.key)">{{ t.label }}</button>
            </div>
            <div ref="visualEl" class="ne-visual" contenteditable="true" spellcheck="false"
              data-placeholder="直接输入文字，选中后点上方按钮即可排版（无需懂 Markdown）" @input="onVisualInput"></div>
          </template>
          <div class="ne-foot">
            <button class="ne-btn danger-text" @click="deleteEditorNode">删除节点</button>
            <div class="ne-spacer"></div>
            <button class="ne-btn" @click="closeEditor">取消</button>
            <button class="ne-btn primary" @click="saveEditor">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <div class="stage-hint" v-if="ui.tool !== 'select' && ui.tool !== 'pan'">
      <span class="hint-label">{{ ui.tool === 'eraser' ? '橡皮擦：划过即删除笔画' : '绘画模式' }}</span>
      <span class="hint-sub">U {{ ui.recognize ? '抬笔成型 开' : '抬笔成型 关' }} · M 合并 {{ ui.mergeMode ? '开' : '关' }} · V 退出</span>
    </div>

    <div class="connect-tip" v-if="tempEdge.fromId">松手到目标节点即可连线</div>
  </div>
</template>

<style scoped>
.space-stage {
  position: absolute; inset: 0; overflow: hidden;
  touch-action: none; user-select: none;
  background: var(--sp-bg, #FAF9F6);
}
.space-canvas { position: absolute; inset: 0; display: block; }
.space-stage.is-panning { cursor: default !important; }

.ctx-menu {
  position: absolute; z-index: 40; width: 208px; padding: 6px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 14px;
  box-shadow: 0 18px 40px -18px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.06);
}
.ctx-head { font-size: 10px; font-weight: 700; letter-spacing: .12em; color: var(--sp-ink-3); padding: 6px 10px 4px; }
.ctx-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px; border-radius: 9px; text-align: left;
  font-size: 12.5px; color: var(--sp-ink); transition: background .14s ease;
}
.ctx-item:hover { background: var(--eo-chip); }
.ctx-item.danger { color: #A05A4C; }
:global([data-theme='dark'] .ctx-item.danger) { color: #E08A78; }
.ctx-item.divider { height: 1px; padding: 0; margin: 5px 8px; background: var(--sp-line); pointer-events: none; }
.ctx-ico { display: flex; width: 16px; color: var(--sp-ink-2); }
.ctx-item.danger .ctx-ico { color: #A05A4C; }
:global([data-theme='dark'] .ctx-item.danger .ctx-ico) { color: #E08A78; }

/* 空空间引导卡 */
.empty-guide {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 24; width: min(440px, calc(100% - 32px)); padding: 16px 16px 12px;
  background: var(--sp-card); border: 1px solid var(--sp-line);
  border-radius: 16px; box-shadow: 0 26px 60px -30px rgba(0,0,0,0.34);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.eg-head { display: flex; align-items: flex-start; gap: 10px; }
.eg-ico { flex: none; display: flex; color: #C99C8C; padding-top: 1px; }
.eg-txt { flex: 1; min-width: 0; }
.eg-title { font-size: 13.5px; font-weight: 700; color: var(--sp-ink); }
.eg-sub { font-size: 11.5px; line-height: 1.6; color: var(--sp-ink-2); margin-top: 4px; }
.eg-close { flex: none; width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: var(--sp-ink-3); }
.eg-close:hover { background: var(--eo-chip); color: var(--sp-ink); }
.eg-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.eg-btn {
  padding: 7px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
  color: var(--sp-ink-1); background: var(--sp-fill); border: 1px solid var(--sp-line);
}
.eg-btn:hover { background: var(--sp-fill-2); }
.eg-btn.primary { background: var(--eo-primary); color: #FFFFFF; border-color: var(--eo-primary); }
.eg-btn.primary:hover { background: var(--eo-primary-deep); }
.eg-tip { margin-top: 9px; font-size: 10.5px; color: var(--sp-ink-3); }

/* 二级弹窗：居中遮罩层（编辑器与卡片设置共用） */
.eo-modal-scrim {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(28, 28, 30, 0.26);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
@media (max-width: 899px) {
  .eo-modal-scrim { padding: 12px; }
  .empty-guide { top: auto; bottom: 96px; transform: translateX(-50%); }
}
/* 编辑器/卡片设置被 Teleport 到 body：深色下自带一组 --sp-* 变量 */
:global([data-theme='dark'] .node-editor),
:global([data-theme='dark'] .sp-card-settings) {
  --sp-card: #1E1E21;
  --sp-ink: #EDEBE7;
  --sp-ink-1: #D3D0C9;
  --sp-ink-2: #A6A29A;
  --sp-ink-3: #7A766F;
  --sp-line: rgba(255,255,255,.12);
  --sp-fill: rgba(255,255,255,.07);
  --sp-fill-2: rgba(255,255,255,.12);
  --sp-field: #26262A;
}
.node-editor {
  position: relative; z-index: auto; width: min(520px, 100%); max-height: calc(100vh - 48px);
  background: var(--sp-card, #FFFFFF); border: 1px solid var(--sp-line, rgba(44,44,44,0.12)); border-radius: 16px;
  box-shadow: 0 30px 60px -24px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.06);
  display: flex; flex-direction: column; overflow: hidden;
}
.ne-head { display: flex; align-items: center; gap: 9px; padding: 12px 12px 8px; }
.ne-dot { width: 8px; height: 8px; border-radius: 50%; background: #E8B86D; flex: none; }
.node-editor__title {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 15px; font-weight: 700; color: var(--sp-ink, #2C2C2C); font-family: inherit;
}
.ne-close { color: var(--sp-ink-2, #8A867E); display: flex; padding: 4px; }
.ne-tools { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.ne-tool {
  padding: 5px 10px; border-radius: 999px; font-size: 11px; font-weight: 600;
  color: var(--sp-ink-1, #5E5A54); background: var(--sp-fill, #F3F1EB); border: 1px solid var(--sp-line, rgba(44,44,44,0.06));
  transition: transform .12s ease, box-shadow .12s ease;
}
.ne-tool:hover { color: var(--eo-primary-deep); background: var(--sp-fill-2, #EAE7DF); transform: translateY(-1px); }
.ne-tabs { display: flex; align-items: center; gap: 4px; padding: 0 12px 8px; }
.ne-tab { font-size: 11.5px; font-weight: 600; color: var(--sp-ink-2, #8A867E); padding: 4px 9px; border-radius: 7px; }
.ne-tab.on { background: var(--sp-fill, #F0EEE8); color: var(--eo-primary); }
.ne-hint { margin-left: auto; font-size: 10px; color: var(--sp-ink-3, #A9A59D); }
.node-editor__body {
  margin: 0 12px; height: clamp(170px, 38vh, 320px); resize: none; outline: none;
  border: 1px solid var(--sp-line, rgba(44,44,44,0.10)); border-radius: 10px;
  background: var(--sp-field, #FCFBF8); padding: 10px; font-size: 12.5px; line-height: 1.65;
  color: var(--sp-ink, #2C2C2C); font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
}
.ne-visual {
  margin: 0 12px; height: clamp(170px, 38vh, 320px); overflow: auto; outline: none;
  border: 1px solid var(--sp-line, rgba(44,44,44,0.10)); border-radius: 10px;
  background: var(--sp-field, #FCFBF8); padding: 10px 12px; font-size: 12.5px; line-height: 1.7;
  color: var(--sp-ink-1, #3D3A35); cursor: text;
}
.ne-visual:empty::before { content: attr(data-placeholder); color: var(--sp-ink-3, #A9A59D); }
.ne-visual h1, .ne-visual h2, .ne-visual h3 { font-size: 15px; margin: 4px 0 6px; color: var(--sp-ink, #2C2C2C); }
.ne-visual p { margin: 0 0 8px; }
.ne-visual li { margin-left: 16px; }
.ne-visual blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid var(--eo-primary); color: var(--sp-ink-2, #6A6258); }
.ne-visual img { max-width: 100%; border-radius: 8px; margin: 4px 0; }
.ne-visual a { color: var(--eo-primary); text-decoration: underline; }
.ne-foot { display: flex; align-items: center; gap: 8px; padding: 10px 12px 12px; }
.ne-spacer { flex: 1; }
.ne-btn { font-size: 12px; font-weight: 600; padding: 7px 13px; border-radius: 9px; color: var(--sp-ink-1, #5E5A54); }
.ne-btn:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.ne-btn.primary { background: var(--eo-primary); color: #FFFFFF; }
.ne-btn.primary:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.ne-btn.danger-text { color: #A05A4C; padding-left: 0; }
:global([data-theme='dark'] .ne-btn.danger-text) { color: #E08A78; }

.stage-hint {
  position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; z-index: 20;
  background: var(--sp-card); border: 1px solid var(--sp-line);
  border-radius: 999px; padding: 7px 16px; box-shadow: 0 10px 26px -18px rgba(0,0,0,0.26);
  pointer-events: none;
}
.hint-label { font-size: 11.5px; font-weight: 700; color: var(--sp-ink); }
.hint-sub { font-size: 10.5px; color: var(--sp-ink-2); }
.connect-tip {
  position: absolute; left: 50%; top: 76px; transform: translateX(-50%);
  font-size: 11px; color: var(--sp-ink-2); background: var(--sp-card);
  border: 1px solid var(--sp-line); border-radius: 999px; padding: 5px 12px; pointer-events: none;
}

/* ---------- 数据卡片 DOM 叠层（方案 B） ---------- */
.sp-card-layer {
  position: absolute; inset: 0; z-index: 12; pointer-events: none;
  transform-origin: 0 0;
  /* 注意：这里不能常驻 will-change: transform —— 整层 scale 会被光栅化成一张纹理，
     缩放后文字跟着位图重采样就会发糊。让浏览器按当前缩放重新栅格化，文字更锐利。 */
}
.sp-card-layer.passive .sp-dom-card { pointer-events: none; }
.sp-dom-card {
  position: absolute; box-sizing: border-box; overflow: hidden;
  border-radius: 16px; background: var(--sp-card);
  border: 1px solid var(--sp-line);
  /* 统一物理反馈：静止微影，悬停整体上浮 + 弥散影（严禁缩放 / 变色） */
  box-shadow: var(--eo-shadow-rest, 0 1px 3px rgba(0,0,0,.05));
  padding: 12px 14px 14px; pointer-events: auto; cursor: grab;
  /* 触屏长按拖动：禁止浏览器接管手势 / 呼出系统菜单，否则长按会被打断 */
  touch-action: none; -webkit-touch-callout: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
  will-change: transform;
}
.sp-dom-card.sp-folder-collapsed { transform: rotate(-3deg) scale(.94); opacity: .82; }
.sp-folder-open {
  position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 5;
  font-size: 11px; font-weight: 700; color: var(--eo-ink); background: var(--eo-chip);
  border: 1px solid var(--eo-glass-border); border-radius: 999px; padding: 4px 10px; cursor: pointer;
}
.sp-rel-badge {
  position: absolute; top: 5px; right: 6px; z-index: 4;
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700; line-height: 1;
  color: var(--eo-ink-soft); background: var(--eo-chip);
  border: 1px solid var(--eo-glass-border); border-radius: 999px;
  padding: 3px 7px; cursor: pointer; opacity: .72;
  transition: opacity .12s ease, transform .12s ease;
}
.sp-rel-badge:hover { opacity: 1; transform: translateY(-1px); }
.sp-dom-card:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
/* 地图：无卡片边框/底色；静止不留影，悬停仍跟随统一上浮 + 弥散影 */
.sp-dom-card.kind-map {
  border: 0 none; box-shadow: none; background: transparent;
  cursor: grab;
}
.sp-dom-card.kind-map:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sp-dom-card.kind-map:active { cursor: grabbing; }
/* 天气：深色卡自带底色与圆角，节点容器透明；hover 仍保留统一上浮 + 弥散影 */
.sp-dom-card.kind-weather {
  background: transparent; border: 0 none; box-shadow: none; padding: 0;
  cursor: grab;
}
.sp-dom-card.kind-weather:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sp-dom-card.selected {
  border-color: transparent;
  box-shadow: 0 0 0 1.5px var(--sp-ink), var(--eo-shadow-rest, 0 1px 3px rgba(0,0,0,.05));
}
.sp-dom-card.selected:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: 0 0 0 1.5px var(--sp-ink), var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sp-dom-card.hovered:not(.selected) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sp-dom-card.stacked { filter: brightness(0.97); }
/* 悬停 1 秒可堆叠的目标提示 */
.sp-dom-card.stack-target { outline: 2px dashed var(--accent, #E8B86D); outline-offset: 3px; }
.sp-dom-card.kind-clock { background: linear-gradient(158deg, #F2F0EB 0%, #EDEAE3 100%); border-color: rgba(0,0,0,0.06); }
.sp-dom-card.kind-audio { background: linear-gradient(158deg, #D64747 0%, #B72F35 100%); border-color: rgba(255,255,255,0.10); }
/* 照片卡：白边相纸（白底 + 内边距 + 柔和投影），照片本体在内侧 */
.sp-dom-card.kind-image {
  background: #FFFFFF; border: 0 none; border-radius: 10px; padding: 7px;
  box-shadow: 0 8px 22px -8px rgba(0, 0, 0, .28), 0 1px 0 rgba(255,255,255,.6) inset;
}
.sp-dom-card.kind-image:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: 0 14px 30px -10px rgba(0, 0, 0, .32);
}
.sp-dom-card.kind-image.selected { box-shadow: 0 0 0 1.5px var(--sp-ink), 0 8px 22px -8px rgba(0, 0, 0, .28); }
:global([data-theme='dark']) .sp-dom-card.kind-clock { background: linear-gradient(158deg, #414144 0%, #323234 100%); border-color: rgba(255,255,255,0.08); }
.sp-dom-card.kind-memo {
  border-radius: 6px 6px 14px 6px; border-color: rgba(160,140,90,0.28);
  box-shadow: 0 1px 3px rgba(120,96,40,0.10);
  padding: 18px 18px 16px;
}
:global([data-theme='dark'] .sp-dom-card.kind-memo) {
  border-color: rgba(255,255,255,.14);
  box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.sp-dom-card.kind-memo:hover:not(.pressing) {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sp-note-text {
  height: 100%; overflow: hidden; white-space: pre-wrap; word-break: break-word;
  font-size: 13px; line-height: 1.75; color: #5A4E33; font-weight: 500;
}
:global([data-theme='dark'] .sp-note-text) { color: var(--sp-ink-1); }
.sp-note-fold {
  position: absolute; right: 0; bottom: 0; width: 22px; height: 22px;
  background: linear-gradient(135deg, rgba(0,0,0,0) 48%, #E3D2A8 50%, #D8C496 100%);
  border-top-left-radius: 4px; pointer-events: none;
}
:global([data-theme='dark'] .sp-note-fold) {
  background: linear-gradient(135deg, rgba(0,0,0,0) 48%, rgba(255,255,255,.08) 50%, rgba(255,255,255,.12) 100%);
}
/* 卡片正文（CanvasCardBody 内部使用 --ink 变量与固定浅色）深色覆盖 */
:global([data-theme='dark'] .sp-dom-card) { --ink: var(--sp-ink); --ink-2: var(--sp-ink-2); }
:global([data-theme='dark'] .sp-dom-card .cb-doc__t) { color: var(--sp-ink); }
:global([data-theme='dark'] .sp-dom-card .cb-doc__n) { color: var(--sp-ink-3); }
:global([data-theme='dark'] .sp-dom-card .cb-doc__body) { color: var(--sp-ink-1); }
:global([data-theme='dark'] .sp-dom-card .cb-doc__body::-webkit-scrollbar-thumb) { background: rgba(255,255,255,.18); }
:global([data-theme='dark'] .sp-dom-card .cb-doc__empty),
:global([data-theme='dark'] .sp-dom-card .cb-img__empty) { color: var(--sp-ink-3); }
/* 照片卡在白边相纸里，深色主题也保持白色底，不再覆盖 */
:global([data-theme='dark'] .sp-dom-card.kind-image .cb-img) { background: #FFFFFF; }
:global([data-theme='dark'] .sp-dom-card .cb-md),
:global([data-theme='dark'] .sp-dom-card .cb-md .md) { color: var(--sp-ink-2); }
.sp-handle-ov { position: absolute; pointer-events: none; }
.sp-handle-ov .sp-resize-grip { pointer-events: auto; }
.sp-resize-grip {
  position: absolute; right: 0; bottom: 0; width: 24px; height: 24px;
  cursor: nwse-resize; pointer-events: auto; border-radius: 6px;
  background:
    linear-gradient(135deg, transparent 46%, var(--sp-ink-3) 48%, var(--sp-ink-3) 54%, transparent 56%) no-repeat 7px 13px / 8px 8px,
    linear-gradient(135deg, transparent 46%, var(--sp-ink-2) 48%, var(--sp-ink-2) 56%, transparent 58%) no-repeat 10px 10px / 9px 9px;
  transition: background-color .15s ease;
}
.sp-resize-grip:hover { background-color: var(--eo-chip); }
/* 整卡着色：不再绘制顶部色条；按下只回落，绝不缩放 */
.sp-dom-card.pressing {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px -18px rgba(0,0,0,0.30);
  filter: none;
}
.sp-dom-card.link-source { outline: 2px dashed var(--accent, #E8B86D); outline-offset: 3px; }
.sp-card-layer.paging .sp-dom-card { transition: left .16s ease, top .16s ease, z-index 0s; }
/* 堆叠展开 / 收起：仅在切换的 180ms 内启用位移过渡，拖拽时不受影响 */
.sp-card-layer.stack-anim .sp-dom-card { transition: left .15s ease, top .15s ease; }
/* 双击空白：新建卡片类型选择浮层 */
.sp-new-menu {
  position: absolute; z-index: 90; width: 300px; padding: 10px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 14px;
  box-shadow: 0 14px 36px rgba(0,0,0,0.24);
}
.sp-nm-head { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 600; color: var(--sp-ink); margin-bottom: 8px; }
.sp-nm-close { border: 0; background: transparent; font-size: 16px; line-height: 1; color: var(--sp-ink-3); cursor: pointer; }
.sp-nm-tabs { display: flex; gap: 4px; margin-bottom: 8px; padding: 3px; border-radius: 9px; background: var(--eo-chip); }
.sp-nm-tabs button {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 8px; border: 0; border-radius: 7px; background: transparent;
  font-size: 11.5px; font-weight: 600; color: var(--sp-ink-2); cursor: pointer;
}
.sp-nm-tabs button.on { background: var(--sp-card); color: var(--sp-ink); box-shadow: 0 1px 3px rgba(0,0,0,0.10); }
.sp-nm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; max-height: 330px; overflow: auto; }
/* 文件夹页：3×3（9 项） */
.sp-nm-grid.cols3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sp-nm-back {
  margin-left: auto; margin-right: 8px; border: 0; background: transparent;
  font-size: 11.5px; font-weight: 600; color: var(--sp-ink-2); cursor: pointer;
}
.sp-nm-back:hover { color: var(--sp-ink); }
.sp-nm-item {
  display: flex; align-items: center; gap: 6px; padding: 8px; border: 1px solid transparent;
  border-radius: 9px; background: color-mix(in srgb, var(--sp-ink) 4%, transparent); color: var(--sp-ink); font-size: 12px;
  cursor: pointer; text-align: left;
}
.sp-nm-item:hover { background: color-mix(in srgb, var(--sp-ink) 9%, transparent); }
.sp-nm-ico { display: inline-flex; color: var(--sp-ink-2); }
.sp-nm-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-card-settings {
  position: relative; z-index: auto; width: min(380px, 100%); max-height: calc(100vh - 48px);
  overflow-y: auto; padding: 12px 14px 14px;
  background: var(--sp-card, #FFFDF9); border: 1px solid var(--sp-line, rgba(44,44,44,0.12)); border-radius: 14px;
  box-shadow: 0 26px 60px -28px rgba(0,0,0,0.38), 0 3px 10px rgba(0,0,0,0.06);
}
.sp-cs-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--sp-ink, #2C2C2C); padding-bottom: 10px; }
.sp-cs-close { width: 22px; height: 22px; border-radius: 6px; font-size: 14px; line-height: 1; color: var(--sp-ink-2, #8A867E); }
.sp-cs-close:hover { background: var(--eo-chip); }
.sp-cs-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--sp-ink-2, #6E6A64); margin-bottom: 8px; }
.sp-cs-field input {
  width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px;
  border: 1px solid var(--sp-line, rgba(44,44,44,0.12)); background: var(--sp-field, #FFFFFF); font-size: 12px; color: var(--sp-ink, #2C2C2C);
}
.sp-cs-body {
  width: 100%; box-sizing: border-box; padding: 8px 9px; border-radius: 8px;
  border: 1px solid var(--sp-line, rgba(44,44,44,0.12)); background: var(--sp-field, #FFFFFF); font-size: 12px; line-height: 1.65;
  color: var(--sp-ink, #2C2C2C); resize: vertical; min-height: 120px; font-family: inherit;
}
.sp-cs-body:focus { outline: none; border-color: var(--sp-ink-3); }
.sp-group-edit {
  position: absolute; z-index: 22; width: 224px; padding: 12px 14px 14px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 14px;
  box-shadow: 0 26px 60px -28px rgba(0,0,0,0.38), 0 3px 10px rgba(0,0,0,0.06);
}
.sp-drop-hint {
  position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 60;
  padding: 7px 14px; border-radius: 99px; pointer-events: none;
  background: rgba(44,44,44,0.86); color: #FFFDF8; font-size: 12px; font-weight: 600;
  box-shadow: 0 8px 22px rgba(0,0,0,0.24);
}
:global([data-theme='dark'] .sp-drop-hint) {
  background: rgba(255,255,255,0.14); color: var(--sp-ink); border: 1px solid var(--sp-line);
}
.sp-cs-field input:focus { outline: none; border-color: var(--sp-ink-3); }
.sp-cs-row { display: flex; gap: 8px; }
.sp-cs-row .sp-cs-field { flex: 1; }
.sp-cs-label { font-size: 11px; color: var(--sp-ink-2); margin: 2px 0 6px; }
.sp-cs-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 12px; }
.sp-cs-swatch { width: 100%; aspect-ratio: 1; border-radius: 7px; border: 1px solid var(--sp-line); }
.sp-cs-swatch.on { box-shadow: 0 0 0 2px var(--eo-primary); }
.sp-cs-actions { display: flex; justify-content: flex-end; gap: 8px; }
.sp-cs-cancel { padding: 6px 12px; border-radius: 8px; font-size: 12px; color: var(--sp-ink-2); background: var(--sp-fill); }
.sp-cs-apply { padding: 6px 14px; border-radius: 8px; font-size: 12px; color: #FFFFFF; background: var(--eo-primary); }
.sp-cs-apply:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
</style>
