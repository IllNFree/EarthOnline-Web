// ===== 四叉树空间索引（纯 JS，零依赖） =====
// 用于视口裁剪与命中检测：节点、绘画元素、空间卡片统一入索引。
// 设计要点：
//   · 批量 rebuild 时按元素包围盒自动推导边界，画布再大也不会漏对象；
//   · query 只返回与矩形相交的叶子对象，单帧 1000+ 元素仍是 O(log n + k)；
//   · 对外只暴露 insert/query/clear/rebuild，渲染层与状态层不感知内部结构。

const DEFAULT_MAX_ITEMS = 8
const DEFAULT_MAX_DEPTH = 8

function intersects(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

class QuadNode {
  constructor(bounds, depth, maxItems, maxDepth) {
    this.bounds = bounds
    this.depth = depth
    this.maxItems = maxItems
    this.maxDepth = maxDepth
    this.items = []
    this.children = null
  }
  subdivide() {
    const { x, y, w, h } = this.bounds
    const hw = w / 2, hh = h / 2
    const d = this.depth + 1
    this.children = [
      new QuadNode({ x, y, w: hw, h: hh }, d, this.maxItems, this.maxDepth),
      new QuadNode({ x: x + hw, y, w: hw, h: hh }, d, this.maxItems, this.maxDepth),
      new QuadNode({ x, y: y + hh, w: hw, h: hh }, d, this.maxItems, this.maxDepth),
      new QuadNode({ x: x + hw, y: y + hh, w: hw, h: hh }, d, this.maxItems, this.maxDepth)
    ]
    // 重新分配已有条目
    const pending = this.items
    this.items = []
    pending.forEach((it) => this.insert(it))
  }
  insert(item) {
    if (!contains(this.bounds, item)) return false
    if (!this.children) {
      this.items.push(item)
      if (this.items.length > this.maxItems && this.depth < this.maxDepth) this.subdivide()
      return true
    }
    for (let i = 0; i < this.children.length; i++) {
      if (this.children[i].insert(item)) return true
    }
    // 跨子象限的条目保留在本层
    this.items.push(item)
    return true
  }
  query(rect, out) {
    if (!intersects(this.bounds, rect)) return out
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i] !== null && intersects(this.items[i], rect)) out.push(this.items[i])
    }
    if (this.children) this.children.forEach((c) => c.query(rect, out))
    return out
  }
  forEach(fn) {
    this.items.forEach(fn)
    if (this.children) this.children.forEach((c) => c.forEach(fn))
  }
  count() {
    let n = this.items.length
    if (this.children) this.children.forEach((c) => { n += c.count() })
    return n
  }
}

export class QuadTree {
  constructor(maxItems = DEFAULT_MAX_ITEMS, maxDepth = DEFAULT_MAX_DEPTH) {
    this.maxItems = maxItems
    this.maxDepth = maxDepth
    this.root = null
    this.total = 0
  }
  clear() {
    this.root = null
    this.total = 0
  }
  rebuild(items) {
    this.clear()
    if (!items || !items.length) return this
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.x < minX) minX = it.x
      if (it.y < minY) minY = it.y
      if (it.x + it.w > maxX) maxX = it.x + it.w
      if (it.y + it.h > maxY) maxY = it.y + it.h
    }
    if (!isFinite(minX)) { minX = -5000; minY = -5000; maxX = 5000; maxY = 5000 }
    // 外扩 10% 给后续插入留余量
    const padX = Math.max(64, (maxX - minX) * 0.1)
    const padY = Math.max(64, (maxY - minY) * 0.1)
    this.root = new QuadNode(
      { x: minX - padX, y: minY - padY, w: (maxX - minX) + padX * 2, h: (maxY - minY) + padY * 2 },
      0, this.maxItems, this.maxDepth
    )
    for (let i = 0; i < items.length; i++) {
      if (this.root.insert(items[i])) this.total++
    }
    return this
  }
  insert(item) {
    if (!this.root) { this.rebuild([item]); return this }
    if (this.root.insert(item)) this.total++
    return this
  }
  query(rect, out = []) {
    if (!this.root) return out
    return this.root.query(rect, out)
  }
  forEach(fn) { if (this.root) this.root.forEach(fn) }
  get size() { return this.total }
}

export function rectOf(x, y, w, h, data) {
  return { x, y, w, h, data }
}
export function unionRect(rects) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (!r) continue
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  if (!isFinite(x1)) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
