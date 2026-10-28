// ===== 泛实体画布导航：查找节点 → 聚焦闪烁 / 提示创建 / 降级路由 =====
// 对应需求 3：画布内任意 @[Type:ID] 引用均可双向跳转。
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { canvasEnsureNode, canvasIsActive, canvasFocus } from './canvasBridge.js'

// 实体类型 → 详情页路由（降级跳转用）
const DETAIL_ROUTE = {
  task: '/tasks',
  memo: '/notes',
  item: '/backpack',
  photo: '/album',
  collection: '/notes', // 收藏无独立页，落到笔记列表（后续可独立）
  location: '/map',
  insight: '/stats',
  profile: '/settings',
  game: '/steam'
}

/**
 * 导航到某实体：
 * ① 画布存在该实体节点 → 平滑移动视口并高亮闪烁；
 * ② 不存在 → Haze 确认框「是否在画布中创建该节点？」；
 * ③ 用户拒绝 → 降级跳转到该实体详情页。
 * @returns {Promise<void>}
 */
export async function canvasNavigate({ type, id, router }) {
  const store = useAppStore()
  const dialog = useDialogStore()
  const t = type === 'note' ? 'memo' : type
  const existing = store.data.whiteboardNodes.find((n) => !n.deletedAt && n.type === t && n.refId === id)
  if (existing) {
    canvasFocus(existing)
    return
  }
  if (canvasIsActive()) {
    const ok = await dialog.confirm({
      title: '画布中未找到该实体',
      message: '是否在当前画布中创建该节点？',
      confirmText: '创建节点',
      cancelText: '去详情页'
    })
    if (ok) {
      const node = canvasEnsureNode(t, id, { center: true })
      if (node) canvasFocus(node)
      return
    }
  }
  if (router && DETAIL_ROUTE[t]) router.push(DETAIL_ROUTE[t])
}

/** 解析节点内容里的 @[Type:ID] 引用，返回 [{type,id,label}]（供 EntityNode / 渲染层使用） */
export function parseEntityRefs(text) {
  if (!text) return []
  const re = /@\[(task|memo|note|item|photo|collection|location|insight|profile|game):([\w-]+)\]/g
  const out = []
  let m
  while ((m = re.exec(text)) !== null) {
    out.push({ type: m[1] === 'note' ? 'memo' : m[1], id: m[2], label: m[0] })
  }
  return out
}
