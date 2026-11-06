// ===== 原生右键菜单（需求 8.1）：全局拦截 + 液态玻璃面板 =====
// 关键：读取全局设置 enableCustomContextMenu；关闭时直接放行浏览器原生菜单（真开关，非假 UI）。
import { reactive, readonly } from 'vue'
import { useAppStore } from '../stores/app.js'

// 模块级共享状态（单例）：全局只存在一个右键菜单
const state = reactive({ visible: false, x: 0, y: 0, items: [], title: '', colors: null, onColor: null })

// 可编辑区域内（输入框 / 文本域 / contenteditable）保留浏览器原生右键菜单，
// 否则用户将失去复制、粘贴等基础操作能力。
function isEditableTarget(el) {
  if (!el || !el.tagName) return false
  const tag = String(el.tagName).toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return !!el.isContentEditable
}

export function openContextMenu(event, itemsOrOpts) {
  const store = useAppStore()
  // 红线 6：右键开关必须生效。关闭时直接 return，不拦截 → 原生菜单出现
  if (store.data.enableCustomContextMenu === false) return false
  if (!event || typeof event.preventDefault !== 'function') return false
  // 可编辑区域放行原生菜单（保留复制 / 粘贴）
  if (isEditableTarget(event.target)) return false
  event.preventDefault()
  event.stopPropagation()
  // 兼容两种调用：openContextMenu(e, itemsArray) 或 openContextMenu(e, { items, title, colors, onColor })
  let items = itemsOrOpts
  let title = ''
  let colors = null
  let onColor = null
  if (itemsOrOpts && !Array.isArray(itemsOrOpts)) {
    items = itemsOrOpts.items
    title = itemsOrOpts.title || ''
    colors = itemsOrOpts.colors || null
    onColor = itemsOrOpts.onColor || null
  }
  const list = Array.isArray(items) ? items.filter((it) => it && it.label) : []
  const menuW = 224
  const menuH = list.length * 46 + 16 + (colors ? 36 : 0)
  let x = event.clientX || 0
  let y = event.clientY || 0
  // 边界检测：贴边翻转，避免溢出视口
  if (x + menuW > window.innerWidth) x = Math.max(8, window.innerWidth - menuW - 8)
  if (y + menuH > window.innerHeight) y = Math.max(8, window.innerHeight - menuH - 8)
  state.items = list
  state.title = title
  state.colors = colors
  state.onColor = onColor
  state.x = x
  state.y = y
  state.visible = true
  return true
}

export function closeContextMenu() {
  state.visible = false
  state.items = []
  state.title = ''
  state.colors = null
  state.onColor = null
}

export function useContextMenu() {
  return {
    open: openContextMenu,
    close: closeContextMenu,
    state: readonly(state)
  }
}
