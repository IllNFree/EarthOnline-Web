// ===== 相机（视口）工具：世界坐标 ↔ 屏幕坐标 =====
// 相机用「世界中心点 + 缩放」表达，切换空间时直接恢复同一组参数即可无缝续视口。
// 所有函数无 Vue 依赖，渲染器、交互层、迷你地图共用。

export const MIN_SCALE = 0.12
export const MAX_SCALE = 3.2

export function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}
// 滚轮 / 按钮缩放吸附到 0.05 档位：避免长期停在 0.63、0.77 这类非整刻度上，
// DOM 卡片整体 scale 分数阶时文字会被位图重采样 → 看起来「有时模糊」。
export function snapScale(s) {
  const q = Math.round(s * 20) / 20
  return clampScale(q > 0 ? q : s)
}

export function screenToWorld(cam, sx, sy, vw, vh) {
  return {
    x: (sx - vw / 2) / cam.s + cam.x,
    y: (sy - vh / 2) / cam.s + cam.y
  }
}

export function worldToScreen(cam, wx, wy, vw, vh) {
  return {
    x: (wx - cam.x) * cam.s + vw / 2,
    y: (wy - cam.y) * cam.s + vh / 2
  }
}

export function visibleWorldRect(cam, vw, vh, pad = 0) {
  const w = (vw + pad * 2) / cam.s
  const h = (vh + pad * 2) / cam.s
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h }
}

// 以屏幕某点为中心缩放（滚轮 / 双击 / 按钮都用它）
export function zoomAt(cam, factor, sx, sy, vw, vh) {
  const next = snapScale(cam.s * factor)
  if (next === cam.s) return cam
  const p = screenToWorld(cam, sx, sy, vw, vh)
  return {
    x: p.x - (sx - vw / 2) / next,
    y: p.y - (sy - vh / 2) / next,
    s: next
  }
}

export function fitRect(cam, rect, vw, vh, padding = 80) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return cam
  const s = clampScale(Math.min((vw - padding * 2) / rect.w, (vh - padding * 2) / rect.h))
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    s
  }
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

const animators = new WeakMap()

// 相机动画：可被新的动画打断（保存 token），并保证结束时精确落到目标值
export function animateCamera(cam, target, duration, onUpdate, onDone) {
  const token = {}
  animators.set(cam, token)
  const from = { x: cam.x, y: cam.y, s: cam.s }
  const start = performance.now()
  const dur = Math.max(80, duration || 420)
  function step(now) {
    if (animators.get(cam) !== token) return
    const t = Math.min(1, (now - start) / dur)
    const e = easeOutCubic(t)
    // 缩放走对数插值，视觉上更均匀
    const s = from.s * Math.pow(target.s / from.s, e)
    const x = from.x + (target.x - from.x) * e
    const y = from.y + (target.y - from.y) * e
    cam.x = x; cam.y = y; cam.s = s
    if (onUpdate) onUpdate(cam)
    if (t < 1) requestAnimationFrame(step)
    else if (onDone) onDone()
  }
  requestAnimationFrame(step)
}

export function stopCameraAnimation(cam) {
  animators.delete(cam)
}

export function screenRectOf(cam, node, vw, vh) {
  return {
    x: (node.x - cam.x) * cam.s + vw / 2,
    y: (node.y - cam.y) * cam.s + vh / 2,
    w: node.w * cam.s,
    h: node.h * cam.s
  }
}
