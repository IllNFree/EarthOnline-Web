// ===== 双向链接（需求 4）：语法解析 + 实体解析 =====
// 语法：@[Type:ID]  —— Type ∈ {task,memo,item,photo,collection,location,ledger}
// 红线 7：必须支持关联任务/背包/笔记/相册等所有核心实体，严禁只针对某一类硬编码。
export const BI_LINK_TYPES = {
  task: { label: '任务', icon: 'tasks', route: '/tasks' },
  memo: { label: '笔记', icon: 'note', route: '/notes' },
  item: { label: '背包', icon: 'backpack', route: '/backpack' },
  photo: { label: '相册', icon: 'image', route: '/album' },
  collection: { label: '收藏', icon: 'star', route: '/backpack' },
  location: { label: '足迹', icon: 'map-pin', route: '/map' },
  ledger: { label: '记账', icon: 'wallet', route: '/ledger' }
}
const TYPES = Object.keys(BI_LINK_TYPES).join('|')
const RE = new RegExp('\\[@(' + TYPES + '):([\\w\\-]+)\\]', 'g')

/** 将文本切分为「普通文本段」与「链接段」序列，供渲染层逐段渲染 */
export function tokenizeBiLinks(text) {
  const out = []
  let last = 0
  let m
  RE.lastIndex = 0
  while ((m = RE.exec(String(text || '')))) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'link', linkType: m[1], id: m[2], raw: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** 提取文本中所有 @ 关联实体（去重），用于反向索引构建 */
export function extractBiLinks(text) {
  const seen = new Set()
  const out = []
  tokenizeBiLinks(text).forEach((t) => {
    if (t.type !== 'link') return
    const key = t.linkType + ':' + t.id
    if (seen.has(key)) return
    seen.add(key)
    out.push({ type: t.linkType, id: t.id })
  })
  return out
}

/** 解析某实体（用于反向索引）：返回 { type, id, title } 或 null */
export function resolveBiLink(state, type, id) {
  const arr = state && state[collectionOf(type)]
  if (!Array.isArray(arr)) return null
  const rec = arr.find((x) => x.id === id && !x.deletedAt)
  if (!rec) return null
  let title = ''
  if (type === 'task') title = rec.title
  else if (type === 'memo') title = rec.title
  else if (type === 'item') title = rec.name
  else if (type === 'collection') title = rec.title
  else if (type === 'location') title = rec.name
  else if (type === 'photo') title = rec.name
  else if (type === 'ledger') title = (rec.type === 'income' ? '收入 ' : '支出 ') + rec.amount + ' 元'
  return { type, id, title: title || '未命名' }
}

function collectionOf(type) {
  return ({
    task: 'tasks', memo: 'memos', item: 'items', photo: 'photos',
    collection: 'collections', location: 'locations', ledger: 'ledger'
  })[type] || null
}

/** 在任意文本中建立双向索引：返回正向链接（source 指向 targets） */
export function buildForwardLinks(sourceType, sourceId, text) {
  return extractBiLinks(text).map((b) => ({ sourceType, sourceId, targetType: b.type, targetId: b.id }))
}
