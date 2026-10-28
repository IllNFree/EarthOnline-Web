// ===== 全局拖拽上传（需求 8.2）：监听整个窗口 dragover/drop =====
// 共享状态驱动全屏拖拽浮层；文件落点通过 onFiles 注册回调（页面组件自行消费）。
import { reactive } from 'vue'

const state = reactive({ dragging: false, files: [] })
let depth = 0
const handlers = new Set()

export function useGlobalDropZone() {
  function activate() {
    if (typeof window === 'undefined') return () => {}
    const onDragOver = (e) => { e.preventDefault() }
    const onDragEnter = (e) => { e.preventDefault(); depth++; state.dragging = true }
    const onDragLeave = (e) => {
      depth--
      if (depth <= 0) { depth = 0; state.dragging = false }
    }
    const onDrop = (e) => {
      e.preventDefault()
      depth = 0
      state.dragging = false
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
      state.files = files
      handlers.forEach((h) => { try { h(files) } catch (err) {} })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }
  function onFiles(fn) {
    handlers.add(fn)
    return () => handlers.delete(fn)
  }
  return { state, activate, onFiles }
}
