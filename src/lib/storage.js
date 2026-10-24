// ===== 零依赖持久化层（IndexedDB 主，localStorage 降级） =====
import { STORAGE_KEY } from './model.js'
import { sanitizeState } from './model.js'

const LS_PREFIX = 'eo_ls_'
let idb = null
let usingFallback = false

function openIDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open('EarthOnlineDB', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch (e) { resolve(null) }
  })
}
function idbGet(key) {
  return new Promise((resolve) => {
    if (!idb) return resolve(undefined)
    try {
      const tx = idb.transaction('kv', 'readonly')
      const r = tx.objectStore('kv').get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(undefined)
    } catch (e) { resolve(undefined) }
  })
}
function idbSet(key, val) {
  return new Promise((resolve) => {
    if (!idb) return resolve()
    try {
      const tx = idb.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(val, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch (e) { resolve() }
  })
}
function idbDel(key) {
  return new Promise((resolve) => {
    if (!idb) return resolve()
    try {
      const tx = idb.transaction('kv', 'readwrite')
      tx.objectStore('kv').delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch (e) { resolve() }
  })
}

async function init() {
  if (idb !== null) return
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
}

export async function loadRaw() {
  await init()
  if (usingFallback) {
    try { const v = localStorage.getItem(LS_PREFIX + STORAGE_KEY); return v ? JSON.parse(v) : null } catch (e) { return null }
  }
  const v = await idbGet(STORAGE_KEY)
  return v === undefined ? null : v
}
export async function saveRaw(obj) {
  await init()
  const clone = JSON.parse(JSON.stringify(obj))
  if (usingFallback) {
    try { localStorage.setItem(LS_PREFIX + STORAGE_KEY, JSON.stringify(clone)) } catch (e) {}
    return
  }
  await idbSet(STORAGE_KEY, clone)
}
export async function loadState() {
  const raw = await loadRaw()
  return sanitizeState(raw)
}
export async function saveState(state) {
  await saveRaw(state)
}
export async function resetAll() {
  await init()
  if (usingFallback) { try { localStorage.removeItem(LS_PREFIX + STORAGE_KEY) } catch (e) {} }
  else await idbDel(STORAGE_KEY)
}
