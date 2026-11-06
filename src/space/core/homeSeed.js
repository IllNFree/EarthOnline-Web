// ===== 默认视图：地球Online 一页合并 =====
// 旧版「主页」子空间已并入根页：12 张卡片（9 数据面板 + 音乐 + 时钟 + 便利贴）直接长在地球Online 画布上，
// 欢迎卡与各空间入口统一排在卡片上方的生活条带（band），避免与卡片重叠。
// 背包 / Steam / 成就按 18×18 对角叠成一摞（stackId + stackIdx）。
// 示例脑图迁入独立空间；所有逻辑幂等，只迁移一次，不覆盖用户后续手工布局。

import { STACK_DX, STACK_DY } from '../../lib/model.js'

const STACK_ID = 'stk_home_lowfreq'
const OLD_HOME_ID = 'sp_home'
const DEMO_SPACE_ID = 'sp_mind_demo'

// 卡片配色：暖白底上更鲜活的低饱和彩（提高活力但保证文字对比）
export const CARD_COLORS = {
  calendar: '#F0A05A',
  map: '#6FAFC6',
  todo: '#79B596',
  ledger: '#9C8FD1',
  notes: '#E18A9E',
  album: '#E7B65E',
  backpack: '#B58BD8',
  steam: '#5F82A6',
  achievements: '#E2A132',
  audio: '#D64747',
  clock: '#3B3A37',
  memo: '#F2C74F',
  stats: '#8FA8C8',
  weather: '#7FB3C8'
}
export const CARD_SWATCHES = [
  '#F0A05A', '#6FAFC6', '#79B596', '#9C8FD1', '#E18A9E', '#E7B65E',
  '#B58BD8', '#5F82A6', '#E2A132', '#D64747', '#3B3A37', '#F2C74F',
  '#C99C8C', '#9DB3A0', '#A8BBCB', '#D3A6A6'
]

// 仪表盘式默认布局（参考图只借构图）：左列欢迎 + 空间入口，主区三行错落
const HOME_ITEMS = [
  // 第一行：宽地图 + 音乐
  { kind: 'panel', panelKind: 'map', title: '足迹地图', x: 280, y: 0, w: 760, h: 220, color: CARD_COLORS.map, z: 11 },
  { kind: 'card', cardKind: 'audio', title: '地球Online · 极简铺底', x: 1060, y: 0, w: 460, h: 220, color: CARD_COLORS.audio, z: 16, cardData: { title: '地球Online · 极简铺底', src: '/audio/demo-loop.wav', source: 'local', format: 'wav' } },
  // 第二行：大日历 + 待办/相册竖排 + 右列长笔记
  { kind: 'panel', panelKind: 'calendar', title: '日历聚合', x: 280, y: 246, w: 620, h: 444, color: CARD_COLORS.calendar, z: 10 },
  { kind: 'panel', panelKind: 'todo', title: '待办清单', x: 928, y: 246, w: 300, h: 210, color: CARD_COLORS.todo, z: 12 },
  { kind: 'panel', panelKind: 'album', title: '相册预览', x: 928, y: 480, w: 300, h: 210, color: CARD_COLORS.album, z: 15 },
  { kind: 'panel', panelKind: 'notes', title: '笔记列表', x: 1256, y: 246, w: 264, h: 444, color: CARD_COLORS.notes, z: 14 },
  // 第三行：天气 / 时钟 / 数据可视化 / 记账 / 低频堆叠（成就展示卡已按用户要求从首页移除）
  { kind: 'panel', panelKind: 'weather', title: '天气', x: 0, y: 714, w: 260, h: 214, color: CARD_COLORS.weather, z: 19 },
  { kind: 'card', cardKind: 'clock', title: '本地时间', x: 280, y: 714, w: 300, h: 214, color: CARD_COLORS.clock, z: 17, cardData: { label: '本地时间' } },
  { kind: 'panel', panelKind: 'stats', title: '数据可视化', x: 600, y: 714, w: 280, h: 214, color: CARD_COLORS.stats, z: 18 },
  { kind: 'panel', panelKind: 'ledger', title: '近期记账', x: 900, y: 714, w: 340, h: 214, color: CARD_COLORS.ledger, z: 13 },
  // 低频堆叠组：锚点 + k×18 对角；stackIdx 0 永远在最上层
  { kind: 'panel', panelKind: 'backpack', title: '背包统计', x: 1260, y: 714, w: 260, h: 214, color: CARD_COLORS.backpack, z: 30, stackId: STACK_ID, stackIdx: 0 },
  { kind: 'panel', panelKind: 'steam', title: 'Steam 游戏库', x: 1260 + STACK_DX, y: 714 + STACK_DY, w: 260, h: 214, color: CARD_COLORS.steam, z: 29, stackId: STACK_ID, stackIdx: 1 }
]

// 说明卡合并文案：原「无限画布工作区」+ 原「便利贴」两张纯文字说明卡合为一张
const WELCOME_BODY = '在这里，文件不再排成列表。把想法拖到任意位置，用「空间」收纳世界。\n'
  + '这是一张便利贴：彩色纸张、随手贴的角度、右上角折角；旁边的数据卡片是满血毛玻璃 —— 一眼就能分清两者。\n\n'
  + '· 空白拖动平移；空白滚轮缩放\n· 堆叠卡片上滚轮翻页\n· 双击空白：新建卡片 / 双击卡片：编辑'

const DATA_KINDS = ['panel', 'card', 'memo']
const BAND_COLORS = ['#E8B86D', '#9DB3A0', '#A8BBCB', '#C8B4C8', '#E18A9E']

function createSpace(id, name, camera) {
  return { id, name, parentId: 'root', childIds: [], camera, createdAt: Date.now() }
}

// 把 12 张卡片播种进根页（仅当根页还没有数据卡片时）
function seedHomeCards(ws) {
  HOME_ITEMS.forEach((it) => {
    ws.addNode(Object.assign({ spaceId: 'root', silent: true }, it))
  })
  return HOME_ITEMS.length
}

// 迁移旧「主页」空间：节点并入根页，删除空间与入口卡
function mergeOldHome(ws) {
  const old = ws.spaces[OLD_HOME_ID]
  if (!old) return false
  if (ws.currentId === OLD_HOME_ID) ws.currentId = 'root'
  const ids = ws.nodes.filter((n) => n.spaceId === OLD_HOME_ID).map((n) => n.id)
  if (ids.length) ws.moveNodesToSpace(ids, 'root', { recenter: false })
  ws.edges.forEach((e) => { if (e.spaceId === OLD_HOME_ID) e.spaceId = 'root' })
  // 移除指向旧主页的入口卡（及其连线）
  const kill = new Set(ws.nodes.filter((n) => n.kind === 'space' && n.targetSpaceId === OLD_HOME_ID).map((n) => n.id))
  if (kill.size) {
    ws.edges = ws.edges.filter((e) => !kill.has(e.fromId) && !kill.has(e.toId))
    ws.nodes = ws.nodes.filter((n) => !kill.has(n.id))
  }
  delete ws.spaces[OLD_HOME_ID]
  const idx = ws.spaces.root.childIds.indexOf(OLD_HOME_ID)
  if (idx >= 0) ws.spaces.root.childIds.splice(idx, 1)
  return true
}

// 旧版根页装饰手绘停在 x=-640，会把「适应内容」倍率拉到 0.4 以下（DOM 卡片失效）。
// 一次性把它平移到条带下方，保留笔迹但不影响取景。
function tidyLegacyStroke(ws) {
  const root = ws.spaces.root
  if (!root || root.strokeHomeV1) return false
  let moved = false
  ws.drawings.forEach((d) => {
    if (d.spaceId !== 'root' || d.tool !== 'highlighter' || d.color !== '#E8B86D' || d.x >= -100) return
    const dx = 40 - d.x
    const dy = -60 - d.y
    if (d.pts && d.pts.length) d.pts = d.pts.map((q) => [q[0] + dx, q[1] + dy])
    if (typeof d.x1 === 'number') {
      d.x1 += dx; d.y1 += dy; d.x2 += dx; d.y2 += dy
    }
    ws.recomputeDrawingBounds(d)
    moved = true
  })
  root.strokeHomeV1 = true
  return moved
}

// 仪表盘默认布局：把 12 张卡片 + 欢迎卡 + 空间入口一次性归位
// 幂等：root.dashboardV2 标记后不再自动重排；「默认布局」按钮用 force 强制再套一次
function applyDashboard(ws) {
  let moved = 0
  HOME_ITEMS.forEach((it) => {
    const n = ws.nodes.find((x) => {
      if (x.spaceId !== 'root' || x.kind !== it.kind) return false
      if (it.panelKind) return x.panelKind === it.panelKind
      if (it.cardKind) return x.cardKind === it.cardKind
      return it.kind === 'memo'
    })
    if (!n) return
    n.x = it.x; n.y = it.y; n.w = it.w; n.h = it.h; n.z = it.z
    moved++
  })
  const welcome = ws.nodeById('n_welcome')
  if (welcome) {
    welcome.x = 0; welcome.y = 0; welcome.w = 260; welcome.h = 200
    welcome.body = WELCOME_BODY
    moved++
  }
  const entries = ws.nodes
    .filter((n) => n.spaceId === 'root' && n.kind === 'space' && n.targetSpaceId && n.targetSpaceId !== OLD_HOME_ID)
    .sort((a, b) => a.x - b.x || a.y - b.y)
  entries.forEach((n, i) => {
    n.x = 0
    n.y = 222 + i * 116
    n.w = 240
    n.h = 104
    n.color = BAND_COLORS[i % BAND_COLORS.length]
    moved++
  })
  return moved
}

export function layoutDashboard(ws, { force = false } = {}) {
  const root = ws.spaces && ws.spaces.root
  if (!root) return 0
  if (!force && root.dashboardV2) return 0
  const moved = applyDashboard(ws)
  root.dashboardV2 = true
  return moved
}

// 示例脑图迁入独立空间（仅当它仍在根页上时迁移一次）
function migrateMindDemo(ws) {
  if (ws.spaces[DEMO_SPACE_ID]) return false
  const mindRoot = ws.nodeById('n_mind')
  if (!mindRoot || mindRoot.spaceId !== 'root') return false
  const ids = new Set()
  const walk = (id) => {
    if (ids.has(id)) return
    const n = ws.nodeById(id)
    if (!n || n.spaceId !== 'root') return
    ids.add(id)
    ;(n.childrenIds || []).forEach(walk)
  }
  walk('n_mind')
  if (!ids.size) return false
  const name = String(mindRoot.title || '').trim() || '脑图示例'
  ws.spaces[DEMO_SPACE_ID] = createSpace(DEMO_SPACE_ID, name, { x: 340, y: 60, s: 0.85 })
  ws.spaces.root.childIds.push(DEMO_SPACE_ID)
  ws.addNode({
    spaceId: 'root', kind: 'space', title: name,
    x: 420, y: -300, w: 220, h: 118,
    targetSpaceId: DEMO_SPACE_ID, color: '#A8BBCB', z: 8, silent: true
  })
  ws.moveNodesToSpace(Array.from(ids), DEMO_SPACE_ID, { recenter: false })
  return true
}

// ===== v3.0.0 首页卡片整理（幂等：root.homeV3 标记后不再执行） =====
// ① 「便利贴」说明卡并入「无限画布工作区」说明卡，原位置改造成「数据可视化」卡；
// ② 移除「成就展示」卡（成就殿堂页面保留，不影响成就本身）；
// ③ 补齐「天气」卡（Open-Meteo + 浏览器定位，卡片组件内自带 30 分钟缓存）。
function tidyHomeV3(ws) {
  const root = ws.spaces.root
  if (!root || root.homeV3) return 0
  let changed = 0
  const welcome = ws.nodeById('n_welcome')
  const memos = ws.nodes.filter((n) => n.spaceId === 'root' && n.kind === 'memo')
  const kill = new Set()
  memos.forEach((m, i) => {
    const txt = String(m.text || m.body || '').trim()
    if (welcome && txt) welcome.body = String(welcome.body || '').replace(/\n+$/, '') + '\n' + txt
    if (i === 0) {
      // 原位改成「数据可视化」：位置 / 尺寸不变，空出的说明卡位置正好放图表
      m.kind = 'panel'
      m.panelKind = 'stats'
      m.title = '数据可视化'
      m.color = CARD_COLORS.stats
      m.text = ''
    } else {
      kill.add(m.id)
    }
    changed++
  })
  const achIds = new Set(ws.nodes
    .filter((n) => n.spaceId === 'root' && n.panelKind === 'achievements')
    .map((n) => n.id))
  achIds.forEach((id) => kill.add(id))
  if (kill.size) {
    ws.nodes = ws.nodes.filter((n) => !kill.has(n.id))
    ws.edges = ws.edges.filter((e) => !kill.has(e.fromId) && !kill.has(e.toId))
    changed++
  }
  const hasRoot = (kind) => ws.nodes.some((n) => n.spaceId === 'root' && n.panelKind === kind)
  if (!hasRoot('stats')) {
    ws.addNode({
      spaceId: 'root', silent: true, kind: 'panel', panelKind: 'stats', title: '数据可视化',
      x: 600, y: 714, w: 280, h: 214, color: CARD_COLORS.stats, z: 18
    })
    changed++
  }
  if (!hasRoot('weather')) {
    ws.addNode({
      spaceId: 'root', silent: true, kind: 'panel', panelKind: 'weather', title: '天气',
      x: 0, y: 714, w: 260, h: 214, color: CARD_COLORS.weather, z: 19
    })
    changed++
  }
  root.homeV3 = true
  return changed
}

// 说明卡改名「便利贴」并把高度收回到 200（否则 258 会压到下方空间卡）
// 幂等：只认默认标题「无限画布工作区」，用户自己改过的名字不动
function fixWelcomeCard(ws) {
  const w = ws.nodeById('n_welcome')
  if (!w) return false
  let changed = false
  if (w.title === '无限画布工作区') { w.title = '便利贴'; changed = true }
  if (Number(w.h) >= 258) { w.h = 200; changed = true }
  return changed
}

export function ensureHomeSpace(ws) {
  if (!ws || !ws.spaces || !ws.spaces.root) return { changed: false }
  let changed = false
  if (mergeOldHome(ws)) changed = true
  const hasCards = ws.nodes.some((n) => n.spaceId === 'root' && DATA_KINDS.includes(n.kind))
  if (!hasCards) { seedHomeCards(ws); changed = true }
  if (tidyHomeV3(ws)) changed = true
  if (fixWelcomeCard(ws)) changed = true
  if (migrateMindDemo(ws)) changed = true
  if (tidyLegacyStroke(ws)) changed = true
  if (layoutDashboard(ws)) changed = true
  if (changed) {
    ws.rebuildIndex()
    ws.touch('home:seed', { index: true })
  }
  return { changed }
}
