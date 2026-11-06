<script setup>
// ===== 无限画布可视化工作区（v2.1） =====
// 空间 (Space) → 画布 (Canvas) → 节点 / 绘画元素
// 这一层只做编排：数据引擎、画布舞台、面板与空间导航；不直接绘制任何像素。
import { reactive, computed, onMounted, onUnmounted, onActivated, ref, watch, watchEffect, nextTick } from 'vue'
import Icon from '../components/Icon.vue'
import SpaceCanvas from './components/SpaceCanvas.vue'
import SpaceToolRail from './components/SpaceToolRail.vue'
import SpaceInspector from './components/SpaceInspector.vue'
import SpaceMinimap from './components/SpaceMinimap.vue'
import SpaceOpenFX from './components/SpaceOpenFX.vue'
import SpaceAiPanel from './components/SpaceAiPanel.vue'
import { Workspace } from './core/workspace.js'
import { ensureHomeSpace, layoutDashboard } from './core/homeSeed.js'
import { computeLayout, descendantsOf, edgeTypeForLayout, packCardsGrouped, CARD_LIKE_KINDS } from './core/layouts.js'
import { detectDeviceTier } from './core/perf.js'
import { useAppStore } from '../stores/app.js'
import { APP_INFO } from '../lib/model.js'
import { useDialogStore } from '../stores/dialog.js'
import { builtinEnabled } from '../services/builtinPlugins.js'
import { animateCamera } from './core/camera.js'
import {
  pickDirectory, walkDirectoryHandle, collectFromDataTransfer, createMediaNodes,
  fillThumbnails, fillTextBodies, createPathMediaNodes, isDesktopShell, kindOfFile
} from './core/media.js'

const ws = new Workspace()
const saved = ws.loadSaved()
if (!saved) ws.seedDemo()

// 属性面板（画布设置）默认收起：每次进入画布都从关闭状态开始，
// 只有用户主动点击右侧把手 / 更多菜单 / 脑图布局入口时才打开，不再恢复上次展开状态。
function setInspector(v) {
  ui.inspector = v
}
// 默认视图：首次进入 / 旧存档升级时补齐「主页」卡片空间，并把示例脑图迁到独立空间
const homeReady = ensureHomeSpace(ws)
if (homeReady.changed) ws.saveNow()

const ui = reactive({
  tool: 'select',
  // 多选模式：null 关闭 / 'click' 自定义多选（连续点选，不连线）/ 'box' 框选
  multiMode: null,
  stroke: { color: '#2C2C2C', width: 3, opacity: 1, dash: 'solid', smooth: 0.6 },
  recognize: true,
  mergeMode: false,
  selection: [],
  hoverId: null,
  activeGroup: null,
  guides: [],
  connectTarget: null,
  clipboard: [],
  editing: false,
  flat: false,
  linkMode: false,
  lite: false,
  fps: 60,
  inspector: false,
  layoutMode: 'mindmap',
  layoutScope: 'all',
  tick: 0,
  mediaProgress: null,
  dragging: false,
  spaceDrawer: false,
  aiOpen: false,
  helpOpen: false,
  toast: '',
  toastKey: 0,
  perf: { tier: 'high', reason: '' }
})

const canvasRef = ref(null)
const inspectorRef = ref(null)
const aiPanelRef = ref(null)
const stageEl = ref(null)
// 顶栏「更多」浮层：扁平模式 / 属性面板 / 快捷键
const moreOpen = ref(false)
const appStore = useAppStore()
const dialog = useDialogStore()

// ---------- 彩蛋：无量空处（进入画布 0.5% 概率 / ?egg=void 强制，只出现一次） ----------
const VOID_EGG_KEY = 'eo_egg_void'
const voidEggOpen = ref(false)
// 纯本地静态数据，不联网；四类卡片铺满全屏
const VOID_EGG_CARDS = [
  {
    name: '政治',
    items: ['联合国决议', '议会表决', '外交照会', '多边条约', '公投程序', '内阁改组', '选举人团', '主权声明', '政策白皮书', '预算审议']
  },
  {
    name: '经济',
    items: ['央行利率', '通胀数据', '汇率波动', '国债收益率', '供需曲线', '关税壁垒', '市盈率', '量化宽松', '产业链转移', '消费信心指数']
  },
  {
    name: '文化',
    items: ['电影分镜', '诗歌意象', '戏曲唱腔', '博物馆策展', '民俗仪式', '非遗名录', '出版审查', '流行音乐榜', '建筑风格', '饮食谱系']
  },
  {
    name: '动漫',
    items: ['番剧企划', '分镜稿', '声优选角', '原画作监', '同人志', '连载节奏', '世界观设定', '角色弧光', '作画监督', '周边贩售']
  }
]
function maybeVoidEgg() {
  // 路由为 hash 模式：?egg=void 既可能出现在 hash 内（#/?egg=void），也可能在真实 search 上
  let forced = false
  try {
    const qs = (window.location.hash.split('?')[1] || window.location.search.slice(1))
    forced = new URLSearchParams(qs).get('egg') === 'void'
  } catch (e) { /* ignore */ }
  if (!forced) {
    try { if (localStorage.getItem(VOID_EGG_KEY)) return } catch (e) { /* 隐私模式忽略 */ }
    if (Math.random() >= 0.005) return
  }
  try { localStorage.setItem(VOID_EGG_KEY, '1') } catch (e) { /* ignore */ }
  // 延迟弹出，确保画布初始化与首帧渲染不被遮挡
  setTimeout(() => { voidEggOpen.value = true }, 560)
}

// 内置插件（Steam）关闭时，画布上的对应卡片整卡隐藏：渲染 / 命中 / 框选 / 堆叠翻页全部跳过
const hiddenPanelKinds = computed(() => (builtinEnabled(appStore, 'steam') ? [] : ['steam']))
watchEffect(() => {
  const hidden = hiddenPanelKinds.value
  ws.hiddenPanelKinds = hidden
  ui.hiddenPanelKinds = hidden
  if (hidden.length && ui.selection.length) {
    ui.selection = ui.selection.filter((id) => {
      const n = ws.nodeById(id)
      return !(n && hidden.includes(n.panelKind))
    })
  }
  ui.tick++
  if (canvasRef.value) canvasRef.value.invalidate()
})
const fileInput = ref(null)
const folderInput = ref(null)
const lightbox = reactive({ open: false, node: null })
const fx = ref(null)
const spaceForm = reactive({ open: false, mode: 'create', parentId: 'root', id: '', name: '' })
const stageSize = reactive({ w: 1200, h: 700 })
let fxTimer = null
let dragCounter = 0
let toastTimer = null

// ---------- 设备能力 ----------
// 成就埋点：事件 reason 只做增量判断，种子/主页自动补齐的空间不计入
let spaceCount = Object.keys(ws.spaces).length
function onWorkspaceChange(reason) {
  ui.tick++
  if (reason === 'space:create') {
    const now = Object.keys(ws.spaces).length
    if (now > spaceCount) appStore.bumpMilestone('spaceCreate')
    spaceCount = now
  } else if (reason === 'space:delete') {
    spaceCount = Object.keys(ws.spaces).length
  } else if (reason === 'group:create') {
    appStore.bumpMilestone('groupCreate')
  } else if (reason === 'node:move-space') {
    appStore.bumpMilestone('crossSpaceMove')
  }
}
onMounted(() => {
  const perf = detectDeviceTier()
  ui.perf = perf
  if (perf.tier === 'low') ui.lite = true
  const ro = new ResizeObserver(() => {
    if (!stageEl.value) return
    const r = stageEl.value.getBoundingClientRect()
    stageSize.w = Math.round(r.width)
    stageSize.h = Math.round(r.height)
  })
  ro.observe(stageEl.value)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('beforeunload', saveNow)
  window.addEventListener('eo:data-reset', onDataReset)
  raf = requestAnimationFrame(tickClock)
  unsubWs = ws.on((reason) => onWorkspaceChange(reason))
  // 首次进入 / 默认视图升级：等舞台量出尺寸后自动适应内容，避免卡片落到视口外
  if (!saved || homeReady.changed) setTimeout(() => { canvasRef.value && canvasRef.value.fitView() }, 420)
  // 尺寸校准（一次性）：只收还在旧默认尺寸的卡片，用户手改过的尺寸不动
  if (typeof ws._calmDefaultSizes === 'function') { ws._calmDefaultSizes(); saveNow() }
  // QA / 调试钩子（只读暴露，不影响用户）
  window.__eoSpace = { ws, ui, enterSpace, applyLayout, openNewSpace, importFolder, fitView: () => canvasRef.value && canvasRef.value.fitView() }
  // 彩蛋判定放在画布初始化之后：不阻塞首帧，也不影响正常使用
  maybeVoidEgg()
})

// 清空全部数据（设置页）后：画布实例被 KeepAlive 缓存，不会卸载，必须就地重建为首次安装版式
let pendingResetFit = false
function onDataReset() {
  ws.history = []
  ws.future = []
  ws.seedDemo()
  ensureHomeSpace(ws)
  ws.saveNow()
  ui.selection = []
  ui.spaceDrawer = false
  ui.helpOpen = false
  ui.editing = false
  ui.hoverId = null
  ui.linkMode = false
  ui.tick++
  pendingResetFit = true
  nextTick(() => {
    const c = canvasRef.value
    if (!c) return
    c.resetForSpace()
    if (stageEl.value && stageEl.value.getBoundingClientRect().width > 0) {
      pendingResetFit = false
      c.fitView()
    }
  })
}
// 重置发生时若正在其他页面（主页被缓存、元素不可见），回到主页时再取景
onActivated(() => {
  if (!pendingResetFit) return
  pendingResetFit = false
  nextTick(() => {
    const c = canvasRef.value
    if (!c) return
    c.resetForSpace()
    c.fitView()
  })
})

let raf = 0
let ro2 = null
let unsubWs = null
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('beforeunload', saveNow)
  window.removeEventListener('eo:data-reset', onDataReset)
  cancelAnimationFrame(raf)
  clearTimeout(fxTimer)
  clearTimeout(toastTimer)
  unsubWs && unsubWs()
  ro2 && ro2.disconnect()
  saveNow()
})

function tickClock() {
  raf = requestAnimationFrame(tickClock)
}
function saveNow() { ws.saveNow() }

// ---------- 提示 ----------
function toast(text) {
  ui.toast = text
  ui.toastKey++
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { ui.toast = '' }, 2600)
}

// ---------- 空间导航 ----------
const currentPath = computed(() => {
  ui.tick
  return ws.pathOf(ws.currentId)
})
const rootName = computed(() => ws.spaces.root ? ws.spaces.root.name : '地球Online')

function enterSpace(id, opts = {}) {
  if (!ws.spaces[id] || id === ws.currentId) return
  const targetSpace = ws.spaces[id]
  const target = { ...targetSpace.camera }
  // 每个空间首次进入时自动铺一次卡片（根页保留手工设计布局）
  autoLayoutSpace(id)
  // 当前视口已实时写回当前空间对象，无需额外保存
  ui.spaceDrawer = false
  if (ui.lite) {
    ws.setSpace(id)
    Object.assign(ws.space.camera, target)
    ui.tick++
    ui.selection = []
    nextTick(() => {
      if (canvasRef.value) { canvasRef.value.resetForSpace(); canvasRef.value.invalidate() }
    })
    return
  }
  fx.value = {
    active: true,
    key: Date.now(),
    name: targetSpace.name,
    meta: (targetSpace.childIds || []).length + ' 个子空间 · 缩略图 ' + Math.round(target.s * 100) + '%',
    caption: '正在展开空间'
  }
  clearTimeout(fxTimer)
  // 前半段让文件夹动画盖住镜头切换，后半段画布从略缩状态推到已保存视口
  setTimeout(() => {
    ws.setSpace(id)
    const c = ws.space.camera
    c.x = target.x; c.y = target.y
    c.s = Math.max(0.2, target.s * 0.9)
    ui.tick++
    ui.selection = []
    nextTick(() => {
      if (canvasRef.value) {
        canvasRef.value.resetForSpace()
        animateCamera(c, target, 560, () => {
          ui.tick++
          canvasRef.value && canvasRef.value.invalidate()
        })
      }
    })
  }, 240)
  fxTimer = setTimeout(() => { fx.value = null }, 820)
}

function goUp() {
  if (ws.currentId === 'root') return
  const parent = ws.parentOf(ws.currentId)
  if (parent) enterSpace(parent.id)
}
function goRoot() {
  if (ws.currentId !== 'root') enterSpace('root')
}

// ---------- 空间树 ----------
const spaceTree = computed(() => {
  ui.tick
  const out = []
  const walk = (id, depth) => {
    const sp = ws.spaces[id]
    if (!sp) return
    out.push({ id, name: sp.name, depth, children: (sp.childIds || []).length, isCurrent: id === ws.currentId })
    ;(sp.childIds || []).forEach((cid) => walk(cid, depth + 1))
  }
  if (ws.spaces.root) walk('root', 0)
  return out
})

function openNewSpace(parentId = ws.currentId) {
  spaceForm.open = true
  spaceForm.mode = 'create'
  spaceForm.parentId = parentId
  spaceForm.id = ''
  spaceForm.name = ''
  ui.spaceDrawer = false
  nextTick(() => {
    const el = document.querySelector('.space-form input')
    if (el) el.focus()
  })
}
function openRenameSpace(id) {
  const sp = ws.spaces[id]
  if (!sp) return
  spaceForm.open = true
  spaceForm.mode = 'rename'
  spaceForm.id = id
  spaceForm.name = sp.name
  nextTick(() => {
    const el = document.querySelector('.space-form input')
    if (el) { el.focus(); el.select && el.select() }
  })
}
function submitSpaceForm() {
  const name = spaceForm.name.trim()
  if (!name) return
  if (spaceForm.mode === 'create') {
    const { space } = ws.createSpace(name, spaceForm.parentId)
    toast('已创建空间「' + name + '」')
    ui.tick++
    spaceForm.open = false
    enterSpace(space.id)
  } else {
    ws.renameSpace(spaceForm.id, name)
    ui.tick++
    spaceForm.open = false
    toast('空间已重命名')
  }
}
function removeSpace(id) {
  if (id === 'root') return
  const sp = ws.spaces[id]
  if (!sp) return
  if (!window.confirm('删除空间「' + sp.name + '」及其全部子空间与内容？')) return
  const parentId = sp.parentId
  ws.deleteSpace(id)
  ui.tick++
  if (parentId) enterSpace(parentId)
  toast('空间已删除')
}

// ---------- 布局 ----------
function applyLayout(mode = ui.layoutMode, scope = ui.layoutScope) {
  ui.tick
  const all = ws.nodes.filter((n) => n.spaceId === ws.currentId)
  const edges = ws.edges.filter((e) => e.spaceId === ws.currentId)
  const selectedNodes = scope === 'local'
    ? ui.selection.map((id) => ws.nodeById(id)).filter((n) => n && n.spaceId === ws.currentId)
    : []
  let roots = []
  if (scope === 'local') {
    if (!selectedNodes.length) { toast('请先选中一个脑图节点'); return }
    roots = selectedNodes
  } else {
    roots = all.filter((n) => (n.childrenIds || []).length > 0)
    if (!roots.length) { toast('当前空间还没有父子结构的节点'); return }
  }
  // 过滤被包含在其它选中根下的节点，避免重复布局
  if (scope === 'local') {
    const covered = new Set()
    roots.forEach((r) => descendantsOf(r.id, all).forEach((id) => {
      if (id !== r.id) covered.add(id)
    }))
    roots = roots.filter((r) => !covered.has(r.id))
  }
  ws.pushUndo()
  let touched = new Set()
  roots.forEach((root) => {
    const subIds = descendantsOf(root.id, all)
    const subNodes = all.filter((n) => subIds.has(n.id))
    if (subNodes.length < 2 && scope === 'all') return
    const map = computeLayout({
      nodes: subNodes,
      edges,
      rootId: root.id,
      mode,
      nodeGap: ws.settings.spacing.node,
      levelGap: ws.settings.spacing.level
    })
    Object.keys(map).forEach((id) => {
      const n = ws.nodeById(id)
      if (!n) return
      n.x = map[id].x
      n.y = map[id].y
      touched.add(id)
    })
  })
  // 布局后按模式自动优化连线类型（折线/曲线/直线）
  const type = edgeTypeForLayout(mode)
  edges.forEach((e) => {
    if (touched.has(e.fromId) && touched.has(e.toId)) {
      e.type = type
      ;[e.fromId, e.toId].forEach((id) => {
        const n = ws.nodeById(id)
        if (n) n.edges = (n.edges || []).map((x) => (x.edgeId === e.id ? Object.assign({}, x, { type }) : x))
      })
    }
  })
  ws.settings.edgeStyle = type
  ws.rebuildIndex()
  ws.touch('layout:apply')
  ui.tick++
  canvasRef.value && canvasRef.value.invalidate()
  toast('已应用「' + modeLabel(mode) + '」' + (scope === 'local' ? ' · 局部' : ' · 全局'))
}
function modeLabel(mode) {
  return { mindmap: '思维导图', logic: '逻辑图', org: '组织架构', radial: '放射状', tree: '树状图' }[mode] || mode
}

// ---------- 卡片排布（各空间默认布局） ----------
// 3.0 一键整理：类型分列 + 连线聚类（packCardsGrouped），保留堆叠组与脑图拓扑
function packSpaceCards(spaceId, { silent = false, standaloneOnly = false } = {}) {
  let cards = ws.nodes.filter((n) => n.spaceId === spaceId && CARD_LIKE_KINDS.includes(n.kind))
  // 有父子结构的空间只整理独立卡片，脑图子树保持拓扑
  if (standaloneOnly) cards = cards.filter((n) => !n.parentId && !(n.childrenIds || []).length)
  if (cards.length < 2) return 0
  ws.pushUndo()
  const ids = new Set(cards.map((c) => c.id))
  packCardsGrouped(cards, { edges: ws.edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId)) })
  ws.rebuildIndex()
  ws.touch('layout:cards')
  ui.tick++
  canvasRef.value && canvasRef.value.invalidate()
  if (!silent) toast('已整理「' + (ws.spaces[spaceId] ? ws.spaces[spaceId].name : '当前空间') + '」卡片布局')
  return cards.length
}
function tidyCurrentSpace() {
  const n = packSpaceCards(ws.currentId)
  if (!n) toast('当前空间还没有可整理的卡片')
}
// 跨空间一键整理：主页保持精心设计的仪表盘版式，不参与重排
function tidyAllSpaces() {
  const ids = Object.keys(ws.spaces).filter((id) => id !== 'root')
  const plan = []
  ids.forEach((id) => {
    const cards = ws.nodes.filter((n) => n.spaceId === id && CARD_LIKE_KINDS.includes(n.kind) && !n.parentId && !(n.childrenIds || []).length)
    if (cards.length >= 2) plan.push({ id, cards })
  })
  if (!plan.length) { toast('没有需要整理的空间（主页版式会保留）'); return }
  ws.pushUndo()
  const edgeIds = new Set()
  plan.forEach((p) => p.cards.forEach((c) => edgeIds.add(c.id)))
  let total = 0
  plan.forEach((p) => {
    total += packCardsGrouped(p.cards, { edges: ws.edges.filter((e) => edgeIds.has(e.fromId) && edgeIds.has(e.toId)) })
  })
  ws.rebuildIndex()
  ws.touch('layout:cards')
  ui.tick++
  canvasRef.value && canvasRef.value.invalidate()
  toast('已整理 ' + plan.length + ' 个空间共 ' + total + ' 张卡片（Ctrl+Z 可撤销）')
}
// 「默认布局」按钮：把主页恢复成首次安装的仪表盘版式（可撤销）
async function restoreDefaultLayout() {
  if (ws.currentId !== 'root') { toast('请先回到主页，再恢复默认布局'); return }
  const ok = await dialog.confirm({
    title: '恢复默认布局',
    message: '将按首次安装版式重排主页的 12 张卡片与空间入口，可用 Ctrl+Z 撤销。',
    confirmText: '恢复布局',
    cancelText: '取消'
  })
  if (!ok) return
  ws.pushUndo()
  const n = layoutDashboard(ws, { force: true })
  ws.rebuildIndex()
  ws.touch('home:layout-default')
  ui.selection = []
  ui.tick++
  if (canvasRef.value) {
    canvasRef.value.invalidate()
    canvasRef.value.fitView()
  }
  toast(n ? '已恢复主页默认布局' : '主页没有可重排的卡片')
}
function autoLayoutSpace(id) {
  const sp = ws.spaces[id]
  if (!sp || id === 'root' || sp.cardsPackedV1) return
  // 有父子结构的空间（脑图 / 结构图）保持拓扑，只整理散落卡片
  const hasTree = ws.nodes.some((n) => n.spaceId === id && (n.childrenIds || []).length > 0)
  sp.cardsPackedV1 = true
  packSpaceCards(id, { silent: true, standaloneOnly: hasTree })
}

// ---------- 编辑节点 ----------
const DATA_CARD_KINDS = ['panel', 'card', 'memo']
function isDataCard(id) {
  const n = ws.nodeById(id)
  return !!n && DATA_CARD_KINDS.includes(n.kind)
}
function editNode(id) { canvasRef.value && (canvasRef.value.openEditor(id)) }
function clearSelectionUI() {
  ui.selection = []
  ui.tick++
  if (canvasRef.value) canvasRef.value.invalidate()
}
function deleteSelected() {
  const nodeIds = ui.selection.filter((id) => ws.nodeById(id))
  const drawIds = ui.selection.filter((id) => ws.drawingById(id))
  if (nodeIds.length) ws.deleteNodes(nodeIds)
  if (drawIds.length) ws.deleteDrawings(drawIds)
  ui.selection = []
  ui.tick++
  toast('已删除所选内容')
}
function duplicateSelected() {
  const ids = ui.selection.filter((id) => ws.nodeById(id))
  if (!ids.length) { toast('请选择节点'); return }
  const copies = ws.duplicateNodes(ids)
  ui.selection = copies.map((n) => n.id)
  ui.tick++
  toast('已复制 ' + copies.length + ' 个节点')
}
function groupSelected() {
  const ids = ui.selection.filter((id) => ws.nodeById(id))
  if (ids.length < 2) { toast('至少选择两个节点才能组合'); return }
  // 已在组里的卡片不能再次组合（会造成跨组脏数据 / 旧组空壳）
  const grouped = ids.filter((id) => {
    const n = ws.nodeById(id)
    return n && n.groupId && ws.groups[n.groupId]
  })
  if (grouped.length) { toast('所选卡片已在组中，请先右键「移出组」'); return }
  const g = ws.group(ids)
  if (g) { ui.activeGroup = g.id; ui.tick++; toast('已组合') }
}
function newNote() {
  const cam = ws.space.camera
  const p = { x: cam.x + (Math.random() - 0.5) * 60, y: cam.y + (Math.random() - 0.5) * 60 }
  ws.pushUndo()
  const n = ws.addNode({ x: p.x, y: p.y, w: 250, h: 150, title: '新节点', body: '' })
  ui.selection = [n.id]
  ui.tick++
  canvasRef.value && canvasRef.value.invalidate()
  nextTick(() => editNode(n.id))
}

// ---------- 键盘 ----------
const BRUSH_KEYS = { 1: 'ballpoint', 2: 'fountain', 3: 'pencil', 4: 'highlighter', 5: 'laser' }
const SHAPE_KEYS = { 6: 'line', 7: 'rect', 8: 'circle', 9: 'scalpel', 0: 'eraser' }
function isTypingTarget(e) {
  const t = e.target
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
function onKeyDown(e) {
  if (ui.editing || isTypingTarget(e)) {
    if (e.key === 'Escape' && !ui.editing) { /* 输入态不处理 */ }
    return
  }
  const meta = e.metaKey || e.ctrlKey
  if (meta && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    const ok = e.shiftKey ? ws.redo() : ws.undo()
    ui.selection = []
    ui.tick++
    canvasRef.value && canvasRef.value.invalidate()
    toast(ok ? (e.shiftKey ? '已前进' : '已撤销') : '没有可撤销的操作')
    return
  }
  if (meta && (e.key === 'c' || e.key === 'C')) {
    const ids = ui.selection.filter((id) => ws.nodeById(id))
    if (ids.length) {
      e.preventDefault()
      ui.clipboard = ids.slice()
      toast('已复制 ' + ids.length + ' 个节点')
    }
    return
  }
  if (meta && (e.key === 'v' || e.key === 'V')) {
    if (!ui.clipboard.length) { toast('剪贴板为空'); return }
    e.preventDefault()
    const copies = ws.duplicateNodes(ui.clipboard, { x: 32, y: 32 })
    if (!copies.length) return
    ws.rebuildIndex()
    ui.selection = copies.map((n) => n.id)
    ui.tick++
    ws.touch('paste')
    ws.saveDebounced()
    canvasRef.value && canvasRef.value.invalidate()
    toast('已粘贴 ' + copies.length + ' 个节点')
    return
  }
  if (meta) return

  const k = e.key
  if (e.key === 'Backspace') {
    e.preventDefault()
    goUp()
    return
  }
  if (e.key === 'Escape') {
    if (ui.helpOpen) { ui.helpOpen = false; return }
    if (lightbox.open) { lightbox.open = false; return }
    if (ui.linkMode) { ui.linkMode = false; ui.tick++; return }
    if (ui.selection.length) { ui.selection = []; ui.activeGroup = null; ui.tick++; return }
    if (ws.currentId !== 'root') { goRoot(); return }
    return
  }
  if (e.key === 'l' || e.key === 'L') {
    ui.linkMode = !ui.linkMode
    ui.tick++
    toast(ui.linkMode ? '连线模式：依次点击两张卡片' : '已退出连线模式')
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    const id = ui.selection.length === 1 ? ui.selection[0] : null
    if (!id) { newNote(); return }
    if (!ws.nodeById(id)) return
    if (isDataCard(id)) { toast('数据卡片内部不可创建子节点'); return }
    const child = ws.addChildNode(id)
    if (child) {
      ui.selection = [child.id]
      ui.tick++
      nextTick(() => editNode(child.id))
    }
    return
  }
  if (e.key === 'Enter') {
    const id = ui.selection.length === 1 ? ui.selection[0] : null
    if (!id || !ws.nodeById(id)) return
    e.preventDefault()
    if (isDataCard(id)) { toast('数据卡片内部不可创建同级节点'); return }
    const sib = ws.addSiblingNode(id)
    if (sib) {
      ui.selection = [sib.id]
      ui.tick++
      nextTick(() => editNode(sib.id))
    }
    return
  }
  if (e.key === 'Delete') {
    if (ui.selection.length) { e.preventDefault(); deleteSelected() }
    return
  }
  if (k === 'v' || k === 'V') { ui.tool = 'select'; return }
  if (k === 'u' || k === 'U') { ui.recognize = !ui.recognize; toast(ui.recognize ? '抬笔成型：开' : '抬笔成型：关'); return }
  if (k === 'm' || k === 'M') { ui.mergeMode = !ui.mergeMode; toast(ui.mergeMode ? '绘画合并：开' : '绘画合并：关'); return }
  if (k === 'g' || k === 'G') { groupSelected(); return }
  if (k === ' ') return
  if (/^[1-9]$/.test(k)) { ui.tool = BRUSH_KEYS[k]; return }
  if (k === '0') { ui.tool = 'eraser'; return }
}

// ---------- 媒体导入 ----------
// 桌面壳（Electron）内可直接填绝对路径（D:\音乐）；纯 Web 端不显示该入口
const isDesktop = isDesktopShell()
const pathDlg = reactive({ open: false, path: '', busy: false, err: '' })
function openPathImport() {
  moreOpen.value = false
  pathDlg.err = ''
  pathDlg.open = true
}
async function runPathImport() {
  const p = pathDlg.path.trim()
  if (!p) { pathDlg.err = '请输入文件夹绝对路径，例如 D:\\音乐'; return }
  pathDlg.busy = true
  pathDlg.err = ''
  try {
    const created = await createPathMediaNodes(ws, p)
    if (!created.length) { pathDlg.err = '该目录里没有可导入的文件'; return }
    pathDlg.open = false
    await finishImport(created, '「' + p + '」')
  } catch (e) {
    pathDlg.err = e.message || '导入失败'
  } finally {
    pathDlg.busy = false
  }
}
function setProgress(label, done, total) {
  ui.mediaProgress = { label, done, total }
}
async function finishImport(created, sourceLabel) {
  if (!created.length) {
    toast('没有找到支持的图片 / 视频 / 音乐 / 文本')
    ui.mediaProgress = null
    return
  }
  // 文本卡先回填正文，图片 / 视频再生成缩略图（音频已直接进歌单卡）
  const texts = created.filter((x) => x.kind === 'text')
  if (texts.length) {
    setProgress('读取文本', 0, texts.length)
    await fillTextBodies(ws, created)
  }
  setProgress('生成缩略图', 0, created.length)
  await fillThumbnails(ws, created, (done, total) => setProgress('生成缩略图', done, total))
  ui.mediaProgress = null
  ws.rebuildIndex()
  ws.touch('media:imported')
  ui.tick++
  canvasRef.value && canvasRef.value.invalidate()
  const songs = created.filter((x) => x.kind === 'audio').reduce((s, x) => s + (x.count || 0), 0)
  const parts = []
  const imgs = created.filter((x) => x.kind === 'image' || x.kind === 'video').length
  if (imgs) parts.push(imgs + ' 个媒体')
  if (songs) parts.push(songs + ' 首歌单')
  if (texts.length) parts.push(texts.length + ' 个文本')
  toast(sourceLabel + '：导入 ' + (parts.join(' · ') || created.length + ' 项'))
  // 内容较多时轻推镜头，让用户看到
  if (created.length > 4) setTimeout(() => canvasRef.value && canvasRef.value.fitView(), 300)
}
async function importFolder() {
  try {
    if (window.showDirectoryPicker) {
      const handle = await pickDirectory()
      if (!handle) return
      setProgress('扫描文件夹', 0, 0)
      const metas = await walkDirectoryHandle(handle, 1, '')
      if (!metas.length) { toast('文件夹内没有找到图片 / 视频 / 音乐 / 文本'); ui.mediaProgress = null; return }
      setProgress('创建媒体节点', 0, metas.length)
      const created = createMediaNodes(ws, metas)
      ui.tick++
      await finishImport(created, '「' + handle.name + '」')
    } else if (folderInput.value) {
      folderInput.value.click()
    }
  } catch (e) {
    console.error(e)
    ui.mediaProgress = null
    toast('导入失败：' + (e.message || '未知错误'))
  }
}
function onFolderFiles(e) {
  const files = Array.from(e.target.files || [])
  const metas = []
  files.forEach((f) => {
    const kind = kindOfFile(f)
    if (!kind) return
    const rel = f.webkitRelativePath || f.name
    const depth = Math.max(1, rel.split('/').length - 1)
    if (depth > 5) return
    metas.push({ file: f, kind, path: rel, depth })
  })
  e.target.value = ''
  const created = createMediaNodes(ws, metas)
  ui.tick++
  finishImport(created, '所选文件夹')
}
function importFiles() { fileInput.value && fileInput.value.click() }
function onFiles(e) {
  const metas = []
  Array.from(e.target.files || []).forEach((f) => {
    const kind = kindOfFile(f)
    if (kind) metas.push({ file: f, kind, path: f.name, depth: 1 })
  })
  e.target.value = ''
  if (!metas.length) { toast('请选择图片 / 视频 / 音乐 / 文本文件'); return }
  const created = createMediaNodes(ws, metas)
  ui.tick++
  finishImport(created, '文件')
}
function onDrop(e) {
  dragCounter = 0
  ui.dragging = false
  const dt = e.dataTransfer
  if (!dt) return
  setProgress('扫描拖入内容', 0, 0)
  collectFromDataTransfer(dt).then((metas) => {
    if (!metas.length) { toast('未识别到图片 / 视频 / 音乐 / 文本'); ui.mediaProgress = null; return }
    const created = createMediaNodes(ws, metas)
    ui.tick++
    finishImport(created, '拖入内容')
  }).catch((err) => {
    console.error(err)
    ui.mediaProgress = null
    toast('导入失败')
  })
}
function onDragEnter() { dragCounter++; ui.dragging = true }
function onDragLeave() { dragCounter = Math.max(0, dragCounter - 1); if (!dragCounter) ui.dragging = false }

async function onBackgroundFile(file) {
  try {
    const dataUrl = await compressImageFile(file, 1600, 0.72)
    ws.settings.background.pattern = 'image'
    ws.settings.background.image = dataUrl
    ws.settings.background.opacity = 0.18
    ws.touch('bg:image')
    toast('背景图片已应用')
  } catch (e) { toast('图片处理失败') }
}
function compressImageFile(file, max, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ratio = img.width / img.height || 1
      const w = Math.min(max, img.width)
      const h = Math.round(w / ratio)
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(cv.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')) }
    img.src = url
  })
}

// ---------- 媒体预览 ----------
function openMedia(node) {
  lightbox.node = node
  lightbox.open = true
}
const lightboxSrc = computed(() => {
  const n = lightbox.node
  if (!n) return ''
  return n._objectUrl || (n.media && (n.media.src || n.media.thumb)) || ''
})

// ---------- 其它 ----------
function stressTest() {
  ws.stressTest(1000)
  ui.tick++
  canvasRef.value && canvasRef.value.fitView()
  toast('已生成 1000 个节点，验证视口裁剪')
}
function pickTool(t) { ui.tool = t }

// ---------- AI 助手（P3） ----------
function toggleAiPanel() {
  ui.aiOpen = !ui.aiOpen
  ui.tick++
}
// 右键菜单 / 工具栏直达总结：打开面板并跑一次总结（id 为空时用当前选中）
function aiSummarize(id) {
  ui.aiOpen = true
  ui.tick++
  nextTick(() => { aiPanelRef.value && aiPanelRef.value.summarizeSelection(id ? [id] : null) })
}
// 工具条「脑图布局」：打开属性面板并直接定位到布局区块（而不是停在「画布设置」首页）
function openLayoutPanel() {
  setInspector(true)
  ui.layoutMode = ui.layoutMode || 'mindmap'
  nextTick(() => { if (inspectorRef.value) inspectorRef.value.openSection('layout') })
}
function openHelp() { moreOpen.value = false; ui.helpOpen = true }

const shortHelp = [
  ['V', '选择工具'], ['L', '连线模式'], ['空格 + 拖拽', '抓手漫游'], ['滚轮', '空白处缩放 / 堆叠卡片翻页'],
  ['单击', '选中卡片'], ['长按拖拽', '移动卡片'], ['长按空白拖拽', '平移画布'], ['双击卡片', '编辑 / 卡片设置'],
  ['Tab', '创建子节点'], ['Enter', '创建同级节点'], ['双击节点', 'Markdown 编辑'],
  ['Delete', '删除节点（含子树）'], ['G', '组合选中节点'], ['Backspace', '返回上一级空间'],
  ['Esc', '返回根空间 / 清除选择'], ['1-5', '笔刷工具'], ['6-0', '直线/矩形/圆/柳叶刀/橡皮'],
  ['U', '抬笔成型开关'], ['M', '绘画合并模式'], ['Ctrl + Z', '撤销'], ['Ctrl + Shift + Z', '前进']
]
</script>

<template>
  <div ref="stageEl" class="space-app" :class="{ 'is-lite': ui.lite, 'insp-open': ui.inspector }"
    @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">

    <!-- 画布舞台 -->
    <div class="canvas-region">
      <SpaceCanvas ref="canvasRef" :ws="ws" :ui="ui" :lite="ui.lite"
        @space-enter="enterSpace" @open-media="openMedia" @toast="toast" @space-new="openNewSpace()"
        @ai-summary="aiSummarize" @import-files="importFiles" @import-folder="importFolder"
        @tidy-current="tidyCurrentSpace" @tidy-all="tidyAllSpaces" />
    </div>

    <!-- AI 助手：右侧可折叠浮层 -->
    <SpaceAiPanel ref="aiPanelRef" :open="ui.aiOpen" :ws="ws" :ui="ui"
      @toast="toast" @close="ui.aiOpen = false; ui.tick++" />

    <!-- 顶栏 / 面包屑 -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">EO</span>
        <div class="brand-text">
          <span class="brand-name">地球Online</span>
          <span class="brand-ver">v{{ APP_INFO.version }} · Canvas</span>
        </div>
      </div>
      <nav class="crumbs" aria-label="空间路径">
        <button class="crumb home" :class="{ on: ws.currentId === 'root' }" @click="goRoot" title="返回根空间 (Esc)">
          <Icon name="home" :size="14" /><span>{{ rootName }}</span>
        </button>
        <template v-for="(sp, i) in currentPath" :key="sp.id">
          <span v-if="sp.id !== 'root'" class="crumb-sep"><Icon name="chevron-right" :size="12" /></span>
          <button v-if="sp.id !== 'root'" class="crumb" :class="{ on: sp.id === ws.currentId, mid: i === currentPath.length - 1 }"
            @click="enterSpace(sp.id)">{{ sp.name }}</button>
        </template>
      </nav>

      <!-- 工具条：原左侧竖栏，合并到顶栏中段 -->
      <SpaceToolRail :ui="ui" @tool="pickTool" @new-note="newNote" @open-layout="openLayoutPanel"
        @tidy="tidyCurrentSpace" @media="importFolder" @ai="toggleAiPanel" />

      <div class="top-actions">
        <div class="action-group">
          <button class="top-btn" :title="ws.canUndo() ? '撤销：' + (ws.undoLabel || '操作') + ' (Ctrl+Z)' : '没有可撤销的操作'" :disabled="!ws.canUndo()" @click="ws.undo(); ui.selection=[]; ui.tick++; canvasRef && canvasRef.invalidate()">
            <Icon name="undo" :size="16" />
          </button>
          <button class="top-btn" :title="ws.canRedo() ? '前进：' + (ws.redoLabel || '操作') + ' (Ctrl+Shift+Z)' : '没有可前进的操作'" :disabled="!ws.canRedo()" @click="ws.redo(); ui.selection=[]; ui.tick++; canvasRef && canvasRef.invalidate()">
            <Icon name="redo" :size="16" />
          </button>
        </div>
        <!-- v2.1.0：新建空间主入口（原入口只在空间抽屉里，不便发现） -->
        <button class="top-btn wide primary" title="新建空间" @click="openNewSpace()">
          <Icon name="plus" :size="15" /><span>新建空间</span>
        </button>
        <button class="top-btn wide" title="空间管理" @click="ui.spaceDrawer = true; ui.tick++">
          <Icon name="layers" :size="15" /><span>空间</span>
        </button>
        <button class="top-btn wide" title="恢复主页默认布局" @click="restoreDefaultLayout">
          <Icon name="home" :size="15" /><span>默认布局</span>
        </button>
        <!-- v2.1.0：低频开关收进「更多」，顶栏每个图标只代表一件事 -->
        <div class="more-anchor">
          <button class="top-btn icon-only" :class="{ on: moreOpen }" title="更多：扁平模式 / 属性面板 / 快捷键" @click="moreOpen = !moreOpen">
            <Icon name="more" :size="16" />
          </button>
          <div v-if="moreOpen" class="more-pop">
            <button class="more-item" :class="{ on: ui.flat }" @click="ui.flat = !ui.flat; moreOpen = false">
              <Icon name="waterfall" :size="15" /><span>扁平模式</span><em>{{ ui.flat ? '已开' : '已关' }}</em>
            </button>
            <button class="more-item" :class="{ on: ui.inspector }" @click="setInspector(!ui.inspector); moreOpen = false">
              <Icon name="columns" :size="15" /><span>属性面板</span><em>{{ ui.inspector ? '已开' : '已关' }}</em>
            </button>
            <button v-if="isDesktop" class="more-item" @click="openPathImport">
              <Icon name="folder" :size="15" /><span>从本地路径导入</span>
            </button>
            <div class="more-divider"></div>
            <button class="more-item" @click="openHelp">
              <Icon name="info" :size="15" /><span>快捷键与手势</span>
            </button>
          </div>
        </div>
        <div v-if="moreOpen" class="more-scrim" @pointerdown="moreOpen = false"></div>
      </div>
    </header>

    <!-- 属性面板：可收起为右侧窄条，开合状态会记住 -->
    <SpaceInspector v-if="ui.inspector" ref="inspectorRef" :ws="ws" :ui="ui" @edit="editNode" @layout="applyLayout"
      @delete-selected="deleteSelected" @group="groupSelected" @duplicate="duplicateSelected"
      @fit="canvasRef && canvasRef.fitView()" @reset="canvasRef && canvasRef.resetView()"
      @import-folder="importFolder" @import-files="importFiles" @import-files-bg="onBackgroundFile"
      @new-space="openNewSpace()" @enter-space="enterSpace" @stress="stressTest" @toast="toast" />
    <button v-if="!ui.inspector" class="insp-rail" title="展开属性面板" @click="setInspector(true)">
      <Icon name="columns" :size="15" /><span>属性面板</span>
    </button>

    <!-- 底部左：缩放 -->
    <div class="zoom-pill">
      <button class="zoom-btn" title="缩小" @click="canvasRef && canvasRef.zoomBy(1 / 1.2)"><Icon name="minus" :size="14" /></button>
      <button class="zoom-value" title="重置为 100%" @click="canvasRef && canvasRef.resetView()">{{ Math.round(ws.space.camera.s * 100) }}%</button>
      <button class="zoom-btn" title="放大" @click="canvasRef && canvasRef.zoomBy(1.2)"><Icon name="plus" :size="14" /></button>
      <span class="zoom-sep"></span>
      <button class="zoom-btn wide" title="适应全部内容" @click="canvasRef && canvasRef.fitView()"><Icon name="frame" :size="14" /></button>
    </div>

    <!-- 多选操作条：框选 / 多选后随手可用，不必先去开属性面板 -->
    <div v-if="ui.selection.length > 1" class="selbar">
      <span class="selbar-n"><b>{{ ui.selection.length }}</b> 项已选</span>
      <span class="selbar-sep"></span>
      <button class="selbar-btn" @click="groupSelected">组合<em>G</em></button>
      <button class="selbar-btn" @click="duplicateSelected">复制</button>
      <button class="selbar-btn" @click="tidyCurrentSpace">对齐</button>
      <button class="selbar-btn danger" @click="deleteSelected">删除</button>
      <button class="selbar-x" title="取消选择 (Esc)" @click="clearSelectionUI"><Icon name="close" :size="12" /></button>
    </div>

    <div class="stage-meta">
      <span>{{ ws.stats().nodes }} 节点</span><i></i>
      <span>{{ ws.stats().drawings }} 笔画</span><i></i>
      <span>{{ currentPath.length }} 层空间</span>
      <template v-if="ui.lite"><i></i><span class="perf-chip">性能模式</span></template>
    </div>

    <!-- 迷你地图 -->
    <div class="minimap-slot" v-if="ws.settings.minimap && ui.selection.length < 2">
      <SpaceMinimap :ws="ws" :ui="ui" :stage-w="stageSize.w" :stage-h="stageSize.h"
        @navigate="canvasRef && canvasRef.invalidate()" />
    </div>

    <!-- 空间切换动画 -->
    <SpaceOpenFX :fx="fx" :lite="ui.lite" />

    <!-- 空间抽屉 -->
    <div v-if="ui.spaceDrawer" class="drawer-wrap" @click.self="ui.spaceDrawer = false">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">SPACES</div>
            <div class="drawer-title">空间层级</div>
          </div>
          <button class="drawer-close" @click="ui.spaceDrawer = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="drawer-scroll">
          <div v-for="sp in spaceTree" :key="sp.id" class="space-row" :class="{ current: sp.isCurrent }"
            :style="{ paddingLeft: 10 + sp.depth * 16 + 'px' }">
            <button class="space-main" @click="enterSpace(sp.id)">
              <Icon :name="sp.depth === 0 ? 'globe' : 'folder'" :size="15" />
              <span class="space-name">{{ sp.name }}</span>
              <span class="space-count">{{ sp.children }}</span>
            </button>
            <div class="space-tools">
              <button title="新建子空间" @click.stop="openNewSpace(sp.id)"><Icon name="plus" :size="13" /></button>
              <button v-if="sp.depth > 0" title="重命名" @click.stop="openRenameSpace(sp.id)"><Icon name="edit" :size="13" /></button>
              <button v-if="sp.depth > 0" class="danger" title="删除空间" @click.stop="removeSpace(sp.id)"><Icon name="trash" :size="13" /></button>
            </div>
          </div>
        </div>
        <div class="drawer-foot">
          <button class="btn block" @click="openNewSpace()"><Icon name="plus" :size="14" />在当前空间下新建</button>
          <p>Backspace 返回上一级 · Esc 回到根空间</p>
        </div>
      </aside>
    </div>

    <!-- 空间表单 -->
    <div v-if="spaceForm.open" class="modal-scrim" @click.self="spaceForm.open = false">
      <div class="modal space-form">
        <div class="modal-head">
          <span>{{ spaceForm.mode === 'create' ? '新建空间' : '重命名空间' }}</span>
          <button @click="spaceForm.open = false"><Icon name="close" :size="15" /></button>
        </div>
        <p class="modal-sub" v-if="spaceForm.mode === 'create'">新空间会作为卡片出现在当前画布，双击进入。</p>
        <p class="modal-sub" v-else>名称会同步到父级画布的空间卡片。</p>
        <input v-model="spaceForm.name" maxlength="32" placeholder="空间名称" @keydown.enter="submitSpaceForm" @keydown.esc="spaceForm.open = false" />
        <div class="modal-actions">
          <button class="btn" @click="spaceForm.open = false">取消</button>
          <button class="btn primary" @click="submitSpaceForm">{{ spaceForm.mode === 'create' ? '创建并进入' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 快捷键帮助 -->
    <div v-if="ui.helpOpen" class="modal-scrim" @click.self="ui.helpOpen = false">
      <div class="modal help-modal">
        <div class="modal-head">
          <span>快捷键与手势</span>
          <button @click="ui.helpOpen = false"><Icon name="close" :size="15" /></button>
        </div>
        <div class="help-grid">
          <div v-for="item in shortHelp" :key="item[0]" class="help-item">
            <span class="help-key">{{ item[0] }}</span><span class="help-desc">{{ item[1] }}</span>
          </div>
        </div>
        <p class="help-note">空白拖动平移 · 空白处滚轮缩放 · 单击选中卡片 · 拖到卡片中心 0.6 秒自动堆叠 · 堆叠组上滚轮翻页 · 双击卡片打开设置 · 右键元素调整图层</p>
        <p class="help-note">堆叠规则：只有内容卡片能互相堆叠并统一为组顶尺寸，打散/移出会恢复原尺寸；空间卡是容器，彼此不堆叠，把卡片拖到空间卡上等于移入该空间。拖动时需停在目标卡片中心区域约 0.6 秒才会成堆，边缘掠过不会触发。</p>
      </div>
    </div>

    <!-- 媒体灯箱 -->
    <div v-if="lightbox.open" class="lightbox" @click.self="lightbox.open = false">
      <div class="lightbox-card">
        <div class="lightbox-head">
          <div>
            <div class="lightbox-title">{{ lightbox.node && lightbox.node.title }}</div>
            <div class="lightbox-sub">{{ lightbox.node && lightbox.node.media && lightbox.node.media.path }}</div>
          </div>
          <button @click="lightbox.open = false"><Icon name="close" :size="16" /></button>
        </div>
        <img v-if="lightbox.node && lightbox.node.kind === 'image' && lightboxSrc" :src="lightboxSrc" alt="" />
        <video v-else-if="lightbox.node && lightbox.node.kind === 'video' && lightboxSrc" :src="lightboxSrc" controls autoplay></video>
        <div v-else class="lightbox-empty">原图仅存在于本次会话，请重新导入该文件夹以恢复预览。</div>
      </div>
    </div>

    <!-- 拖拽提示 -->
    <div v-if="ui.dragging" class="drop-veil">
      <div class="drop-card">
        <Icon name="image" :size="28" />
        <strong>松手导入媒体</strong>
        <span>图片 / 视频 / 音乐 / 文本 / 文件夹 · 递归最深 5 层</span>
      </div>
    </div>

    <!-- 桌面壳：按绝对路径导入（纯 Web 端不渲染） -->
    <div v-if="pathDlg.open" class="path-mask" @pointerdown="pathDlg.open = false">
      <div class="path-card glass glass-strong" @pointerdown.stop>
        <strong>从本地路径导入</strong>
        <p>输入文件夹绝对路径（如 D:\音乐），会递归读取其中的音乐 / 图片 / 视频 / 文本。音乐将合并成一张可离线播放的歌单卡。</p>
        <input v-model="pathDlg.path" class="path-input" placeholder="D:\音乐" @keydown.enter="runPathImport" />
        <span v-if="pathDlg.err" class="path-err">{{ pathDlg.err }}</span>
        <div class="path-btns">
          <button class="btn ghost" @click="pathDlg.open = false">取消</button>
          <button class="btn" :disabled="pathDlg.busy" @click="runPathImport">{{ pathDlg.busy ? '读取中…' : '导入' }}</button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" multiple accept="image/*,video/*,audio/*,.txt,.md,.markdown,.log,.csv,.json" hidden @change="onFiles" />
    <input ref="folderInput" type="file" webkitdirectory directory multiple hidden @change="onFolderFiles" />

    <!-- 彩蛋：无量空处（全屏信息墙，点击任意处关闭） -->
    <Teleport to="body">
      <div v-if="voidEggOpen" class="void-egg" @click="voidEggOpen = false">
        <div class="void-wall">
          <section v-for="c in VOID_EGG_CARDS" :key="c.name" class="void-col">
            <h3 class="void-col-name">{{ c.name }}</h3>
            <div v-for="it in c.items" :key="it" class="void-card">{{ it }}</div>
          </section>
        </div>
        <div class="void-title">无量空处</div>
        <div class="void-hint">点击任意位置关闭</div>
      </div>
    </Teleport>

    <Transition name="space-toast">
      <div v-if="ui.toast" :key="ui.toastKey" class="space-toast">{{ ui.toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.space-app {
  --sp-bg: #FAF9F6;
  --sp-card: #FFFFFF;
  --sp-ink: #2C2C2C;
  --sp-ink-1: #4A4742;
  --sp-ink-2: #6E6A64;
  --sp-ink-3: #9A968E;
  --sp-line: rgba(44,44,44,0.10);
  --sp-fill: #F3F1EB;
  --sp-fill-2: #EAE7DF;
  --sp-field: #FCFBF8;
  --sp-track: #E4E1D9;
  position: absolute; inset: 0; overflow: hidden; background: var(--sp-bg); color: var(--sp-ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  animation: appIn .55s cubic-bezier(.2,.85,.24,1) both;
}
/* 深色主题：画布工作区局部覆盖，变量下发到所有子组件 */
:global([data-theme='dark'] .space-app) {
  --sp-bg: #141416;
  --sp-card: #1E1E21;
  --sp-ink: #EDEBE7;
  --sp-ink-1: #D3D0C9;
  --sp-ink-2: #A6A29A;
  --sp-ink-3: #7A766F;
  --sp-line: rgba(255,255,255,.12);
  --sp-fill: rgba(255,255,255,.07);
  --sp-fill-2: rgba(255,255,255,.12);
  --sp-field: #26262A;
  --sp-track: rgba(255,255,255,.16);
}
@keyframes appIn { from { opacity: 0; transform: scale(0.994) } to { opacity: 1; transform: none } }
.canvas-region { position: absolute; inset: 0; }

.topbar {
  position: absolute; left: 0; right: 0; top: 0; height: 54px; z-index: 25;
  display: flex; align-items: center; gap: 16px; padding: 0 16px;
  background: var(--sp-bg); border-bottom: 1px solid var(--sp-line);
  backdrop-filter: blur(14px) saturate(1.1);
}
.brand { display: flex; align-items: center; gap: 9px; padding-right: 14px; border-right: 1px solid var(--sp-line); }
.brand-mark {
  width: 30px; height: 30px; border-radius: 9px; background: #2C2C2C; color: #FAF9F6;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; letter-spacing: .02em;
}
:global([data-theme='dark'] .brand-mark) {
  background: var(--sp-card); color: var(--sp-ink); border: 1px solid var(--sp-line);
}
.brand-text { display: flex; flex-direction: column; line-height: 1.15; }
.brand-name { font-size: 12.5px; font-weight: 800; letter-spacing: .01em; }
.brand-ver { font-size: 9px; color: var(--sp-ink-3); letter-spacing: .08em; margin-top: 2px; }
.crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.crumbs::-webkit-scrollbar { display: none; }
.crumb { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border-radius: 8px; font-size: 11.5px; color: var(--sp-ink-2); white-space: nowrap; }
.crumb:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); color: var(--sp-ink); }
.crumb.on { color: var(--sp-ink); font-weight: 700; background: var(--sp-card); border: 1px solid var(--sp-line); }
.crumb.home { color: var(--sp-ink-3); font-size: 11px; }
.crumb-sep { color: var(--sp-ink-3); display: flex; }
.top-actions { display: flex; align-items: center; gap: 6px; }
.action-group { display: flex; background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 9px; overflow: hidden; }
.top-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; border-radius: 9px; color: var(--sp-ink-2); font-size: 11px; font-weight: 600; }
.action-group .top-btn { border-radius: 0; padding: 6px 8px; }
.action-group .top-btn + .top-btn { border-left: 1px solid var(--sp-line); }
.top-btn:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); color: var(--sp-ink); }
.top-btn:disabled { opacity: .38; cursor: default; }
.top-btn.on { background: var(--eo-primary); border-color: var(--eo-primary); color: #FFFFFF; }
.top-btn.wide { background: var(--sp-card); border: 1px solid var(--sp-line); }
.top-btn.icon-only { width: 32px; height: 32px; justify-content: center; padding: 0; }
/* 新建空间：顶栏主入口，实心强调色，与其他白色按钮区分 */
.top-btn.primary { background: var(--eo-primary); border: 1px solid var(--eo-primary); color: #FAF9F6; }
.top-btn.primary:hover { color: #FFFFFF; }
/* 「更多」浮层：低频开关收纳在同一个入口 */
.more-anchor { position: relative; }
.more-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; width: 170px; padding: 6px;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 11px;
  box-shadow: 0 18px 38px -22px rgba(0,0,0,.32);
}
.more-item { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--sp-ink-2); text-align: left; }
.more-item span { flex: 1; }
.more-item em { font-style: normal; font-size: 10px; color: var(--sp-ink-3); }
.more-item:hover { background: var(--eo-chip); color: var(--sp-ink); }
.more-item.on { color: var(--sp-ink); }
.more-item.on em { color: var(--sp-ink); font-weight: 700; }
.more-divider { height: 1px; margin: 4px 2px; background: var(--sp-line); }
.more-scrim { position: fixed; inset: 0; z-index: 30; }

.zoom-pill {
  position: absolute; left: 16px; bottom: 16px; z-index: 20;
  display: flex; align-items: center; gap: 2px; padding: 5px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 12px;
  box-shadow: 0 16px 36px -28px rgba(0,0,0,0.3); backdrop-filter: blur(10px);
}
.zoom-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--sp-ink-2); }
.zoom-btn:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); color: var(--sp-ink); }
.zoom-btn.wide { width: 32px; }
.zoom-value { min-width: 48px; height: 28px; font-size: 11px; font-weight: 700; color: var(--sp-ink); border-radius: 8px; }
.zoom-value:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.zoom-sep { width: 1px; height: 16px; background: var(--sp-line); margin: 0 3px; }
/* 多选操作条：底部居中，避开左下缩放与右下小地图 */
.selbar {
  position: absolute; left: 50%; bottom: 56px; transform: translateX(-50%); z-index: 24;
  display: flex; align-items: center; gap: 2px; padding: 5px 6px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 12px;
  box-shadow: 0 18px 44px -26px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.04);
  backdrop-filter: blur(10px); animation: selIn .18s cubic-bezier(.2,.8,.2,1) both;
  max-width: calc(100vw - 40px); overflow-x: auto;
}
@keyframes selIn { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
.selbar-n { font-size: 11px; color: var(--sp-ink-2); padding: 0 8px 0 6px; white-space: nowrap; }
.selbar-n b { font-weight: 700; color: var(--sp-ink); }
.selbar-sep { width: 1px; height: 18px; background: var(--sp-line); margin-right: 4px; }
.selbar-btn {
  height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12px; color: var(--sp-ink);
  display: flex; align-items: center; gap: 4px; white-space: nowrap; transition: background .15s ease;
}
.selbar-btn em { font-style: normal; font-size: 9px; opacity: .5; }
.selbar-btn:hover { background: var(--eo-chip); }
.selbar-btn.danger:hover { background: var(--eo-chip); }
.selbar-x { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; color: var(--sp-ink-2); }
.selbar-x:hover { background: var(--eo-chip); }
.stage-meta {
  position: absolute; left: 16px; bottom: 62px; z-index: 20; display: flex; align-items: center; gap: 8px;
  font-size: 9.5px; color: var(--sp-ink-3); letter-spacing: .02em;
}
.stage-meta i { width: 2px; height: 2px; border-radius: 50%; background: var(--sp-line); }
.perf-chip { color: #8A6B3E; background: #F3E9D8; padding: 2px 7px; border-radius: 99px; font-size: 8.5px; font-weight: 700; }
:global([data-theme='dark'] .perf-chip) { color: #E4C089; background: rgba(232,184,109,.14); }
.minimap-slot { position: absolute; right: 16px; bottom: 16px; z-index: 20; transition: right .25s ease; }
.insp-open .minimap-slot { right: 322px; }
.insp-rail {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%); z-index: 24;
  width: 34px; padding: 14px 0; border-radius: 10px 0 0 10px;
  background: var(--sp-card); border: 1px solid var(--sp-line); border-right: none;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  font-size: 10px; writing-mode: vertical-rl; color: var(--sp-ink-2);
  box-shadow: -8px 0 24px -20px rgba(0,0,0,0.35);
}
.insp-rail:hover { background: var(--sp-fill); color: var(--sp-ink); }
@media (max-width: 899px) {
  .insp-rail { display: none; }
}

/* 抽屉 */
.drawer-wrap { position: absolute; inset: 0; z-index: 50; background: rgba(44,44,44,0.14); backdrop-filter: blur(2px); }
:global([data-theme='dark'] .drawer-wrap),
:global([data-theme='dark'] .modal-scrim) { background: rgba(0,0,0,0.55); }
.drawer {
  position: absolute; left: 0; top: 0; bottom: 0; width: 320px;
  background: var(--sp-card); box-shadow: 28px 0 60px -40px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; animation: drawerIn .28s cubic-bezier(.2,.85,.24,1) both;
}
@keyframes drawerIn { from { transform: translateX(-16px); opacity: 0 } to { transform: none; opacity: 1 } }
.drawer-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 16px 12px; border-bottom: 1px solid var(--sp-line); }
.drawer-kicker { font-size: 9px; font-weight: 800; letter-spacing: .2em; color: var(--sp-ink-3); }
.drawer-title { font-size: 16px; font-weight: 800; margin-top: 3px; }
.drawer-close { color: var(--sp-ink-3); padding: 4px; border-radius: 7px; }
.drawer-close:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.drawer-scroll { flex: 1; overflow-y: auto; padding: 10px 8px; }
.space-row { display: flex; align-items: center; border-radius: 9px; padding-right: 6px; }
.space-row:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.space-row.current { background: var(--sp-fill); }
.space-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 9px 8px; font-size: 11.5px; color: var(--sp-ink-2); text-align: left; }
.space-row.current .space-main { color: var(--sp-ink); font-weight: 700; }
.space-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-count { font-size: 9px; color: var(--sp-ink-3); }
.space-tools { display: flex; gap: 2px; opacity: 0; transition: opacity .15s ease; }
.space-row:hover .space-tools { opacity: 1; }
.space-tools button { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--sp-ink-2); }
.space-tools button:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); color: var(--sp-ink); }
.space-tools .danger:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.drawer-foot { padding: 12px 14px 16px; border-top: 1px solid var(--sp-line); }
.drawer-foot p { font-size: 9.5px; color: var(--sp-ink-3); margin-top: 8px; line-height: 1.6; }

/* 模态 */
.modal-scrim { position: absolute; inset: 0; z-index: 60; background: rgba(44,44,44,0.18); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.modal { width: min(420px, calc(100vw - 40px)); background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 18px; padding: 18px; box-shadow: 0 40px 90px -50px rgba(0,0,0,0.5); animation: modalIn .24s cubic-bezier(.2,.85,.24,1) both; }
@keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
.modal-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 800; }
.modal-head button { color: var(--sp-ink-3); padding: 4px; border-radius: 7px; }
.modal-sub { font-size: 11px; line-height: 1.65; color: var(--sp-ink-2); margin: 8px 0 14px; }
.space-form input { width: 100%; padding: 11px 12px; border: 1px solid var(--sp-line); border-radius: 10px; background: var(--sp-field); font-size: 13px; color: var(--sp-ink); outline: none; }
.space-form input:focus { border-color: var(--sp-ink-3); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 9px; font-size: 12px; font-weight: 600; color: var(--sp-ink-1); background: var(--sp-fill); }
.btn:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.btn.primary { background: var(--eo-primary); color: #FFFFFF; }
.btn.primary:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.btn.block { width: 100%; justify-content: center; }
.help-modal { width: min(620px, calc(100vw - 40px)); }
.help-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 14px 0 10px; }
.help-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--sp-line); }
.help-key { min-width: 96px; font-size: 10px; font-weight: 700; color: var(--sp-ink); background: var(--sp-fill); border-radius: 6px; padding: 4px 7px; text-align: center; }
.help-desc { font-size: 11px; color: var(--sp-ink-2); }
.help-note { font-size: 10px; color: var(--sp-ink-3); line-height: 1.7; margin-top: 8px; }

/* 灯箱 */
.lightbox { position: absolute; inset: 0; z-index: 65; background: rgba(32,31,29,0.72); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 40px; }
.lightbox-card { max-width: min(980px, 92vw); max-height: 88vh; background: var(--sp-card); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; }
.lightbox-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--sp-line); }
.lightbox-title { font-size: 13px; font-weight: 700; }
.lightbox-sub { font-size: 9.5px; color: var(--sp-ink-3); margin-top: 2px; word-break: break-all; }
.lightbox-head button { color: var(--sp-ink-2); }
.lightbox-card img, .lightbox-card video { max-width: 100%; max-height: 74vh; display: block; background: #111; }
.lightbox-empty { padding: 60px 40px; font-size: 12px; color: var(--sp-ink-2); text-align: center; }

.drop-veil { position: absolute; inset: 0; z-index: 68; background: rgba(250,249,246,0.86); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.drop-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 48px; border: 2px dashed var(--sp-line); border-radius: 20px; color: var(--sp-ink-2); background: color-mix(in srgb, var(--sp-card) 72%, transparent); }
.drop-card strong { font-size: 14px; color: var(--sp-ink); }
.drop-card span { font-size: 10.5px; }
:global([data-theme='dark'] .drop-veil) { background: rgba(20,20,22,0.86); }
:global([data-theme='dark'] .drop-card) { border-color: rgba(255,255,255,.2); }

.space-toast {
  position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 76;
  background: #2C2C2C; color: #FFFFFF; font-size: 11.5px; font-weight: 600;
  padding: 9px 16px; border-radius: 999px; box-shadow: 0 18px 40px -22px rgba(0,0,0,0.5);
  white-space: nowrap;
}
:global([data-theme='dark'] .space-toast) {
  background: #2E2E32; color: var(--sp-ink); border: 1px solid var(--sp-line);
}
.space-toast-enter-active, .space-toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.space-toast-enter-from, .space-toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }

@media (max-width: 1280px) {
  .stage-meta { display: none; }
}
@media (max-width: 1100px) {
  .inspector { top: 64px; }
  .minimap-slot { right: 16px; bottom: 62px; }
  .insp-open .minimap-slot { right: 16px; }
}
@media (max-width: 899px) {
  .brand-text { display: none; }
  .brand { padding-right: 8px; }
  .top-actions .top-btn.wide span { display: none; }
  .top-btn.icon-only { display: none; }
  .topbar { gap: 8px; padding: 0 10px; height: 50px; }
  .crumbs { font-size: 10px; }
  .zoom-pill { bottom: calc(env(safe-area-inset-bottom, 0px) + 96px); }
  .selbar { bottom: calc(env(safe-area-inset-bottom, 0px) + 144px); max-width: calc(100vw - 24px); }
  .minimap-slot { display: none; }
  .stage-meta { display: none; }
  .help-grid { grid-template-columns: 1fr; }
  .drawer { width: min(320px, 86vw); }
  .more-pop { right: -6px; width: 160px; }
}
@media (max-width: 520px) {
  .brand { display: none; }
  .crumbs { display: none; }
  .top-actions .action-group { display: none; }
}
@media (max-height: 640px) {
  .minimap-slot { display: none; }
}

/* ===== 彩蛋：无量空处（全屏信息墙） ===== */
.void-egg {
  position: fixed; inset: 0; z-index: 88; overflow: hidden; cursor: pointer;
  background: rgba(24, 23, 21, 0.62);
  backdrop-filter: blur(14px) saturate(130%);
  -webkit-backdrop-filter: blur(14px) saturate(130%);
  animation: voidFade .32s ease both;
}
.void-wall {
  position: absolute; inset: 14px;
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
  animation: voidWall .45s cubic-bezier(.2, .8, .2, 1) both;
}
.void-col {
  display: flex; flex-direction: column; gap: 6px; min-height: 0;
  padding: 12px 10px; border-radius: 18px;
  background: var(--eo-glass-strong);
  border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow);
}
.void-col-name {
  flex: none; margin: 0 0 2px; padding: 2px 4px; font-size: 12px; font-weight: 800;
  letter-spacing: .18em; color: var(--eo-ink-faint);
}
.void-card {
  flex: 1 1 0; min-height: 0; display: flex; align-items: center;
  padding: 0 10px; border-radius: 10px;
  background: var(--eo-chip); color: var(--eo-ink);
  font-size: 11.5px; font-weight: 600; letter-spacing: .02em;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.void-title {
  position: absolute; left: 50%; top: 26px; transform: translateX(-50%);
  padding: 4px 12px; border-radius: 999px;
  font-size: 11px; font-weight: 800; letter-spacing: .28em; color: #FFFFFF;
  background: rgba(24, 23, 21, .4);
  pointer-events: none;
}
.void-hint {
  position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%);
  padding: 6px 14px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: .08em; color: #FFFFFF;
  background: rgba(24, 23, 21, .45); pointer-events: none;
}
@keyframes voidFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes voidWall { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
@media (max-width: 899px) {
  .void-wall { inset: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .void-card { font-size: 10.5px; }
  .void-title { top: 18px; }
  .void-hint { bottom: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .void-egg, .void-wall { animation: none; }
}
/* 桌面壳：本地路径导入弹窗 */
.path-mask {
  position: fixed; inset: 0; z-index: 120; display: grid; place-items: center;
  background: rgba(30, 29, 27, .32); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.path-card {
  width: min(92vw, 430px); padding: 20px 22px 18px; border-radius: var(--eo-radius);
  display: flex; flex-direction: column; gap: 10px;
}
.path-card strong { font-size: 16px; color: var(--eo-ink); }
.path-card p { margin: 0; font-size: 12px; line-height: 1.6; opacity: .62; }
.path-input {
  height: 40px; padding: 0 12px; border-radius: 12px; font-size: 13px;
  border: 1px solid var(--eo-glass-border); background: var(--eo-glass); color: var(--eo-ink);
  outline: none;
}
.path-input:focus { border-color: var(--eo-primary); }
.path-err { font-size: 12px; color: #A97C72; }
.path-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
