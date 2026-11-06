// 全量数据加密封装：Web Crypto AES-GCM（PBKDF2 派生密钥），零依赖。
// 用于「一键打包导出 / 导入」加密 JSON。
function b64(u8) { return btoa(String.fromCharCode.apply(null, u8)) }
function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) }

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptJson(obj, pass) {
  const enc = new TextEncoder()
  const data = enc.encode(JSON.stringify(obj))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(pass, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return JSON.stringify({ v: 1, k: 'AES-GCM', salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) })
}

export async function decryptJson(text, pass) {
  const o = JSON.parse(text)
  if (!o || o.k !== 'AES-GCM') throw new Error('格式不支持')
  const salt = unb64(o.salt)
  const iv = unb64(o.iv)
  const ct = unb64(o.ct)
  const key = await deriveKey(pass, salt)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt))
}
