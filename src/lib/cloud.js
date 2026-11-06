// ===== 自建云端同步（本地优先 + 断网可用） =====
// 设计原则：
//   1. 离线优先：所有数据仍然先写 localStorage，云端只是「异步镜像」，任何网络失败都不阻塞本地使用；
//   2. 冲突解决：实体级按 id 合并（复用 webdav.js 的 mergeBackup 语义：入站侧覆盖、本地独有保留），
//      画布按节点 id + updatedAt 做 LWW，并用服务端 rev 做乐观并发控制（409 时合并重试一次）；
//   3. 凭证只在浏览器内存/localStorage 存 token，第三方 client secret 永远留在服务端。
import { mergeBackup } from './webdav.js'
import { SPACE_STORAGE_KEY } from '../space/core/workspace.js'

const CFG_KEY = 'eo_cloud_cfg_v1'
// 后端地址：本地开发连本地 Node 服务；线上走 CloudBase 的 HTTP 访问服务域名
// （静态托管域名只托管前端资源，/api 由 CloudBase「HTTP 访问服务」承接）。
const EO_CLOUD_BASE = 'https://earthonline-d6g4gdqln67ca31a0.service.tcloudbase.com'
function defaultBase() {
  if (typeof window === 'undefined') return 'http://localhost:8787'
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8787'
  if (h === 'earthonline-d6g4gdqln67ca31a0.service.tcloudbase.com') return window.location.origin
  return EO_CLOUD_BASE
}

export function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (raw) {
      const c = Object.assign({ baseUrl: defaultBase(), token: '', user: null, lastRev: 0, lastSyncAt: '' }, JSON.parse(raw))
      // 换设备/换域名后，旧的 localhost 地址自动失效，回落到同域
      if (/localhost|127\.0\.0\.1/.test(c.baseUrl) && !/localhost|127\.0\.0\.1/.test(String(window.location.hostname))) c.baseUrl = defaultBase()
      return c
    }
  } catch (e) {}
  return { baseUrl: defaultBase(), token: '', user: null, lastRev: 0, lastSyncAt: '' }
}
export function saveCloudConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {}
}
function baseOf(cfg) { return String(cfg.baseUrl || defaultBase()).replace(/\/+$/, '') }

async function api(cfg, method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token
  let res
  try {
    res = await fetch(baseOf(cfg) + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (e) {
    return { ok: false, status: 0, error: '无法连接同步服务（离线或服务未启动）' }
  }
  let data = null
  try { data = await res.json() } catch (e) { data = null }
  if (!res.ok) return { ok: false, status: res.status, error: (data && data.error) || ('HTTP ' + res.status), data }
  return { ok: true, status: res.status, ...(data || {}) }
}

export async function cloudHealth(cfg) {
  const c = cfg || loadCloudConfig()
  const r = await api(c, 'GET', '/api/health')
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export async function cloudRegister(cfg, email, password) {
  const r = await api(cfg, 'POST', '/api/auth/register', { email, password })
  if (!r.ok) return r
  // 注册成功 = 已发出验证码，账号尚未激活；界面需要引导用户输入验证码。
  return { ok: true, needVerify: true, email, debugCode: r.debugCode || '' }
}

export async function cloudSendCode(cfg, email, purpose) {
  return api(cfg, 'POST', '/api/auth/send-code', { email, purpose: purpose || 'register' })
}

export async function cloudVerifyEmail(cfg, email, code) {
  const r = await api(cfg, 'POST', '/api/auth/verify', { email, code })
  if (!r.ok) return r
  const next = Object.assign({}, cfg, { token: r.token, user: r.user, lastRev: 0, lastSyncAt: '' })
  saveCloudConfig(next)
  return { ok: true, user: r.user }
}

export async function cloudResetPassword(cfg, email, code, password) {
  return api(cfg, 'POST', '/api/auth/reset', { email, code, password })
}

export async function cloudLogin(cfg, email, password) {
  const r = await api(cfg, 'POST', '/api/auth/login', { email, password })
  if (!r.ok) return r
  const next = Object.assign({}, cfg, { token: r.token, user: r.user, lastRev: 0, lastSyncAt: '' })
  saveCloudConfig(next)
  return { ok: true, user: r.user }
}

export async function cloudLogout(cfg) {
  if (cfg.token) await api(cfg, 'POST', '/api/auth/logout').catch(() => null)
  const next = Object.assign({}, cfg, { token: '', user: null, lastRev: 0, lastSyncAt: '' })
  saveCloudConfig(next)
  return { ok: true }
}

// ---------- 画布状态：按节点 id + updatedAt 做 LWW 合并 ----------
function readSpaceRaw() {
  try {
    const raw = localStorage.getItem(SPACE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}
function writeSpaceRaw(obj) {
  try { localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(obj)) } catch (e) {}
}
function lwwList(localArr, remoteArr) {
  const map = new Map()
  ;(localArr || []).forEach((x) => { if (x && x.id) map.set(x.id, x) })
  ;(remoteArr || []).forEach((x) => {
    if (!x || !x.id) return
    const cur = map.get(x.id)
    if (!cur) { map.set(x.id, x); return }
    const lt = cur.updatedAt || 0
    const rt = x.updatedAt || 0
    if (rt >= lt) map.set(x.id, x)
  })
  return Array.from(map.values())
}
export function mergeSpace(local, remote) {
  if (!local) return remote || null
  if (!remote) return local
  const out = Object.assign({}, local)
  out.nodes = lwwList(local.nodes, remote.nodes)
  out.edges = lwwList(local.edges, remote.edges)
  out.drawings = lwwList(local.drawings, remote.drawings)
  const spaces = Object.assign({}, remote.spaces || {})
  Object.keys(local.spaces || {}).forEach((k) => {
    const l = local.spaces[k]
    const r = spaces[k]
    if (!r) { spaces[k] = l; return }
    if ((l.updatedAt || 0) > (r.updatedAt || 0)) spaces[k] = l
  })
  out.spaces = spaces
  const groups = Object.assign({}, remote.groups || {})
  Object.keys(local.groups || {}).forEach((k) => {
    const l = local.groups[k]
    const r = groups[k]
    if (!r) { groups[k] = l; return }
    if ((l.updatedAt || 0) > (r.updatedAt || 0)) groups[k] = l
  })
  out.groups = groups
  out.settings = Object.assign({}, remote.settings || {}, local.settings || {})
  out.currentId = local.currentId || remote.currentId || 'root'
  return out
}

/**
 * 立即同步：拉取 → 合并（数据 + 画布）→ 写本地 → 推送。
 * 任何一步失败都不影响本地数据，返回 ok:false 由 UI 提示。
 */
export async function cloudSyncNow(store, cfgArg) {
  const cfg = loadCloudConfig()
  if (!cfg.token) return { ok: false, error: '请先登录' }
  const pull = await api(cfg, 'GET', '/api/sync')
  if (!pull.ok) return { ok: false, error: pull.error }

  const remote = pull.data && typeof pull.data === 'object' ? pull.data : {}
  const remoteApp = remote.app || remote
  const remoteSpace = remote.space || null

  // 1) 合并应用数据（复用 WebDAV 的实体级合并语义）
  const { patch } = mergeBackup(store.data, remoteApp || {})
  Object.keys(patch).forEach((k) => { store.data[k] = patch[k] })
  store.persist()

  // 2) 合并画布
  const localSpace = readSpaceRaw()
  const merged = mergeSpace(localSpace, remoteSpace)
  if (merged) writeSpaceRaw(merged)

  // 3) 推送合并结果（带乐观并发：409 时再合并一次并重试）
  const payload = () => ({
    baseRev: cfg.lastRev || 0,
    updatedAt: new Date().toISOString(),
    data: { app: store.data, space: readSpaceRaw() }
  })
  let put = await api(cfg, 'PUT', '/api/sync', Object.assign(payload(), { baseRev: pull.rev }))
  if (put.status === 409 && put.data) {
    const serverData = put.data.data || {}
    const { patch: p2 } = mergeBackup(store.data, serverData.app || {})
    Object.keys(p2).forEach((k) => { store.data[k] = p2[k] })
    store.persist()
    const mergedSpace = mergeSpace(readSpaceRaw(), serverData.space || null)
    if (mergedSpace) writeSpaceRaw(mergedSpace)
    put = await api(cfg, 'PUT', '/api/sync', Object.assign(payload(), { baseRev: put.data.rev }))
  }
  if (!put.ok) return { ok: false, error: put.error }
  const next = Object.assign({}, cfg, { lastRev: put.rev, lastSyncAt: new Date().toISOString() })
  saveCloudConfig(next)
  return { ok: true, rev: put.rev }
}

// 登录后自动同步：页面回到前台或每 10 分钟一次（失败静默，不影响离线使用）
export function initCloudAutoSync(store) {
  if (typeof window === 'undefined') return
  let timer = null
  const run = () => {
    const cfg = loadCloudConfig()
    if (!cfg.token) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    cloudSyncNow(store).catch(() => null)
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run() })
  window.addEventListener('online', run)
  if (!timer) timer = setInterval(run, 10 * 60 * 1000)
}
