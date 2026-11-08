// ===== 画布节点 ↔ 功能实体 绑定 + 连线双向桥接（v3.0.2）=====
// 事实源唯一：store.data.biLinks。画布 ws.edges 中 source==='relation' 的边完全由它派生。
// 用户手动连线（source='manual'）两端都绑定实体时 → 写入 biLinks 并升级为 relation 边。
// 删除卡片只断线，绝不删 biLinks（保护页面关联数据）。
import { watch } from 'vue'

const VALID_TYPES = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'ledger']

/** 从节点解析它绑定的功能实体；无绑定返回 null */
export function entityOf(node) {
  if (!node) return null
  const r = node.entityRef
  if (r && VALID_TYPES.includes(r.type) && r.id) return { type: r.type, id: String(r.id) }
  const d = node.cardData || {}
  if (node.kind === 'card' && node.cardKind === 'image' && d.photoId) return { type: 'photo', id: String(d.photoId) }
  if (node.kind === 'card' && node.cardKind === 'doc' && d.noteId) return { type: 'memo', id: String(d.noteId) }
  return null
}

/** 绑定 / 解绑节点实体（doc 卡与 image 卡同步写回 cardData，兼容旧渲染层） */
export function setNodeEntity(ws, nodeId, ref) {
  const n = ws.nodeById && ws.nodeById(nodeId)
  if (!n) return false
  if (ref && VALID_TYPES.includes(ref.type) && ref.id) {
    n.entityRef = { type: ref.type, id: String(ref.id) }
    if (ref.type === 'memo' && n.cardKind === 'doc') n.cardData = { ...(n.cardData || {}), noteId: String(ref.id) }
    if (ref.type === 'photo' && n.cardKind === 'image') n.cardData = { ...(n.cardData || {}), photoId: String(ref.id) }
  } else {
    delete n.entityRef
  }
  ws.touch('node:update')
  return true
}

function matchEntity(n, type, id) {
  const e = entityOf(n)
  return !!(e && e.type === type && e.id === String(id))
}

/** 找某实体在同一空间的画布卡片 */
export function nodesForEntity(ws, type, id, spaceId) {
  const sid = spaceId || ws.currentId
  return (ws.nodes || []).filter((n) => !n.deletedAt && n.spaceId === sid && matchEntity(n, type, id))
}

function liveLinks(store) {
  return (store.data.biLinks || [])
    .filter((b) => !b.deletedAt && b.sourceType && b.targetType)
    .map((b) => ({
      id: b.id,
      a: { type: b.sourceType, id: String(b.sourceId) },
      b: { type: b.targetType, id: String(b.targetId) }
    }))
}

function findLink(store, a, b) {
  return (store.data.biLinks || []).find((l) => !l.deletedAt && (
    (l.sourceType === a.type && String(l.sourceId) === String(a.id) && l.targetType === b.type && String(l.targetId) === String(b.id)) ||
    (l.sourceType === b.type && String(l.sourceId) === String(b.id) && l.targetType === a.type && String(l.targetId) === String(a.id))
  ))
}

const keyOf = (fromId, toId) => fromId + '>' + toId

/**
 * 以 biLinks 重算 relation 边：两端实体在同一空间都有卡才补线；多余的自动删。
 * manual / mind 边一律不动（纯装饰连线、脑图父子连线保留原样）。
 */
export function syncEdgesFromLinks(ws, store) {
  const want = []
  liveLinks(store).forEach((L) => {
    const as = nodesForEntity(ws, L.a.type, L.a.id)
    const bs = nodesForEntity(ws, L.b.type, L.b.id)
    as.forEach((an) => bs.forEach((bn) => {
      if (an.id === bn.id || an.spaceId !== bn.spaceId) return
      want.push({ fromId: an.id, toId: bn.id, linkId: L.id })
    }))
  })
  const wantMap = new Map(want.map((w) => [keyOf(w.fromId, w.toId), w]))
  let changed = false

  ;(ws.edges || []).filter((e) => e.source === 'relation').forEach((e) => {
    const w = wantMap.get(keyOf(e.fromId, e.toId))
    if (!w) { ws.deleteEdge(e.id); changed = true }
    else if (e.linkId !== w.linkId) { e.linkId = w.linkId; changed = true }
  })

  want.forEach((w) => {
    const exist = (ws.edges || []).find((e) => e.fromId === w.fromId && e.toId === w.toId)
    if (exist) {
      // 用户手连产生的 manual 边：已写关联则就地升级，不删不建，避免闪烁
      if (exist.source !== 'relation') { exist.source = 'relation'; exist.linkId = w.linkId; changed = true }
      return
    }
    const e = ws._addEdgeInternal(w.fromId, w.toId, ws.settings.edgeStyle || 'curve', 'relation', true)
    if (e) { e.linkId = w.linkId; changed = true }
  })
  if (changed) ws.touch('edge:sync')
  return changed
}

/** 用户主动删除一条连线：relation 边同时解除页面关联；manual 边只删线 */
export function unlinkEdge(ws, store, edgeId) {
  const e = (ws.edges || []).find((x) => x.id === edgeId)
  if (!e) return false
  if (e.source === 'relation') {
    const a = entityOf(ws.nodeById(e.fromId))
    const b = entityOf(ws.nodeById(e.toId))
    const l = (a && b) ? findLink(store, a, b) : null
    if (l && store.deleteBiLink) store.deleteBiLink(l.id)
  }
  ws.deleteEdge(edgeId)
  return true
}

/**
 * 启动双向桥接（全局一次）。返回卸载函数。
 * 循环保护：所有同步都在 syncing 标志内执行，避免 edge:add → 写关联 → 重算边 → 再写关联 的死循环。
 */
export function startEntityLinkBridge(ws, store) {
  let syncing = false
  const guarded = (fn) => {
    if (syncing) return
    syncing = true
    try { fn() } finally { syncing = false }
  }

  const stopWatch = watch(
    () => (store.data.biLinks || []).map((b) => b.id + (b.deletedAt ? ':x' : ':o')).join(','),
    () => guarded(() => syncEdgesFromLinks(ws, store))
  )

  const unsub = ws.on((reason) => {
    if (syncing) return
    if (reason === 'edge:add') {
      guarded(() => {
        // 新画的 manual 连线：两端都绑定实体 → 写关联并升级为 relation 边
        ;(ws.edges || []).forEach((e) => {
          if (e.source !== 'manual') return
          const a = entityOf(ws.nodeById(e.fromId))
          const b = entityOf(ws.nodeById(e.toId))
          if (!a || !b) return
          if (!findLink(store, a, b) && store.addBiLink) {
            store.addBiLink({ sourceType: a.type, sourceId: a.id, targetType: b.type, targetId: b.id })
          }
          e.source = 'relation'
        })
      })
    }
    // edge:delete / node:delete 不自动删关联：删卡片只断线，页面数据不动
    if (reason === 'node:delete' || reason === 'edge:delete' || reason === 'node:move-space' || reason === 'space:delete') {
      guarded(() => syncEdgesFromLinks(ws, store))
    }
  })

  // 启动时对齐一次（老数据里已有 biLinks 但画布没线）
  guarded(() => syncEdgesFromLinks(ws, store))

  return () => { stopWatch(); unsub() }
}
