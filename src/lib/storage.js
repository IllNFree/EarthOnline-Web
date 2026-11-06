// ===== 零依赖持久化层（IndexedDB 主，localStorage 降级） =====
// 3.0 存储可靠性改造：
// 1) 二进制拆分 —— 照片 / 封面 / 头像 / 壁纸的 base64 不再写进主存档键，
//    而是单独存到 IndexedDB 的 blobs 仓，主存档里只留 `eo-blob:<key>` 令牌。
//    运行时内存里仍是原始 dataURL（组件无需改动），仅在落库时剥离、读取时回填。
// 2) 体积 / 配额统计 —— 每次保存记录主存档字节数、媒体字节数；可查询浏览器配额占用。
// 3) 保存失败可感知 —— saveRaw 返回结果对象并回调失败原因，由上层弹 toast，绝不静默丢数据。
import { STORAGE_KEY } from './model.js'
import { sanitizeState } from './model.js'

const DB_NAME = 'EarthOnlineDB'
const DB_VERSION = 2
const KV_STORE = 'kv'
const BLOB_STORE = 'blobs'
const TOKEN = 'eo-blob:'
const LS_PREFIX = 'eo_ls_'

let idb = null
let usingFallback = false
let initPromise = null
// 串行化保存：避免连续 debounce 触发时后发先至覆盖新数据
let saveChain = Promise.resolve()
let errorHandler = null
const stats = { mainBytes: 0, mediaBytes: 0, mediaCount: 0, at: 0, ok: true, error: '' }
// 本次会话已写入 blobs 仓的媒体内容（key → dataURL），内容未变则跳过重复写
const savedMedia = new Map()
export const lastStats = stats

function openIDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE)
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch (e) { resolve(null) }
  })
}
function idbGet(key, storeName = KV_STORE) {
  return new Promise((resolve) => {
    if (!idb) return resolve(undefined)
    try {
      const tx = idb.transaction(storeName, 'readonly')
      const r = tx.objectStore(storeName).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(undefined)
    } catch (e) { resolve(undefined) }
  })
}
function idbPut(key, val, storeName = KV_STORE) {
  return new Promise((resolve) => {
    if (!idb) return resolve(false)
    try {
      const tx = idb.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(val, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch (e) { resolve(false) }
  })
}
function idbDel(key, storeName = KV_STORE) {
  return new Promise((resolve) => {
    if (!idb) return resolve()
    try {
      const tx = idb.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch (e) { resolve() }
  })
}
function idbKeys(storeName) {
  return new Promise((resolve) => {
    if (!idb) return resolve([])
    try {
      const tx = idb.transaction(storeName, 'readonly')
      const r = tx.objectStore(storeName).getAllKeys()
      r.onsuccess = () => resolve(r.result || [])
      r.onerror = () => resolve([])
    } catch (e) { resolve([]) }
  })
}

async function init() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    idb = await openIDB()
    if (!idb) {
      usingFallback = true
      try {
        if (!localStorage.getItem(LS_PREFIX + 'migrated')) {
          // 一次性迁移旧 earth_* 键
          const old = {}
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.indexOf('earth_') === 0) old[k] = localStorage.getItem(k)
          }
          if (old[STORAGE_KEY]) {
            try { localStorage.setItem(LS_PREFIX + STORAGE_KEY, old[STORAGE_KEY]) } catch (e) {}
          }
          for (const k in old) { try { localStorage.removeItem(k) } catch (e) {} }
          try { localStorage.setItem(LS_PREFIX + 'migrated', '1') } catch (e) {}
        }
      } catch (e) {}
    }
  })()
  return initPromise
}

// ---------- 二进制字段清单（新增内联大字段时只改这里） ----------
// 每个字段都需要一个稳定的媒体 key：删除重建同 id 记录时会复用同一份二进制。
function eachMedia(state, fn) {
  if (!state || typeof state !== 'object') return
  const walk = (list, field, prefix) => {
    if (!Array.isArray(list)) return
    list.forEach((x) => {
      if (!x || typeof x !== 'object') return
      const v = x[field]
      if (typeof v !== 'string' || !v) return
      fn(x, field, prefix + ':' + x.id)
    })
  }
  walk(state.photos, 'dataUrl', 'photo')
  walk(state.items, 'cover', 'item')
  walk(state.collections, 'cover', 'col')
  if (state.profile && state.profile.avatarData) fn(state.profile, 'avatarData', 'profile:avatar')
  if (typeof state.wallpaper === 'string' && state.wallpaper) fn(state, 'wallpaper', 'state:wallpaper')
}

/** 读取：把存档里的 blob 令牌回填成 dataURL（内存里始终拿到可直接渲染的字符串） */
async function hydrate(raw) {
  if (!raw || typeof raw !== 'object' || usingFallback) return raw
  const refs = []
  eachMedia(raw, (obj, field, key) => {
    const v = obj[field]
    if (typeof v === 'string' && v.indexOf(TOKEN) === 0) refs.push({ obj, field, key: v.slice(TOKEN.length) || key })
  })
  if (!refs.length) return raw
  const results = await Promise.all(refs.map((r) => idbGet(r.key, BLOB_STORE)))
  refs.forEach((r, i) => {
    const v = results[i]
    r.obj[r.field] = (typeof v === 'string' && v) ? v : ''
  })
  return raw
}

/** 落库：把 dataURL 剥离到 blobs 仓，主存档只留令牌 */
async function stripAndSave(obj) {
  const clone = JSON.parse(JSON.stringify(obj))
  const medias = []
  let mediaBytes = 0
  eachMedia(clone, (o, field, key) => {
    const v = o[field]
    if (typeof v !== 'string') return
    if (v.indexOf('data:') === 0) {
      medias.push({ key, dataUrl: v })
      mediaBytes += v.length
      o[field] = TOKEN + key
    }
  })
  if (usingFallback) {
    // 降级路径没有独立二进制仓：媒体继续内联，保证不丢图
    try {
      const text = JSON.stringify(clone)
      localStorage.setItem(LS_PREFIX + STORAGE_KEY, text)
      Object.assign(stats, { mainBytes: text.length, mediaBytes: 0, mediaCount: 0, at: Date.now(), ok: true, error: '' })
      return { ok: true, bytes: text.length }
    } catch (e) {
      const msg = e && e.name === 'QuotaExceededError' ? '本地存储空间已满，请导出备份后清理部分照片' : ('保存失败：' + (e && e.message ? e.message : e))
      Object.assign(stats, { at: Date.now(), ok: false, error: msg })
      if (errorHandler) { try { errorHandler(msg) } catch (_) {} }
      return { ok: false, error: msg }
    }
  }
  let failed = ''
  // 已落库且内容未变的二进制不重复写：避免每次 250ms 防抖都把几十张图重写一遍
  for (const m of medias) {
    if (savedMedia.get(m.key) === m.dataUrl) continue
    const ok = await idbPut(m.key, m.dataUrl, BLOB_STORE)
    if (!ok) { failed = '媒体写入失败（存储空间可能已满）'; break }
    savedMedia.set(m.key, m.dataUrl)
  }
  if (failed) {
    Object.assign(stats, { at: Date.now(), ok: false, error: failed })
    if (errorHandler) { try { errorHandler(failed) } catch (_) {} }
    return { ok: false, error: failed }
  }
  const ok = await idbPut(STORAGE_KEY, clone)
  if (!ok) {
    const msg = '存档写入失败（存储空间可能已满，请先导出备份）'
    Object.assign(stats, { at: Date.now(), ok: false, error: msg })
    if (errorHandler) { try { errorHandler(msg) } catch (_) {} }
    return { ok: false, error: msg }
  }
  Object.assign(stats, { mainBytes: JSON.stringify(clone).length, mediaBytes, mediaCount: medias.length, at: Date.now(), ok: true, error: '' })
  // 清理孤儿二进制（照片彻底删除 / 换封面后残留），低频执行不阻塞首屏
  pruneMedia(clone)
  return { ok: true, bytes: stats.mainBytes + mediaBytes }
}

async function pruneMedia(clone) {
  try {
    const alive = new Set()
    eachMedia(clone, (o, field, key) => alive.add(key))
    const keys = await idbKeys(BLOB_STORE)
    for (const k of keys) {
      if (!alive.has(k)) await idbDel(k, BLOB_STORE)
    }
  } catch (e) { /* 清理失败不影响主流程 */ }
}

export async function loadRaw() {
  await init()
  if (usingFallback) {
    try {
      const v = localStorage.getItem(LS_PREFIX + STORAGE_KEY)
      return v ? JSON.parse(v) : null
    } catch (e) { return null }
  }
  const v = await idbGet(STORAGE_KEY)
  if (v === undefined || v === null) return null
  return hydrate(v)
}
/** 保存：返回 { ok, bytes, error }；失败会走 errorHandler，绝不静默 */
export async function saveRaw(obj) {
  await init()
  const run = () => stripAndSave(obj)
  saveChain = saveChain.then(run, run)
  return saveChain
}
export async function loadState() {
  const raw = await loadRaw()
  return sanitizeState(raw)
}
export async function saveState(state) {
  return saveRaw(state)
}
export async function resetAll() {
  await init()
  if (usingFallback) { try { localStorage.removeItem(LS_PREFIX + STORAGE_KEY) } catch (e) {} }
  else {
    await idbDel(STORAGE_KEY)
    const keys = await idbKeys(BLOB_STORE)
    for (const k of keys) await idbDel(k, BLOB_STORE)
  }
}

// ---------- 观测接口 ----------
export function setStorageErrorHandler(fn) { errorHandler = typeof fn === 'function' ? fn : null }

/** 配额 / 占用：浏览器支持时返回真实用量，否则返回本地估算 */
export async function getStorageStats() {
  await init()
  let usage = null, quota = null, persisted = null
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate()
      usage = est.usage || 0
      quota = est.quota || 0
    }
  } catch (e) {}
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted()
  } catch (e) {}
  return {
    mainBytes: stats.mainBytes,
    mediaBytes: stats.mediaBytes,
    mediaCount: stats.mediaCount,
    at: stats.at,
    ok: stats.ok,
    error: stats.error,
    usage,
    quota,
    persisted,
    fallback: usingFallback
  }
}
/** 申请持久化存储（减少被系统自动清理的概率） */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist()
  } catch (e) {}
  return false
}
