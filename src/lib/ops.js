// ===== 业务操作层：就地修改 state，由 store 负责持久化 =====
import {
  uid, todayStr, clampProgress, parseTagsInput, pushActivity, TASK_CATEGORY, TASK_STATUS,
  TRASH_TTL_DAYS, TRASH_KINDS, LEDGER_EXPENSE_PRESET, LEDGER_INCOME_PRESET,
  SOFT_KIND_MAP, SOFT_KINDS, isDeleted, purgeExpiredSoftDeleted,
  CANVAS_PANELS, CANVAS_PANEL_KINDS, STACK_PANEL_KINDS, ARCMIND_HOME,
  STACK_DX, STACK_DY
} from './model.js'
import { syncAchievements } from './achievements.js'
import { extractBiLinks } from './bilink.js'

function nowIso() { return new Date().toISOString() }
// 画布内容原点：左侧不再预留悬浮工具栏宽度（工具栏已移至底部居中胶囊 Dock）
export const PANEL_ORIGIN_X = 40
// 网格吸附（与画布 4px 网格对齐）
const snap = (v) => Math.round(v / 4) * 4
// 卡片堆叠组在画布上的默认落位与展开后的包围盒（两列错落）
export const STACK_FRAME = { x: 40, y: 712, w: 520, h: 200 }
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
    // 2026-11-04：任务同样支持截止日期/时间（此前仅 category==='todo' 才保存）
    dueDate: data.dueDate ? String(data.dueDate).slice(0, 10) : null,
    dueTime: /^\d{2}:\d{2}$/.test(data.dueTime || '') ? data.dueTime : null,
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
  syncInlineBiLinks(state, 'memo', memo.id, memo.markdown)
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
  syncInlineBiLinks(state, 'memo', m.id, m.markdown)
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
  cascadeRemoveEntity(state, kind, rec.id)
  syncAchievements(state)
  return true
}

// 级联清理：实体被软删时，连带软删其画布节点 + 关联记录（biLinks），防止产生死链。
// 连线由 biLinks 派生（rebuildRelationEdges），因此一并重建。
function cascadeRemoveEntity(state, kind, id) {
  state.whiteboardNodes.forEach((n) => { if (!n.deletedAt && n.type === kind && n.refId === id) n.deletedAt = nowIso() })
  state.biLinks.forEach((b) => {
    if (!b.deletedAt && ((b.sourceType === kind && b.sourceId === id) || (b.targetType === kind && b.targetId === id))) b.deletedAt = nowIso()
  })
  rebuildRelationEdges(state)
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

// ---------- 个人主页博客（文章 / 分享链接） ----------
// 独立于笔记与收藏：文章可由笔记导入（source='note' + noteId），也可站内新写。
// 文章与链接均为纯本地实体，随存档 / 备份整体持久化。
export function addBlogPost(state, data) {
  if (!state.blog) state.blog = { posts: [], links: [] }
  const title = String(data.title || '').trim()
  if (!title) return { ok: false, error: '标题不能为空', post: null }
  const post = {
    id: uid('post'),
    title,
    summary: String(data.summary || '').trim(),
    cover: String(data.cover || ''),
    tags: parseTagsInput(data.tags),
    body: String(data.body || ''),
    status: data.status === 'published' ? 'published' : 'draft',
    pinned: data.pinned === true,
    source: data.source === 'note' ? 'note' : 'self',
    noteId: data.noteId ? String(data.noteId) : null,
    createdAt: todayStr(),
    updatedAt: todayStr()
  }
  state.blog.posts.unshift(post)
  return { ok: true, error: '', post }
}
export function updateBlogPost(state, id, patch) {
  const p = state.blog && state.blog.posts.find((x) => x.id === id)
  if (!p) return { ok: false, error: '文章不存在', post: null }
  const d = patch && typeof patch === 'object' ? patch : {}
  if (d.title !== undefined) p.title = String(d.title || '').trim() || p.title
  if (d.summary !== undefined) p.summary = String(d.summary || '').trim()
  if (d.cover !== undefined) p.cover = String(d.cover || '')
  if (d.tags !== undefined) p.tags = parseTagsInput(d.tags)
  if (d.body !== undefined) p.body = String(d.body || '')
  if (d.status !== undefined) p.status = d.status === 'published' ? 'published' : 'draft'
  if (d.pinned !== undefined) p.pinned = d.pinned === true
  if (d.source !== undefined) p.source = d.source === 'note' ? 'note' : 'self'
  if (d.noteId !== undefined) p.noteId = d.noteId ? String(d.noteId) : null
  p.updatedAt = todayStr()
  return { ok: true, error: '', post: p }
}
export function deleteBlogPost(state, id) {
  const p = state.blog && state.blog.posts.find((x) => x.id === id)
  if (!p || p.deletedAt) return false
  // 软删除：保留墓碑，保证跨端 / 备份合并时不会把已删文章又捞回来
  p.deletedAt = new Date().toISOString()
  return true
}
export function addBlogLink(state, data) {
  if (!state.blog) state.blog = { posts: [], links: [] }
  const url = String(data.url || '').trim()
  if (!url) return { ok: false, error: '链接不能为空', link: null }
  const link = {
    id: uid('blink'),
    title: String(data.title || '').trim(),
    url,
    cover: String(data.cover || ''),
    note: String(data.note || ''),
    createdAt: todayStr()
  }
  state.blog.links.unshift(link)
  return { ok: true, error: '', link }
}
export function updateBlogLink(state, id, patch) {
  const l = state.blog && state.blog.links.find((x) => x.id === id)
  if (!l) return { ok: false, error: '链接不存在', link: null }
  const d = patch && typeof patch === 'object' ? patch : {}
  if (d.title !== undefined) l.title = String(d.title || '').trim()
  if (d.url !== undefined && String(d.url || '').trim()) l.url = String(d.url).trim()
  if (d.cover !== undefined) l.cover = String(d.cover || '')
  if (d.note !== undefined) l.note = String(d.note || '')
  return { ok: true, error: '', link: l }
}
export function deleteBlogLink(state, id) {
  const l = state.blog && state.blog.links.find((x) => x.id === id)
  if (!l || l.deletedAt) return false
  l.deletedAt = new Date().toISOString()
  return true
}

export function setProfile(state, patch) {
  Object.assign(state.profile, patch)
  syncAchievements(state)
}
export function setAiConfig(state, cfg) {
  state.aiConfig = Object.assign({ baseUrl: '', apiKey: '', model: '' }, cfg || {})
}
export function setSteamConfig(state, cfg) {
  state.steam = Object.assign({ apiKey: '', steamId: '', proxy: '', profile: null, bio: '', showcases: [], manualGames: [] }, cfg || {})
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
    createdAt: todayStr(),
    // 3.0：可关联任务（记账 ↔ 任务），为空表示未关联
    taskId: data.taskId ? String(data.taskId) : null
  }
  state.ledger.records.push(rec)
  pushActivity(state, 'wallet', (rec.type === 'income' ? '收入 ' : '支出 ') + rec.amount + ' 元（' + rec.category + '）')
  return { ok: true, error: '', record: rec }
}
export function updateLedgerRecord(state, id, data) {
  const rec = state.ledger.records.find((r) => r.id === id)
  if (!rec) return { ok: false, error: '记录不存在' }
  if (data.amount !== undefined) {
    const amount = Number(data.amount)
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: '金额必须大于 0' }
    rec.amount = Math.min(99999999, amount)
  }
  if (data.type !== undefined) rec.type = data.type === 'income' ? 'income' : 'expense'
  if (data.category !== undefined) rec.category = String(data.category || '其他').slice(0, 60)
  if (data.note !== undefined) rec.note = String(data.note || '').slice(0, 500)
  if (data.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) rec.date = data.date
  // 3.0：关联 / 解除关联任务
  if (data.taskId !== undefined) {
    rec.taskId = data.taskId ? String(data.taskId) : null
    if (!rec.taskId) delete rec.taskId
  }
  return { ok: true, error: '', record: rec }
}
export function deleteLedgerRecord(state, id) {
  const idx = state.ledger.records.findIndex((r) => r.id === id)
  if (idx < 0) return false
  state.ledger.records.splice(idx, 1)
  // 级联软删记账节点 + 关联（与 SOFT_KINDS 同源处理，防止死链）
  state.whiteboardNodes.forEach((n) => { if (!n.deletedAt && n.type === 'ledger' && n.refId === id) n.deletedAt = nowIso() })
  state.biLinks.forEach((b) => {
    if (!b.deletedAt && ((b.sourceType === 'ledger' && b.sourceId === id) || (b.targetType === 'ledger' && b.targetId === id))) b.deletedAt = nowIso()
  })
  rebuildRelationEdges(state)
  return true
}
export function ensureLedgerCategories(state) {
  if (!state.ledger.expenseCategories.length) state.ledger.expenseCategories = LEDGER_EXPENSE_PRESET.slice()
  if (!state.ledger.incomeCategories.length) state.ledger.incomeCategories = LEDGER_INCOME_PRESET.slice()
}
// 老存档补齐新增的默认分类（只增不减，不覆盖用户自定义分类）
export function mergeLedgerPresets(state) {
  ensureLedgerCategories(state)
  LEDGER_EXPENSE_PRESET.forEach((p) => {
    if (!state.ledger.expenseCategories.some((c) => c.name === p.name)) state.ledger.expenseCategories.push({ ...p })
  })
  LEDGER_INCOME_PRESET.forEach((p) => {
    if (!state.ledger.incomeCategories.some((c) => c.name === p.name)) state.ledger.incomeCategories.push({ ...p })
  })
}

// ---------- v2.1.0：白板（无限画布便利贴 + 连线） ----------
export function addWhiteboardNode(state, data) {
  const node = sanitizeWhiteboardNodeLocal(Object.assign({}, data, {
    stackId: data.stackId || null,
    stackIdx: typeof data.stackIdx === 'number' ? data.stackIdx : 0,
    spaceId: data.spaceId || null
  }))
  state.whiteboardNodes.push(node)
  return { ok: true, node }
}
export function updateWhiteboardNode(state, id, patch) {
  const n = state.whiteboardNodes.find((x) => x.id === id)
  if (!n) return null
  if (patch.x !== undefined) n.x = Number(patch.x) || 0
  if (patch.y !== undefined) n.y = Number(patch.y) || 0
  if (patch.w !== undefined) n.w = Math.min(1200, Math.max(120, Number(patch.w) || 200))
  if (patch.h !== undefined) n.h = Math.min(1200, Math.max(80, Number(patch.h) || 140))
  if (patch.text !== undefined) n.text = String(patch.text).slice(0, 2000)
  if (patch.color !== undefined) n.color = String(patch.color || 'amber')
  if (patch.refId !== undefined) n.refId = patch.refId || null
  // v2.1.0 模块二：数据面板子类型切换（仅 panel 节点生效）
  if (patch.panelKind !== undefined && n.type === 'panel' && CANVAS_PANEL_KINDS.includes(patch.panelKind)) n.panelKind = patch.panelKind
  // v2.1.0：节点固定位置（固定后禁止拖拽 / 不参与自动整理）
  if (patch.pinned !== undefined) n.pinned = !!patch.pinned
  if (patch.tags !== undefined) n.tags = parseTagsInput(patch.tags)
  // v2.2.0 卡片矩阵：内联交互（待办打勾 / 图表类型与维度 / 隐藏卡展开 / 搜索词）必须真正落库
  if (patch.cardData !== undefined) {
    n.cardData = (patch.cardData && typeof patch.cardData === 'object') ? patch.cardData : null
  }
  if (patch.cardKind !== undefined && n.type === 'card') n.cardKind = String(patch.cardKind || n.cardKind)
  // v2.1.1：堆叠组（节点级元数据）与所属空间
  if (patch.stackId !== undefined) n.stackId = patch.stackId || null
  if (patch.stackIdx !== undefined) n.stackIdx = Math.max(0, Math.floor(Number(patch.stackIdx) || 0))
  if (patch.spaceId !== undefined) n.spaceId = patch.spaceId || null
  n.updatedAt = todayStr()
  return n
}

// v2.2.0 绘图层
export function addWhiteboardDrawing(state, data) {
  const d = {
    id: uid('wbd'),
    spaceId: data.spaceId || null,
    tool: data.tool || 'pen',
    color: data.color || '#2C2C2C',
    width: Math.min(60, Math.max(1, Number(data.width) || 3)),
    opacity: Math.min(1, Math.max(0.1, Number(data.opacity) || 1)),
    pts: Array.isArray(data.pts) ? data.pts.slice(0, 4000) : [],
    x1: Number(data.x1) || 0, y1: Number(data.y1) || 0,
    x2: Number(data.x2) || 0, y2: Number(data.y2) || 0,
    createdAt: todayStr(), deletedAt: null
  }
  state.whiteboardDrawings.push(d)
  return { ok: true, drawing: d }
}
export function updateWhiteboardDrawing(state, id, patch) {
  const d = state.whiteboardDrawings.find((x) => x.id === id)
  if (!d) return null
  if (patch.color !== undefined) d.color = String(patch.color)
  if (patch.width !== undefined) d.width = Math.min(60, Math.max(1, Number(patch.width) || 3))
  if (patch.opacity !== undefined) d.opacity = Math.min(1, Math.max(0.1, Number(patch.opacity) || 1))
  if (patch.pts !== undefined) d.pts = patch.pts.slice(0, 4000)
  if (patch.x1 !== undefined) d.x1 = Number(patch.x1)
  if (patch.y1 !== undefined) d.y1 = Number(patch.y1)
  if (patch.x2 !== undefined) d.x2 = Number(patch.x2)
  if (patch.y2 !== undefined) d.y2 = Number(patch.y2)
  return d
}
export function deleteWhiteboardDrawing(state, id) {
  const i = state.whiteboardDrawings.findIndex((x) => x.id === id)
  if (i >= 0) { state.whiteboardDrawings.splice(i, 1); return true }
  return false
}
export function deleteWhiteboardNode(state, id) {
  const n = state.whiteboardNodes.find((x) => x.id === id)
  if (!n) return false
  n.deletedAt = nowIso()
  // 级联软删该节点相关的连线
  state.whiteboardEdges.forEach((e) => { if (e.from === id || e.to === id) e.deletedAt = nowIso() })
  return true
}
export function addWhiteboardEdge(state, data) {
  if (!data.from || !data.to || data.from === data.to) return { ok: false, error: '连线两端无效' }
  const edge = {
    id: uid('wbe'), from: String(data.from), to: String(data.to),
    label: String(data.label || ''), createdAt: todayStr(), deletedAt: null,
    // manual = 手工连线（纯文本便利贴之间，无实体关联背书）；重建时两端仍在画布即保留
    manual: data.manual === true
  }
  state.whiteboardEdges.push(edge)
  return { ok: true, edge }
}
export function deleteWhiteboardEdge(state, id) {
  const e = state.whiteboardEdges.find((x) => x.id === id)
  if (!e) return false
  e.deletedAt = nowIso()
  return true
}

// ---------- v2.2.0 多级空间（Space）----------
export function addSpace(state, data) {
  if (!Array.isArray(state.spaces)) state.spaces = []
  const sp = {
    id: uid('spc'),
    name: String(data.name || '新空间').slice(0, 40),
    emoji: data.emoji || '📁',
    color: data.color || 'amber',
    parentId: data.parentId || null,
    x: Number(data.x) || 0, y: Number(data.y) || 0,
    w: Math.min(1200, Math.max(160, Number(data.w) || 240)),
    h: Math.min(1200, Math.max(120, Number(data.h) || 168)),
    viewport: null,
    createdAt: todayStr(), deletedAt: null
  }
  state.spaces.push(sp)
  return { ok: true, space: sp }
}
export function updateSpace(state, id, patch) {
  const sp = state.spaces.find((x) => x.id === id)
  if (!sp) return null
  if (patch.name !== undefined) sp.name = String(patch.name || '').slice(0, 40)
  if (patch.emoji !== undefined) sp.emoji = String(patch.emoji || '📁').slice(0, 8)
  if (patch.color !== undefined) sp.color = String(patch.color || 'amber')
  if (patch.parentId !== undefined) sp.parentId = patch.parentId || null
  if (patch.x !== undefined) sp.x = Number(patch.x) || 0
  if (patch.y !== undefined) sp.y = Number(patch.y) || 0
  if (patch.w !== undefined) sp.w = Math.min(1200, Math.max(160, Number(patch.w) || 240))
  if (patch.h !== undefined) sp.h = Math.min(1200, Math.max(120, Number(patch.h) || 168))
  // 视口记忆：缩放 / 平移状态随空间独立保存
  if (patch.viewport !== undefined) sp.viewport = patch.viewport || null
  return sp
}
export function deleteSpace(state, id) {
  const sp = state.spaces.find((x) => x.id === id)
  if (!sp) return false
  sp.deletedAt = nowIso()
  const parent = sp.parentId || null
  // 子空间与节点一并上移到父空间（或枢纽根层），避免内容丢失
  state.spaces.forEach((c) => { if (!c.deletedAt && c.parentId === id) c.parentId = parent })
  state.whiteboardNodes.forEach((n) => { if (!n.deletedAt && n.spaceId === id) n.spaceId = parent })
  return true
}

// ---------- v2.1.0 终极重构：统一重建画布连线 ----------
// 以 biLinks（实体关联表）为准，两端节点都存在才连线 —— 保证「画布连线」与「详情页关联」永远同源、
// 双向同步、任一端删除另一端同步消失。
export function rebuildRelationEdges(state) {
  const nodeOf = (type, id) => state.whiteboardNodes.find((n) => !n.deletedAt && n.type === type && n.refId === id)
  // 实体是否真实存在（防止为已删除实体造出空节点）
  const entityExists = (type, id) => {
    // 记账是对象容器 { records: [] }，其余类型均为数组
    if (type === 'ledger') {
      const recs = state.ledger && state.ledger.records
      if (!Array.isArray(recs)) return false
      const rec = recs.find((x) => x.id === id)
      return !!rec && !rec.deletedAt
    }
    const arr = state[collectionOfType(type)]
    if (!Array.isArray(arr)) return false
    const rec = arr.find((x) => x.id === id)
    return !!rec && !rec.deletedAt
  }
  // 关联两端若还不在画布上，自动拉入（详情页关联 → 画布长线）
  // 落位策略：放在已有节点右侧的空白处，避免与既有节点重叠
  const ensure = (type, id) => {
    const existing = nodeOf(type, id)
    if (existing) return existing
    if (!entityExists(type, id)) return null
    const live = state.whiteboardNodes.filter((n) => !n.deletedAt)
    const maxRight = live.reduce((m, n) => Math.max(m, n.x + n.w), 0)
    const r = ensureWhiteboardNodeForEntity(state, {
      type, refId: id,
      x: maxRight + 40, y: 40,
      w: 230, h: 150
    })
    return (r && r.node) ? r.node : null
  }
  // 只有 biLinks 派生的关系连线会被重建；手工连线（manual，纯便利贴之间）保留 ——
  // 但两端节点已被删除的手工连线随之下线
  state.whiteboardEdges.forEach((e) => { if (!e.manual) e.deletedAt = todayStr() })
  const seen = new Set()
  state.biLinks.forEach((b) => {
    if (b.deletedAt) return
    const a = ensure(b.sourceType, b.sourceId)
    const c = ensure(b.targetType, b.targetId)
    if (!a || !c || a.id === c.id) return
    const key = [a.id, c.id].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    state.whiteboardEdges.push({ id: uid('wbe'), from: a.id, to: c.id, label: '', createdAt: todayStr(), deletedAt: null })
  })
  const aliveId = (id) => state.whiteboardNodes.some((n) => n.id === id && !n.deletedAt)
  state.whiteboardEdges.forEach((e) => {
    if (e.manual && (!aliveId(e.from) || !aliveId(e.to))) e.deletedAt = todayStr()
  })
}

/** 类型 → 实体集合名（用于判断实体是否真实存在） */
function collectionOfType(type) {
  return ({
    task: 'tasks', memo: 'memos', item: 'items', photo: 'photos',
    collection: 'collections', location: 'locations', ledger: 'ledger'
  })[type] || null
}
export function updateWhiteboardEdge(state, id, patch) {
  const e = state.whiteboardEdges.find((x) => x.id === id)
  if (!e) return null
  if (patch.label !== undefined) e.label = String(patch.label || '').slice(0, 60)
  return e
}
// 复制节点：偏移 24px 避免完全重叠，生成新 id
export function duplicateWhiteboardNode(state, id) {
  const n = state.whiteboardNodes.find((x) => x.id === id)
  if (!n) return null
  const copy = sanitizeWhiteboardNodeLocal({
    type: n.type, refId: n.refId, x: n.x + 24, y: n.y + 24,
    w: n.w, h: n.h, color: n.color, text: n.text,
    stackId: null, stackIdx: 0, spaceId: n.spaceId || null
  })
  state.whiteboardNodes.push(copy)
  return copy
}
// 解除某节点的全部连线（右键「解除连线」）
export function detachNodeEdges(state, id) {
  let n = 0
  state.whiteboardEdges.forEach((e) => { if (!e.deletedAt && (e.from === id || e.to === id)) { e.deletedAt = nowIso(); n++ } })
  return n
}
/**
 * 新建节点落点避让（v2.5.3）：目标点与既有节点重叠时，按黄金角螺旋步进找空位。
 * 修复「新建同类实体 → 新便利贴恰好盖住旧贴（视口中心 / 螺旋起点每会话重置）」的问题。
 */
export function findFreeSpot(state, x, y, w = 230, h = 150) {
  const occupied = (state.whiteboardNodes || []).filter((n) => !n.deletedAt && !n.spaceId)
  const hits = (nx, ny) => occupied.some((n) =>
    !((nx + w + 24 <= n.x) || (n.x + (n.w || 220) + 24 <= nx) || (ny + h + 24 <= n.y) || (n.y + (n.h || 150) + 24 <= ny)))
  if (!hits(x, y)) return { x: Math.round(x), y: Math.round(y) }
  let ang = 0
  let step = 0
  for (let i = 0; i < 120; i++) {
    const radius = 60 + step * 70
    const cx = x + radius * Math.cos(ang)
    const cy = y + radius * Math.sin(ang)
    ang += 2.39996 // 黄金角
    if (ang > Math.PI * 2) { ang -= Math.PI * 2; step++ }
    if (!hits(cx, cy)) return { x: Math.round(cx), y: Math.round(cy) }
  }
  return { x: Math.round(x + 300), y: Math.round(y + 240) }
}

/**
 * 确保某实体在画布上存在一个节点：存在则复用，否则在指定坐标（默认视口中心）创建。
 * 这是「全实体节点化 + Tool Calling / 导入自动落节点」的统一入口。
 * v2.5.3：创建时坐标先过 findFreeSpot 避让 —— 同类型新实体绝不叠在旧贴正上方。
 */
export function ensureWhiteboardNodeForEntity(state, data) {
  const rawType = data.type === 'note' ? 'memo' : data.type
  const type = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'insight', 'profile', 'game', 'panel', 'ledger'].includes(rawType) ? rawType : 'memo'
  const refId = data.refId || null
  const kind = CANVAS_PANEL_KINDS.includes(data.panelKind) ? data.panelKind : null
  // 数据面板节点：主键是 panelKind（同类面板全局唯一），不是 refId
  const existing = type === 'panel'
    ? state.whiteboardNodes.find((n) => !n.deletedAt && n.type === 'panel' && n.panelKind === kind)
    : state.whiteboardNodes.find((n) => !n.deletedAt && n.type === type && n.refId === refId)
  if (existing) return { ok: true, node: existing, created: false }
  const w = Number(data.w) || 220
  const h = Number(data.h) || 150
  const spot = type === 'panel' ? { x: data.x, y: data.y } : findFreeSpot(state, Number(data.x) || 0, Number(data.y) || 0, w, h)
  const node = sanitizeWhiteboardNodeLocal({
    type, refId, panelKind: data.panelKind,
    x: spot.x, y: spot.y,
    w, h,
    color: data.color || 'amber', text: String(data.text || '')
  })
  state.whiteboardNodes.push(node)
  return { ok: true, node, created: true }
}

// 模块二：按可见性开关增删画布数据面板节点（开关为「所见即所得」的唯一事实来源）
export function syncCanvasPanels(state, visibleMap) {
  const added = []
  const removed = []
  CANVAS_PANELS.forEach((p, idx) => {
    const want = !!(visibleMap && visibleMap[p.kind])
    const node = state.whiteboardNodes.find((n) => !n.deletedAt && n.type === 'panel' && n.panelKind === p.kind)
    if (want && !node) {
      // 模块一：优先采用注册表里预置的错落坐标（x / y），让默认布局天然错落有致；
      // 仅当某面板未声明坐标时退回「三列 × 两行等距网格」兜底。
      const col = idx % 3, row = Math.floor(idx / 3)
      const x = (typeof p.x === 'number') ? p.x : (PANEL_ORIGIN_X + col * 270)
      const y = (typeof p.y === 'number') ? p.y : (40 + row * 200)
      const n = sanitizeWhiteboardNodeLocal({
        type: 'panel', panelKind: p.kind, refId: null,
        x, y,
        w: p.w, h: p.h, color: p.color, text: p.label
      })
      state.whiteboardNodes.push(n)
      added.push(n)
    } else if (!want && node) {
      node.deletedAt = todayStr()
      removed.push(node.id)
      // 面板隐藏时一并清掉其上的连线，避免画布残留孤边
      state.whiteboardEdges.forEach((e) => {
        if (e.from === node.id || e.to === node.id) e.deletedAt = todayStr()
      })
    }
  })
  return { added, removed }
}

// v2.1.1：首次进入画布 —— 把不常用 / 信息量巨大的卡片默认收纳进「卡片堆叠组」（仅执行一次）。
// 2026-11-03（v2.5.0 默认视图）：用户指定取消默认堆叠 —— 低频名单清空，堆叠仍可手动拖拽合并；
// applyDefaultStacking 保留仅作历史迁移通路（对存量用户 canvasStackV2 已为 true，不会再跑）。
const LOW_FREQ_PANELS = []
// 注：chart / imageStack 已于 2026-11-02 下线；热力图已于 2026-11-03 移出默认视图
const LOW_FREQ_CARDS = []
const STACK_EDGE_X = 1200
const STACK_EDGE_Y = 0
// 智能 Bento 排布：kind → [x, y, w, h]（v2.5.3 暖白版式与 CANVAS_PANELS 保持一致：行式对齐 + 28px 间距）
const SMART_PANEL_POS = {
  calendar: [0, 0, 620, 440], map: [1352, 0, 480, 440],
  todo: [648, 0, 368, 208], ledger: [648, 232, 368, 208],
  notes: [1044, 0, 280, 208], album: [396, 468, 280, 208],
  backpack: [1352, 468, 280, 208], steam: [1370, 486, 280, 208], achievements: [1388, 504, 280, 208]
}
const SMART_CARD_POS = {
  clock: [1044, 232, 280, 208], audio: [0, 468, 368, 208]
}
const SMART_MEMO_POS = [704, 468, 248, 208]

export function applyDefaultStacking(state) {
  if (!state) return { applied: false }
  if (state.canvasStackV2 === true) return { applied: false }
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  const rootNodes = state.whiteboardNodes.filter((n) => !n.deletedAt && !n.spaceId)
  const targets = rootNodes.filter((n) =>
    (n.type === 'panel' && LOW_FREQ_PANELS.includes(n.panelKind)) ||
    (n.type === 'card' && LOW_FREQ_CARDS.includes(n.cardKind)))
  let applied = false
  if (targets.length >= 2) {
    targets.sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
    const sid = 'wsg_' + uid('sg').slice(1)
    const anchor = targets[0]
    anchor.stackId = sid; anchor.stackIdx = 0
    anchor.x = STACK_EDGE_X; anchor.y = STACK_EDGE_Y
    targets.slice(1).forEach((n, i) => {
      const k = i + 1
      n.stackId = sid; n.stackIdx = k
      n.x = anchor.x + k * STACK_DX
      n.y = anchor.y + k * STACK_DY
    })
    applied = true
  }
  // 其余常用卡归位到智能 Bento 网格（只动坐标，不动内容）
  rootNodes.forEach((n) => {
    if (n.stackId) return
    let pos = null
    if (n.type === 'panel') pos = SMART_PANEL_POS[n.panelKind]
    else if (n.type === 'card') pos = SMART_CARD_POS[n.cardKind]
    else if (n.type === 'memo') pos = SMART_MEMO_POS
    if (!pos) return
    n.x = pos[0]; n.y = pos[1]; n.w = pos[2]; n.h = pos[3]
  })
  state.canvasStackV1 = true
  state.canvasStackV2 = true
  // 迁移标记：避免 unstackCanvasPanels 把刚建好的收纳组又拆开
  state.canvasUnstackV1 = true
  return { applied, count: targets.length }
}

// v2.2.2：拆掉历史遗留的「卡片堆叠组」—— 清空 stackId / stackIdx，
// 组内其余卡片沿锚点向右平铺、上下轻微错位，保证每张卡内容完整可见（只执行一次）。
export function unstackCanvasPanels(state) {
  if (!state) return { applied: false }
  if (state.canvasUnstackV1 === true) return { applied: false }
  if (!Array.isArray(state.whiteboardNodes)) { state.canvasUnstackV1 = true; return { applied: false } }
  const groups = new Map()
  state.whiteboardNodes.forEach((n) => {
    if (n.deletedAt || !n.stackId) return
    if (!groups.has(n.stackId)) groups.set(n.stackId, [])
    groups.get(n.stackId).push(n)
  })
  if (!groups.size) { state.canvasUnstackV1 = true; return { applied: false } }
  let moved = 0
  groups.forEach((list) => {
    list.sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
    const anchor = list[0]
    list.forEach((n, i) => {
      n.stackId = null
      n.stackIdx = 0
      if (i === 0) return
      // 向右平铺（整卡宽度 + 24px 间距），奇偶行轻微上下错位 → 错落但不遮挡
      n.x = snap(anchor.x + i * (Math.max(anchor.w || 0, n.w || 0) + 24))
      n.y = snap(anchor.y + (i % 2 ? 18 : 0))
      moved++
    })
  })
  state.canvasUnstackV1 = true
  return { applied: moved > 0, moved }
}

// ===== 主页默认版式：一次性补齐默认卡片（便利贴 / 热力图 / 音乐 / 时钟 / 倒数 / 图片 / 图表） =====
// 红线：只补齐缺失的默认卡片，绝不删除、绝不覆盖用户已有的节点。
export function seedArcMindHome(state) {
  if (!state) return { applied: false }
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  let added = 0
  const hasCard = (k) => state.whiteboardNodes.some((n) => !n.deletedAt && n.type === 'card' && n.cardKind === k)
  const hasMemo = () => state.whiteboardNodes.some((n) => !n.deletedAt && n.type === 'memo')
  if (state.arcmindHomeV4 !== true) {
    ARCMIND_HOME.forEach((d) => {
      if (d.type === 'panel') return // 数据面板由 syncCanvasPanels 负责，避免重复
      const found = state.whiteboardNodes.find((x) => !x.deletedAt && x.type === d.type && d.type === 'card' && x.cardKind === d.cardKind)
      if (found) {
        // 已存在：只把默认卡片归位到新网格，不动内容；已在堆叠组里的卡片保持原位
        if (found.stackId) return
        found.x = d.x; found.y = d.y; found.w = d.w; found.h = d.h
        return
      }
      if (d.type === 'memo' && hasMemo()) return
      state.whiteboardNodes.push(sanitizeWhiteboardNodeLocal(Object.assign({}, d, { spaceId: null, stackId: null, stackIdx: 0 })))
      added++
    })
    state.arcmindHomeV3 = true
    state.arcmindHomeV4 = true
  }
  // v2.2.3：一次性把核心面板归位到新版 Bento 坐标（日历放大到 576×400 作为主视觉）。
  // 面板节点此时尚未由 syncCanvasPanels 创建，因此交给后面的 applyGoldenLayout 执行 ——
  // 这里只把 goldenLayoutV1 标记清掉，让那次对账按新坐标跑一遍。
  if (state.homeLayoutV3 !== true) {
    state.goldenLayoutV1 = false
    state.homeLayoutV3 = true
  }
  state.arcmindHomeV1 = 1
  state.arcmindHomeV2 = 5
  return { applied: added > 0, added }
}

// 模块二：首次进入画布 —— 种子一张示例便利贴（纯文本节点，不污染笔记列表），
// 让「便利贴（彩色纸张折角）vs 数据卡片（毛玻璃）」的视觉区分在首屏即可见。
// 仅当画布尚无任何便利贴时执行一次；用户删掉后不会复活。
export function seedCanvasDemo(state) {
  if (!state || state.canvasDemoV1 === true) return { applied: false }
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  const hasMemo = state.whiteboardNodes.some((n) => !n.deletedAt && n.type === 'memo')
  if (hasMemo) { state.canvasDemoV1 = true; return { applied: false } }
  state.whiteboardNodes.push({
    id: 'wbn-demo-sticky', type: 'memo', refId: null,
    text: '这是一张便利贴：彩色纸张、随手贴的角度、右上角折角。\n旁边的数据卡片是满血毛玻璃 —— 一眼就能分清两者。',
    // 2026-11-03（v2.5.3 暖白版式）：便利贴落在行 2 相册右侧（704,468），行式对齐不叠压。
    x: 704, y: 468, w: 248, h: 208, color: 'amber',
    stackId: null, stackIdx: 0, spaceId: null, createdAt: todayStr(), updatedAt: todayStr(), deletedAt: null
  })
  state.canvasDemoV1 = true
  return { applied: true }
}

// 模块一：黄金网格迁移 —— 把核心面板节点一次性归位到注册表定义的网格坐标（仅执行一次）。
// 只改节点 x/y/w/h 坐标，绝不触及任何实体数据 / 关联关系 / 连线，符合「保留底层数据」红线。
export function applyGoldenLayout(state) {
  if (!state || state.goldenLayoutV1 === true) return { applied: false }
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  let moved = 0
  CANVAS_PANELS.forEach((p) => {
    if (typeof p.x !== 'number') return // 堆叠组内的面板（无坐标）不在网格里落位
    const node = state.whiteboardNodes.find((n) => !n.deletedAt && n.type === 'panel' && n.panelKind === p.kind)
    if (node) {
      // v2.2.4：已被智能收纳进堆叠组的面板不再归位，否则会被强行拆开
      if (node.stackId) return
      node.x = p.x; node.y = p.y; node.w = p.w; node.h = p.h
      // 若该面板此前被收进堆叠组，回归网格自由坐标
      if (node.stackId) { node.stackId = null; node.stackIdx = 0 }
      moved++
    }
  })
  state.goldenLayoutV1 = true
  return { applied: moved > 0, moved }
}

// ===== v2.5.0 默认视图迁移（2026-11-03，仅执行一次）=====
// 用户指定（原始诉求）：默认画布只移除 热力图卡；其余卡片归位新布局。
// 2026-11-03 晚修正：背包/成就/Steam 当初被误删 —— 恢复由 applyRestoreLowFreq 负责（v2.5.3）。
// 被移除节点走 deletedAt 软删除（回收站可恢复）；可见性开关同步关闭，防止 syncCanvasPanels 重建。
export function applyDefaultViewV5(state) {
  if (!state || state.homeLayoutV5 === true) return { applied: false, removed: [] }
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  if (!Array.isArray(state.whiteboardEdges)) state.whiteboardEdges = []
  const DROP_PANELS = []
  const removed = []
  state.whiteboardNodes.forEach((n) => {
    if (n.deletedAt) return
    const drop = (n.type === 'panel' && DROP_PANELS.includes(n.panelKind)) ||
      (n.type === 'card' && n.cardKind === 'heatmap')
    if (!drop) return
    n.deletedAt = todayStr()
    removed.push(n.id)
    // 面板隐藏时一并清掉其上的连线，避免画布残留孤边
    state.whiteboardEdges.forEach((e) => {
      if (e.from === n.id || e.to === n.id) e.deletedAt = todayStr()
    })
  })
  // 解散因成员被删而不足 2 张的堆叠组（如 album 所在的历史低频组）
  const groups = new Map()
  state.whiteboardNodes.forEach((n) => {
    if (n.deletedAt || !n.stackId) return
    if (!groups.has(n.stackId)) groups.set(n.stackId, [])
    groups.get(n.stackId).push(n)
  })
  groups.forEach((list) => {
    if (list.length >= 2) return
    list.forEach((n) => { n.stackId = null; n.stackIdx = 0 })
  })
  // 关闭被移除面板的可见性开关（syncCanvasPanels 的唯一事实来源）
  if (!state.canvasPanels || typeof state.canvasPanels !== 'object') state.canvasPanels = {}
  DROP_PANELS.forEach((k) => { state.canvasPanels[k] = false })
  // 时钟 / 音乐 / 演示便利贴归位新布局（面板节点交给 applyGoldenLayout 按新注册表坐标归位）
  const reposCard = (kind, pos) => {
    const n = state.whiteboardNodes.find((x) => !x.deletedAt && x.type === 'card' && x.cardKind === kind && !x.spaceId)
    if (n) { n.x = pos[0]; n.y = pos[1]; n.w = pos[2]; n.h = pos[3] }
  }
  reposCard('clock', SMART_CARD_POS.clock)
  reposCard('audio', SMART_CARD_POS.audio)
  const sticky = state.whiteboardNodes.find((x) => !x.deletedAt && x.id === 'wbn-demo-sticky')
  if (sticky) { sticky.x = SMART_MEMO_POS[0]; sticky.y = SMART_MEMO_POS[1]; sticky.w = SMART_MEMO_POS[2]; sticky.h = SMART_MEMO_POS[3] }
  // 触发一次黄金网格归位（新 CANVAS_PANELS 坐标），并封锁历史堆叠迁移重跑
  state.goldenLayoutV1 = false
  state.canvasStackV2 = true
  state.canvasUnstackV1 = true
  state.homeLayoutV5 = true
  return { applied: true, removed }
}

// v2.5.x 还原（2026-11-03）：地图卡片回归主页 —— 无边框地图卡（TileMapCanvas 铺满卡面）
// + 独立全屏页 /map（侧栏「足迹」可达）双入口。一次性执行：
// ① 恢复被 applyRemoveMapCard 关闭的 map 开关（否则 syncCanvasPanels 不会铺设/会再删）；
// ② 把被软删的地图面板复活并归位新坐标（其连线一并复活）；
// ③ 若画布既无活面板也无软删面板，交给随后的 syncCanvasPanels 依据开关自动铺设。
export function applyRestoreMapCard(state) {
  if (!state || state.mapCardBackV1 === true) return { applied: false, revived: [] }
  state.mapCardBackV1 = true
  if (!state.canvasPanels || typeof state.canvasPanels !== 'object') state.canvasPanels = {}
  state.canvasPanels.map = true
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  const spec = CANVAS_PANELS.find((p) => p.kind === 'map')
  const revived = []
  const dead = state.whiteboardNodes.find((n) => n.deletedAt && n.type === 'panel' && n.panelKind === 'map')
  if (dead && spec) {
    dead.deletedAt = null
    dead.updatedAt = todayStr()
    dead.x = spec.x; dead.y = spec.y; dead.w = spec.w; dead.h = spec.h
    if (dead.stackId) { dead.stackId = null; dead.stackIdx = 0 }
    revived.push(dead.id)
    // 复活其连线（对端节点仍存活才复活，避免孤边）
    const alive = (id) => state.whiteboardNodes.some((n) => n.id === id && !n.deletedAt)
    ;(state.whiteboardEdges || []).forEach((e) => {
      if ((e.from === dead.id || e.to === dead.id) && e.deletedAt && alive(e.from) && alive(e.to)) e.deletedAt = null
    })
  }
  return { applied: true, revived }
}

// v2.5.3 还原（2026-11-03 晚）：背包/成就/Steam 面板回归默认视图 ——
// 用户原始诉求只是删除热力图卡，v2.5.0 把这三个面板一并误删了。一次性执行：
// ① 恢复三个面板的可见性开关（syncCanvasPanels 依据开关铺设缺失面板）；
// ② 复活被软删的面板节点及其连线；
// ③ 强制黄金网格重跑（goldenLayoutV1 = false）→ 新暖白版式坐标全量归位。
// 必须在 syncCanvasPanels 之前调用。
const LOW_FREQ_KINDS = ['backpack', 'steam', 'achievements']
export function applyRestoreLowFreq(state) {
  if (!state || state.lowFreqBackV1 === true) return { applied: false, revived: [] }
  state.lowFreqBackV1 = true
  if (!state.canvasPanels || typeof state.canvasPanels !== 'object') state.canvasPanels = {}
  LOW_FREQ_KINDS.forEach((k) => { state.canvasPanels[k] = true })
  if (!Array.isArray(state.whiteboardNodes)) state.whiteboardNodes = []
  const revived = []
  state.whiteboardNodes.forEach((n) => {
    if (!n.deletedAt || n.type !== 'panel' || !LOW_FREQ_KINDS.includes(n.panelKind)) return
    if (state.whiteboardNodes.some((x) => !x.deletedAt && x.type === 'panel' && x.panelKind === n.panelKind && x.id !== n.id)) return
    n.deletedAt = null
    n.updatedAt = todayStr()
    revived.push(n.id)
  })
  const alive = (id) => state.whiteboardNodes.some((n) => n.id === id && !n.deletedAt)
  ;(state.whiteboardEdges || []).forEach((e) => {
    if (e.deletedAt && revived.includes(e.from) && alive(e.to)) e.deletedAt = null
    if (e.deletedAt && revived.includes(e.to) && alive(e.from)) e.deletedAt = null
  })
  // 新暖白版式全量归位：黄金网格重跑 + 行 2 小卡（音乐/时钟/便利贴）按新坐标落位
  state.goldenLayoutV1 = false
  const reposCard = (kind, pos) => {
    const n = state.whiteboardNodes.find((x) => !x.deletedAt && x.type === 'card' && x.cardKind === kind && !x.spaceId && !x.stackId)
    if (n) { n.x = pos[0]; n.y = pos[1]; n.w = pos[2]; n.h = pos[3] }
  }
  reposCard('audio', SMART_CARD_POS.audio)
  reposCard('clock', SMART_CARD_POS.clock)
  const sticky = state.whiteboardNodes.find((x) => !x.deletedAt && x.id === 'wbn-demo-sticky')
  if (sticky) { sticky.x = SMART_MEMO_POS[0]; sticky.y = SMART_MEMO_POS[1]; sticky.w = SMART_MEMO_POS[2]; sticky.h = SMART_MEMO_POS[3] }
  return { applied: true, revived }
}

// v2.5.3（2026-11-03 晚）：背包/成就/Steam 默认堆叠 —— 三张低频面板收进一个堆叠组（锚点 + k×18 对角）。
// 必须在 syncCanvasPanels / applyGoldenLayout 之后调用（面板节点已存在并已按注册表锚点坐标落位）。
export function applyStackLowFreq(state) {
  if (!state || state.lowFreqStackV1 === true) return { applied: false }
  state.lowFreqStackV1 = true
  if (!Array.isArray(state.whiteboardNodes)) return { applied: false }
  const targets = state.whiteboardNodes.filter((n) =>
    !n.deletedAt && !n.spaceId && !n.stackId && n.type === 'panel' && LOW_FREQ_KINDS.includes(n.panelKind))
  if (targets.length < 2) return { applied: false }
  targets.sort((a, b) => LOW_FREQ_KINDS.indexOf(a.panelKind) - LOW_FREQ_KINDS.indexOf(b.panelKind))
  const sid = 'wsg_' + uid('sg').slice(1)
  const anchor = targets[0]
  const aw = anchor.w || 280, ah = anchor.h || 208
  targets.forEach((n, k) => {
    n.stackId = sid
    n.stackIdx = k
    // 全组坐标统一 = 锚点 + k×等值对角（渲染唯一真源，禁止单独 snap）
    n.x = anchor.x + k * STACK_DX
    n.y = anchor.y + k * STACK_DY
    n.w = aw
    n.h = ah
  })
  return { applied: true, count: targets.length }
}

// ---------- v2.1.0：双向链接（系统级实体关联 + 反向索引） ----------
export function addBiLink(state, data) {
  const types = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'ledger']
  const sourceType = types.includes(data.sourceType) ? data.sourceType : 'memo'
  const targetType = types.includes(data.targetType) ? data.targetType : 'task'
  if (!data.sourceId || !data.targetId) return { ok: false, error: '关联两端无效' }
  // 去重：同一对 (source,target) 不重复写入
  const dup = state.biLinks.find((b) => !b.deletedAt && b.sourceType === sourceType && b.sourceId === data.sourceId && b.targetType === targetType && b.targetId === data.targetId)
  if (dup) return { ok: true, link: dup, duplicated: true }
  const link = {
    id: uid('bil'), sourceType, sourceId: String(data.sourceId),
    targetType, targetId: String(data.targetId), createdAt: todayStr(), deletedAt: null
  }
  state.biLinks.push(link)
  return { ok: true, link }
}
export function deleteBiLink(state, id) {
  const b = state.biLinks.find((x) => x.id === id)
  if (!b) return false
  b.deletedAt = nowIso()
  return true
}

/**
 * 同步「文本内联 @[Type:ID]」到统一关联表 biLinks。
 * 内联链接是关联的另一种入口，最终落到同一张表 → 画布连线、详情页关联、反向索引三处永远同源。
 * 只处理 sourceType/sourceId 自身发出的链接；目标侧的记录由对端实体自己维护（无向对语义）。
 */
export function syncInlineBiLinks(state, sourceType, sourceId, text) {
  const targets = extractBiLinks(text)
  const want = new Set(targets.map((t) => t.type + ':' + t.id))
  // 清理该实体作为「来源方」且已不在正文中的旧内联链接
  state.biLinks.filter((b) => !b.deletedAt && b.sourceType === sourceType && b.sourceId === sourceId && b.inline).forEach((b) => {
    if (!want.has(b.targetType + ':' + b.targetId)) deleteBiLink(state, b.id)
  })
  targets.forEach((t) => {
    const dup = state.biLinks.find((b) => !b.deletedAt && (
      (b.sourceType === sourceType && b.sourceId === sourceId && b.targetType === t.type && b.targetId === t.id) ||
      (b.sourceType === t.type && b.sourceId === t.id && b.targetType === sourceType && b.targetId === sourceId)
    ))
    if (dup) return
    const link = {
      id: uid('bil'), sourceType, sourceId: String(sourceId),
      targetType: t.type, targetId: t.id, inline: true,
      createdAt: todayStr(), deletedAt: null
    }
    state.biLinks.push(link)
  })
}
// 反向索引：查询某实体被哪些实体引用（用于「某任务被哪些笔记引用」）
export function backlinksOf(state, type, id) {
  return state.biLinks.filter((b) => !b.deletedAt && b.targetType === type && b.targetId === id)
}
export function forwardLinksOf(state, type, id) {
  return state.biLinks.filter((b) => !b.deletedAt && b.sourceType === type && b.sourceId === id)
}

function sanitizeWhiteboardNodeLocal(data) {
  const rawType = data.type === 'note' ? 'memo' : data.type
  const type = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'insight', 'profile', 'game', 'panel', 'ledger', 'card'].includes(rawType) ? rawType : 'memo'
  const rawKind = String(data.panelKind || '')
  const rawCard = String(data.cardKind || '')
  return {
    id: uid('wbn'),
    type,
    // 数据面板节点子类型（canvasPanels 六类），非 panel 节点恒为 null
    panelKind: type === 'panel' && CANVAS_PANEL_KINDS.includes(rawKind) ? rawKind : null,
    // v2.2.0 卡片矩阵：画布原生卡片子类型，非 card 节点恒为 null
    cardKind: type === 'card' ? (rawCard || 'note') : null,
    refId: data.refId || null,
    x: Number(data.x) || 0, y: Number(data.y) || 0,
    w: Math.min(1200, Math.max(120, Number(data.w) || 200)),
    h: Math.min(1200, Math.max(80, Number(data.h) || 140)),
    color: data.color || 'amber',
    text: String(data.text || '').slice(0, 2000),
    // v2.2.0 卡片矩阵：结构化卡片数据
    cardData: (data.cardData && typeof data.cardData === 'object') ? data.cardData : null,
    // v2.1.1 画布精简：节点标签（自定义分组）
    tags: parseTagsInput(data.tags),
    // v2.1.1 堆叠组（节点级元数据，null = 自由卡片）
    stackId: data.stackId || null,
    stackIdx: typeof data.stackIdx === 'number' ? Math.max(0, Math.floor(data.stackIdx)) : 0,
    // v2.2.0 多级空间：所属空间（null = 枢纽根层）
    spaceId: data.spaceId || null,
    createdAt: todayStr(), updatedAt: todayStr(), deletedAt: null
  }
}

// ---------- v2.1.0：看板布局（序列化保存） ----------
export function saveDashboardLayout(state, layout) {
  if (!Array.isArray(layout)) return false
  state.dashboardLayout = layout
    .filter((l) => l && l.i)
    .map((l) => ({
      i: String(l.i), x: Number(l.x) || 0, y: Number(l.y) || 0,
      w: Math.min(12, Math.max(1, Number(l.w) || 4)), h: Math.min(24, Math.max(1, Number(l.h) || 6)),
      module: ['chart', 'calendar', 'tasks', 'stats', 'recent'].includes(l.module) ? l.module : 'tasks'
    }))
  return true
}
