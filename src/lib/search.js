// ===== v2.0.0 P1：全局搜索（对齐 Android 6 类聚合：task/item/collection/memo/achievement/location） =====
import { liveList } from './model.js'
import { ACHIEVEMENTS } from './achievements.js'

const LIMIT = 8
const ROUTE = {
  task: '/tasks', item: '/backpack', collection: '/backpack',
  memo: '/notes', achievement: '/achievements', location: '/map'
}
const ICON = { task: 'tasks', item: 'backpack', collection: 'star', memo: 'note', achievement: 'trophy', location: 'map-pin' }
const LABEL = { task: '任务', item: '物品', collection: '收藏', memo: '笔记', achievement: '成就', location: '足迹' }

function norm(s) { return String(s || '').toLowerCase() }

/** 命中：标题 / 名称 / 内容摘要 / 标签 任一包含关键词 */
function hit(rec, fields, q) {
  return fields.some((f) => norm(rec[f]).indexOf(q) >= 0)
    || (Array.isArray(rec.tags) && rec.tags.join(' ').toLowerCase().indexOf(q) >= 0)
}

export function searchAll(state, query) {
  const q = norm(query).trim()
  if (!q) return []
  const groups = []

  const push = (type, list) => {
    if (!list.length) return
    groups.push({ type, label: LABEL[type], icon: ICON[type], route: ROUTE[type], items: list.slice(0, LIMIT) })
  }

  push('task', liveList(state, 'tasks').filter((t) => hit(t, ['title', 'note'], q))
    .map((t) => ({ id: t.id, title: t.title, sub: t.note ? String(t.note).slice(0, 40) : t.category })))

  push('item', liveList(state, 'items').filter((i) => hit(i, ['name', 'description'], q))
    .map((i) => ({ id: i.id, title: i.name, sub: i.category || i.type })))

  push('collection', liveList(state, 'collections').filter((c) => hit(c, ['title', 'content'], q))
    .map((c) => ({ id: c.id, title: c.title, sub: c.category || '收藏' })))

  push('memo', liveList(state, 'memos').filter((m) => hit(m, ['title', 'markdown'], q))
    .map((m) => ({ id: m.id, title: m.title, sub: String(m.markdown || '').slice(0, 40) })))

  push('location', liveList(state, 'locations').filter((l) => hit(l, ['name', 'note'], q))
    .map((l) => ({ id: l.id, title: l.name, sub: l.date })))

  const unlocked = new Set((state.achievements || []).map((a) => a.key))
  push('achievement', ACHIEVEMENTS.filter((a) => unlocked.has(a.key))
    .filter((a) => norm(a.title + ' ' + a.desc).indexOf(q) >= 0)
    .map((a) => ({ id: a.key, title: a.title, sub: a.desc })))

  return groups
}
