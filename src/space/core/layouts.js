// ===== 脑图布局：5 种算法 =====
// · 逻辑图 / 组织架构 / 树状图：dagre（开源 Sugiyama 布局，自动减交叉）
// · 思维导图 / 放射状：自研树形布局（双向树干 / 同心环），同样以层级关系驱动
// 输入节点必须带真实 w/h，输出节点左上角坐标；局部布局只对传入的子树生效。

import dagre from '@dagrejs/dagre'

export const LAYOUT_MODES = [
  { id: 'mindmap', label: '思维导图', icon: 'branch', hint: '中心向两侧' },
  { id: 'logic', label: '逻辑图', icon: 'flow', hint: '根向右逐层' },
  { id: 'org', label: '组织架构', icon: 'org', hint: '自上而下' },
  { id: 'radial', label: '放射状', icon: 'radial', hint: '同心环' },
  { id: 'tree', label: '树状图', icon: 'tree', hint: '自上而下树形' }
]

export function edgeTypeForLayout(mode) {
  if (mode === 'org' || mode === 'tree') return 'orthogonal'
  if (mode === 'logic') return 'straight'
  return 'curve'
}

function buildChildren(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map(nodes.map((n) => [n.id, []]))
  nodes.forEach((n) => {
    if (n.parentId && byId.has(n.parentId) && byId.get(n.parentId).spaceId === n.spaceId) {
      children.get(n.parentId).push(n.id)
    }
  })
  // 父级关系缺失时，用连线补足（避免节点丢失）
  edges.forEach((e) => {
    const a = byId.get(e.fromId), b = byId.get(e.toId)
    if (!a || !b) return
    if (!children.get(a.id).includes(b.id) && !b.parentId) children.get(a.id).push(b.id)
  })
  // 去重 + 防环
  children.forEach((list, id) => {
    const seen = new Set()
    children.set(id, list.filter((x) => {
      if (seen.has(x) || x === id) return false
      seen.add(x); return true
    }))
  })
  return { byId, children, edges }
}

function rootsOf(nodes, children) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hasParent = new Set()
  children.forEach((list, id) => list.forEach((c) => hasParent.add(c)))
  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id)
  return roots.length ? roots : [nodes[0] && nodes[0].id].filter(Boolean)
}

function subtreeLeafCount(id, children, memo = new Map()) {
  if (memo.has(id)) return memo.get(id)
  const kids = children.get(id) || []
  if (!kids.length) { memo.set(id, 1); return 1 }
  let total = 0
  kids.forEach((c) => { total += subtreeLeafCount(c, children, memo) })
  memo.set(id, total)
  return total
}

function subtreeHeight(id, children, byId, gap, memo = new Map()) {
  if (memo.has(id)) return memo.get(id)
  const n = byId.get(id)
  const h = n ? n.h : 100
  const kids = children.get(id) || []
  if (!kids.length) { memo.set(id, h); return h }
  let total = 0
  kids.forEach((c, i) => {
    total += subtreeHeight(c, children, byId, gap, memo)
    if (i < kids.length - 1) total += gap
  })
  const v = Math.max(h, total)
  memo.set(id, v)
  return v
}

function shiftResult(map, byId, dx, dy) {
  Object.keys(map).forEach((id) => {
    if (map[id]) { map[id].x += dx; map[id].y += dy }
  })
  return map
}

// ---------- 思维导图：中心向两侧 ----------
function layoutMindmap(nodes, edges, rootId, opts) {
  const { byId, children } = buildChildren(nodes, edges)
  const root = rootId && byId.has(rootId) ? rootId : rootsOf(nodes, children)[0]
  const out = {}
  const gapY = opts.nodeGap
  const gapX = opts.levelGap
  const rn = byId.get(root)
  if (!rn) return out
  const rc = { x: rn.x + rn.w / 2, y: rn.y + rn.h / 2 }
  out[root] = { x: rc.x - rn.w / 2, y: rc.y - rn.h / 2 }

  const first = (children.get(root) || []).slice()
  // 按子树重量均衡分到两侧（左 / 右）
  const memoLeaf = new Map()
  const weighted = first.map((id) => ({ id, w: subtreeLeafCount(id, children, memoLeaf) }))
  weighted.sort((a, b) => b.w - a.w)
  const left = [], right = []
  let lw = 0, rw = 0
  weighted.forEach((x) => {
    if (lw <= rw) { left.push(x.id); lw += x.w }
    else { right.push(x.id); rw += x.w }
  })
  // 恢复原始顺序，视觉更稳定
  left.sort((a, b) => first.indexOf(a) - first.indexOf(b))
  right.sort((a, b) => first.indexOf(a) - first.indexOf(b))

  const sideLayout = (ids, sign) => {
    if (!ids.length) return
    // 每层的列宽（用于计算列中心 X）
    const levels = new Map()
    const walkLevel = (id, d) => {
      if (!levels.has(d)) levels.set(d, [])
      levels.get(d).push(id)
      ;(children.get(id) || []).forEach((c) => walkLevel(c, d + 1))
    }
    ids.forEach((id) => walkLevel(id, 1))
    const maxDepth = Math.max(...levels.keys())
    const colW = []
    for (let d = 1; d <= maxDepth; d++) {
      const arr = levels.get(d) || []
      colW[d] = Math.max(120, ...arr.map((id) => (byId.get(id) ? byId.get(id).w : 200)))
    }
    const colCenter = (d) => {
      let x = rc.x + sign * (rn.w / 2 + gapX + colW[d] / 2)
      for (let k = 1; k < d; k++) x += sign * (colW[k] / 2 + gapX + colW[d] / 2)
      return x
    }
    const measure = (id) => subtreeHeight(id, children, byId, gapY, memoH)
    const memoH = new Map()
    const place = (id, d, top) => {
      const n = byId.get(id)
      if (!n) return
      const total = measure(id)
      // 节点放在子树块的中线
      out[id] = { x: colCenter(d) - n.w / 2, y: top + total / 2 - n.h / 2 }
      const kids = children.get(id) || []
      if (!kids.length) return
      let block = 0
      let childTop = top + (total - (kids.reduce((s, c, i) => s + measure(c) + (i < kids.length - 1 ? gapY : 0), 0))) / 2
      kids.forEach((c, i) => {
        const ch = measure(c)
        place(c, d + 1, childTop)
        childTop += ch + gapY
        block += ch
        if (i < kids.length - 1) block += gapY
      })
    }
    const totalSide = ids.reduce((s, id, i) => s + measure(id) + (i < ids.length - 1 ? gapY : 0), 0)
    let top = rc.y - totalSide / 2
    ids.forEach((id, i) => {
      place(id, 1, top)
      top += measure(id) + gapY
    })
  }
  sideLayout(left, -1)
  sideLayout(right, 1)
  return out
}

// ---------- 放射状：根为中心的同心环 ----------
function layoutRadial(nodes, edges, rootId, opts) {
  const { byId, children } = buildChildren(nodes, edges)
  const root = rootId && byId.has(rootId) ? rootId : rootsOf(nodes, children)[0]
  const out = {}
  const rn = byId.get(root)
  if (!rn) return out
  const rc = { x: rn.x + rn.w / 2, y: rn.y + rn.h / 2 }
  out[root] = { x: rc.x - rn.w / 2, y: rc.y - rn.h / 2 }

  const memo = new Map()
  const levelRadius = [Math.max(rn.w, rn.h) / 2]
  const levels = new Map()
  const walk = (id, d) => {
    if (!levels.has(d)) levels.set(d, [])
    levels.get(d).push(id)
    ;(children.get(id) || []).forEach((c) => walk(c, d + 1))
  }
  ;(children.get(root) || []).forEach((c) => walk(c, 1))

  const maxD = levels.size ? Math.max(...levels.keys()) : 0
  for (let d = 1; d <= maxD; d++) {
    const arr = levels.get(d) || []
    const maxSize = Math.max(48, ...arr.map((id) => {
      const n = byId.get(id)
      return n ? Math.max(n.w, n.h) * 0.72 : 80
    }))
    levelRadius[d] = levelRadius[d - 1] + maxSize + opts.levelGap * 0.55 + 18
  }
  const totalLeaves = (children.get(root) || []).reduce((s, id) => s + subtreeLeafCount(id, children, memo), 0) || 1
  let cursor = -Math.PI / 2

  const assign = (id, d, span) => {
    const n = byId.get(id)
    if (!n) return
    const leaves = subtreeLeafCount(id, children, memo)
    const mySpan = span * (leaves / totalLeaves)
    const angle = cursor + mySpan / 2
    // 注意：cursor 由父级统一推进，这里单独计算子树角度区间
    const start = cursor
    const r = levelRadius[d] || levelRadius[levelRadius.length - 1]
    const cx = rc.x + Math.cos(angle) * r
    const cy = rc.y + Math.sin(angle) * r
    out[id] = { x: cx - n.w / 2, y: cy - n.h / 2 }
    const kids = children.get(id) || []
    if (kids.length) {
      const kidTotal = kids.reduce((s, c) => s + subtreeLeafCount(c, children, memo), 0) || 1
      let kc = start
      kids.forEach((c) => {
        const cLeaves = subtreeLeafCount(c, children, memo)
        const cSpan = mySpan * (cLeaves / kidTotal)
        // 直接在这里递归需要控制 cursor；改用参数化的角度区间
        assignWithRange(c, d + 1, kc, kc + cSpan)
        kc += cSpan
      })
    }
  }
  const assignWithRange = (id, d, start, end) => {
    const n = byId.get(id)
    if (!n) return
    const leaves = subtreeLeafCount(id, children, memo)
    const angle = (start + end) / 2
    const r = levelRadius[d] || levelRadius[levelRadius.length - 1]
    out[id] = { x: rc.x + Math.cos(angle) * r - n.w / 2, y: rc.y + Math.sin(angle) * r - n.h / 2 }
    const kids = children.get(id) || []
    const kidTotal = kids.reduce((s, c) => s + subtreeLeafCount(c, children, memo), 0) || 1
    let kc = start
    kids.forEach((c) => {
      const cLeaves = subtreeLeafCount(c, children, memo)
      const cSpan = (end - start) * (cLeaves / kidTotal)
      assignWithRange(c, d + 1, kc, kc + cSpan)
      kc += cSpan
    })
  }
  ;(children.get(root) || []).forEach((c) => {
    const leaves = subtreeLeafCount(c, children, memo)
    const span = Math.PI * 2 * (leaves / totalLeaves)
    assignWithRange(c, 1, cursor, cursor + span)
    cursor += span
  })
  return out
}

// ---------- dagre 布局 ----------
function layoutDagre(nodes, edges, rootId, mode, opts) {
  const { byId, children } = buildChildren(nodes, edges)
  const roots = rootsOf(nodes, children)
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false })
  const rankdir = mode === 'logic' ? 'LR' : 'TB'
  g.setGraph({
    rankdir,
    nodesep: opts.nodeGap,
    ranksep: opts.levelGap,
    marginx: 0,
    marginy: 0,
    ranker: 'network-simplex',
    align: mode === 'tree' ? 'UL' : undefined
  })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach((n) => g.setNode(n.id, { width: n.w, height: n.h }))
  const seen = new Set()
  children.forEach((list, parent) => {
    list.forEach((child) => {
      const key = parent + '>' + child
      if (seen.has(key)) return
      seen.add(key)
      g.setEdge(parent, child, { weight: 2 })
    })
  })
  // 额外的非层级关系边也参与布局（不重复）
  edges.forEach((e) => {
    if (byId.has(e.fromId) && byId.has(e.toId) && !seen.has(e.fromId + '>' + e.toId)) {
      seen.add(e.fromId + '>' + e.toId)
      g.setEdge(e.fromId, e.toId, { weight: 1 })
    }
  })
  try {
    dagre.layout(g)
  } catch (e) {
    console.warn('[space] dagre layout failed', e)
  }
  const out = {}
  nodes.forEach((n) => {
    const p = g.node(n.id)
    if (p) out[n.id] = { x: p.x - n.w / 2, y: p.y - n.h / 2 }
  })
  // 多个根：dagre 会给它们同层，若仍重叠则按 roots 依次下移
  if (roots.length > 1 && mode !== 'logic') {
    let maxBottom = -Infinity
    roots.forEach((rid) => {
      const r = out[rid]
      if (!r) return
      if (r.y < maxBottom + opts.levelGap) {
        const d = maxBottom + opts.levelGap - r.y
        // 平移该根的一整棵子树
        const stack = [rid]
        while (stack.length) {
          const id = stack.pop()
          const p = out[id]
          if (p) p.y += d
          ;(children.get(id) || []).forEach((c) => stack.push(c))
        }
      }
      const nr = out[rid]
      maxBottom = Math.max(maxBottom, nr.y + (byId.get(rid) ? byId.get(rid).h : 100))
    })
  }
  return out
}

// ---------- 统一入口 ----------
export function computeLayout({ nodes, edges, rootId, mode = 'mindmap', nodeGap = 36, levelGap = 88 }) {
  if (!nodes || !nodes.length) return {}
  const opts = { nodeGap: Math.max(12, nodeGap), levelGap: Math.max(24, levelGap) }
  let map
  if (mode === 'mindmap') map = layoutMindmap(nodes, edges, rootId, opts)
  else if (mode === 'radial') map = layoutRadial(nodes, edges, rootId, opts)
  else map = layoutDagre(nodes, edges, rootId, mode, opts)

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const root = rootId && byId.has(rootId) ? rootId : (rootsOf(nodes, buildChildren(nodes, edges).children)[0])
  // 以根节点原位为锚点做整体平移：局部布局不把整块画布弹飞
  if (root && map[root] && byId.get(root)) {
    const r = byId.get(root)
    const dx = r.x - map[root].x
    const dy = r.y - map[root].y
    Object.keys(map).forEach((id) => { map[id].x += dx; map[id].y += dy })
  }
  // 网格对齐（10px），避免模糊坐标
  Object.keys(map).forEach((id) => {
    map[id].x = Math.round(map[id].x / 5) * 5
    map[id].y = Math.round(map[id].y / 5) * 5
  })
  return map
}

// 卡片流式排布：按原阅读顺序逐行摆放，行宽受限、整行居中；堆叠组整体移动保持错位
export const CARD_LIKE_KINDS = ['panel', 'card', 'memo', 'note', 'image', 'video', 'file', 'space']
export function packCards(nodes, opts = {}) {
  const gapX = opts.gapX ?? 28
  const gapY = opts.gapY ?? 26
  const maxW = opts.maxW ?? 1180
  const minX = opts.minX ?? 0
  const minY = opts.minY ?? 0
  const groups = []
  const seen = new Set()
  nodes.forEach((n) => {
    if (seen.has(n.id)) return
    let items
    if (n.stackId) {
      items = nodes.filter((m) => m.stackId === n.stackId && !seen.has(m.id))
    } else {
      items = [n]
    }
    items.forEach((m) => seen.add(m.id))
    const ax = Math.min(...items.map((m) => m.x))
    const ay = Math.min(...items.map((m) => m.y))
    const w = Math.max(...items.map((m) => m.x + m.w)) - ax
    const h = Math.max(...items.map((m) => m.y + m.h)) - ay
    groups.push({ items, ax, ay, w, h, ox: ax, oy: ay })
  })
  groups.sort((a, b) => a.oy - b.oy || a.ox - b.ox)
  const rows = []
  let row = { items: [], w: 0, h: 0 }
  groups.forEach((g) => {
    if (row.items.length && row.w + gapX + g.w > maxW) {
      rows.push(row)
      row = { items: [], w: 0, h: 0 }
    }
    row.w += (row.items.length ? gapX : 0) + g.w
    row.h = Math.max(row.h, g.h)
    row.items.push(g)
  })
  if (row.items.length) rows.push(row)
  let y = minY
  rows.forEach((r) => {
    let x = minX + Math.round(Math.max(0, (maxW - r.w) / 2))
    r.items.forEach((g) => {
      const dx = x - g.ax
      const dy = y - g.ay
      g.items.forEach((m) => {
        m.x = Math.round((m.x + dx) / 5) * 5
        m.y = Math.round((m.y + dy) / 5) * 5
      })
      x += g.w + gapX
    })
    y += r.h + gapY
  })
  return rows.length
}

// 3.0 一键整理：先按类型分列，再按连线关联度聚类 —— 同类卡片竖着排成一列，
// 有连线的卡片聚在一起（大簇靠前），无连线的按原有阅读顺序跟在后面。
// 堆叠组始终整体移动，保持原有错位与槽位顺序。
export function packCardsGrouped(nodes, opts = {}) {
  const edges = opts.edges || []
  const gapX = opts.gapX ?? 40
  const gapY = opts.gapY ?? 30
  const minX = opts.minX ?? 0
  const minY = opts.minY ?? 0
  if (!nodes || nodes.length < 2) return 0
  // 1) 归并为「可整体移动的单元」：堆叠组算一个单元
  const units = []
  const seen = new Set()
  nodes.forEach((n) => {
    if (seen.has(n.id)) return
    let items
    if (n.stackId) items = nodes.filter((m) => m.stackId === n.stackId && !seen.has(m.id))
    else items = [n]
    items.forEach((m) => seen.add(m.id))
    const ax = Math.min(...items.map((m) => m.x))
    const ay = Math.min(...items.map((m) => m.y))
    const w = Math.max(...items.map((m) => m.x + m.w)) - ax
    const h = Math.max(...items.map((m) => m.y + m.h)) - ay
    const head = items.slice().sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))[0]
    units.push({
      items, ax, ay, w, h,
      // 类型列：数据面板细到 panelKind，普通卡片细到 cardKind，其余按 kind
      key: head.panelKind ? 'panel:' + head.panelKind : (head.cardKind ? 'card:' + head.cardKind : String(head.kind || 'other')),
      ids: items.map((m) => m.id)
    })
  })
  // 2) 连线聚类：同一类型列内，被连线串起来的单元归为一簇
  const parent = new Map(units.map((u, i) => [i, i]))
  const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i) } return i }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  if (edges.length) {
    const owner = new Map()
    units.forEach((u, i) => u.ids.forEach((id) => owner.set(id, i)))
    const keyOf = (i) => units[i].key
    edges.forEach((e) => {
      const a = owner.get(e.fromId), b = owner.get(e.toId)
      if (a === undefined || b === undefined || a === b) return
      if (keyOf(a) !== keyOf(b)) return // 跨类型连线不强行并簇，类型列语义优先
      union(a, b)
    })
  }
  // 3) 分列：按类型数量降序（数量相同的按类型名稳定排序）
  const cols = new Map()
  units.forEach((u, i) => {
    if (!cols.has(u.key)) cols.set(u.key, [])
    cols.get(u.key).push(i)
  })
  const colOrder = Array.from(cols.keys()).sort((a, b) => cols.get(b).length - cols.get(a).length || (a < b ? -1 : 1))
  let x = minX
  colOrder.forEach((key) => {
    const idxs = cols.get(key).slice()
    // 簇内按原阅读顺序；簇之间按规模降序
    idxs.sort((a, b) => (units[a].ay - units[b].ay) || (units[a].ax - units[b].ax))
    const clusters = new Map()
    idxs.forEach((i) => {
      const r = find(i)
      if (!clusters.has(r)) clusters.set(r, [])
      clusters.get(r).push(i)
    })
    const ordered = Array.from(clusters.values())
      .sort((a, b) => b.length - a.length)
      .reduce((acc, list) => acc.concat(list), [])
    const colW = Math.max(...idxs.map((i) => units[i].w))
    let y = minY
    ordered.forEach((i) => {
      const u = units[i]
      const dx = x + Math.round((colW - u.w) / 2) - u.ax
      const dy = y - u.ay
      // 只对单元锚点做 5px 对齐，组内每一项用同一位移，堆叠错位（8px）不会被抹平
      const sx = Math.round((u.ax + dx) / 5) * 5 - u.ax
      const sy = dy
      u.items.forEach((m) => {
        m.x = m.x + sx
        m.y = m.y + sy
      })
      y += u.h + gapY
    })
    x += colW + gapX
  })
  return units.length
}

export function descendantsOf(rootId, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Set()
  const walk = (id) => {
    if (out.has(id)) return
    const n = byId.get(id)
    if (!n) return
    out.add(id)
    ;(n.childrenIds || []).forEach(walk)
  }
  walk(rootId)
  return out
}
