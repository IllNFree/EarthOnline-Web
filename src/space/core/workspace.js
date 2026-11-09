// ===== 工作区状态层（纯 JS，零 Vue 依赖） =====
// 数据模型：空间(Space) → 画布(Canvas) → 节点/绘画元素(Node/Drawing)
// 每个节点同时保存：
//   · 画布坐标 {x, y, w, h}        —— 视图层自由布局
//   · 拓扑 {parentId, childrenIds, edges[]} —— 脑图布局与连线
// 状态层只负责数据 + 索引 + 持久化 + 撤销，绝不直接触摸 DOM / Canvas。

import { QuadTree, unionRect } from './quadtree.js'
import { autoColor, paletteById } from './palettes.js'

export const SPACE_STORAGE_KEY = 'eo:space:v21'
const STORAGE_KEY = SPACE_STORAGE_KEY
const MAX_HISTORY = 30
// 撤销/重做提示用的动作名（按 workspace 的 touch reason 映射）
const UNDO_LABELS = {
  'node:add': '新建卡片',
  'node:update': '修改卡片',
  'node:delete': '删除卡片',
  'node:move': '移动卡片',
  'node:resize': '调整尺寸',
  'node:rotate': '旋转卡片',
  'node:stack': '堆叠卡片',
  'node:unstack': '打散堆叠',
  'node:move-space': '移入空间',
  'edge:add': '连线',
  'edge:delete': '删除连线',
  'drawing:add': '绘制',
  'drawing:delete': '擦除',
  'group:create': '组合卡片',
  'group:delete': '解散组合',
  'group:update': '修改组合',
  'space:create': '新建空间',
  'space:delete': '删除空间',
  'space:update': '修改空间',
  'reorder': '调整层级',
  'settings': '调整设置',
  'ai:create-cards': 'AI 生成卡片'
}

// 清空全部数据时，画布存档必须一并移除（否则下次进主页会被旧存档还原）
export function clearSavedSpace() {
  try { localStorage.removeItem(SPACE_STORAGE_KEY) } catch (e) {}
}

let seq = 0
export function uid(prefix = 'n') {
  seq = (seq + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)

export function defaultSettings() {
  return {
    palette: 'warm',
    background: { pattern: 'dots', opacity: 0.55, image: '' },
    snap: true,
    guides: true,
    minimap: true,
    flat: false,
    autoColor: true,
    spacing: { node: 36, level: 88 },
    edgeStyle: 'curve',
    arrow: true,
    gridSize: 10
  }
}

function emptySpace(id, name, parentId, camera) {
  return {
    id,
    name,
    parentId: parentId || null,
    childIds: [],
    camera: camera || { x: 0, y: 0, s: 1 },
    createdAt: Date.now()
  }
}

export class Workspace {
  constructor() {
    this.version = 1
    this.spaces = {}
    this.nodes = []
    this.edges = []
    this.drawings = []
    this.groups = {}
    this.settings = defaultSettings()
    this.currentId = 'root'
    this.index = new QuadTree()
    this.listeners = new Set()
    this.history = []
    this.future = []
    this._saveTimer = null
    this._dirty = false
    // 被关闭的内置插件对应的数据面板（如蒸汽）：渲染与命中都跳过，但数据保留以便重新开启
    this.hiddenPanelKinds = []
  }

  // ---------- 订阅 / 变更通知 ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(reason = 'change') {
    this.listeners.forEach((fn) => { try { fn(reason, this) } catch (e) { console.error('[space] listener', e) } })
  }
  touch(reason = 'change', { save = true, index = false } = {}) {
    if (index) this.rebuildIndex()
    // 给最近一次撤销快照打上动作名，用于「撤销：移动卡片」这类可读提示
    const top = this.history[this.history.length - 1]
    if (top && !top.label) top.label = UNDO_LABELS[reason] || '操作'
    this.emit(reason)
    if (save) this.saveDebounced()
  }

  get rootId() { return 'root' }
  get space() { return this.spaces[this.currentId] || this.spaces.root }
  get nodesInSpace() { return this.nodes.filter((n) => n.spaceId === this.currentId) }
  get drawingsInSpace() { return this.drawings.filter((d) => d.spaceId === this.currentId) }
  get childrenSpaces() {
    const cur = this.space
    return (cur.childIds || []).map((id) => this.spaces[id]).filter(Boolean)
  }
  nodeById(id) { return this.nodes.find((n) => n.id === id) || null }
  drawingById(id) { return this.drawings.find((d) => d.id === id) || null }
  elementById(id) { return this.nodeById(id) || this.drawingById(id) }

  // ---------- 空间 ----------
  pathOf(spaceId) {
    const out = []
    let cur = this.spaces[spaceId]
    let guard = 0
    while (cur && guard++ < 40) {
      out.unshift(cur)
      cur = cur.parentId ? this.spaces[cur.parentId] : null
    }
    return out
  }
  parentOf(spaceId) {
    const sp = this.spaces[spaceId]
    return sp && sp.parentId ? this.spaces[sp.parentId] : null
  }
  setSpace(id) {
    if (!this.spaces[id]) return false
    this.currentId = id
    this.rebuildIndex()
    this.emit('space')
    this.saveDebounced()
    return true
  }
  createSpace(name, parentId = this.currentId, opts = {}) {
    const parent = this.spaces[parentId] || this.spaces.root
    const id = uid('sp')
    const sp = emptySpace(id, name || '未命名空间', parent.id)
    // 子空间在父画布上以「空间卡片」呈现，双击进入
    const parentCamera = parent.camera || { x: 0, y: 0, s: 1 }
    const spot = opts.position || this.findFreeSpot(parent.id, 220, 128, parentCamera.x, parentCamera.y)
    sp.camera = { x: 0, y: 0, s: 1 }
    this.spaces[id] = sp
    parent.childIds.push(id)
    const card = this.addNode({
      spaceId: parent.id,
      kind: 'space',
      title: sp.name,
      body: '',
      x: spot.x,
      y: spot.y,
      w: 220,
      h: 128,
      targetSpaceId: id,
      color: opts.color || null,
      silent: true
    })
    if (opts.enter) {
      this.currentId = id
      this.rebuildIndex()
    }
    this.touch('space:create', { index: true })
    return { space: sp, card }
  }
  renameSpace(id, name) {
    const sp = this.spaces[id]
    if (!sp) return
    sp.name = String(name || '').trim() || sp.name
    // 同步父画布上的空间卡片标题
    this.nodes.forEach((n) => { if (n.kind === 'space' && n.targetSpaceId === id) n.title = sp.name })
    this.touch('space:rename')
  }
  deleteSpace(id) {
    if (id === 'root' || !this.spaces[id]) return
    const collect = (sid) => {
      const sp = this.spaces[sid]
      if (!sp) return []
      return [sid].concat(...(sp.childIds || []).map(collect))
    }
    const ids = collect(id)
    const set = new Set(ids)
    const parentId = this.spaces[id].parentId
    if (this.spaces[parentId]) {
      this.spaces[parentId].childIds = this.spaces[parentId].childIds.filter((x) => x !== id)
    }
    this.nodes = this.nodes.filter((n) => !(set.has(n.spaceId) || (n.kind === 'space' && set.has(n.targetSpaceId))))
    this.drawings = this.drawings.filter((d) => !set.has(d.spaceId))
    this.edges = this.edges.filter((e) => !set.has(e.spaceId))
    ids.forEach((sid) => { delete this.spaces[sid] })
    if (set.has(this.currentId)) this.currentId = parentId || 'root'
    this.touch('space:delete', { index: true })
  }

  // ---------- 节点 ----------
  _nextZ(spaceId) {
    let m = 0
    this.nodes.forEach((n) => { if (n.spaceId === spaceId && n.z > m) m = n.z })
    this.drawings.forEach((d) => { if (d.spaceId === spaceId && d.z > m) m = d.z })
    return m + 1
  }
  addNode(patch = {}) {
    const spaceId = patch.spaceId || this.currentId
    const w = num(patch.w, 240)
    const h = num(patch.h, 148)
    const node = {
      id: patch.id || uid('n'),
      spaceId,
      kind: patch.kind || 'note',
      title: patch.title != null ? String(patch.title) : '新节点',
      body: patch.body || '',
      x: num(patch.x, 0),
      y: num(patch.y, 0),
      w,
      h,
      color: patch.color || (this.settings.autoColor ? autoColor(patch.id || patch.title || ('c' + this.nodes.length), this.settings.palette) : null),
      parentId: patch.parentId || null,
      childrenIds: [],
      edges: [],
      groupId: patch.groupId || null,
      z: num(patch.z, this._nextZ(spaceId)),
      collapsed: !!patch.collapsed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      media: patch.media || null,
      targetSpaceId: patch.targetSpaceId || null,
      panelKind: patch.panelKind || null,
      cardKind: patch.cardKind || null,
      cardData: patch.cardData || null,
      text: patch.text || '',
      stackId: patch.stackId || null,
      stackIdx: num(patch.stackIdx, 0),
      _thumb: patch._thumb || null
    }
    this.nodes.push(node)
    if (node.parentId) {
      const p = this.nodeById(node.parentId)
      if (p) {
        if (!p.childrenIds.includes(node.id)) p.childrenIds.push(node.id)
        this._addEdgeInternal(p.id, node.id, this.settings.edgeStyle, 'mind', true)
      }
    }
    if (!patch.silent) this.touch('node:add', { index: true })
    return node
  }
  updateNode(id, patch, { history = false, index = false, save = true } = {}) {
    const n = this.nodeById(id)
    if (!n) return null
    if (history) this.pushUndo()
    Object.keys(patch).forEach((k) => {
      if (k === 'id' || k === 'spaceId') return
      n[k] = patch[k]
    })
    n.updatedAt = Date.now()
    this.touch('node:update', { index, save })
    return n
  }
  addChildNode(parentId, { title = '新节点', x, y, w = 220, h = 108 } = {}) {
    const parent = this.nodeById(parentId)
    if (!parent) return null
    this.pushUndo()
    const childCount = (parent.childrenIds || []).length
    const spot = (x != null && y != null)
      ? { x, y }
      : {
          x: parent.x + parent.w + 96,
          y: parent.y + (childCount - 1) * 24
        }
    const node = this.addNode({
      spaceId: parent.spaceId,
      kind: parent.kind === 'space' ? 'note' : parent.kind,
      title,
      x: spot.x, y: spot.y, w, h,
      parentId: parent.id
    })
    this.selectionAfterAdd = node.id
    this.touch('node:child', { index: true })
    return node
  }
  addSiblingNode(nodeId) {
    const n = this.nodeById(nodeId)
    if (!n) return null
    this.pushUndo()
    let created
    if (n.parentId && this.nodeById(n.parentId)) {
      const p = this.nodeById(n.parentId)
      const idx = p.childrenIds.indexOf(n.id)
      created = this.addNode({
        spaceId: n.spaceId,
        kind: n.kind === 'space' ? 'note' : n.kind,
        title: '新节点',
        x: n.x,
        y: n.y + n.h + 28,
        w: n.w,
        h: Math.min(n.h, 120),
        parentId: p.id
      })
      // 插到被选中节点之后，保持语义顺序
      if (idx >= 0) {
        p.childrenIds = p.childrenIds.filter((id) => id !== created.id)
        p.childrenIds.splice(idx + 1, 0, created.id)
      }
    } else {
      created = this.addNode({
        spaceId: n.spaceId,
        kind: 'note',
        title: '新节点',
        x: n.x + n.w + 48,
        y: n.y,
        w: n.w,
        h: Math.min(n.h, 120)
      })
    }
    this.touch('node:sibling', { index: true })
    return created
  }
  deleteNodes(ids) {
    const set = new Set()
    const walk = (id) => {
      if (set.has(id)) return
      const n = this.nodeById(id)
      if (!n) return
      set.add(id)
      ;(n.childrenIds || []).forEach(walk)
    }
    ids.forEach(walk)
    if (!set.size) return
    this.pushUndo()
    const touchedGroups = new Set()
    this.nodes = this.nodes.filter((n) => {
      if (!set.has(n.id)) return true
      if (n.groupId && this.groups[n.groupId]) {
        touchedGroups.add(n.groupId)
        this.groups[n.groupId].nodeIds = this.groups[n.groupId].nodeIds.filter((x) => x !== n.id)
      }
      return false
    })
    // 成员被删光的组一并移除，避免留一个空虚线框
    touchedGroups.forEach((gid) => {
      const g = this.groups[gid]
      if (g && !(g.nodeIds || []).length) delete this.groups[gid]
    })
    this.edges = this.edges.filter((e) => {
      const drop = set.has(e.fromId) || set.has(e.toId)
      if (!drop) return true
      const a = this.nodeById(e.fromId), b = this.nodeById(e.toId)
      if (a) a.edges = (a.edges || []).filter((x) => x.toId !== e.toId)
      if (b) b.edges = (b.edges || []).filter((x) => x.fromId !== e.fromId)
      return false
    })
    this.nodes.forEach((n) => {
      n.childrenIds = (n.childrenIds || []).filter((id) => !set.has(id))
      n.edges = (n.edges || []).filter((e) => !set.has(e.toId) && !set.has(e.fromId))
      if (n.parentId && set.has(n.parentId)) n.parentId = null
    })
    this.touch('node:delete', { index: true })
  }
  duplicateNodes(ids, offset = { x: 40, y: 40 }) {
    const src = ids.map((id) => this.nodeById(id)).filter(Boolean)
    if (!src.length) return []
    this.pushUndo()
    const map = new Map()
    const copies = src.map((n) => {
      const c = this.addNode({
        spaceId: this.currentId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        x: n.x + offset.x,
        y: n.y + offset.y,
        w: n.w, h: n.h,
        media: n.media,
        color: n.color,
        panelKind: n.panelKind,
        cardKind: n.cardKind,
        cardData: n.cardData ? JSON.parse(JSON.stringify(n.cardData)) : null,
        text: n.text,
        silent: true
      })
      map.set(n.id, c.id)
      return c
    })
    // 复制内部拓扑
    src.forEach((n) => {
      const c = this.nodeById(map.get(n.id))
      if (n.parentId && map.has(n.parentId)) {
        c.parentId = map.get(n.parentId)
        const p = this.nodeById(c.parentId)
        if (p && !p.childrenIds.includes(c.id)) p.childrenIds.push(c.id)
        if (!this.edges.some((e) => e.fromId === c.parentId && e.toId === c.id)) {
          this._addEdgeInternal(c.parentId, c.id, this.settings.edgeStyle, 'mind', true)
        }
      }
      ;(n.edges || []).forEach((e) => {
        if (map.has(e.fromId) && map.has(e.toId) && e.fromId === n.id) {
          this._addEdgeInternal(map.get(e.fromId), map.get(e.toId), e.type, 'mind', true)
        }
      })
    })
    this.touch('node:duplicate', { index: true })
    return copies
  }

  // 跨空间搬运节点（用于把卡片 / 组拖进空间卡）
  // 落位策略：整批保持相对布局，平移到目标空间「进入时的视图中心」；
  // 若与目标空间已有内容重叠，再按螺旋步进找一个空位，避免移入后看不见或叠在别人身上。
  moveNodesToSpace(ids, spaceId, { recenter = true } = {}) {
    if (!this.spaces[spaceId]) return 0
    const set = new Set(ids)
    const moving = this.nodes.filter((n) => set.has(n.id) && n.spaceId !== spaceId)
    if (!moving.length) return 0
    const cam = this.spaces[spaceId].camera || { x: 0, y: 0, s: 1 }
    const bounds = unionRect(moving.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })))
    let dx = 0
    let dy = 0
    if (recenter) {
      dx = cam.x - (bounds.x + bounds.w / 2)
      dy = cam.y - (bounds.y + bounds.h / 2)
      const others = this.nodes.filter((n) => n.spaceId === spaceId && !set.has(n.id))
      const hit = (x, y, w, h) => others.some((n) => !(
        x + w + 24 < n.x || n.x + n.w + 24 < x || y + h + 24 < n.y || n.y + n.h + 24 < y
      ))
      if (hit(bounds.x + dx, bounds.y + dy, bounds.w, bounds.h)) {
        const golden = Math.PI * (3 - Math.sqrt(5))
        for (let i = 1; i < 240; i++) {
          const r = 60 * Math.sqrt(i)
          const a = i * golden
          const x = cam.x + Math.cos(a) * r - bounds.w / 2
          const y = cam.y + Math.sin(a) * r - bounds.h / 2
          if (!hit(x, y, bounds.w, bounds.h)) {
            dx = x - bounds.x
            dy = y - bounds.y
            break
          }
        }
      }
    }
    moving.forEach((n) => {
      // 跨空间后不再属于原空间的组
      if (n.groupId) {
        const g = this.groups[n.groupId]
        if (g) {
          g.nodeIds = (g.nodeIds || []).filter((x) => x !== n.id)
          if (!g.nodeIds.length) delete this.groups[n.groupId]
        }
        n.groupId = null
      }
      n.x += dx
      n.y += dy
      n.spaceId = spaceId
    })
    // 两端都搬迁的连线一并迁移，避免跨空间孤边
    this.edges.forEach((e) => {
      if (set.has(e.fromId) && set.has(e.toId)) e.spaceId = spaceId
    })
    this.drawings.forEach((d) => {
      if (!set.has(d.id) || d.spaceId === spaceId) return
      if (d.pts) d.pts = d.pts.map((q) => [q[0] + dx, q[1] + dy])
      if (typeof d.x1 === 'number') { d.x1 += dx; d.x2 += dx }
      if (typeof d.y1 === 'number') { d.y1 += dy; d.y2 += dy }
      d.spaceId = spaceId
    })
    this.touch('node:move-space', { index: true })
    return moving.length
  }
  // 堆叠组伙伴（含自身，按 stackIdx 从组顶到组底）
  stackPeers(nodeId) {
    const n = this.nodeById(nodeId)
    if (!n || !n.stackId) return n ? [n] : []
    const hidden = this.hiddenPanelKinds || []
    return this.nodes
      .filter((x) => x.spaceId === n.spaceId && x.stackId === n.stackId && !hidden.includes(x.panelKind))
      .sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
  }
  // 记录首次入堆前的尺寸，供打散 / 移出时还原（再次入堆不覆盖）
  _rememberSize(n) {
    if (n.origW == null) n.origW = n.w
    if (n.origH == null) n.origH = n.h
  }
  _restoreSize(n) {
    if (n.origW != null) n.w = n.origW
    if (n.origH != null) n.h = n.origH
    n.origW = null
    n.origH = null
  }
  // v3.0.2：连接卡片「文件夹式收起」——按 ws.edges 找直连节点，用独立字段，不碰 stackId
  collapseConnected(nodeId) {
    const ids = new Set()
    this.edges.forEach((e) => {
      if (e.fromId === nodeId) ids.add(e.toId)
      if (e.toId === nodeId) ids.add(e.fromId)
    })
    ids.forEach((id) => { const n = this.nodeById(id); if (n) n.folderCollapsed = true })
    const root = this.nodeById(nodeId)
    if (root) root.folderRoot = true
    this.touch('node:folder')
    return ids.size
  }
  expandConnected(nodeId) {
    this.nodes.forEach((n) => { if (n.folderCollapsed) delete n.folderCollapsed })
    const root = this.nodeById(nodeId)
    if (root) delete root.folderRoot
    this.touch('node:folder')
  }
  unstack(stackId) {
    if (!stackId) return
    const members = this.nodes.filter((n) => n.stackId === stackId)
    if (!members.length) return
    this.pushUndo()
    members.forEach((n) => {
      n.stackId = null
      n.stackIdx = 0
      this._restoreSize(n)
    })
    this.touch('stack:remove')
  }
  // 2026-11-04：拖卡悬停 1 秒 → 堆到目标卡上（同空间；一张卡只属于一个堆叠组）
  stackNodes(targetId, fromId) {
    const to = this.nodeById(targetId)
    const from = this.nodeById(fromId)
    if (!to || !from || to.id === from.id) return null
    if (to.spaceId !== from.spaceId) return null
    // 空间卡是容器入口，既不作为堆叠源也不作为目标，避免「空间卡能叠卡片」的歧义
    if (to.kind === 'space' || from.kind === 'space') return null
    const hidden = this.hiddenPanelKinds || []
    if (hidden.includes(to.panelKind) || hidden.includes(from.panelKind)) return null
    if (to.stackId && from.stackId === to.stackId) return null
    this.pushUndo()
    const oldGroup = from.stackId
    const groupId = to.stackId || ('stk_' + Math.random().toString(36).slice(2, 8))
    const members = this.nodes.filter((n) => n.spaceId === to.spaceId && n.stackId === groupId)
    if (!to.stackId) to.stackId = groupId
    if (!members.length) to.stackIdx = 0
    const baseIdx = Math.max(0, ...members.map((n) => n.stackIdx || 0)) + 1
    from.stackId = groupId
    from.stackIdx = baseIdx
    // 旧堆叠组只剩一张时自动解散，避免留下空组（解散同时还原它入堆前的尺寸）
    if (oldGroup && oldGroup !== groupId) {
      const left = this.nodes.filter((n) => n.stackId === oldGroup)
      if (left.length === 1) { left[0].stackId = null; left[0].stackIdx = 0; this._restoreSize(left[0]) }
    }
    const all = this.nodes.filter((n) => n.spaceId === to.spaceId && n.stackId === groupId)
    const ax = Math.min(...all.map((n) => n.x))
    const ay = Math.min(...all.map((n) => n.y))
    const maxZ = Math.max(...all.map((n) => n.z || 0))
    // 以组顶卡尺寸为准：整组统一宽高（旧版堆叠的自动对齐规则）
    const aw = to.w
    const ah = to.h
    all.forEach((n) => {
      this._rememberSize(n)
      n.z = maxZ - (n.stackIdx || 0)
      n.x = ax + (n.stackIdx || 0) * 18
      n.y = ay + (n.stackIdx || 0) * 18
      n.w = aw
      n.h = ah
    })
    this.rebuildIndex()
    this.touch('stack:add', { index: true })
    this.saveDebounced()
    return groupId
  }
  // 堆叠翻页：dir=1 下滚（下一张翻到顶），dir=-1 上滚（上一张翻到顶）
  rotateStack(stackId, dir = 1) {
    if (!stackId) return null
    const hidden = this.hiddenPanelKinds || []
    const all = this.nodes
      .filter((n) => n.stackId === stackId)
      .sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
    // 关闭的插件卡不参与翻页，避免滚轮翻到一张“空白页”
    const members = all.filter((n) => !hidden.includes(n.panelKind))
    if (members.length < 2) return null
    const k = members.length
    members.forEach((n, i) => {
      n.stackIdx = (i - dir + k) % k
    })
    const maxZ = Math.max(...all.map((n) => n.z || 0))
    const top = members.find((n) => n.stackIdx === 0)
    // 位置始终由 stackIdx 推导：组顶固定锚点，向下逐张 18px 错位
    const ax = Math.min(...all.map((n) => n.x))
    const ay = Math.min(...all.map((n) => n.y))
    // 隐藏成员排到堆叠底部，重新开启后仍能正常参与翻页
    all.filter((n) => hidden.includes(n.panelKind)).forEach((n, i) => { n.stackIdx = k + i })
    all.forEach((n) => {
      this._rememberSize(n)
      n.z = maxZ - n.stackIdx
      n.x = ax + n.stackIdx * 18
      n.y = ay + n.stackIdx * 18
      // 翻页过程尺寸恒定：沿用当前组顶卡的宽高
      if (top) { n.w = top.w; n.h = top.h }
    })
    this.touch('stack:rotate')
    return top || null
  }

  // ---------- 连线 ----------
  _addEdgeInternal(fromId, toId, type = 'curve', source = 'mind', silent = false) {
    if (fromId === toId) return null
    const a = this.nodeById(fromId), b = this.nodeById(toId)
    if (!a || !b || a.spaceId !== b.spaceId) return null
    const exist = this.edges.find((e) => e.fromId === fromId && e.toId === toId)
    if (exist) return exist
    const edge = {
      id: uid('e'),
      spaceId: a.spaceId,
      fromId, toId,
      type: type || 'curve',
      arrow: this.settings.arrow !== false,
      source
    }
    this.edges.push(edge)
    if (!a.edges) a.edges = []
    if (!b.edges) b.edges = []
    a.edges.push({ edgeId: edge.id, fromId, toId, type: edge.type })
    b.edges.push({ edgeId: edge.id, fromId, toId, type: edge.type })
    if (!silent) this.touch('edge:add')
    return edge
  }
  connect(fromId, toId, type = this.settings.edgeStyle) {
    if (!this.nodeById(fromId) || !this.nodeById(toId) || fromId === toId) return null
    this.pushUndo()
    const e = this._addEdgeInternal(fromId, toId, type, 'manual')
    if (e) this.touch('edge:add')
    return e
  }
  setEdgeType(edgeId, type) {
    const e = this.edges.find((x) => x.id === edgeId)
    if (!e) return
    e.type = type
    ;[e.fromId, e.toId].forEach((id) => {
      const n = this.nodeById(id)
      if (n) n.edges = (n.edges || []).map((x) => (x.edgeId === edgeId ? Object.assign({}, x, { type }) : x))
    })
    this.touch('edge:type')
  }
  deleteEdge(edgeId) {
    const e = this.edges.find((x) => x.id === edgeId)
    if (!e) return
    this.pushUndo()
    this.edges = this.edges.filter((x) => x.id !== edgeId)
    ;[e.fromId, e.toId].forEach((id) => {
      const n = this.nodeById(id)
      if (n) n.edges = (n.edges || []).filter((x) => x.edgeId !== edgeId)
    })
    this.touch('edge:delete')
  }
  // 脑图子节点连线跟随父级展示
  syncTreeEdges(nodeIds) {
    nodeIds.forEach((id) => {
      const n = this.nodeById(id)
      if (!n || !n.parentId) return
      if (!this.edges.some((e) => (e.fromId === n.parentId && e.toId === n.id) || (e.fromId === n.id && e.toId === n.parentId))) {
        this._addEdgeInternal(n.parentId, n.id, this.settings.edgeStyle, 'mind', true)
      }
    })
  }

  // ---------- 绘画 ----------
  addDrawing(patch = {}) {
    const spaceId = patch.spaceId || this.currentId
    const d = Object.assign({
      id: patch.id || uid('d'),
      spaceId,
      tool: 'ballpoint',
      color: '#2C2C2C',
      width: 3,
      opacity: 1,
      dash: 'solid',
      smooth: 0.6,
      pts: [],
      x1: 0, y1: 0, x2: 0, y2: 0,
      z: this._nextZ(spaceId),
      groupId: null,
      createdAt: Date.now()
    }, patch)
    this.recomputeDrawingBounds(d)
    this.drawings.push(d)
    this.touch('draw:add', { index: true })
    return d
  }
  recomputeDrawingBounds(d) {
    let x1 = d.x1, y1 = d.y1, x2 = d.x2, y2 = d.y2
    if (d.pts && d.pts.length) {
      x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity
      d.pts.forEach((p) => {
        if (p[0] < x1) x1 = p[0]
        if (p[1] < y1) y1 = p[1]
        if (p[0] > x2) x2 = p[0]
        if (p[1] > y2) y2 = p[1]
      })
    }
    const pad = Math.max(6, (d.width || 2) * (d.tool === 'highlighter' ? 3 : 1.5))
    d.x = Math.min(x1, x2) - pad
    d.y = Math.min(y1, y2) - pad
    d.w = Math.abs(x2 - x1) + pad * 2
    d.h = Math.abs(y2 - y1) + pad * 2
    return d
  }
  updateDrawing(id, patch) {
    const d = this.drawingById(id)
    if (!d) return
    Object.assign(d, patch)
    this.recomputeDrawingBounds(d)
    this.touch('draw:update', { index: true })
  }
  deleteDrawings(ids) {
    const set = new Set(ids)
    if (!set.size) return
    this.pushUndo()
    this.drawings = this.drawings.filter((d) => !set.has(d.id))
    Object.values(this.groups).forEach((g) => { g.nodeIds = g.nodeIds.filter((id) => !set.has(id)) })
    this.touch('draw:delete', { index: true })
  }

  // ---------- 图层排序（节点与绘画共享 z 空间） ----------
  zList(spaceId = this.currentId) {
    const list = []
    this.nodes.forEach((n) => { if (n.spaceId === spaceId) list.push({ id: n.id, type: 'node', z: n.z, ref: n }) })
    this.drawings.forEach((d) => { if (d.spaceId === spaceId) list.push({ id: d.id, type: 'draw', z: d.z, ref: d }) })
    return list.sort((a, b) => a.z - b.z)
  }
  reorder(id, op) {
    const list = this.zList()
    const idx = list.findIndex((x) => x.id === id)
    if (idx < 0) return
    this.pushUndo()
    const cur = list[idx]
    if (op === 'front') {
      cur.ref.z = list[list.length - 1].z + 1
    } else if (op === 'back') {
      cur.ref.z = list[0].z - 1
    } else if (op === 'up') {
      if (idx < list.length - 1) {
        const nxt = list[idx + 1]
        const z = nxt.z
        nxt.ref.z = cur.z
        cur.ref.z = z + 0.5
      }
    } else if (op === 'down') {
      if (idx > 0) {
        const prv = list[idx - 1]
        const z = prv.z
        prv.ref.z = cur.z
        cur.ref.z = z - 0.5
      }
    }
    this.touch('layer:reorder')
  }

  // ---------- 组合 / 分类组（2026-11-04 P2） ----------
  // 组是画布上的虚线分类容器：不是节点，用 groups[id] + 节点 groupId 关联。
  // 组同时保存自己的矩形（x/y/w/h），因此空组也能显示、能被拖入卡片、能被整组移动。
  group(ids) {
    const valid = ids.map((id) => this.nodeById(id)).filter(Boolean)
    if (valid.length < 2) return null
    this.pushUndo()
    const id = uid('g')
    const r = unionRect(valid.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })))
    this.groups[id] = {
      id, spaceId: this.currentId, nodeIds: valid.map((n) => n.id), name: '组合', createdAt: Date.now(),
      x: (r ? r.x : 0) - 16, y: (r ? r.y : 0) - 32, w: (r ? r.w : 240) + 32, h: (r ? r.h : 160) + 48
    }
    valid.forEach((n) => { n.groupId = id })
    this.touch('group:create')
    return this.groups[id]
  }
  // 在画布空白处新建一个空组（新建菜单「组」）
  createGroupAt(x, y, w = 300, h = 220, name = '新组') {
    this.pushUndo()
    const id = uid('g')
    this.groups[id] = {
      id, spaceId: this.currentId, nodeIds: [], name,
      x: Math.round(x), y: Math.round(y), w, h, createdAt: Date.now()
    }
    this.touch('group:create')
    return this.groups[id]
  }
  groupPeers(groupId) {
    const g = this.groups[groupId]
    if (!g) return []
    return (g.nodeIds || []).map((id) => this.nodeById(id)).filter((n) => n && n.spaceId === g.spaceId)
  }
  // 组框矩形（用于拖动整组 / 命中判断），与展示包围盒分开：
  // 展示包围盒 = 组框 ∪ 成员包围盒，保证成员永远不被框裁掉。
  groupRect(groupId) {
    const g = this.groups[groupId]
    if (!g || !isFinite(g.x) || !isFinite(g.y) || !isFinite(g.w) || !isFinite(g.h)) return null
    return { x: g.x, y: g.y, w: g.w, h: g.h }
  }
  groupBounds(groupId) {
    const g = this.groups[groupId]
    if (!g) return null
    const rects = (g.nodeIds || []).map((id) => this.nodeById(id)).filter(Boolean)
      .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
    let r = null
    if (rects.length) {
      const u = unionRect(rects)
      r = { x: u.x - 16, y: u.y - 32, w: u.w + 32, h: u.h + 48 }
    }
    const base = this.groupRect(groupId)
    if (r && base) return unionRect([r, base])
    return r || base
  }
  // 把节点放进组（拖入）
  addToGroup(groupId, nodeId) {
    const g = this.groups[groupId]
    const n = this.nodeById(nodeId)
    if (!g || !n || n.spaceId !== g.spaceId || n.groupId === groupId) return false
    this.pushUndo()
    if (n.groupId) this.removeFromGroup(nodeId, true)
    g.nodeIds = (g.nodeIds || []).filter((x) => x !== nodeId)
    g.nodeIds.push(nodeId)
    n.groupId = groupId
    // 组框随成员扩张，保证下次能明确「拖出」
    const r = { x: n.x - 18, y: n.y - 34, w: n.w + 36, h: n.h + 52 }
    const base = this.groupRect(groupId)
    const merged = base ? unionRect([base, r]) : r
    g.x = merged.x; g.y = merged.y; g.w = merged.w; g.h = merged.h
    this.touch('group:add')
    return true
  }
  // 把节点移出组（拖出 / 跨空间搬运）
  removeFromGroup(nodeId, silent = false) {
    const n = this.nodeById(nodeId)
    if (!n || !n.groupId) return false
    const g = this.groups[n.groupId]
    if (!silent) this.pushUndo()
    n.groupId = null
    if (g) g.nodeIds = (g.nodeIds || []).filter((x) => x !== nodeId)
    if (!silent) this.touch('group:remove')
    return true
  }
  renameGroup(groupId, name) {
    const g = this.groups[groupId]
    if (!g) return
    g.name = String(name || '').trim() || g.name
    this.touch('group:rename')
  }
  ungroup(groupId) {
    const g = this.groups[groupId]
    if (!g) return
    this.pushUndo()
    g.nodeIds.forEach((id) => {
      const n = this.nodeById(id)
      if (n && n.groupId === groupId) n.groupId = null
    })
    delete this.groups[groupId]
    this.touch('group:remove')
  }

  // ---------- 布局落点 ----------
  findFreeSpot(spaceId, w, h, cx = 0, cy = 0, avoidIds = []) {
    const others = this.nodes.filter((n) => n.spaceId === spaceId && !avoidIds.includes(n.id))
    const hit = (x, y) => others.some((n) => !(x + w + 24 < n.x || n.x + n.w + 24 < x || y + h + 24 < n.y || n.y + n.h + 24 < y))
    if (!hit(cx - w / 2, cy - h / 2)) return { x: cx - w / 2, y: cy - h / 2 }
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 1; i < 240; i++) {
      const r = 36 * Math.sqrt(i)
      const a = i * golden
      const x = cx + Math.cos(a) * r - w / 2
      const y = cy + Math.sin(a) * r - h / 2
      if (!hit(x, y)) return { x: Math.round(x), y: Math.round(y) }
    }
    return { x: cx + 80, y: cy + 80 }
  }
  contentBounds(spaceId = this.currentId) {
    const okRect = (r) => r && isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h) && r.w > 0 && r.h > 0
    const rects = this.nodes.filter((n) => n.spaceId === spaceId).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      .concat(this.drawings.filter((d) => d.spaceId === spaceId).map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })))
    return unionRect(rects.filter(okRect))
  }

  // ---------- 空间索引 ----------
  rebuildIndex() {
    const items = []
    this.nodes.forEach((n) => {
      if (n.spaceId !== this.currentId) return
      items.push({ id: n.id, type: 'node', x: n.x, y: n.y, w: n.w, h: n.h, data: n })
    })
    this.drawings.forEach((d) => {
      if (d.spaceId !== this.currentId) return
      items.push({ id: d.id, type: 'draw', x: d.x, y: d.y, w: d.w, h: d.h, data: d })
    })
    this.index.rebuild(items)
    return this.index
  }
  query(rect) {
    const hits = this.index.query(rect)
    const hidden = this.hiddenPanelKinds
    if (!hidden || !hidden.length) return hits
    return hits.filter((it) => it.type !== 'node' || !hidden.includes(it.data.panelKind))
  }
  hitTest(x, y) {
    const hits = this.query({ x, y, w: 0.01, h: 0.01 })
    // 后绘制的在上层 → 按 z 倒序
    hits.sort((a, b) => (b.data.z || 0) - (a.data.z || 0))
    return hits[0] || null
  }

  // ---------- 序列化 / 持久化 ----------
  serialize() {
    const stripNode = (n) => {
      const { media, ...rest } = n
      const m = media ? Object.assign({}, media) : null
      if (m) { delete m.src; delete m.file; delete m.handle }
      return Object.assign({}, rest, { media: m })
    }
    const stripDraw = (d) => ({ ...d })
    return {
      version: 1,
      currentId: this.currentId,
      settings: JSON.parse(JSON.stringify(this.settings)),
      spaces: JSON.parse(JSON.stringify(this.spaces)),
      nodes: this.nodes.map(stripNode),
      edges: this.edges.map((e) => ({ ...e })),
      drawings: this.drawings.map(stripDraw),
      groups: JSON.parse(JSON.stringify(this.groups))
    }
  }
  load(raw) {
    if (!raw || raw.version !== 1) return false
    const spaces = raw.spaces || {}
    if (!spaces.root) return false
    this.spaces = spaces
    // 修复每个空间的 childIds / parentId 一致性
    Object.values(this.spaces).forEach((sp) => {
      if (!Array.isArray(sp.childIds)) sp.childIds = []
      if (!sp.camera) sp.camera = { x: 0, y: 0, s: 1 }
    })
    this.nodes = (raw.nodes || []).map((n) => Object.assign({
      kind: 'note', body: '', color: null, parentId: null, childrenIds: [], edges: [],
      groupId: null, z: 1, collapsed: false, media: null, targetSpaceId: null,
      panelKind: null, cardKind: null, cardData: null, text: '',
      stackId: null, stackIdx: 0
    }, n))
    // 2026-11-04 迁移：已下线的卡片类型（文字 / 链接 / 导航 / 导航面板 / 隐藏 / 热图 / 便签卡）
    // 一律转成便利贴（kind:'memo'），保留原有正文与位置尺寸，避免画布上留下无法渲染的空白壳卡。
    const RETIRED_CARD_KINDS = ['text', 'link', 'nav', 'menu', 'hidden', 'heatmap', 'note']
    this.nodes.forEach((n) => {
      if (n.kind !== 'card' || !RETIRED_CARD_KINDS.includes(n.cardKind)) return
      const d = n.cardData || {}
      const bodyText = d.markdown || d.text || d.content || d.label || d.title || ''
      const url = d.url && d.url !== 'https://' ? d.url : ''
      n.kind = 'memo'
      n.text = String(bodyText || (url ? url : '')) + (bodyText && url ? '\n' + url : '')
      n.cardKind = null
      n.cardData = null
    })
    this.edges = (raw.edges || []).filter((e) => e && e.fromId && e.toId)
    this.drawings = (raw.drawings || []).map((d) => Object.assign({ pts: [], tool: 'ballpoint' }, d))
    this.drawings.forEach((d) => {
      if (d.pts && d.pts.length) {
        this.recomputeDrawingBounds(d)
      } else {
        d.x = Math.min(d.x1, d.x2); d.y = Math.min(d.y1, d.y2)
        d.w = Math.abs(d.x2 - d.x1); d.h = Math.abs(d.y2 - d.y1)
      }
    })
    this.groups = raw.groups || {}
    this.settings = Object.assign(defaultSettings(), raw.settings || {})
    this.settings.background = Object.assign(defaultSettings().background, (raw.settings || {}).background || {})
    this.settings.spacing = Object.assign(defaultSettings().spacing, (raw.settings || {}).spacing || {})
    this.currentId = spaces[raw.currentId] ? raw.currentId : 'root'
    // 清理孤儿引用
    const idSet = new Set(this.nodes.map((n) => n.id))
    this.nodes.forEach((n) => {
      n.childrenIds = (n.childrenIds || []).filter((id) => idSet.has(id))
      n.parentId = n.parentId && idSet.has(n.parentId) ? n.parentId : null
      n.edges = (n.edges || []).filter((e) => idSet.has(e.fromId) && idSet.has(e.toId))
    })
    this.rebuildIndex()
    this._calmDefaultSizes()
    return true
  }

  // v2.1.0 手感校准：只把「仍停在旧默认尺寸」的卡片收一圈；用户手动改过尺寸的不动，堆叠成员也不动
  _calmDefaultSizes() {
    if (this.settings.sizeCalm21) return
    const MAP = {
      audio: [[320, 240, 292, 220], [460, 220, 400, 200]],
      image: [[280, 220, 248, 196]],
      doc: [[360, 320, 340, 300]],
      memo: [[248, 160, 228, 152]],
      clock: [[260, 170, 244, 158]]
    }
    this.nodes.forEach((n) => {
      const key = n.kind === 'card' ? n.cardKind : n.kind
      const pairs = MAP[key]
      if (!pairs || n.stackId) return
      const hit = pairs.find((p) => n.w === p[0] && n.h === p[1])
      if (!hit) return
      n.w = hit[2]; n.h = hit[3]
    })
    this.settings.sizeCalm21 = true
  }
  saveNow() {
    this._dirty = false
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()))
      return true
    } catch (e) {
      console.warn('[space] 保存失败（可能超出配额）', e)
      return false
    }
  }
  saveDebounced() {
    this._dirty = true
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      if (this._dirty) this.saveNow()
    }, 500)
  }
  hasSaved() {
    try { return !!localStorage.getItem(STORAGE_KEY) } catch (e) { return false }
  }
  loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      return this.load(JSON.parse(raw))
    } catch (e) { return false }
  }
  resetAll() {
    clearSavedSpace()
  }

  // ---------- 撤销 / 重做 ----------
  _snapshot() {
    return JSON.stringify({
      spaces: this.spaces,
      nodes: this.nodes.map((n) => {
        const { media, ...rest } = n
        const m = media ? Object.assign({}, media) : null
        if (m) { delete m.src; delete m.file; delete m.handle }
        return Object.assign({}, rest, { media: m })
      }),
      edges: this.edges,
      drawings: this.drawings,
      groups: this.groups,
      settings: this.settings,
      currentId: this.currentId
    })
  }
  pushUndo() {
    try {
      this.history.push({ s: this._snapshot(), label: '' })
      if (this.history.length > MAX_HISTORY) this.history.shift()
      this.future.length = 0
      this.undoLabel = ''
      this.redoLabel = ''
    } catch (e) {}
  }
  _restore(str) {
    const s = JSON.parse(str)
    this.spaces = s.spaces
    this.nodes = s.nodes
    this.edges = s.edges
    this.drawings = s.drawings
    this.groups = s.groups
    this.settings = Object.assign(defaultSettings(), s.settings || {})
    this.currentId = this.spaces[s.currentId] ? s.currentId : 'root'
    this.rebuildIndex()
    this.touch('restore')
  }
  undo() {
    if (!this.history.length) return false
    const h = this.history.pop()
    this.future.push({ s: this._snapshot(), label: h.label || '操作' })
    this.undoLabel = h.label || '操作'
    this._restore(h.s)
    return true
  }
  redo() {
    if (!this.future.length) return false
    const f = this.future.pop()
    this.history.push({ s: this._snapshot(), label: f.label || '操作' })
    this.redoLabel = f.label || '操作'
    this._restore(f.s)
    return true
  }
  canUndo() { return this.history.length > 0 }
  canRedo() { return this.future.length > 0 }

  // ---------- 种子数据 ----------
  seedDemo() {
    this.spaces = {}
    this.nodes = []
    this.edges = []
    this.drawings = []
    this.groups = {}
    this.settings = defaultSettings()
    const root = emptySpace('root', '地球Online', null, { x: 30, y: 40, s: 0.9 })
    this.spaces.root = root
    this.currentId = 'root'

    const mk = (o) => {
      const n = {
        id: o.id || uid('n'),
        spaceId: o.spaceId || 'root',
        kind: o.kind || 'note',
        title: o.title || '节点',
        body: o.body || '',
        x: o.x || 0, y: o.y || 0, w: o.w || 240, h: o.h || 148,
        color: o.color !== undefined ? o.color : autoColor(o.title || o.id || 'x', 'warm'),
        parentId: o.parentId || null,
        childrenIds: [], edges: [], groupId: null,
        z: o.z || this.nodes.length + 1,
        collapsed: false, createdAt: Date.now(), updatedAt: Date.now(),
        media: null, targetSpaceId: o.targetSpaceId || null,
        _thumb: null
      }
      this.nodes.push(n)
      return n
    }
    const link = (a, b, type = 'curve') => {
      const e = { id: uid('e'), spaceId: 'root', fromId: a, toId: b, type, arrow: false, source: 'mind' }
      this.edges.push(e)
      ;[a, b].forEach((id) => {
        const n = this.nodeById(id)
        if (n) n.edges.push({ edgeId: e.id, fromId: a, toId: b, type })
      })
    }

    // 欢迎卡
    const welcome = mk({
      id: 'n_welcome', title: '无限画布工作区', kind: 'note',
      body: '在这里，文件不再排成列表。\n把想法拖到任意位置，用「空间」收纳世界。\n\n· 双击空白：新建节点\n· Tab / Enter：子节点 / 同级节点\n· 滚轮：平移，Ctrl + 滚轮：缩放\n· 空格 + 拖拽：抓手漫游',
      x: -640, y: -260, w: 380, h: 258, color: '#E8B86D', z: 2
    })
    welcome.w = 380; welcome.h = 258

    // 脑图主干
    const mindRoot = mk({ id: 'n_mind', title: 'v2.1 可视化重构', body: '空间 · 画布 · 节点', x: -120, y: -80, w: 280, h: 110, color: '#2C2C2C', z: 3 })
    const branches = [
      { id: 'n_b1', title: '空间层级', body: '面包屑 / Backspace / Esc', color: '#9DB3A0', x: 320, y: -300 },
      { id: 'n_b2', title: 'Canvas 2D 渲染', body: '四叉树裁剪 · 1000+ 元素', color: '#A8BBCB', x: 360, y: -170 },
      { id: 'n_b3', title: '脑图节点', body: '坐标 + 拓扑双存', color: '#C99C8C', x: 360, y: -40 },
      { id: 'n_b4', title: '绘画模块', body: '笔刷 · 形状 · 抬笔成型', color: '#D3A6A6', x: 320, y: 90 },
      { id: 'n_b5', title: '3D 空间过渡', body: '文件夹展开 · 性能降级', color: '#9A9A96', x: 300, y: 220 }
    ]
    branches.forEach((b) => {
      const n = mk({ id: b.id, title: b.title, body: b.body, x: b.x, y: b.y, w: 240, h: 104, color: b.color, parentId: 'n_mind', z: 4 })
      mindRoot.childrenIds.push(n.id)
      link(mindRoot.id, n.id, 'curve')
    })
    // 二级节点
    const leafs = [
      { parent: 'n_b1', title: '视口持久化', x: 650, y: -330 },
      { parent: 'n_b1', title: '空间切换 = 状态恢复', x: 650, y: -210 },
      { parent: 'n_b3', title: '5 种布局算法', x: 650, y: -60 },
      { parent: 'n_b4', title: '手绘识别', x: 620, y: 70 }
    ]
    leafs.forEach((l) => {
      const n = mk({ title: l.title, x: l.x, y: l.y, w: 210, h: 76, color: '#C8C5BD', parentId: l.parent, z: 5 })
      this.nodeById(l.parent).childrenIds.push(n.id)
      link(l.parent, n.id, 'curve')
    })

    // 子空间卡片
    const spaces = [
      { id: 'sp_create', name: '创作空间', x: -660, y: 80, color: '#E8B86D' },
      { id: 'sp_life', name: '生活记录', x: -660, y: 240, color: '#9DB3A0' },
      { id: 'sp_media', name: '媒体库', x: -660, y: 400, color: '#A8BBCB' }
    ]
    spaces.forEach((s) => {
      const sp = emptySpace(s.id, s.name, 'root', { x: 0, y: 0, s: 1 })
      this.spaces[s.id] = sp
      root.childIds.push(s.id)
      mk({ kind: 'space', title: s.name, x: s.x, y: s.y, w: 220, h: 118, color: s.color, targetSpaceId: s.id, z: 6 })
    })

    // 创作空间：局部脑图 + 手绘示意
    const cRoom = this.spaces.sp_create
    cRoom.camera = { x: 260, y: 60, s: 0.85 }
    const ideas = [
      { id: 'c1', title: '灵感池', body: '把散落的想法先丢进来', x: 0, y: -40, w: 250, h: 120, color: '#E8B86D' },
      { id: 'c2', title: '本周短篇', body: '## 三个片段\n- 海边的信号塔\n- 地铁末班车\n- 没有寄出的信', x: 380, y: -110, w: 260, h: 160, color: '#C99C8C' },
      { id: 'c3', title: '配乐清单', body: '钢琴 / 环境音 / 磁带质感', x: 390, y: 80, w: 240, h: 110, color: '#A8BBCB' },
      { id: 'c4', title: '结构草图', body: '开头 → 回声 → 收束', x: 390, y: 230, w: 240, h: 100, color: '#9DB3A0' }
    ]
    const cNodes = ideas.map((o) => {
      const n = mk(Object.assign({ spaceId: 'sp_create', parentId: o.id === 'c1' ? null : 'c1', z: 10 }, o))
      if (o.id !== 'c1') { this.nodeById('c1').childrenIds.push(n.id); this._addEdgeInternal('c1', n.id, 'curve', 'mind', true) }
      return n
    })
    cNodes.forEach((n) => { n.spaceId = 'sp_create' })
    this.edges.forEach((e) => { if (e.fromId === 'c1') e.spaceId = 'sp_create' })

    // 生活记录
    const lRoom = this.spaces.sp_life
    lRoom.camera = { x: 80, y: 0, s: 1 }
    mk({ spaceId: 'sp_life', title: '十月清单', body: '- [x] 搬家\n- [ ] 看完三本书\n- [ ] 给阳台装一盏灯', x: -80, y: -100, w: 260, h: 170, color: '#9DB3A0' })
    mk({ spaceId: 'sp_life', title: '周末去处', body: '山里 · 旧书店 · 河边', x: 260, y: 60, w: 230, h: 120, color: '#C99C8C' })

    // 媒体库
    const mRoom = this.spaces.sp_media
    mRoom.camera = { x: 0, y: 0, s: 1 }
    mk({ spaceId: 'sp_media', kind: 'file', title: '拖入图片 / 视频', body: '也可以连接一个外部媒体文件夹\n递归扫描最深 5 层。', x: -40, y: -30, w: 300, h: 150, color: '#A8BBCB' })

    // 根画布上的手绘：一条温和的下划线 + 星形，证明绘画层与节点共存
    const stroke = {
      spaceId: 'root', tool: 'highlighter', color: '#E8B86D', width: 5, opacity: 0.5,
      pts: Array.from({ length: 24 }, (_, i) => [40 + i * 15, -60 + Math.sin(i / 2) * 2]),
      z: 1
    }
    this.recomputeDrawingBounds(stroke)
    this.drawings.push(Object.assign({ id: uid('d'), createdAt: Date.now(), dash: 'solid', smooth: 0.8 }, stroke))
    const star = {
      spaceId: 'sp_create', tool: 'star', color: '#C99C8C', width: 2, opacity: 0.9,
      x1: 210, y1: 330, x2: 268, y2: 388, pts: [], z: 8
    }
    this.recomputeDrawingBounds(star)
    this.drawings.push(Object.assign({ id: uid('d'), createdAt: Date.now(), dash: 'dashed', smooth: 0.5 }, star))

    // 修复 c1 的坐标（父节点在 sp_create）
    const c1 = this.nodeById('c1')
    if (c1) { c1.x = 30; c1.y = 0 }
    const c2 = this.nodeById('c2'); if (c2) c2.parentId = 'c1'
    this.rebuildIndex()
    this.saveNow()
  }

  stats() {
    const nodes = this.nodes.filter((n) => n.spaceId === this.currentId)
    const draws = this.drawings.filter((d) => d.spaceId === this.currentId)
    return {
      spaces: Object.keys(this.spaces).length,
      nodes: nodes.length,
      mindNodes: nodes.filter((n) => n.parentId || (n.childrenIds || []).length).length,
      drawings: draws.length,
      edges: this.edges.filter((e) => e.spaceId === this.currentId).length
    }
  }

  // 压测生成：n 个节点铺成网格（仅 QA / 命令面板使用）
  stressTest(count = 1000) {
    this.pushUndo()
    const cols = Math.ceil(Math.sqrt(count))
    const palette = paletteById(this.settings.palette)
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols)
      this.nodes.push({
        id: uid('s'), spaceId: this.currentId, kind: 'note',
        title: '压力节点 ' + (i + 1), body: '视口裁剪测试 · 四叉树索引',
        x: col * 270 - (cols * 270) / 2, y: row * 170 - count * 8,
        w: 240, h: 140,
        color: palette.colors[i % palette.colors.length],
        parentId: null, childrenIds: [], edges: [], groupId: null,
        z: 1000 + i, collapsed: false,
        createdAt: Date.now(), updatedAt: Date.now(), media: null, targetSpaceId: null
      })
    }
    this.touch('stress', { index: true })
  }
}
