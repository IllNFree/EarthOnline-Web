// ===== 统一实体检索（需求 4 编辑层）：跨模块级联选择器数据源 =====
// 覆盖全部核心实体；支持按类型过滤。纯函数，传入 store.data 即可，无组件耦合。
import { BI_LINK_TYPES } from '../lib/bilink.js'

function norm(s) { return String(s || '').toLowerCase() }

/**
 * 跨实体检索（笔记/任务/背包/收藏/相册/足迹/记账）。
 * @param {Object} state store.data
 * @param {String} query 关键词
 * @param {Array<String>} [filterTypes] 仅检索这些类型；缺省全量
 * @returns {Array<{type,id,title,sub,icon}>}
 */
export function searchEntities(state, query, filterTypes) {
  const q = norm(query).trim()
  const types = Array.isArray(filterTypes) && filterTypes.length ? filterTypes : Object.keys(BI_LINK_TYPES)
  const out = []
  const push = (type, list) => {
    if (!types.includes(type)) return
    list.forEach((rec) => {
      const hit = norm(rec.title || rec.name).indexOf(q) >= 0 ||
        norm(rec.markdown || rec.note || rec.description || rec.category || '').indexOf(q) >= 0
      if (!hit) return
      out.push({
        type, id: rec.id,
        title: rec.title || rec.name || '未命名',
        sub: rec.category || rec.type || rec.date || '',
        icon: (BI_LINK_TYPES[type] || {}).icon || 'tag'
      })
    })
  }
  if (q) {
    push('task', (state.tasks || []).filter((x) => !x.deletedAt))
    push('memo', (state.memos || []).filter((x) => !x.deletedAt))
    push('item', (state.items || []).filter((x) => !x.deletedAt))
    push('collection', (state.collections || []).filter((x) => !x.deletedAt))
    push('photo', (state.photos || []).filter((x) => !x.deletedAt))
    push('location', (state.locations || []).filter((x) => !x.deletedAt))
  }
  return out.slice(0, 30)
}

/** 按类型返回该类型下全部实体（级联选择器 Tab 切换用） */
export function listEntitiesByType(state, type) {
  const map = {
    task: (state.tasks || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.title, sub: x.category, icon: 'tasks' })),
    memo: (state.memos || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.title, sub: x.type, icon: 'note' })),
    item: (state.items || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.name, sub: x.category, icon: 'backpack' })),
    collection: (state.collections || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.title, sub: x.category, icon: 'star' })),
    photo: (state.photos || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.name, sub: x.category, icon: 'image' })),
    location: (state.locations || []).filter((x) => !x.deletedAt).map((x) => ({ type, id: x.id, title: x.name, sub: x.date, icon: 'map-pin' }))
  }
  return map[type] || []
}
