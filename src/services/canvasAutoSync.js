// ===== 模块二：实体自动同步至画布（带螺旋避让 + 防抖批量）=====
// 监听 Pinia store 中任务/笔记/背包/收藏/足迹/照片的 创建/更新/软删，
// 自动在画布上增删改节点；新节点用「螺旋避让算法」放置，严禁叠罗汉。
// 受设置 center.enableAutoCanvasSync 控制（默认开启）。
import { watch } from 'vue'

// 受同步的实体集合 → 画布节点类型
const SYNC_MAP = [
  { key: 'tasks', type: 'task', text: (r) => r.title || '任务' },
  { key: 'memos', type: 'memo', text: (r) => r.title || (r.markdown || '').slice(0, 40) || '笔记' },
  { key: 'items', type: 'item', text: (r) => r.name || '物品' },
  { key: 'collections', type: 'collection', text: (r) => r.title || '收藏' },
  { key: 'locations', type: 'location', text: (r) => r.name || '足迹' },
  { key: 'photos', type: 'photo', text: (r) => r.name || '照片' }
]

// 螺旋避让状态：angle 递增，radius 阶梯增长，保证新节点天然错开
let spiralAngle = 0
let spiralStep = 0
function nextSpiralPos() {
  // 起始点下移到 y=660：让开主页顶部预置的六块数据面板（三列 × 两行，占据 y 40~610）
  const baseX = 120, baseY = 660
  const radius = 60 + spiralStep * 70
  const x = baseX + radius * Math.cos(spiralAngle)
  const y = baseY + radius * Math.sin(spiralAngle)
  spiralAngle += 2.39996 // 黄金角，分布最均匀
  if (spiralAngle > Math.PI * 2) { spiralAngle -= Math.PI * 2; spiralStep++ }
  return { x: Math.round(x), y: Math.round(y) }
}

// 提取某实体在画布节点上的展示文本
function entityText(type, rec) {
  const m = SYNC_MAP.find((s) => s.type === type)
  return m ? String(m.text(rec) || '').slice(0, 2000) : ''
}

let storeRef = null
let timer = null

// 单次对账：把当前数据快照同步到画布节点
function reconcile() {
  const store = storeRef
  if (!store) return
  if (store.data.enableAutoCanvasSync === false) return
  const data = store.data
  const nodes = data.whiteboardNodes
  SYNC_MAP.forEach(({ key, type, text }) => {
    const list = (data[key] || [])
    list.forEach((rec) => {
      const refId = rec.id
      const existing = nodes.find((n) => !n.deletedAt && n.type === type && n.refId === refId)
      if (rec.deletedAt) {
        // 软删：把对应节点也置灰（软删），与全局软删契约一致
        const dead = nodes.find((n) => n.type === type && n.refId === refId && !n.deletedAt)
        if (dead) store.deleteWhiteboardNode(dead.id)
        return
      }
      if (existing) {
        // 已存在：内容更新（不改动位置，避免抖动）
        const t = text(rec)
        if (t !== (existing.text || '')) store.updateWhiteboardNode(existing.id, { text: t })
      } else {
        // 不存在：螺旋避让生成新节点
        const pos = nextSpiralPos()
        store.ensureWhiteboardNodeForEntity({ type, refId, x: pos.x, y: pos.y, text: text(rec) })
      }
    })
  })
}

// 防抖批量：多个变更合并到一次对账，避免高频写画布阻塞主线程
function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { try { reconcile() } catch (e) {} }, 300)
}

export function initCanvasAutoSync(store) {
  storeRef = store
  // 监听六类集合的形状变化（id + deletedAt 指纹），创建/更新/软删都能感知
  const sig = () => SYNC_MAP.map(({ key }) =>
    (store.data[key] || []).map((r) => r.id + ':' + (r.deletedAt || '')).join(',')
  ).join('|')
  watch(sig, () => schedule(), { deep: false })
  // 首屏进入时先对账一次（若画布为空则自动铺一批）
  schedule()
}

export function triggerCanvasSync() { schedule() }
