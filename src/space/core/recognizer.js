// ===== 手绘笔画识别器（抬笔成型） =====
// 目标：把一笔潦草的手绘，在抬笔瞬间修正为标准圆 / 矩形 / 三角形 / 五角星 / 直线。
// 做法：重采样 → 闭合判定 → RDP 多边形简化 → 角点/径向方差/贴边率打分。
// 不依赖任何模型或外部库，坐标系由调用方传入（已是世界坐标）。

export function resample(points, count = 64) {
  if (!points || points.length < 2) return points ? points.slice() : []
  const total = []
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    const d = Math.hypot(dx, dy)
    length += d
    total.push(d)
  }
  if (length < 1) return [points[0], points[points.length - 1]]
  const step = length / (count - 1)
  const out = [points[0]]
  let acc = 0, seg = 0, t = 0
  for (let i = 1; i < count - 1; i++) {
    const target = i * step
    while (acc + total[seg] < target && seg < total.length - 1) { acc += total[seg]; seg++ }
    const segLen = total[seg] || 1
    const ratio = Math.min(1, Math.max(0, (target - acc) / segLen))
    const a = points[seg], b = points[seg + 1] || points[seg]
    out.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio])
  }
  out.push(points[points.length - 1])
  return out
}

function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  points.forEach((p) => {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  })
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = dx * dx + dy * dy || 1
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

// Ramer–Douglas–Peucker 多边形简化
export function rdp(points, epsilon) {
  if (points.length < 3) return points.slice()
  let maxD = 0, index = 0
  const a = points[0], b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = b.length === 2 && a.length === 2 ? distToSegment(points[i], a, b) : 0
    if (d > maxD) { maxD = d; index = i }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon)
    const right = rdp(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

function polygonArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area / 2)
}

function centroid(points) {
  let x = 0, y = 0
  points.forEach((p) => { x += p[0]; y += p[1] })
  return [x / points.length, y / points.length]
}

function betweenAngles(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]]
  const v2 = [c[0] - b[0], c[1] - b[1]]
  const l1 = Math.hypot(v1[0], v1[1]) || 1
  const l2 = Math.hypot(v2[0], v2[1]) || 1
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI
}

// 点是否贴近矩形边界
function boundaryCoverage(points, box) {
  const tol = Math.max(6, Math.min(box.w, box.h) * 0.14)
  let hit = 0
  points.forEach((p) => {
    const dl = Math.abs(p[0] - box.x)
    const dr = Math.abs(p[0] - (box.x + box.w))
    const dt = Math.abs(p[1] - box.y)
    const db = Math.abs(p[1] - (box.y + box.h))
    if (Math.min(dl, dr, dt, db) <= tol) hit++
  })
  return hit / points.length
}

export function recognizeStroke(rawPoints) {
  const pts = resample(rawPoints, 72)
  if (pts.length < 5) return null
  const box = bboxOf(pts)
  const diag = Math.hypot(box.w, box.h)
  if (diag < 24) return null
  const first = pts[0], last = pts[pts.length - 1]
  const endGap = Math.hypot(last[0] - first[0], last[1] - first[1])
  const closed = endGap < diag * 0.14
  const simplified = rdp(pts, diag * 0.05)
  const corners = closed && simplified.length > 2 ? simplified.slice(0, -1) : simplified

  // ① 直线：所有点距首尾连线很近
  let maxDev = 0
  pts.forEach((p) => { maxDev = Math.max(maxDev, distToSegment(p, first, last)) })
  const lineLen = Math.hypot(last[0] - first[0], last[1] - first[1])
  if (!closed && lineLen > diag * 0.7 && maxDev < Math.max(5, diag * 0.075)) {
    return { type: 'line', x1: first[0], y1: first[1], x2: last[0], y2: last[1], confidence: 0.95 }
  }

  if (!closed) return null

  // ② 矩形：贴边率高，且有 4 个近直角
  const coverage = boundaryCoverage(pts, box)
  const aspect = box.w / Math.max(1, box.h)
  if (coverage > 0.72 && corners.length >= 4 && corners.length <= 8 && aspect > 0.2 && aspect < 5) {
    let rightAngles = 0
    for (let i = 0; i < corners.length; i++) {
      const ang = betweenAngles(corners[(i - 1 + corners.length) % corners.length], corners[i], corners[(i + 1) % corners.length])
      if (Math.abs(ang - 90) < 28) rightAngles++
    }
    if (rightAngles >= 3) {
      return { type: 'rect', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, confidence: 0.9 }
    }
  }

  // ③ 三角形：简化后 3 个角点
  if (corners.length === 3 && polygonArea(corners) > diag * diag * 0.06) {
    return { type: 'triangle', points: corners, x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, confidence: 0.85 }
  }

  // ④ 五角星：半径分布明显分层（外尖远大于内凹），且外尖角点不少于 3 个
  const cen = centroid(pts)
  const radii = pts.map((p) => Math.hypot(p[0] - cen[0], p[1] - cen[1]))
  const sorted = radii.slice().sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.15)]
  const hi = sorted[Math.floor(sorted.length * 0.85)]
  if (closed && corners.length >= 8 && lo > 0 && hi / lo > 1.45) {
    const cornerR = corners.map((p) => Math.hypot(p[0] - cen[0], p[1] - cen[1]))
    const outer = cornerR.filter((r) => r > hi * 0.72).length
    if (outer >= 3) {
      return { type: 'star', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, confidence: 0.8 }
    }
  }

  // ⑤ 圆：径向方差小 + 接近方形
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  const variance = radii.reduce((a, b) => a + (b - mean) * (b - mean), 0) / radii.length
  const std = Math.sqrt(variance)
  if (aspect > 0.55 && aspect < 1.8 && mean > 0 && std / mean < 0.22 && hi / Math.max(1, lo) < 1.4) {
    return { type: 'circle', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, confidence: 0.9 }
  }

  // ⑥ 兜底：仍视为圆（手绘近似闭合曲线最常见的意图）
  if (closed && corners.length >= 5) {
    return { type: 'circle', x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h, confidence: 0.65 }
  }
  return null
}
