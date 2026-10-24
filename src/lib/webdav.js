// ===== WebDAV 同步（云端备份还原，保持 fileMetaJson 契约） =====
// 说明：WebDAV 需要用户自有服务器（地址/账号/密码）。本模块实现基础 PUT/GET/PROPFIND。
import { serializeBackup, parseBackup } from './backup.js'
import { sanitizeState } from './model.js'

function client(cfg) {
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.user && cfg.pass) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(cfg.user + ':' + cfg.pass)))
  return headers
}
function joinUrl(base, path) {
  const b = base.replace(/\/+$/, '')
  const p = (path || '').replace(/^\/+/, '')
  return b + '/' + p
}
export async function testConnection(cfg) {
  try {
    const res = await fetch(joinUrl(cfg.url, ''), { method: 'PROPFIND', headers: client(cfg), body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' })
    if (res.status === 401 || res.status === 403) return { ok: false, error: '认证失败，请检查账号密码' }
    if (res.status === 405 || res.status === 207 || res.ok) return { ok: true }
    return { ok: res.ok, error: 'HTTP ' + res.status }
  } catch (e) { return { ok: false, error: e.message || '连接失败' } }
}
export async function pushBackup(cfg, state) {
  const body = serializeBackup(state)
  const res = await fetch(joinUrl(cfg.url, 'earth-online-web.json'), {
    method: 'PUT', headers: Object.assign(client(cfg), { 'Content-Type': 'application/json' }), body
  })
  if (!res.ok && res.status !== 201 && res.status !== 204) return { ok: false, error: '上传失败 HTTP ' + res.status }
  return { ok: true }
}
export async function pullBackup(cfg) {
  const res = await fetch(joinUrl(cfg.url, 'earth-online-web.json'), { method: 'GET', headers: client(cfg) })
  if (!res.ok) return { ok: false, error: '下载失败 HTTP ' + res.status, state: null }
  const text = await res.text()
  try { return { ok: true, state: sanitizeState(parseBackup(text)) } }
  catch (e) { return { ok: false, error: '解析失败：' + e.message, state: null } }
}
