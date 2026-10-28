// ===== 画布桥：跨模块（Tool Calling / 导入 / 剪贴板）向当前画布投递节点 =====
// 白板主页挂载时注册处理器；其他模块调用 ensureNodeForEntity / focusNode 时，
// 若画布未打开则静默 no-op（实体已落库，仅不生成节点视图）。
let handlers = {
  ensureNodeForEntity: null, // (type, id, opts) => node | null
  focusNode: null, // (node) => void
  isCanvasActive: null // () => boolean
}

export function registerCanvas(h) {
  handlers = Object.assign({}, handlers, h || {})
}
export function unregisterCanvas() {
  handlers = { ensureNodeForEntity: null, focusNode: null, isCanvasActive: null }
}
export function canvasIsActive() {
  return typeof handlers.isCanvasActive === 'function' ? handlers.isCanvasActive() : false
}
export function canvasEnsureNode(type, id, opts) {
  if (typeof handlers.ensureNodeForEntity === 'function') return handlers.ensureNodeForEntity(type, id, opts)
  return null
}
export function canvasFocus(node) {
  if (typeof handlers.focusNode === 'function') handlers.focusNode(node)
}
