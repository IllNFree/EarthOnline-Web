// ===== 布局计算 Web Worker =====
// 红线：布局算法（尤其是全局节点）必须在 Web Worker 中执行，严禁阻塞 UI 线程。
// 该 Worker 仅在浏览器环境运行；主线程通过 layoutClient.js 调用，并自带主线程兜底。
import { computeLayout } from './layoutEngine.js'

self.onmessage = function (e) {
  const msg = e.data || {}
  if (!msg.type || msg.type !== 'layout') return
  try {
    const positions = computeLayout(msg.mode, msg.nodes, msg.edges, msg.rootId, msg.spacing)
    self.postMessage({ type: 'layout:result', id: msg.id, positions })
  } catch (err) {
    self.postMessage({ type: 'layout:error', id: msg.id, error: String(err && err.message || err) })
  }
}
