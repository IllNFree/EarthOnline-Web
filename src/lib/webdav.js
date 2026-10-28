// ===== WebDAV 同步（v2.0.0 P0：文件名 / 主键合并 / lastSyncAt 三处与 Android 全面对齐） =====
// 契约：远端文件名恒为 /earth_online_backup.json（与 Android CloudSyncManager.DEFAULT_REMOTE_PATH 一致），
// 合并语义 = 按实体主键 upsert（同 id 覆盖，本地独有保留，远端独有补入），
// 冲突判定 = 比较 remote.exportedAt 与本地 lastSyncAt，远端不比本地新则不落库。
import { serializeBackup, parseBackup } from './backup.js'
import { SOFT_KIND_MAP, SOFT_KINDS, sanitizeState } from './model.js'

// ===== 远端路径 =====
export const DEFAULT_REMOTE_PATH = '/earth_online_backup.json'
export function remotePathOf(cfg) {
  const p = String((cfg && cfg.path) || '').trim()
  if (!p) return DEFAULT_REMOTE_PATH
  return p.charAt(0) === '/' ? p : '/' + p
}

// ===== 请求基础 =====
function client(cfg) {
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.user && cfg.pass) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(cfg.user + ':' + cfg.pass)))
  return headers
}
function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '')
  const p = String(path || '').replace(/^\/+/, '')
  return b + '/' + p
}

export async function testConnection(cfg) {
  try {
    const res = await fetch(joinUrl(cfg.url, remotePathOf(cfg)), {
      method: 'PROPFIND', headers: client(cfg),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: '认证失败，请检查账号密码' }
    if (res.status === 405 || res.status === 207 || res.ok) return { ok: true }
    return { ok: res.ok, error: 'HTTP ' + res.status }
  } catch (e) { return { ok: false, error: e.message || '连接失败' } }
}

// ===== 上传 =====
export async function pushBackup(cfg, state) {
  const body = serializeBackup(state)
  const res = await fetch(joinUrl(cfg.url, remotePathOf(cfg)), {
    method: 'PUT', headers: client(cfg), body
  })
  if (!res.ok && res.status !== 201 && res.status !== 204) return { ok: false, error: '上传失败 HTTP ' + res.status }
  return { ok: true, syncedAt: new Date().toISOString() }
}

// ===== 下载（不强落库，交由调用方做主键合并决策） =====
export async function pullBackup(cfg) {
  const res = await fetch(joinUrl(cfg.url, remotePathOf(cfg)), { method: 'GET', headers: client(cfg) })
  if (!res.ok) return { ok: false, error: '下载失败 HTTP ' + res.status, payload: null }
  const text = await res.text()
  let obj
  try { obj = JSON.parse(text) } catch (e) { return { ok: false, error: '解析失败：云端不是合法 JSON', payload: null } }
  if (!obj || !obj.state) return { ok: false, error: '备份格式不合法', payload: null }
  return { ok: true, payload: { obj, exportedAt: obj.exportedAt || '', state: sanitizeState(obj.state) } }
}

// ===== 主键合并 =====
// 语义严格对齐 Android @Insert(OnConflictStrategy.REPLACE)：去重键 = 实体 id，
// 同主键一律以「入站一侧」覆盖本地（拉云=云端覆盖；导入文件=文件覆盖），本地独有主键保留。
// 与旧实现（Object.assign 整包浅覆盖）的区别：**不会**删掉本地独有数据。
function mergeList(localArr, remoteArr) {
  const out = []
  const localById = new Map()
  ;(localArr || []).forEach((r) => { if (r && r.id) localById.set(r.id, r) })
  const seen = new Set()
  // 1) 入站侧优先写入（同主键覆盖到本地 singleton 位置）
  ;(remoteArr || []).forEach((r) => {
    if (!r || !r.id) return
    if (seen.has(r.id)) { const i = out.findIndex((x) => x.id === r.id); if (i >= 0) out[i] = r; return }
    seen.add(r.id)
    out.push(r)
  })
  // 2) 本地独有主键保留（这是与「整包覆盖」的本质差别）
  ;(localArr || []).forEach((r) => {
    if (!r || !r.id) return
    if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
  })
  return out
}
function mergeSimpleList(localArr, remoteArr, keyOf) {
  const out = (localArr || []).slice()
  ;(remoteArr || []).forEach((r) => {
    if (!r) return
    const k = keyOf(r)
    if (!k) return
    const i = out.findIndex((x) => keyOf(x) === k)
    if (i >= 0) out[i] = r
    else out.push(r)
  })
  return out
}

/**
 * 按主键把远端 state 合并进本地 state（返回合并后的片段，由调用方写回 + 持久化）。
 * 软删除走同一条通道：deletedAt 随实体一起按主键 upsert，彻底消灭跨端幽灵数据。
 */
export function mergeBackup(localState, remoteState) {
  const patch = {}
  let added = 0
  SOFT_KINDS.forEach((kind) => {
    const key = SOFT_KIND_MAP[kind]
    const localArr = localState[key] || []
    const remoteArr = remoteState[key] || []
    const before = localArr.length
    const merged = mergeList(localArr, remoteArr)
    added += Math.max(0, merged.length - before)
    patch[key] = merged
  })
  if (Array.isArray(remoteState.activities)) {
    patch.activities = mergeSimpleList(localState.activities, remoteState.activities, (x) => x.id)
  }
  if (Array.isArray(remoteState.achievements)) {
    patch.achievements = mergeSimpleList(localState.achievements, remoteState.achievements, (x) => x.key)
  }
  if (remoteState.ledger && Array.isArray(remoteState.ledger.records)) {
    patch.ledger = {
      records: mergeSimpleList(localState.ledger.records, remoteState.ledger.records, (x) => x.id),
      expenseCategories: mergeSimpleList(localState.ledger.expenseCategories, remoteState.ledger.expenseCategories, (x) => x.name),
      incomeCategories: mergeSimpleList(localState.ledger.incomeCategories, remoteState.ledger.incomeCategories, (x) => x.name)
    }
  }
  ;['itemCategories', 'collectionCategories'].forEach((k) => {
    if (Array.isArray(remoteState[k])) patch[k] = mergeSimpleList(localState[k], remoteState[k], (x) => x.name)
  })
  // v2.1.0：白板节点 / 连线 / 双向链接（按 id 主键合并，软删除随实体同步）
  ;['whiteboardNodes', 'whiteboardEdges', 'biLinks'].forEach((k) => {
    if (Array.isArray(remoteState[k])) patch[k] = mergeSimpleList(localState[k], remoteState[k], (x) => x.id)
  })
  // v2.1.0：看板布局（主键 = i）
  if (Array.isArray(remoteState.dashboardLayout)) {
    patch.dashboardLayout = mergeSimpleList(localState.dashboardLayout || [], remoteState.dashboardLayout, (x) => x.i)
  }
  // v2.1.0：Web 专属成就里程碑计数（逐项取较大值，跨端/多设备合并不倒退）
  if (remoteState.webMilestones && typeof remoteState.webMilestones === 'object') {
    const localM = localState.webMilestones || {}
    const m = {}
    Object.keys(remoteState.webMilestones).forEach((k) => {
      const lv = Number(localM[k]) || 0
      const rv = Number(remoteState.webMilestones[k]) || 0
      m[k] = Math.max(lv, rv)
    })
    // 本地已有但远端没有的键也要保留
    Object.keys(localM).forEach((k) => { if (m[k] === undefined) m[k] = Number(localM[k]) || 0 })
    patch.webMilestones = m
  }
  // 资料：远端非空字段优先（昵称 / 头像 / 签名属用户本人资料，跨端应当同步）
  if (remoteState.profile && typeof remoteState.profile === 'object') {
    const p = Object.assign({}, localState.profile || {})
    Object.keys(remoteState.profile).forEach((k) => {
      const v = remoteState.profile[k]
      if (v === null || v === undefined || v === '') return
      if (Array.isArray(v) && !v.length) return
      p[k] = v
    })
    patch.profile = p
  }
  if (remoteState.birthDate) patch.birthDate = remoteState.birthDate
  return { patch, added }
}

/** 远端是否比本地新（lastSyncAt 比对） */
export function remoteIsNewer(exportedAt, lastSyncAt) {
  const a = String(exportedAt || '')
  const b = String(lastSyncAt || '')
  if (!b) return true
  if (!a) return false
  return a > b
}

export { parseBackup }
