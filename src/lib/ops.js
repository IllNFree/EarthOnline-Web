// ===== 业务操作层：就地修改 state，由 store 负责持久化 =====
import {
  uid, todayStr, clampProgress, parseTagsInput, pushActivity, TASK_CATEGORY, TASK_STATUS,
  TRASH_TTL_DAYS, TRASH_KINDS, LEDGER_EXPENSE_PRESET, LEDGER_INCOME_PRESET,
  SOFT_KIND_MAP, SOFT_KINDS, isDeleted, purgeExpiredSoftDeleted
} from './model.js'
import { syncAchievements } from './achievements.js'

function nowIso() { return new Date().toISOString() }
export function trashKindLabel(kind) {
  return ({ task: '任务', item: '物品', collection: '收藏', memo: '笔记', location: '足迹', photo: '相册' })[kind] || kind
}

export function addTask(state, data) {
  const category = TASK_CATEGORY[data.category] ? data.category : 'side'
  const status = TASK_STATUS[data.status] ? data.status : 'planning'
  const title = String(data.title || '').trim()
  if (!title) return { ok: false, error: '标题不能为空', task: null }
  const task = {
    id: uid('task'),
    parentId: data.parentId || null,
    category, title, status,
    progress: status === 'done' ? 100 : clampProgress(data.progress),
    note: String(data.note || ''),
    dueDate: category === 'todo' && data.dueDate ? data.dueDate : null,
    dueTime: category === 'todo' && /^\d{2}:\d{2}$/.test(data.dueTime || '') ? data.dueTime : null,
    createdAt: todayStr(), lastModified: todayStr(),
    doneAt: status === 'done' ? new Date().toISOString() : null,
    tags: parseTagsInput(data.tags)
  }
  state.tasks.push(task)
  pushActivity(state, 'flag', '新建任务「' + title + '」')
  syncAchievements(state)
  return { ok: true, error: '', task }
}
export function updateTask(state, id, patch) {
  const t = state.tasks.find((x) => x.id === id)
  if (!t) return null
  if (patch.title !== undefined) { const v = String(patch.title).trim(); if (v) t.title = v }
  if (patch.category && TASK_CATEGORY[patch.category]) t.category = patch.category
  if (patch.status && TASK_STATUS[patch.status]) {
    t.status = patch.status
    t.doneAt = patch.status === 'done' ? new Date().toISOString() : null
    if (patch.status === 'done') t.progress = 100
  }
  if (patch.progress !== undefined && t.status !== 'done') t.progress = clampProgress(patch.progress)
  if (patch.note !== undefined) t.note = String(patch.note)
  if (patch.dueDate !== undefined) t.dueDate = patch.dueDate || null
  if (patch.dueTime !== undefined) t.dueTime = /^\d{2}:\d{2}$/.test(patch.dueTime || '') ? patch.dueTime : null
  if (patch.tags !== undefined) t.tags = parseTagsInput(patch.tags)
  if (patch.parentId !== undefined) t.parentId = patch.parentId || null
  t.lastModified = todayStr()
  syncAchievements(state)
  return t
}
export function toggleTaskDone(state, id) {
  const t = state.tasks.find((x) => x.id === id)
  if (!t) return null
  const next = t.status === 'done' ? 'active' : 'done'
  return updateTask(state, id, { status: next })
}
export function deleteTask(state, id) {
  const t = state.tasks.find((x) => x.id === id)
  if (!t) return false
  return softDelete(state, 'task', t)
}

export function addMemo(state, data) {
  const title = String(data.title || '').trim()
  if (!title && !String(data.markdown || '').trim()) return { ok: false, error: '内容不能为空', memo: null }
  const memo = {
    id: uid('memo'),
    title: title || '无标题',
    markdown: String(data.markdown || ''),
    type: data.type || 'note',
    tags: parseTagsInput(data.tags),
    createdAt: todayStr(), updatedAt: todayStr()
  }
  state.memos.push(memo)
  pushActivity(state, 'note', '写下笔记「' + memo.title + '」')
  syncAchievements(state)
  return { ok: true, error: '', memo }
}
export function updateMemo(state, id, patch) {
  const m = state.memos.find((x) => x.id === id)
  if (!m) return null
  if (patch.title !== undefined) m.title = String(patch.title)
  if (patch.markdown !== undefined) m.markdown = String(patch.markdown)
  if (patch.type !== undefined) m.type = patch.type
  if (patch.tags !== undefined) m.tags = parseTagsInput(patch.tags)
  m.updatedAt = todayStr()
  syncAchievements(state)
  return m
}
export function deleteMemo(state, id) {
  const m = state.memos.find((x) => x.id === id)
  if (!m) return false
  return softDelete(state, 'memo', m)
}

export function addItem(state, data) {
  const name = String(data.name || '').trim()
  if (!name) return { ok: false, error: '名称不能为空', item: null }
  const item = {
    id: uid('item'), name,
    type: data.type === 'virtual' ? 'virtual' : 'physical',
    category: String(data.category || ''),
    count: Number(data.count) || 1,
    description: String(data.description || ''),
    cover: String(data.cover || ''),
    tags: parseTagsInput(data.tags),
    createdAt: todayStr()
  }
  state.items.push(item)
  pushActivity(state, 'backpack', '收入物品「' + name + '」')
  syncAchievements(state)
  return { ok: true, error: '', item }
}
export function updateItem(state, id, patch) {
  const it = state.items.find((x) => x.id === id)
  if (!it) return null
  if (patch.name !== undefined) it.name = String(patch.name)
  if (patch.type !== undefined) it.type = patch.type
  if (patch.category !== undefined) it.category = String(patch.category)
  if (patch.count !== undefined) it.count = Number(patch.count) || 1
  if (patch.description !== undefined) it.description = String(patch.description)
  if (patch.cover !== undefined) it.cover = String(patch.cover)
  if (patch.tags !== undefined) it.tags = parseTagsInput(patch.tags)
  return it
}
export function deleteItem(state, id) {
  const it = state.items.find((x) => x.id === id)
  if (!it) return false
  return softDelete(state, 'item', it)
}

export function addCollection(state, data) {
  const title = String(data.title || '').trim()
  if (!title) return { ok: false, error: '标题不能为空', collection: null }
  const col = {
    id: uid('col'), title,
    content: String(data.content || ''),
    category: String(data.category || ''),
    cover: String(data.cover || ''),
    url: String(data.url || ''),
    fileMeta: data.fileMeta && typeof data.fileMeta === 'object'
      ? { name: String(data.fileMeta.name || ''), mime: String(data.fileMeta.mime || ''), size: Number(data.fileMeta.size) || 0, dataUrl: String(data.fileMeta.dataUrl || '') }
      : null,
    tags: parseTagsInput(data.tags),
    createdAt: todayStr()
  }
  state.collections.push(col)
  pushActivity(state, 'star', '新增收藏「' + title + '」')
  syncAchievements(state)
  return { ok: true, error: '', collection: col }
}
export function updateCollection(state, id, patch) {
  const c = state.collections.find((x) => x.id === id)
  if (!c) return null
  if (patch.title !== undefined) c.title = String(patch.title)
  if (patch.content !== undefined) c.content = String(patch.content)
  if (patch.category !== undefined) c.category = String(patch.category)
  if (patch.cover !== undefined) c.cover = String(patch.cover)
  if (patch.url !== undefined) c.url = String(patch.url)
  if (patch.fileMeta !== undefined) {
    c.fileMeta = patch.fileMeta && typeof patch.fileMeta === 'object'
      ? { name: String(patch.fileMeta.name || ''), mime: String(patch.fileMeta.mime || ''), size: Number(patch.fileMeta.size) || 0, dataUrl: String(patch.fileMeta.dataUrl || '') }
      : null
  }
  if (patch.tags !== undefined) c.tags = parseTagsInput(patch.tags)
  return c
}
export function deleteCollection(state, id) {
  const c = state.collections.find((x) => x.id === id)
  if (!c) return false
  return softDelete(state, 'collection', c)
}

export function addLocation(state, data) {
  const lat = Number(data.lat), lng = Number(data.lng)
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: '经纬度不合法', entry: null }
  const name = String(data.name || '').trim()
  if (!name) return { ok: false, error: '名称不能为空', entry: null }
  const entry = {
    id: uid('loc'), name, lat, lng,
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayStr(),
    note: String(data.note || ''),
    tags: parseTagsInput(data.tags)
  }
  state.locations.push(entry)
  pushActivity(state, 'map-pin', '标记足迹「' + name + '」')
  syncAchievements(state)
  return { ok: true, error: '', entry }
}
export function updateLocation(state, id, patch) {
  const l = state.locations.find((x) => x.id === id)
  if (!l) return null
  Object.assign(l, patch)
  return l
}
export function deleteLocation(state, id) {
  const l = state.locations.find((x) => x.id === id)
  if (!l) return false
  return softDelete(state, 'location', l)
}

// ---------- 回收站（v2.0.0 P0：deletedAt 软删除，与 Android 实体列同构） ----------
/**
 * 软删除：记录**留在原集合**，只打 deletedAt 时间戳。
 * 这样：① 各业务列表用 live 视图自动过滤；② 回收站由 trashList() 实时派生；
 * ③ 与 Android Room 的 deletedAt 列语义完全一致，跨端合并不会出幽灵数据。
 */
export function softDelete(state, kind, rec) {
  if (!rec || !SOFT_KIND_MAP[kind]) return false
  rec.deletedAt = nowIso()
  syncAchievements(state)
  return true
}

/** 兼容旧名：历史上直接传实体的调用点仍可用 */
export function softDeleteToTrash(state, kind, rec) { return softDelete(state, kind, rec) }

/** 恢复：清掉 deletedAt，记录立刻回到正常列表 */
export function restoreFromTrash(state, trashId) {
  let hit = null
  SOFT_KINDS.forEach((kind) => {
    const arr = state[SOFT_KIND_MAP[kind]]
    if (!Array.isArray(arr)) return
    const rec = arr.find((x) => x.id === trashId && isDeleted(x))
    if (rec) hit = rec
  })
  if (!hit) return false
  hit.deletedAt = null
  syncAchievements(state)
  return true
}

/** 彻底删除：从集合里真正移除 */
export function purgeTrashEntry(state, trashId) {
  let removed = false
  SOFT_KINDS.forEach((kind) => {
    const key = SOFT_KIND_MAP[kind]
    const arr = state[key]
    if (!Array.isArray(arr)) return
    const idx = arr.findIndex((x) => x.id === trashId && isDeleted(x))
    if (idx >= 0) { arr.splice(idx, 1); removed = true }
  })
  return removed
}

/** 清空回收站：移除全部软删除记录 */
export function emptyTrash(state) {
  SOFT_KINDS.forEach((kind) => {
    const key = SOFT_KIND_MAP[kind]
    if (!Array.isArray(state[key])) return
    state[key] = state[key].filter((x) => !isDeleted(x))
  })
  return true
}

/** 过期清理：软删除超过 30 天的记录物理移除（对齐回收站 TTL） */
export function purgeExpiredTrash(state) {
  return purgeExpiredSoftDeleted(state) >= 0
}

export function addPhoto(state, data) {
  const name = String(data.name || '').trim()
  if (!data.dataUrl) return { ok: false, error: '请选择图片', photo: null }
  const photo = {
    id: uid('photo'), name: name || '照片',
    category: String(data.category || ''),
    dataUrl: String(data.dataUrl),
    tags: parseTagsInput(data.tags),
    createdAt: todayStr()
  }
  state.photos.push(photo)
  pushActivity(state, 'image', '存入相册「' + photo.name + '」')
  syncAchievements(state)
  return { ok: true, error: '', photo }
}
export function deletePhoto(state, id) {
  const p = state.photos.find((x) => x.id === id)
  if (!p) return false
  return softDelete(state, 'photo', p)
}
export function updatePhoto(state, id, patch) {
  const p = state.photos.find((x) => x.id === id)
  if (!p) return { ok: false, error: '照片不存在' }
  if (patch.name !== undefined) p.name = String(patch.name || '').trim() || '照片'
  if (patch.tags !== undefined) p.tags = parseTagsInput(patch.tags)
  if (patch.dataUrl !== undefined && patch.dataUrl) p.dataUrl = String(patch.dataUrl)
  if (patch.category !== undefined) p.category = String(patch.category || '')
  syncAchievements(state)
  return { ok: true, error: '', photo: p }
}

export function setProfile(state, patch) {
  Object.assign(state.profile, patch)
  syncAchievements(state)
}
export function setAiConfig(state, cfg) {
  state.aiConfig = Object.assign({ baseUrl: '', apiKey: '', model: '' }, cfg || {})
}
export function setSteamConfig(state, cfg) {
  state.steam = Object.assign({ apiKey: '', steamId: '', proxy: '' }, cfg || {})
}
export function setWallpaper(state, dataUrl) {
  state.wallpaper = String(dataUrl || '')
}
export function setAppearance(state, patch) {
  const cl = (v) => { const n = Number(v); return isFinite(n) ? Math.min(1, Math.max(0, n)) : null }
  const cln = (v) => { const n = Number(v); return isFinite(n) ? Math.min(30, Math.max(0, n)) : null }
  if (patch && patch.wallAlpha !== undefined) { const v = cl(patch.wallAlpha); if (v !== null) state.wallAlpha = v }
  if (patch && patch.wallBlur !== undefined) { const v = cln(patch.wallBlur); if (v !== null) state.wallBlur = v }
  if (patch && patch.cardAlpha !== undefined) { const v = cl(patch.cardAlpha); if (v !== null) state.cardAlpha = v }
}
export function setBirthDate(state, d) {
  state.birthDate = d || ''
  syncAchievements(state)
}
export function addCategory(state, which, name, icon) {
  const key = which === 'item' ? 'itemCategories' : 'collectionCategories'
  if (!state[key].some((c) => c.name === name)) state[key].push({ name, icon: icon || 'tag' })
}
export function removeCategory(state, which, name) {
  const key = which === 'item' ? 'itemCategories' : 'collectionCategories'
  state[key] = state[key].filter((c) => c.name !== name)
}

// ---------- 记账 ----------
export function addLedgerRecord(state, data) {
  const amount = Number(data.amount)
  if (!isFinite(amount) || amount <= 0) return { ok: false, error: '金额必须大于 0' }
  const rec = {
    id: uid('led'),
    type: data.type === 'income' ? 'income' : 'expense',
    amount: Math.min(99999999, amount),
    category: String(data.category || '其他'),
    note: String(data.note || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayStr(),
    createdAt: todayStr()
  }
  state.ledger.records.push(rec)
  pushActivity(state, 'wallet', (rec.type === 'income' ? '收入 ' : '支出 ') + rec.amount + ' 元（' + rec.category + '）')
  return { ok: true, error: '', record: rec }
}
export function deleteLedgerRecord(state, id) {
  const idx = state.ledger.records.findIndex((r) => r.id === id)
  if (idx < 0) return false
  state.ledger.records.splice(idx, 1)
  return true
}
export function ensureLedgerCategories(state) {
  if (!state.ledger.expenseCategories.length) state.ledger.expenseCategories = LEDGER_EXPENSE_PRESET.slice()
  if (!state.ledger.incomeCategories.length) state.ledger.incomeCategories = LEDGER_INCOME_PRESET.slice()
}
