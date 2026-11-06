// ===== Steam 数据缓存层（等效 @pinia/colada）=====
// 目标：请求去重（in-flight 复用）+ 30 分钟 TTL + stale-while-revalidate + IndexedDB 持久化。
// 语义：
//   · 缓存仍新鲜 → 直接复用，绝不发起网络请求（切页返回秒开）
//   · 缓存已过期 → 立即返回旧数据（用户无感），后台静默刷新后再替换
//   · 刷新页面 → 先读 IndexedDB 本地缓存渲染，再后台静默更新
//   · 同一时刻同一账号只会有一个网络请求（去重）
import { reactive } from 'vue'
import { fetchSteamGames, fetchRecentPlaytime, fetchSteamProfile, fetchGameAchievements } from '../lib/steam.js'
import { setSteamCache } from './steamCache.js'

export const STEAM_TTL = 30 * 60 * 1000
const ACH_TTL = 30 * 60 * 1000
const DB_NAME = 'EarthOnlineDB'
const STORE_NAME = 'kv'
const CACHE_KEY = 'eo_steam_cache_v2'

export const steamState = reactive({
  games: [],
  count: 0,
  recent: {},
  profile: null,
  ach: {},
  at: 0,
  fp: '',
  hydrated: false,
  loading: false,
  revalidating: false,
  error: ''
})

let dbPromise = null
let inflight = null
let persistTimer = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch (e) { resolve(null) }
  })
  return dbPromise
}
function idbGet(key) {
  return openDB().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined)
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const r = tx.objectStore(STORE_NAME).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(undefined)
    } catch (e) { resolve(undefined) }
  }))
}
function idbSet(key, val) {
  return openDB().then((db) => new Promise((resolve) => {
    if (!db) return resolve()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(val, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch (e) { resolve() }
  }))
}

function fingerprint(cfg) {
  const c = cfg || {}
  return (c.steamId || '').trim() + '|' + (c.proxy || '').trim() + '|' + ((c.apiKey || '').trim() ? 'k' : '')
}

function snapshot() {
  return {
    games: steamState.games,
    count: steamState.count,
    recent: steamState.recent,
    profile: steamState.profile,
    ach: steamState.ach,
    at: steamState.at,
    fp: steamState.fp
  }
}

function schedulePersist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { idbSet(CACHE_KEY, snapshot()) }, 800)
}

function applyRecord(rec) {
  if (!rec || !Array.isArray(rec.games)) return
  steamState.games = rec.games
  steamState.count = Number(rec.count) || rec.games.length
  steamState.recent = rec.recent || {}
  steamState.profile = rec.profile || null
  steamState.ach = rec.ach || {}
  steamState.at = Number(rec.at) || 0
  steamState.fp = rec.fp || ''
  setSteamCache(rec.games, steamState.count, { steamId: (rec.fp || '').split('|')[0] })
}

export async function hydrateSteam() {
  if (steamState.hydrated) return
  steamState.hydrated = true
  const rec = await idbGet(CACHE_KEY)
  if (rec) applyRecord(rec)
}

export function isFresh(cfg) {
  const fp = fingerprint(cfg)
  return !!(steamState.at && steamState.fp === fp && (Date.now() - steamState.at < STEAM_TTL))
}

export function cacheAgeMs() {
  return steamState.at ? Date.now() - steamState.at : Infinity
}

async function runFetch(cfg, fp) {
  const hasCache = steamState.fp === fp && steamState.games.length > 0
  if (hasCache) steamState.revalidating = true
  else steamState.loading = true
  steamState.error = ''

  try {
    const r = await fetchSteamGames(cfg)
    if (!r.ok) {
      steamState.error = r.error || '游戏库暂时拉取失败'
      if (!hasCache) steamState.games = []
      return steamState
    }
    let recent = {}
    let profile = steamState.fp === fp ? steamState.profile : null
    const [rr, pr] = await Promise.all([
      fetchRecentPlaytime(cfg).catch(() => ({ ok: false })),
      fetchSteamProfile(cfg).catch(() => ({ ok: false }))
    ])
    if (rr && rr.ok) recent = rr.recent || {}
    if (pr && pr.ok && pr.profile) profile = pr.profile
    steamState.games = (r.games || []).map((g) => {
      const rec = recent[g.appid] || {}
      return { ...g, recentHours: rec.recentHours || 0, lastPlayedTime: rec.lastPlayedTime || 0 }
    })
    steamState.count = r.count || steamState.games.length
    steamState.recent = recent
    steamState.profile = profile
    steamState.at = Date.now()
    steamState.fp = fp
    steamState.error = steamState.games.length ? '' : '该账号暂无公开游戏库，或 Steam 资料设为私密。'
    setSteamCache(steamState.games, steamState.count, { steamId: (cfg.steamId || '') })
    schedulePersist()
    return steamState
  } catch (e) {
    steamState.error = (e && e.message) || '网络异常'
    return steamState
  } finally {
    steamState.loading = false
    steamState.revalidating = false
  }
}

/**
 * 确保 Steam 数据可用（页面挂载 / 激活时调用）。
 * @param {object} cfg  { apiKey, steamId, proxy }
 * @param {object} opts { force: 强制重新拉取 }
 */
export async function ensureSteam(cfg, opts) {
  const force = !!(opts && opts.force)
  await hydrateSteam()
  const c = cfg || {}
  const fp = fingerprint(c)
  const configured = !!(String(c.apiKey || '').trim() && String(c.steamId || '').trim())

  if (!configured) {
    steamState.error = '尚未绑定 Steam：填入 API Key 与 Steam ID 即可同步游戏库。'
    return steamState
  }
  // 缓存命中且新鲜 → 零网络请求
  if (!force && isFresh(c)) return steamState
  // 换了账号 → 清掉旧展示，避免串号
  if (steamState.fp && steamState.fp !== fp) {
    steamState.games = []
    steamState.count = 0
    steamState.recent = {}
    steamState.profile = null
    steamState.ach = {}
    steamState.at = 0
  }
  if (inflight) return inflight
  inflight = runFetch(c, fp).finally(() => { inflight = null })
  return inflight
}

/** 单个游戏成就（懒加载 + 去重 + 30 分钟缓存） */
export async function ensureAchievements(cfg, appid) {
  const key = String(appid || '')
  if (!key) return null
  const cur = steamState.ach[key]
  if (cur && cur.at && Date.now() - cur.at < ACH_TTL) return cur
  if (cur && cur.loading) return cur
  const entry = {
    loading: true,
    ok: false,
    error: '',
    achievements: (cur && cur.achievements) || [],
    unlocked: (cur && cur.unlocked) || 0,
    total: (cur && cur.total) || 0,
    at: (cur && cur.at) || 0
  }
  steamState.ach = { ...steamState.ach, [key]: entry }
  try {
    const r = await fetchGameAchievements(cfg || {}, key)
    entry.loading = false
    if (r && r.ok) {
      entry.achievements = r.achievements || []
      entry.unlocked = r.unlocked || 0
      entry.total = r.total || 0
      entry.error = ''
      entry.ok = true
    } else {
      entry.error = (r && r.error) || '成就数据不可用'
      entry.ok = false
    }
  } catch (e) {
    entry.loading = false
    entry.error = '成就数据不可用'
    entry.ok = false
  }
  entry.at = Date.now()
  steamState.ach = { ...steamState.ach, [key]: entry }
  schedulePersist()
  return entry
}

/** 清空缓存（换绑 / 手动刷新时用） */
export async function clearSteamCache() {
  steamState.games = []
  steamState.count = 0
  steamState.recent = {}
  steamState.profile = null
  steamState.ach = {}
  steamState.at = 0
  steamState.fp = ''
  steamState.error = ''
  setSteamCache([], 0, null)
  await idbSet(CACHE_KEY, null)
}
