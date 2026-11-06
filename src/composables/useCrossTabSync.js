// 多标签页实时同步：通过 BroadcastChannel 广播「状态已变更」，
// 其他标签页收到后从 localStorage 重载，实现零拷贝的数据互通。
import { onMounted, onUnmounted } from 'vue'

export function useCrossTabSync(store) {
  let ch = null
  let timer = null
  let muted = false // 静默重载窗口：期间既不处理外来广播，也不对外广播，杜绝回环
  function postChanged() {
    if (muted) return
    try { ch && ch.postMessage({ t: 'changed', ts: Date.now() }) } catch (e) {}
  }
  function onMessage(e) {
    if (!e || !e.data || e.data.t !== 'changed') return
    if (muted) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      muted = true
      Promise.resolve()
        .then(() => store.reloadFromStorage())
        .catch(() => {})
        .finally(() => { setTimeout(() => { muted = false }, 500) })
    }, 350)
  }
  onMounted(() => {
    if (typeof BroadcastChannel === 'undefined') return
    try {
      ch = new BroadcastChannel('eo-sync')
      ch.onmessage = onMessage
    } catch (e) { ch = null }
  })
  onUnmounted(() => { if (timer) clearTimeout(timer); if (ch) { ch.onmessage = null; try { ch.close() } catch (e) {} } })
  return { postChanged }
}
