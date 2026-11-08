// ===== Canvas 2D 渲染器 =====
// 纯绘制层：只读 workspace 数据与 ui 状态，不产生任何 DOM。
// 性能关键：四叉树视口裁剪 + 文本布局缓存 + LOD（低缩放降级为色块/标题）。

import { tintOf } from './palettes.js'
import { visibleWorldRect } from './camera.js'

const IMG_CACHE = new Map()
const TEXT_CACHE = new Map()
const TEXT_CACHE_MAX = 600
const BG_IMG_CACHE = new Map()

const INK = '#2C2C2C'
const INK_SOFT = '#6E6B66'
const LINE = 'rgba(44,44,44,0.14)'
const CARD = '#FFFFFF'

// 深色主题：随帧读取 data-theme，切换主题后无需重建渲染器
function isDark() {
  try {
    const de = document.documentElement
    return (de.dataset && de.dataset.theme) === 'dark' || de.getAttribute('data-theme') === 'dark'
  } catch (e) { return false }
}
function ink() { return isDark() ? '#EDEBE7' : INK }
function inkSoft() { return isDark() ? '#A6A29A' : INK_SOFT }
function line() { return isDark() ? 'rgba(255,255,255,0.14)' : LINE }

export function getImage(src) {
  if (!src) return null
  let rec = IMG_CACHE.get(src)
  if (rec) return rec.img
  rec = { img: null }
  IMG_CACHE.set(src, rec)
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => { rec.img = img; if (rec.onload) rec.onload() }
  img.onerror = () => { rec.img = null }
  img.src = src
  return rec.img
}

export function preloadImage(src, cb) {
  if (!src) return
  const rec = IMG_CACHE.get(src)
  if (rec && rec.img) { cb && cb(); return }
  if (!rec) { IMG_CACHE.set(src, { img: null, onload: cb }); const img = new Image(); img.onload = () => { const r = IMG_CACHE.get(src); if (r) r.img = img; cb && cb() }; img.src = src; return }
  rec.onload = cb
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function withAlpha(hex, a) {
  return tintOf(hex, a)
}

// 整卡着色：把主题色与暖白混合成淡彩，保证深色文字可读
function mixWhite(hex, ratio = 0.62) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return 'rgb(246,239,230)'
  const ch = (i) => parseInt(h.slice(i, i + 2), 16)
  const mix = (c) => Math.round(c * (1 - ratio) + 252 * ratio)
  return 'rgb(' + mix(ch(0)) + ',' + mix(ch(2)) + ',' + mix(ch(4)) + ')'
}

// 深色整卡着色：主题色按少量比例混入 #26262A，保持淡彩但不刺眼
function mixDark(hex, ratio = 0.20) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return 'rgb(38,38,42)'
  const ch = (i) => parseInt(h.slice(i, i + 2), 16)
  const base = [38, 38, 42]
  const mix = (c, i) => Math.round(c * ratio + base[i] * (1 - ratio))
  return 'rgb(' + mix(ch(0), 0) + ',' + mix(ch(2), 1) + ',' + mix(ch(4), 2) + ')'
}

// 整卡底色：浅色混暖白，深色混深底（ratio 为浅色模式的混白比例）
function cardFill(hex, ratio) {
  if (!isDark()) return mixWhite(hex, ratio)
  const accent = Math.max(0.18, Math.min(0.24, 0.24 - (ratio - 0.5) * 0.5))
  return mixDark(hex, accent)
}

function cleanInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

function wrapLine(ctx, text, maxWidth) {
  if (!text) return ['']
  const out = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const test = cur + ch
    if (ctx.measureText(test).width > maxWidth && cur) {
      out.push(cur)
      cur = ch
    } else {
      cur = test
    }
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

function parseMarkdown(body) {
  const lines = []
  if (!body) return lines
  let inCode = false
  body.split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/\t/g, '  ')
    if (/^```/.test(line.trim())) { inCode = !inCode; return }
    if (!line.trim()) { lines.push({ text: '', size: 6, gap: 6 }); return }
    let text = line
    let size = 12
    let bold = false
    let color = inkSoft()
    let indent = 0
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      size = h[1].length <= 2 ? 15 : 13.5
      text = h[2]
      bold = true
      color = ink()
    } else if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const checked = /\[[ xX]\]/.exec(line)[0].toLowerCase().includes('x')
      text = line.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
      indent = 0
      lines.push({ text: (checked ? '✓ ' : '○ ') + text, size: 12, color: checked ? '#9A9A96' : inkSoft(), strike: checked, bullet: true })
      return
    } else if (/^\s*[-*+]\s+/.test(line)) {
      text = line.replace(/^\s*[-*+]\s+/, '')
      lines.push({ text: '• ' + text, size: 12, color: inkSoft(), bullet: true })
      return
    } else if (/^\s*>\s+/.test(line)) {
      text = line.replace(/^\s*>\s+/, '')
      lines.push({ text: '▏ ' + text, size: 12, color: isDark() ? '#A9A59D' : '#8C8880', italic: true })
      return
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const m = /^\s*(\d+\.)\s+(.*)$/.exec(line)
      lines.push({ text: m[1] + ' ' + m[2], size: 12, color: inkSoft(), bullet: true })
      return
    } else if (inCode) {
      text = line
      size = 11
      color = isDark() ? '#B3AFA7' : '#6F6B64'
    }
    lines.push({ text: cleanInline(text), size, bold, color, indent })
  })
  return lines
}

function layoutText(node) {
  const key = node.id + '|' + (isDark() ? 'd' : 'l') + '|' + node.w + '|' + node.h + '|' + node.title + '|' + node.body
  const cached = TEXT_CACHE.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const pad = 18
  const innerW = Math.max(20, node.w - pad * 2)
  ctx.font = '600 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  const titleLines = wrapLine(ctx, node.title || '', innerW).slice(0, 2)
  const lines = parseMarkdown(node.body)
  const out = { titleLines, lines: [], titleH: titleLines.length * 20, font: '600 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif' }
  let h = 0
  const avail = Math.max(20, node.h - pad * 2 - out.titleH - 10)
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (ln.gap) { h += ln.gap; out.lines.push({ text: '', h: ln.gap }); continue }
    if (h >= avail) break
    ctx.font = (ln.bold ? '600 ' : '400 ') + ln.size + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    const wrapped = wrapLine(ctx, ln.text, innerW - (ln.indent || 0))
    for (let j = 0; j < wrapped.length; j++) {
      const lineH = ln.size + 6
      if (h + lineH > avail) break
      out.lines.push({ text: wrapped[j], size: ln.size, bold: ln.bold, color: ln.color, italic: ln.italic, strike: ln.strike, h: lineH })
      h += lineH
    }
  }
  TEXT_CACHE.set(key, out)
  if (TEXT_CACHE.size > TEXT_CACHE_MAX) {
    const first = TEXT_CACHE.keys().next().value
    TEXT_CACHE.delete(first)
  }
  return out
}

function starPath(ctx, cx, cy, R, r) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5
    const rad = i % 2 === 0 ? R : r
    const x = cx + rad * Math.cos(ang)
    const y = cy + rad * Math.sin(ang)
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function leafPath(ctx, x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const bulge = len * 0.28
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(cx + nx * bulge, cy + ny * bulge, x2, y2)
  ctx.quadraticCurveTo(cx - nx * bulge, cy - ny * bulge, x1, y1)
  ctx.closePath()
}

function smoothPath(ctx, pts, smooth = 0.5) {
  if (!pts.length) return
  const p = []
  // Chaikin 细分一次，越平滑越接近曲线
  const cuts = smooth > 0.75 ? 2 : (smooth > 0.35 ? 1 : 0)
  let src = pts
  for (let k = 0; k < cuts; k++) {
    const next = [src[0]]
    for (let i = 0; i < src.length - 1; i++) {
      const a = src[i], b = src[i + 1]
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    next.push(src[src.length - 1])
    src = next
  }
  ctx.beginPath()
  ctx.moveTo(src[0][0], src[0][1])
  for (let i = 1; i < src.length - 1; i++) {
    const mid = [(src[i][0] + src[i + 1][0]) / 2, (src[i][1] + src[i + 1][1]) / 2]
    ctx.quadraticCurveTo(src[i][0], src[i][1], mid[0], mid[1])
  }
  ctx.lineTo(src[src.length - 1][0], src[src.length - 1][1])
}

function dashPattern(dash, scale) {
  if (dash === 'dashed') return [8 / scale, 6 / scale]
  if (dash === 'dotted') return [2 / scale, 4 / scale]
  return []
}

function strokeStyleFor(d, scale) {
  const base = d.color || INK
  const w = Math.max(0.6, d.width || 2)
  if (d.tool === 'highlighter') return { color: base, width: Math.max(8, w * 3.6), alpha: Math.min(0.42, (d.opacity == null ? 1 : d.opacity) * 0.32) }
  if (d.tool === 'pencil') return { color: base, width: Math.max(0.8, w * 0.72), alpha: (d.opacity == null ? 1 : d.opacity) * 0.85 }
  if (d.tool === 'fountain') return { color: base, width: Math.max(1, w), alpha: d.opacity == null ? 1 : d.opacity }
  if (d.tool === 'laser') return { color: base, width: Math.max(1.2, w * 0.75), alpha: 0.95 }
  return { color: base, width: w, alpha: d.opacity == null ? 1 : d.opacity }
}

export function drawDrawing(ctx, d, scale, preview = false) {
  if (!d) return
  const st = strokeStyleFor(d, scale)
  ctx.save()
  ctx.globalAlpha = st.alpha
  ctx.strokeStyle = st.color
  ctx.fillStyle = st.color
  ctx.lineWidth = st.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const dash = dashPattern(d.dash, scale)
  ctx.setLineDash(dash)
  if (d.tool === 'laser') {
    ctx.shadowColor = st.color
    ctx.shadowBlur = 10 / scale
  }
  const pts = d.pts || []
  if (d.tool === 'line' || d.tool === 'rect' || d.tool === 'circle' || d.tool === 'triangle' || d.tool === 'star' || d.tool === 'scalpel') {
    const x1 = d.x1, y1 = d.y1, x2 = d.x2, y2 = d.y2
    if (d.tool === 'line') {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    } else if (d.tool === 'rect') {
      const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
      roundRect(ctx, x, y, w, h, Math.min(6, w / 8, h / 8))
      ctx.stroke()
    } else if (d.tool === 'circle') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    } else if (d.tool === 'triangle') {
      const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.stroke()
    } else if (d.tool === 'star') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
      const R = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2
      starPath(ctx, cx, cy, R, R * 0.44); ctx.stroke()
    } else if (d.tool === 'scalpel') {
      leafPath(ctx, x1, y1, x2, y2)
      ctx.globalAlpha = st.alpha * 0.46
      ctx.fill()
      ctx.globalAlpha = st.alpha
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (!pts.length) { ctx.restore(); return }
  if (d.tool === 'fountain' && pts.length > 2) {
    // 钢笔：按速度变化线宽，形成收笔/重笔的呼吸感
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
      const w = st.width * (0.55 + Math.min(1, dist / 16) * 0.75)
      ctx.lineWidth = w
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (d.tool === 'pencil' && pts.length > 2) {
    ctx.globalAlpha = st.alpha * 0.9
    ctx.lineWidth = st.width
    smoothPath(ctx, pts.map((p, i) => [p[0] + Math.sin(i * 12.99) * 0.8, p[1] + Math.cos(i * 8.77) * 0.8]), 0.2)
    ctx.stroke()
    ctx.restore()
    return
  }
  smoothPath(ctx, pts, d.smooth == null ? 0.5 : d.smooth)
  ctx.stroke()
  if (preview) {
    ctx.setLineDash([])
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 1
    ctx.strokeStyle = INK
  }
  ctx.restore()
}

export class SpaceRenderer {
  constructor(canvas, workspace) {
    this.canvas = canvas
    this.ws = workspace
    this.ctx = canvas.getContext('2d', { alpha: true })
    this.w = 0
    this.h = 0
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.onImageLoad = null
    this.lastImageRequest = 0
  }

  resize(w, h, dpr = Math.min(2, window.devicePixelRatio || 1)) {
    this.w = w; this.h = h; this.dpr = dpr
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
  }

  draw(state) {
    const ctx = this.ctx
    if (!ctx || !this.w || !this.h) return
    const cam = state.cam
    const s = cam.s
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    // 背景先铺满（屏幕空间）
    ctx.fillStyle = isDark() ? '#141416' : (state.flat ? '#F7F6F2' : '#FAF9F6')
    ctx.fillRect(0, 0, this.w, this.h)

    this.drawBackground(state)

    ctx.save()
    ctx.translate(this.w / 2 - cam.x * s, this.h / 2 - cam.y * s)
    ctx.scale(s, s)

    const view = visibleWorldRect(cam, this.w, this.h, 120 / s)
    const indexHits = this.ws.query(view)
    const visibleNodes = []
    const visibleDraws = []
    const force = state.forceVisible || []
    indexHits.forEach((it) => {
      if (it.type === 'node') visibleNodes.push(it.data)
      else visibleDraws.push(it.data)
    })
    // 正在拖拽/选中的元素必须始终绘制（索引可能滞后于实时坐标）
    force.forEach((id) => {
      const n = this.ws.nodeById(id)
      if (n && n.spaceId === this.ws.currentId && !visibleNodes.includes(n)) visibleNodes.push(n)
      const d = this.ws.drawingById(id)
      if (d && d.spaceId === this.ws.currentId && !visibleDraws.includes(d)) visibleDraws.push(d)
    })

    const zSorted = visibleNodes.map((n) => ({ type: 'node', ref: n, z: n.z || 1 }))
      .concat(visibleDraws.map((d) => ({ type: 'draw', ref: d, z: d.z || 1 })))
      .sort((a, b) => a.z - b.z)

    // 组合框在元素之下
    Object.values(this.ws.groups).forEach((g) => {
      if (g.spaceId !== this.ws.currentId) return
      const b = this.ws.groupBounds(g.id)
      if (!b || !this.rectVisible(b, view)) return
      const active = state.activeGroup === g.id
      ctx.save()
      // 极淡底色，让空组也看得出是「容器」
      ctx.fillStyle = active ? 'rgba(232,184,109,0.10)' : (isDark() ? 'rgba(255,255,255,0.035)' : 'rgba(44,44,44,0.025)')
      roundRect(ctx, b.x, b.y, b.w, b.h, 10)
      ctx.fill()
      ctx.strokeStyle = active ? (isDark() ? 'rgba(255,255,255,0.55)' : 'rgba(44,44,44,0.55)') : (isDark() ? 'rgba(255,255,255,0.22)' : 'rgba(44,44,44,0.22)')
      ctx.lineWidth = (active ? 1.6 : 1) / s
      ctx.setLineDash([7 / s, 5 / s])
      ctx.stroke()
      ctx.restore()
    })

    // 连线位于节点下方
    this.drawEdges(ctx, state, view)

    // 节点 / 绘画 按 z 混排
    zSorted.forEach((item) => {
      if (item.type === 'node') this.drawNode(ctx, item.ref, s, state)
      else drawDrawing(ctx, item.ref, s)
    })

    // 组名标签：画在元素之上，保证不会被卡片盖住
    this.drawGroupLabels(ctx, state, s, view)

    // 选中绘画的包围框
    state.selection.forEach((id) => {
      const d = this.ws.drawingById(id)
      if (!d || d.spaceId !== this.ws.currentId) return
      const sel = state.selection.size === 1
      ctx.save()
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.7)' : 'rgba(44,44,44,0.7)'
      ctx.lineWidth = 1.5 / s
      ctx.setLineDash([6 / s, 4 / s])
      roundRect(ctx, d.x, d.y, d.w, d.h, 6)
      ctx.stroke()
      if (sel) {
        ctx.setLineDash([])
        ctx.fillStyle = ink()
        const hs = 5 / s
        ;[[d.x, d.y], [d.x + d.w, d.y], [d.x, d.y + d.h], [d.x + d.w, d.y + d.h]].forEach(([x, y]) => {
          ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2)
        })
      }
      ctx.restore()
    })

    // 选中节点手柄
    if (state.selection.size === 1) {
      const n = this.ws.nodeById([...state.selection][0])
      if (n && n.spaceId === this.ws.currentId) this.drawHandles(ctx, n, s)
    }

    if (state.tempEdge) this.drawTempEdge(ctx, state)
    if (state.preview) drawDrawing(ctx, state.preview, s, true)
    if (state.marquee) {
      const m = state.marquee
      ctx.save()
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(44,44,44,0.06)'
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.4)' : 'rgba(44,44,44,0.4)'
      ctx.lineWidth = 1 / s
      ctx.fillRect(m.x, m.y, m.w, m.h)
      ctx.strokeRect(m.x, m.y, m.w, m.h)
      ctx.restore()
    }
    if (state.guides && state.guides.length) {
      ctx.save()
      ctx.strokeStyle = 'rgba(232,184,109,0.9)'
      ctx.lineWidth = 1 / s
      state.guides.forEach((g) => {
        if (g.v != null) {
          ctx.beginPath(); ctx.moveTo(g.v, view.y - 1000); ctx.lineTo(g.v, view.y + view.h + 1000); ctx.stroke()
        }
        if (g.h != null) {
          ctx.beginPath(); ctx.moveTo(view.x - 1000, g.h); ctx.lineTo(view.x + view.w + 1000, g.h); ctx.stroke()
        }
      })
      ctx.restore()
    }
    ctx.restore()

    // 画布四角渐隐（微暖纸面感，低端设备关闭）
    if (!state.lite) this.drawVignette()
  }

  // 组名标签单独一遍绘制：恒定屏幕字号，贴在组框上沿（贴到视口顶时改放框内）
  drawGroupLabels(ctx, state, s, view) {
    Object.values(this.ws.groups).forEach((g) => {
      if (g.spaceId !== this.ws.currentId) return
      const b = this.ws.groupBounds(g.id)
      if (!b || !this.rectVisible(b, view)) return
      const active = state.activeGroup === g.id
      const label = String(g.name || '组')
      const fs = 10.5 / s
      ctx.save()
      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      const tw = ctx.measureText(label).width
      const padX = 7 / s
      const bh = 15 / s
      const lx = b.x + 8 / s
      const above = (b.y - bh - 3 / s) >= view.y
      const ly = above ? (b.y - bh - 3 / s) : (b.y + 3 / s)
      ctx.fillStyle = isDark() ? 'rgba(30,30,33,0.94)' : 'rgba(255,253,248,0.94)'
      roundRect(ctx, lx, ly, tw + padX * 2, bh, 5 / s)
      ctx.fill()
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(44,44,44,0.16)'
      ctx.lineWidth = 1 / s
      ctx.setLineDash([])
      ctx.stroke()
      ctx.fillStyle = isDark() ? (active ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.58)') : (active ? 'rgba(44,44,44,0.78)' : 'rgba(44,44,44,0.55)')
      ctx.fillText(label, lx + padX, ly + bh - 4 / s)
      ctx.restore()
    })
  }

  rectVisible(r, view) {
    return !(r.x + r.w < view.x || r.x > view.x + view.w || r.y + r.h < view.y || r.y > view.y + view.h)
  }

  drawBackground(state) {
    const ctx = this.ctx
    const cfg = this.ws.settings.background || {}
    const pattern = cfg.pattern || 'dots'
    const opacity = cfg.opacity == null ? 0.55 : cfg.opacity
    const s = state.cam.s
    if (pattern === 'image' && cfg.image) {
      let rec = BG_IMG_CACHE.get(cfg.image)
      if (!rec) {
        rec = { img: null }
        BG_IMG_CACHE.set(cfg.image, rec)
        const img = new Image()
        img.onload = () => { rec.img = img; this.onImageLoad && this.onImageLoad() }
        img.src = cfg.image
      }
      if (rec.img) {
        ctx.save()
        ctx.globalAlpha = Math.max(0.05, opacity)
        const iw = rec.img.width, ih = rec.img.height
        const scale = Math.max(this.w / iw, this.h / ih)
        const dw = iw * scale, dh = ih * scale
        ctx.drawImage(rec.img, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh)
        ctx.restore()
        return
      }
    }
    ctx.save()
    ctx.translate(this.w / 2 - state.cam.x * s, this.h / 2 - state.cam.y * s)
    ctx.scale(s, s)
    const view = visibleWorldRect(state.cam, this.w, this.h, 40 / s)
    // v2.1.0 修复：图案间距随缩放自适应合并（屏幕间距不足 10px 时步长翻倍），
    // 并移除旧的固定行列上限 —— 画布缩到极小时也能铺满整个视口，不再露出边缘空带。
    let step = 24
    while (step * s < 10) step *= 2
    const alpha = Math.min(0.7, Math.max(0.05, opacity))
    // 图案颜色随主题：深色用白色线，浅色保持暖灰
    const mode = isDark() ? 'rgba(255,255,255,' : 'rgba(44,44,44,'
    if (pattern === 'dots') {
      const r = Math.max(0.7, 1.1 / s)
      ctx.fillStyle = mode + (alpha * 0.28) + ')'
      const x0 = Math.floor(view.x / step) * step
      const y0 = Math.floor(view.y / step) * step
      const cols = Math.ceil(view.w / step) + 2
      const rows = Math.ceil(view.h / step) + 2
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = x0 + i * step, y = y0 + j * step
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        }
      }
    } else if (pattern === 'grid') {
      ctx.strokeStyle = mode + (alpha * 0.16) + ')'
      ctx.lineWidth = 1 / s
      const x0 = Math.floor(view.x / step) * step
      const y0 = Math.floor(view.y / step) * step
      const cols = Math.ceil(view.w / step) + 2
      const rows = Math.ceil(view.h / step) + 2
      for (let i = 0; i < cols; i++) {
        const x = x0 + i * step
        ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.h); ctx.stroke()
      }
      for (let j = 0; j < rows; j++) {
        const y = y0 + j * step
        ctx.beginPath(); ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.w, y); ctx.stroke()
      }
      // 主网格线
      ctx.strokeStyle = mode + (alpha * 0.22) + ')'
      const major = step * 5
      const mx0 = Math.floor(view.x / major) * major
      const my0 = Math.floor(view.y / major) * major
      for (let i = 0; i < Math.ceil(view.w / major) + 2; i++) {
        const x = mx0 + i * major
        ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.h); ctx.stroke()
      }
      for (let j = 0; j < Math.ceil(view.h / major) + 2; j++) {
        const y = my0 + j * major
        ctx.beginPath(); ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.w, y); ctx.stroke()
      }
    } else if (pattern === 'lines') {
      ctx.strokeStyle = mode + (alpha * 0.12) + ')'
      ctx.lineWidth = 1 / s
      let lstep = 30
      while (lstep * s < 10) lstep *= 2
      const y0 = Math.floor(view.y / lstep) * lstep
      for (let j = 0; j < Math.ceil(view.h / lstep) + 2; j++) {
        const y = y0 + j * lstep
        ctx.beginPath(); ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.w, y); ctx.stroke()
      }
    }
    ctx.restore()
  }

  drawVignette() {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.42, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.78)
    g.addColorStop(0, 'rgba(250,249,246,0)')
    g.addColorStop(1, isDark() ? 'rgba(0,0,0,0.42)' : 'rgba(231,229,223,0.32)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.w, this.h)
  }

  drawNode(ctx, n, s, state) {
    // 数据卡片（面板 / 卡片 / 便利贴）由 DOM 叠层真实渲染，画布只负责空白区域与占位
    if (state.domIds && state.domIds.has(n.id)) return
    const selected = state.selection.has(n.id)
    const hover = state.hoverId === n.id
    const lod = s < 0.3 ? 0 : (s < 0.55 ? 1 : 2)
    const color = n.color || '#C8C5BD'
    const isMedia = n.kind === 'image' || n.kind === 'video'
    // 照片 / 视频卡：白边相纸（白色外框 + 内缩照片 + 轻微圆角）
    const r = isMedia ? 10 : 14
    // 相纸白边宽度随卡片尺寸缩放，并限制上下限，保证小卡也有可见白边
    const pad = isMedia ? Math.max(3, Math.min(9, Math.min(n.w, n.h) * 0.035)) : 0
    const innerR = Math.max(2, r - pad * 0.5)
    ctx.save()
    // 统一悬停物理反馈：整体上浮（屏幕 3px，0.2s 补间由 SpaceCanvas 驱动）
    const hoverLift = (state.hoverLifts && state.hoverLifts.get(n.id)) || 0
    if (hoverLift > 0.005) ctx.translate(0, -3 * hoverLift / s)
    const borderless = isMedia || (n.kind === 'panel' && n.panelKind === 'map')

    // 图片 / 视频：白边相纸（白底外框，照片内缩 pad），静止微弱底线影，悬停弥散影
    if (isMedia) {
      const src = n.media && (n.media.thumb || n.media.src)
      const img = src ? getImage(src) : null
      const ix = n.x + pad, iy = n.y + pad
      const iw = Math.max(1, n.w - pad * 2), ih = Math.max(1, n.h - pad * 2)
      ctx.save()
      roundRect(ctx, n.x, n.y, n.w, n.h, r)
      if (!state.flat && !state.lite) {
        ctx.shadowColor = 'rgba(0,0,0,' + (0.08 + 0.08 * hoverLift) + ')'
        ctx.shadowBlur = (6 + 22 * hoverLift) / s
        ctx.shadowOffsetY = (2 + 7 * hoverLift) / s
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()
      // 内侧照片区域
      roundRect(ctx, ix, iy, iw, ih, innerR)
      ctx.clip()
      if (img) {
        const scale = Math.max(iw / img.width, ih / img.height)
        const dw = img.width * scale, dh = img.height * scale
        ctx.drawImage(img, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh)
      } else {
        ctx.fillStyle = cardFill(color, 0.5)
        ctx.fillRect(ix, iy, iw, ih)
        ctx.fillStyle = inkSoft()
        ctx.font = '500 ' + Math.max(9, Math.min(13, iw / 14)) + 'px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(n.kind === 'video' ? '视频' : '图片', ix + iw / 2, iy + ih / 2)
        ctx.textAlign = 'left'
      }
      ctx.restore()
      if (n.kind === 'video') {
        ctx.fillStyle = 'rgba(255,255,255,0.86)'
        ctx.beginPath(); ctx.arc(ix + iw / 2, iy + ih / 2, 16, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.moveTo(ix + iw / 2 - 4, iy + ih / 2 - 7)
        ctx.lineTo(ix + iw / 2 + 8, iy + ih / 2)
        ctx.lineTo(ix + iw / 2 - 4, iy + ih / 2 + 7)
        ctx.closePath(); ctx.fill()
      }
      if (selected) {
        ctx.strokeStyle = ink(); ctx.lineWidth = 1.8 / s
        roundRect(ctx, n.x, n.y, n.w, n.h, r); ctx.stroke()
      }
      ctx.restore()
      return
    }

    // 阴影：静止微弱底线影 → 悬停上浮后弥散影（扁平模式与低端设备关闭）
    if (!state.flat && !state.lite && lod === 2) {
      ctx.shadowColor = 'rgba(0,0,0,' + (0.04 + 0.04 * hoverLift) + ')'
      ctx.shadowBlur = (2 + 22 * hoverLift) / s
      ctx.shadowOffsetY = (1 + 7 * hoverLift) / s
    }
    // 整卡着色：几乎全部卡片都用主题淡彩铺满整张
    let fill = cardFill(color, 0.62)
    if (n.kind === 'space') fill = cardFill(color, 0.55)
    else if (n.cardKind === 'clock') fill = '#33322E'
    // 天气整卡是深色磨砂卡：低缩放下画布占位保持同色，缩放跨越 DOM 阈值时不闪白
    else if (n.kind === 'panel' && n.panelKind === 'weather') fill = '#26262A'
    else if (n.cardKind === 'audio') fill = withAlpha(color, 0.95)
    roundRect(ctx, n.x, n.y, n.w, n.h, r)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.shadowColor = 'transparent'
    // 描边：地图等无边框卡片静止时不描边；悬停只用上浮 + 影，不再变色
    ctx.lineWidth = 1 / s
    if (selected) ctx.strokeStyle = ink()
    else ctx.strokeStyle = borderless ? 'transparent' : line()
    if (!borderless || selected) ctx.stroke()

    let contentTop = n.y + 18
    let contentLeft = n.x + 20
    let contentRight = n.x + n.w - 18

    // 低缩放：整卡色块 + 简笔内容，保证任何倍率都有显示
    if (lod === 0) {
      ctx.fillStyle = withAlpha(color, 0.34)
      const bw = Math.max(3, n.w * 0.34)
      roundRect(ctx, n.x + 12, n.y + 14, bw, 6, 3); ctx.fill()
      roundRect(ctx, n.x + 12, n.y + 28, Math.max(3, n.w * 0.22), 5, 3); ctx.fill()
      ctx.restore()
      return
    }

    // 空间卡片：文件夹视觉；内容随卡片大小等比缩放（放大后不留大片空白）
    const sk = n.kind === 'space' ? Math.max(0.75, Math.min(1.5, Math.min(n.w / 240, n.h / 104))) : 1
    if (n.kind === 'space') this.drawFolderGlyph(ctx, n, color, s, sk)


    if (lod === 2) {
      const layout = layoutText(n)
      const tfs = Math.round(14 * sk)
      ctx.fillStyle = ink()
      let ty = contentTop + 14
      // 缩放后实际字号不足 6px 时只保留卡片色块，不绘制文字（避免小字重采样成灰雾）
      if (tfs * s >= 6) {
        ctx.font = '600 ' + tfs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
        layout.titleLines.forEach((line) => {
          ctx.fillText(line, contentLeft, ty)
          ty += 20
        })
        for (let i = 0; i < layout.lines.length; i++) {
          const ln = layout.lines[i]
          if (!ln.text) { ty += ln.h || 6; continue }
          if (ty > n.y + n.h - 12) break
          if ((ln.size || 12) * s < 6) { ty += ln.h || 18; continue }
          ctx.font = (ln.bold ? '600 ' : '400 ') + (ln.size || 12) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
          ctx.fillStyle = ln.color || inkSoft()
          ctx.fillText(ln.text, contentLeft, ty + (ln.size || 12) - 1)
          if (ln.strike) {
            const w = ctx.measureText(ln.text).width
            ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.3)' : 'rgba(44,44,44,0.3)'; ctx.lineWidth = 1 / s
            ctx.beginPath(); ctx.moveTo(contentLeft, ty - 4); ctx.lineTo(contentLeft + w, ty - 4); ctx.stroke()
          }
          ty += ln.h || 18
        }
      }
      // 类型角标
      if (n.kind === 'space') {
        ctx.fillStyle = inkSoft()
        const nfs = Math.round(10 * sk)
        if (nfs * s >= 5) {
          ctx.font = '500 ' + nfs + 'px -apple-system, sans-serif'
          const count = (this.ws.spaces[n.targetSpaceId] && this.ws.spaces[n.targetSpaceId].childIds) || []
          ctx.fillText('双击进入 · ' + count.length + ' 个子空间', contentLeft, n.y + n.h - 14 * sk)
        }
      }
    } else {
      if (13 * s < 6) { ctx.restore(); return }
      ctx.font = '600 13px -apple-system, "PingFang SC", sans-serif'
      ctx.fillStyle = ink()
      const label = n.title || ''
      let t = label
      while (ctx.measureText(t).width > n.w - 36 && t.length > 4) t = t.slice(0, -1)
      if (t !== label) t = t.slice(0, -1) + '…'
      ctx.fillText(t, contentLeft, contentTop + 16)
      // 中低倍率补两条内容骨架线，避免缩小时出现空白卡片
      const bw = Math.max(10, n.w - 40)
      ctx.fillStyle = withAlpha(color, 0.30)
      if (n.h > 92) roundRect(ctx, contentLeft, contentTop + 28, bw * 0.74, 6, 3)
      if (n.h > 92) ctx.fill()
      if (n.h > 120) {
        roundRect(ctx, contentLeft, contentTop + 42, bw * 0.52, 5, 3)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  drawFolderGlyph(ctx, n, color, s, sk = 1) {
    const size = Math.min(46 * sk, n.h * 0.46)
    const x = n.x + n.w - size - 16
    const y = n.y + 16
    ctx.save()
    ctx.fillStyle = withAlpha(color, 0.5)
    // 文件夹：底部大矩形 + 顶部小标签
    roundRect(ctx, x, y + size * 0.24, size, size * 0.66, 5)
    ctx.fill()
    roundRect(ctx, x, y + size * 0.08, size * 0.52, size * 0.36, 4)
    ctx.fill()
    ctx.strokeStyle = withAlpha(color, 0.9)
    ctx.lineWidth = 1 / s
    roundRect(ctx, x, y + size * 0.24, size, size * 0.66, 5)
    ctx.stroke()
    ctx.restore()
  }

  drawHandles(ctx, n, s) {
    const hs = 6 / s
    ctx.save()
    ctx.fillStyle = ink()
    // 四角缩放手柄
    ;[[n.x, n.y], [n.x + n.w, n.y], [n.x, n.y + n.h], [n.x + n.w, n.y + n.h]].forEach(([x, y]) => {
      ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs)
    })
    // 连线连接点（四向）
    ctx.fillStyle = isDark() ? '#1E1E21' : '#FFFFFF'
    ctx.strokeStyle = ink()
    ctx.lineWidth = 1.4 / s
    const pts = [
      [n.x + n.w / 2, n.y],
      [n.x + n.w / 2, n.y + n.h],
      [n.x, n.y + n.h / 2],
      [n.x + n.w, n.y + n.h / 2]
    ]
    pts.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, (i === 3 ? 5.5 : 4) / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    })
    ctx.restore()
  }

  drawEdges(ctx, state, view) {
    const s = state.cam.s
    const edges = this.ws.edges.filter((e) => e.spaceId === this.ws.currentId)
    const byId = new Map()
    this.ws.nodes.forEach((n) => { if (n.spaceId === this.ws.currentId) byId.set(n.id, n) })
    edges.forEach((e) => {
      const a = byId.get(e.fromId), b = byId.get(e.toId)
      if (!a || !b) return
      if (!this.rectVisible({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + Math.max(a.w, b.w), h: Math.abs(a.y - b.y) + Math.max(a.h, b.h) }, view)) return
      this.strokeEdge(ctx, a, b, e.type || 'curve', s, e, state)
    })
  }

  anchorPoints(a, b) {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const dx = bc.x - ac.x, dy = bc.y - ac.y
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        x1: dx >= 0 ? a.x + a.w : a.x,
        y1: ac.y,
        x2: dx >= 0 ? b.x : b.x + b.w,
        y2: bc.y,
        dir: dx >= 0 ? 'right' : 'left'
      }
    }
    return {
      x1: ac.x,
      y1: dy >= 0 ? a.y + a.h : a.y,
      x2: bc.x,
      y2: dy >= 0 ? b.y : b.y + b.h,
      dir: dy >= 0 ? 'down' : 'up'
    }
  }

  edgeCurvePath(ctx, a, b) {
    const p = this.anchorPoints(a, b)
    if (p.dir === 'right' || p.dir === 'left') {
      const mid = (p.x1 + p.x2) / 2
      ctx.moveTo(p.x1, p.y1)
      ctx.bezierCurveTo(mid, p.y1, mid, p.y2, p.x2, p.y2)
    } else {
      const mid = (p.y1 + p.y2) / 2
      ctx.moveTo(p.x1, p.y1)
      ctx.bezierCurveTo(p.x1, mid, p.x2, mid, p.x2, p.y2)
    }
    return p
  }

  strokeEdge(ctx, a, b, type, s, edge, state) {
    const p = this.anchorPoints(a, b)
    ctx.save()
    ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.42)' : 'rgba(44,44,44,0.42)'
    ctx.lineWidth = 1.2 / s
    ctx.lineCap = 'round'
    ctx.beginPath()
    let end = { x: p.x2, y: p.y2, ang: 0 }
    if (type === 'orthogonal') {
      const midX = p.x1 + (p.x2 - p.x1) / 2
      ctx.moveTo(p.x1, p.y1)
      ctx.lineTo(midX, p.y1)
      ctx.lineTo(midX, p.y2)
      ctx.lineTo(p.x2, p.y2)
      end = { x: p.x2, y: p.y2, ang: Math.abs(p.x2 - midX) < 1 ? 0 : (p.x2 > midX ? 0 : Math.PI) }
    } else if (type === 'straight') {
      ctx.moveTo(p.x1, p.y1)
      ctx.lineTo(p.x2, p.y2)
      end = { x: p.x2, y: p.y2, ang: Math.atan2(p.y2 - p.y1, p.x2 - p.x1) }
    } else {
      this.edgeCurvePath(ctx, a, b)
      // 曲线末端切线
      end = { x: p.x2, y: p.y2, ang: (p.dir === 'right' || p.dir === 'left') ? (p.dir === 'right' ? 0 : Math.PI) : (p.dir === 'down' ? Math.PI / 2 : -Math.PI / 2) }
    }
    ctx.stroke()
    if (edge && edge.arrow !== false) {
      const size = 8 / s
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.55)' : 'rgba(44,44,44,0.55)'
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(end.x - Math.cos(end.ang - 0.42) * size, end.y - Math.sin(end.ang - 0.42) * size)
      ctx.lineTo(end.x - Math.cos(end.ang + 0.42) * size, end.y - Math.sin(end.ang + 0.42) * size)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  drawTempEdge(ctx, state) {
    const a = this.ws.nodeById(state.tempEdge.fromId)
    if (!a) return
    const s = state.cam.s
    ctx.save()
    ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.6)' : 'rgba(44,44,44,0.6)'
    ctx.lineWidth = 1.6 / s
    ctx.setLineDash([6 / s, 4 / s])
    ctx.beginPath()
    ctx.moveTo(a.x + a.w / 2, a.y)
    ctx.lineTo(state.tempEdge.x, state.tempEdge.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(state.tempEdge.x, state.tempEdge.y, 4 / s, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }
}
