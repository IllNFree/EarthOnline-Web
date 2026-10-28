// ===== 剪贴板智能监听（需求 8.3）：页面重新可见时读取剪贴板 =====
// 监听 visibilitychange / focus；读取后右下角 Haze 气泡提示「是否加入笔记」。
import { reactive } from 'vue'
import { useAppStore } from '../stores/app.js'

const state = reactive({ visible: false, text: '', onAccept: null })
let lastText = ''
let timer = null

export function useClipboardWatcher() {
  const store = useAppStore()

  async function check() {
    if (store.data.enableClipboardWatch === false) return
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.readText) return
    if (document.visibilityState !== 'visible') return
    try {
      const text = await navigator.clipboard.readText()
      if (!text || text === lastText || text.length > 2000) return
      lastText = text
      state.text = text.slice(0, 80)
      state.visible = true
      clearTimeout(timer)
      timer = setTimeout(() => { state.visible = false }, 9000)
    } catch (e) { /* 无权限 / 不支持：静默 */ }
  }

  function activate() {
    if (typeof document === 'undefined') return () => {}
    const onVis = () => { if (!document.hidden) setTimeout(check, 500) }
    const onFocus = () => setTimeout(check, 500)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }
  function accept() {
    if (typeof state.onAccept === 'function') { try { state.onAccept(lastText) } catch (e) {} }
    state.visible = false
  }
  function dismiss() { state.visible = false }
  return { state, activate, accept, dismiss }
}
