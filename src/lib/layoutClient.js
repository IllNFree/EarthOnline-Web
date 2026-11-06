// ===== 布局计算客户端 =====
// 红线落地：优先在 Web Worker 中计算布局，避免阻塞 UI 主线程；
// 若运行环境不支持 Worker（SSR / 某些测试 / 老浏览器）则降级为主线程直接计算。
import { computeLayout } from './layoutEngine.js'

let worker = null
let supported = typeof window !== 'undefined' && typeof Worker !== 'undefined'
let seq = 0
const pending = new Map()

function ensureWorker() {
  if (!supported) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./layoutWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const msg = e.data || {}
      if (msg.type !== 'layout:result' && msg.type !== 'layout:error') return
      const cb = pending.get(msg.id)
      if (!cb) return
      pending.delete(msg.id)
      if (msg.type === 'layout:error') cb.reject(new Error(msg.error))
      else cb.resolve(msg.positions)
    }
    worker.onerror = () => {
      // Worker 运行期异常 → 标记降级，后续走主线程
      supported = false
      pending.forEach((cb) => { pending.delete(cb.id); cb.reject(new Error('worker error')) })
      worker = null
    }
    return worker
  } catch (err) {
    supported = false
    worker = null
    return null
  }
}

/**
 * 计算布局。返回 Promise<{ [id]: {x,y} }>。
 * 若 Worker 可用则在 Worker 执行；否则主线程直接执行（不阻塞 UI 的前提是调用方自行异步调度）。
 */
export function requestLayout(mode, nodes, edges, rootId, spacing) {
  const w = ensureWorker()
  if (!w) {
    return Promise.resolve(computeLayout(mode, nodes, edges, rootId, spacing))
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(computeLayout(mode, nodes, edges, rootId, spacing)) }
    }, 1500)
    pending.set(id, {
      resolve: (pos) => { clearTimeout(timer); resolve(pos) },
      reject: (err) => { clearTimeout(timer); reject(err) }
    })
    w.postMessage({ type: 'layout', id, mode, nodes, edges, rootId, spacing })
  })
}

export function isWorkerLayoutEnabled() { return supported && !!worker }
