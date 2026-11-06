// ===== 布局引擎（纯函数，零框架依赖） =====
// 同时被 Web Worker（src/lib/layoutWorker.js）与主线程兜底调用。
// 输入：nodes: [{id, x, y, w, h, refId, type}]，edges: [{from, to}]，rootId，spacing {levelGap, rowGap}
// 输出：positions: { [id]: {x, y} }（节点左上角绝对坐标）
// 2026-11-03 硬约束（用户红线）：智能布局绝不重叠 ——
// ① 纵向堆叠一律按节点「真实高度」推进（固定 rowGap 步进曾把 440px 高的大卡叠进下一张）；
// ② 所有模式算完坐标后统一过 resolveOverlaps 碰撞解除，保证两两不相交。
import dagre from '@dagrejs/dagre'

export function buildAdjacency(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const adj = new Map(nodes.map((n) => [n.id, []]))
  edges.forEach((e) => {
    if (!byId.has(e.from) || !byId.has(e.to)) return
    if (e.from === e.to) return
    adj.get(e.from).push(e.to)
    adj.get(e.to).push(e.from)
  })
  return adj
}

function bfsLevels(nodes, adj, rootId) {
  const ids = nodes.map((n) => n.id)
  const root = rootId && ids.includes(rootId) ? rootId : ids[0]
  const depth = new Map([[root, 0]])
  const visited = new Set([root])
  const queue = [root]
  while (queue.length) {
    const cur = queue.shift()
    for (const nb of (adj.get(cur) || [])) {
      if (!visited.has(nb)) {
        visited.add(nb)
        depth.set(nb, depth.get(cur) + 1)
        queue.push(nb)
      }
    }
  }
  // 未连通节点：挂在根之后（depth=1），避免丢失
  let d = 1
  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      // 找一个还没占满的层
      while ([...depth.values()].filter((v) => v === d).length >= 6) d++
      depth.set(n.id, d)
      visited.add(n.id)
    }
  })
  return { root, depth }
}

function centerOf(n) { return { x: n.x + n.w / 2, y: n.y + n.h / 2 } }
function place(map, id, x, y) { map[id] = { x: Math.round(x), y: Math.round(y) } }
const hOf = (n) => Math.max(40, (n && n.h) || 160)
const wOf = (n) => Math.max(60, (n && n.w) || 220)
// 卡片间垂直间距：由「节点间距」滑杆派生，但设上下限（过小必叠、过大松散）
const vGap = (sp) => Math.max(24, Math.min(96, sp.rowGap * 0.3))
const hGap = (sp) => Math.max(24, Math.min(96, sp.rowGap * 0.3))

// ===== 通用去重叠（硬约束）=====
// 迭代把互相重叠（含 gap 间距要求）的矩形沿「侵入最小」的方向推开，直到两两不相交。
export function resolveOverlaps(map, nodes, gap = 32) {
  const rects = nodes
    .filter((n) => map[n.id])
    .map((n) => ({ id: n.id, x: map[n.id].x, y: map[n.id].y, w: wOf(n), h: hOf(n) }))
  const hits = (a, b) => !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y)
  for (let iter = 0; iter < 80; iter++) {
    let moved = false
    for (let i = 0; i < rects.length; i++) {
      for (let j = 0; j < rects.length; j++) {
        if (i === j) continue
        const a = rects[i], b = rects[j]
        if (!hits(a, b)) continue
        moved = true
        // 四方向位移取最小者推 b（下 / 右 / 上 / 左），避免越推越远
        const dDown = a.y + a.h + gap - b.y
        const dRight = a.x + a.w + gap - b.x
        const dUp = b.y + b.h + gap - a.y
        const dLeft = b.x + b.w + gap - a.x
        const min = Math.min(dDown, dRight, dUp, dLeft)
        if (min === dDown) b.y += dDown
        else if (min === dRight) b.x += dRight
        else if (min === dUp) b.y -= dUp
        else b.x -= dLeft
      }
    }
    if (!moved) break
  }
  rects.forEach((r) => { map[r.id] = { x: Math.round(r.x), y: Math.round(r.y) } })
  return map
}

// 思维导图（中心向两侧）：根居中，一级子节点左右交替，深层继续水平外扩 + 垂直堆叠
export function layoutMindmap(nodes, edges, rootId, sp) {
  const adj = buildAdjacency(nodes, edges)
  const { root, depth } = bfsLevels(nodes, adj, rootId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const map = {}
  const r = byId.get(root)
  const rc = r ? centerOf(r) : { x: 0, y: 0 }
  place(map, root, rc.x - (r ? r.w / 2 : 110), rc.y - (r ? r.h / 2 : 70))
  // 收集每层的节点（除根）
  const levels = {}
  depth.forEach((d, id) => { if (id !== root) (levels[d] = levels[d] || []).push(id) })
  const gapV = vGap(sp)
  Object.keys(levels).forEach((d) => {
    const arr = levels[d]
    const levelGap = sp.levelGap * d
    // 左右交替分配
    const left = arr.filter((_, i) => i % 2 === 0)
    const right = arr.filter((_, i) => i % 2 === 1)
    const stackOn = (side, sign) => {
      // 按真实高度求总高后居中起始 y，逐张用真实高度推进 —— 大卡不再压进下一张
      const totalH = side.reduce((s, id) => s + hOf(byId.get(id)), 0) + gapV * (side.length - 1)
      let y = rc.y - totalH / 2
      side.forEach((id) => {
        const n = byId.get(id)
        const x = rc.x + sign * (levelGap + 80) - (n ? n.w / 2 : 0)
        place(map, id, x, y)
        y += hOf(n) + gapV
      })
    }
    stackOn(left, -1)
    stackOn(right, 1)
  })
  return map
}

// 逻辑图（根节点向右逐层）：根在左，每层向右推进，同级垂直堆叠
export function layoutLogic(nodes, edges, rootId, sp) {
  const adj = buildAdjacency(nodes, edges)
  const { root, depth } = bfsLevels(nodes, adj, rootId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const map = {}
  const r = byId.get(root)
  const rc = r ? centerOf(r) : { x: 0, y: 0 }
  place(map, root, rc.x - (r ? r.w / 2 : 110), rc.y - (r ? r.h / 2 : 70))
  const levels = {}
  depth.forEach((d, id) => { (levels[d] = levels[d] || []).push(id) })
  const gapV = vGap(sp)
  Object.keys(levels).forEach((d) => {
    const arr = levels[d]
    const totalH = arr.reduce((s, id) => s + hOf(byId.get(id)), 0) + gapV * (arr.length - 1)
    let y = rc.y - totalH / 2
    arr.forEach((id) => {
      const n = byId.get(id)
      const x = rc.x + d * sp.levelGap - (n ? n.w / 2 : 0)
      place(map, id, x, y)
      y += hOf(n) + gapV
    })
  })
  return map
}

// 组织架构（自上而下层级）：根居顶，子层横向铺开、逐层向下（真实行高推进）
export function layoutOrg(nodes, edges, rootId, sp) {
  const adj = buildAdjacency(nodes, edges)
  const { root, depth } = bfsLevels(nodes, adj, rootId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const map = {}
  const r = byId.get(root)
  const rc = r ? centerOf(r) : { x: 0, y: 0 }
  place(map, root, rc.x - (r ? r.w / 2 : 110), 40)
  const levels = {}
  depth.forEach((d, id) => { (levels[d] = levels[d] || []).push(id) })
  const gapH = hGap(sp)
  const gapV = Math.max(40, sp.levelGap * 0.4)
  let y = 40
  Object.keys(levels).sort((a, b) => a - b).forEach((d) => {
    const arr = levels[d]
    const rowW = arr.reduce((s, id) => s + wOf(byId.get(id)) + gapH, 0) - gapH
    let x = rc.x - rowW / 2
    let rowMaxH = 0
    arr.forEach((id) => {
      const n = byId.get(id)
      place(map, id, x, y)
      x += wOf(n) + gapH
      rowMaxH = Math.max(rowMaxH, hOf(n))
    })
    y += rowMaxH + gapV
  })
  return map
}

// 放射状（根节点向四周）：根在中心，其余按角度环绕
export function layoutRadial(nodes, edges, rootId, sp) {
  const adj = buildAdjacency(nodes, edges)
  const { root, depth } = bfsLevels(nodes, adj, rootId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const map = {}
  const r = byId.get(root)
  const rc = r ? centerOf(r) : { x: 0, y: 0 }
  place(map, root, rc.x - (r ? r.w / 2 : 110), rc.y - (r ? r.h / 2 : 70))
  const rest = nodes.filter((n) => n.id !== root)
  const n = rest.length
  // 半径随卡片尺寸 / 数量放大，避免大卡在内圈互相叠压（残余交给 resolveOverlaps）
  const maxDim = Math.max(220, ...rest.map((x) => Math.max(wOf(x), hOf(x))))
  const radius = Math.max(sp.levelGap * 1.4, maxDim * 1.6, 300 + n * 40)
  rest.forEach((node, i) => {
    const ang = (i / Math.max(1, n)) * Math.PI * 2
    place(map, node.id, rc.x + Math.cos(ang) * radius - node.w / 2, rc.y + Math.sin(ang) * radius - node.h / 2)
  })
  return map
}

// 树状图（自上而下树形）：根在顶，逐层向下（真实行高推进）
export function layoutTree(nodes, edges, rootId, sp) {
  const adj = buildAdjacency(nodes, edges)
  const { root, depth } = bfsLevels(nodes, adj, rootId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const map = {}
  const r = byId.get(root)
  const rc = r ? centerOf(r) : { x: 0, y: 0 }
  place(map, root, rc.x - (r ? r.w / 2 : 110), 40)
  const levels = {}
  depth.forEach((d, id) => { (levels[d] = levels[d] || []).push(id) })
  const gapH = hGap(sp)
  const gapV = Math.max(40, sp.levelGap * 0.4)
  let y = 40
  Object.keys(levels).sort((a, b) => a - b).forEach((d) => {
    const arr = levels[d]
    const rowW = arr.reduce((s, id) => s + wOf(byId.get(id)) + gapH, 0) - gapH
    let x = rc.x - rowW / 2
    let rowMaxH = 0
    arr.forEach((id) => {
      const n = byId.get(id)
      place(map, id, x, y)
      x += wOf(n) + gapH
      rowMaxH = Math.max(rowMaxH, hOf(n))
    })
    y += rowMaxH + gapV
  })
  return map
}

// 网格（按标签/类型聚拢）：真实宽高逐行装箱，行高随行内最高卡推进
export function layoutGrid(nodes, edges, rootId, sp) {
  const map = {}
  const gap = 28
  const sorted = nodes.slice().sort((a, b) => {
    const ta = (a.tags && a.tags[0]) || '~', tb = (b.tags && b.tags[0]) || '~'
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.type < b.type ? -1 : 1
  })
  const maxW = Math.max(1200, (typeof window !== 'undefined' && window.innerWidth) || 1200) - 80
  let x = 40, y = 40, rowH = 0
  sorted.forEach((n) => {
    const w = wOf(n), h = hOf(n)
    if (x > 40 && x + w > 40 + maxW) { x = 40; y += rowH + gap; rowH = 0 }
    place(map, n.id, x, y)
    x += w + gap
    rowH = Math.max(rowH, h)
  })
  return map
}

// 自动去重叠（@dagrejs/dagre 有向图布局引擎）：
// 以节点为顶点、连线为有向边交给 dagre 求解分层布局，
// 引擎保证同层节点互不重叠（nodesep）、层间留白充足（ranksep），
// 未连通的孤立节点也会被各自成组排布 —— 从拓扑关系出发根治节点重叠。
export function layoutDagre(nodes, edges, rootId, sp) {
  const map = {}
  if (!nodes.length) return map
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false })
  g.setGraph({
    rankdir: 'LR',
    nodesep: Math.max(28, Math.round(sp.rowGap / 2)),
    ranksep: Math.max(48, Math.round(sp.levelGap / 2)),
    marginx: 0, marginy: 0,
    ranker: 'network-simplex'
  })
  g.setDefaultNodeLabel(() => ({}))
  g.setDefaultEdgeLabel(() => ({}))
  const byId = new Map()
  nodes.forEach((n) => {
    const w = Math.max(60, n.w || 220), h = Math.max(40, n.h || 160)
    byId.set(n.id, { w, h })
    g.setNode(n.id, { width: w, height: h })
  })
  const seen = new Set()
  edges.forEach((e) => {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) return
    const key = e.from + '→' + e.to
    if (seen.has(key)) return
    seen.add(key)
    g.setEdge(e.from, e.to)
  })
  dagre.layout(g)
  g.nodes().forEach((id) => {
    const pos = g.node(id)
    const dim = byId.get(id)
    if (!pos || !dim) return
    // dagre 返回节点中心 → 画布使用左上角坐标
    place(map, id, pos.x - dim.w / 2, pos.y - dim.h / 2)
  })
  return map
}

// 调度入口：所有模式统一过 resolveOverlaps —— 「禁止重叠」是硬约束
export function computeLayout(mode, nodes, edges, rootId, spacing) {
  const sp = Object.assign({ levelGap: 300, rowGap: 200 }, spacing || {})
  let map
  switch (mode) {
    case 'mindmap': map = layoutMindmap(nodes, edges, rootId, sp); break
    case 'logic': map = layoutLogic(nodes, edges, rootId, sp); break
    case 'org': map = layoutOrg(nodes, edges, rootId, sp); break
    case 'radial': map = layoutRadial(nodes, edges, rootId, sp); break
    case 'tree': map = layoutTree(nodes, edges, rootId, sp); break
    case 'dagre': map = layoutDagre(nodes, edges, rootId, sp); break
    case 'grid':
    default: map = layoutGrid(nodes, edges, rootId, sp); break
  }
  return resolveOverlaps(map, nodes, 32)
}
