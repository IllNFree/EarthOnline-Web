// ===== 剪贴板智能监听（需求 5 / 8.3）：页面重新可见时读取剪贴板并多态孵化 =====
// 监听 visibilitychange / focus；读取后右下角 Haze 气泡提示，确认后按 MIME 类型孵化实体 + 节点。
import { reactive } from 'vue'
import { useAppStore } from '../stores/app.js'
import { incubateClipboard } from '../services/ClipboardNodeFactory.js'

const state = reactive({ visible: false, text: '', kind: '', lastFp: '' })
let timer = null

export function useClipboardWatcher() {
  const store = useAppStore()

  async function check() {
    if (store.data.enableClipboardWatch === false) return
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') return
    if (document.visibilityState !== 'visible') return
    try {
      const items = await navigator.clipboard.read()
      if (!items || !items.length) return
      const fp = JSON.stringify(items.map((i) => i.types))
      if (fp === state.lastFp) return
      state.lastFp = fp
      const hasImg = items.some((i) => (i.types || []).some((t) => t.startsWith('image/')))
      const hasText = items.some((i) => (i.types || []).includes('text/plain'))
      state.kind = hasImg ? '图片' : hasText ? '文本 / 链接' : '文件'
      state.text = '检测到剪贴板' + state.kind + '，可孵化为节点'
      state.visible = true
      clearTimeout(timer)
      timer = setTimeout(() => { state.visible = false }, 12000)
    } catch (e) {
      // 无权限 / 不支持：静默降级
    }
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
  async function accept() {
    state.visible = false
    const r = await incubateClipboard()
    if (r.ok && r.results && r.results.length) {
      store.showToast('已从剪贴板孵化 ' + r.results.length + ' 个节点')
      // 模块六：剪贴板捕获里程碑（触发 Web 专属成就）
      store.bumpMilestone('clipboardCatch')
    } else if (!r.ok) store.showToast(r.error || '剪贴板孵化失败')
  }
  function dismiss() { state.visible = false }
  return { state, activate, accept, dismiss }
}
