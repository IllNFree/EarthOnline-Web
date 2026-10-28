// ===== 原生右键菜单（需求 8.1）：全局拦截 + 液态玻璃面板 =====
// 关键：读取全局设置 enableCustomContextMenu；关闭时直接放行浏览器原生菜单（真开关，非假 UI）。
import { reactive, readonly } from 'vue'
import { useAppStore } from '../stores/app.js'

// 模块级共享状态（单例）：全局只存在一个右键菜单
const state = reactive({ visible: false, x: 0, y: 0, items: [] })

export function openContextMenu(event, items) {
  const store = useAppStore()
  // 红线 6：右键开关必须生效。关闭时直接 return，不拦截、不 preventDefault → 原生菜单出现
  if (store.data.enableCustomContextMenu === false) return false
  if (!event || typeof event.preventDefault !== 'function') return false
  event.preventDefault()
  event.stopPropagation()
  const menuW = 224
  const menuH = (items ? items.length : 0) * 46 + 16
  let x = event.clientX || 0
  let y = event.clientY || 0
  // 边界检测：贴边翻转，避免溢出视口
  if (x + menuW > window.innerWidth) x = Math.max(8, window.innerWidth - menuW - 8)
  if (y + menuH > window.innerHeight) y = Math.max(8, window.innerHeight - menuH - 8)
  state.items = Array.isArray(items) ? items.filter((it) => it && it.label) : []
  state.x = x
  state.y = y
  state.visible = true
  return true
}

export function closeContextMenu() {
  state.visible = false
  state.items = []
}

export function useContextMenu() {
  return {
    open: openContextMenu,
    close: closeContextMenu,
    state: readonly(state)
  }
}
