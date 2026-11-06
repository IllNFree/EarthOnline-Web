// ===== PWA 更新状态（3.0 存储与升级可靠性） =====
// registerSW 的回调只做「标记」，UI 由 UpdateBanner 渲染，避免 main.js 里塞模板逻辑。
// applyUpdate 由 main.js 注入（内部调用 registerSW 返回的 updateSW(true) → 跳过等待并刷新）。
import { reactive } from 'vue'

export const updateState = reactive({
  needRefresh: false,
  offlineReady: false,
  updating: false,
  applyUpdate: null
})

export function applyUpdate() {
  if (updateState.updating) return
  updateState.updating = true
  const fn = updateState.applyUpdate
  if (typeof fn === 'function') fn()
  else window.location.reload()
}

export function dismissUpdate() {
  updateState.needRefresh = false
}
