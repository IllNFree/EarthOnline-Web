// home 空间同类实体节点智能去重（纯函数，便于单测与复用）
// 同类型（且为实体关联节点 refId 存在）≥2 张时，合并为一张可滚动「总览卡」。
const MERGE_TYPES = ['memo', 'task', 'item', 'photo', 'collection', 'location', 'ledger', 'insight', 'game']

export function dedupHomeNodes(nodes, currentSpaceId) {
  // 仅 home 空间（spaceId 为空）做去重
  if (currentSpaceId !== null && currentSpaceId !== undefined) return nodes
  const byType = {}
  nodes.forEach((n) => {
    if (!n.stackId && n.refId && MERGE_TYPES.includes(n.type)) {
      ;(byType[n.type] || (byType[n.type] = [])).push(n)
    }
  })
  const out = []
  const hidden = new Set()
  nodes.forEach((n) => {
    const g = byType[n.type]
    if (g && g.length >= 2) {
      if (g[0].id === n.id) {
        out.push(Object.assign({}, n, {
          _merged: true,
          mergedType: n.type,
          mergedIds: g.map((x) => x.refId),
          w: Math.max(n.w, 232),
          h: Math.max(n.h, 208)
        }))
      } else {
        hidden.add(n.id)
      }
      return
    }
    out.push(n)
  })
  return out.filter((n) => !hidden.has(n.id))
}
