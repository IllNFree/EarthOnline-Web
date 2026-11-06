// 认证与加密：scrypt 密码散列、HMAC 会话令牌、吊销集合、AES-256-GCM 密文、简单 IP 限流。
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './errors.mjs'
import * as store from './store.mjs'

const scrypt = promisify(scryptCallback)

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const SCRYPT_KEY_LEN = 64
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

let stateKey = null
let tokenKey = null
let cryptoKey = null
let revoked = new Map() // sha256(token) -> 过期毫秒
const rateBuckets = new Map() // ip -> { count, resetAt }

export async function init() {
  const master = createHash('sha256').update(await store.loadOrCreateSecret()).digest()
  tokenKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'eo/session-token', 32))
  stateKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'eo/oauth-state', 32))
  cryptoKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'eo/provider-token', 32))
  revoked = await store.loadRevoked()
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data).digest('hex')
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex')
    const bb = Buffer.from(String(b), 'hex')
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

// ===== 密码 =====
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(String(password), salt, SCRYPT_KEY_LEN, SCRYPT_OPTIONS)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(stored, password) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  if (!salt.length || !expected.length) return false
  try {
    const actual = await scrypt(String(password), salt, expected.length, SCRYPT_OPTIONS)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ===== 会话令牌：uid.exp.random.sig =====
export function issueSession(uid) {
  const exp = Date.now() + SESSION_TTL_MS
  const random = randomBytes(9).toString('base64url')
  const body = `${uid}.${exp}.${random}`
  return `${body}.${hmacHex(tokenKey, body)}`
}

export function verifySession(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [uid, expText, random, sig] = parts
  const exp = Number(expText)
  if (!uid || !random || !Number.isFinite(exp) || exp <= Date.now()) return null
  if (!safeEqualHex(sig, hmacHex(tokenKey, `${uid}.${expText}.${random}`))) return null
  if (revoked.has(hashToken(token))) return null
  return { uid, exp, token }
}

export async function revokeSession(token) {
  const exp = Number(token.split('.')[1])
  revoked.set(hashToken(token), Number.isFinite(exp) ? exp : Date.now() + SESSION_TTL_MS)
  await store.saveRevoked(revoked)
}

// ===== 限流（/api/auth/* 每 IP 每分钟 10 次） =====
export function checkRateLimit(ip) {
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateBuckets.set(ip, bucket)
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    throw new HttpError(429, '请求过于频繁，请稍后再试')
  }
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now >= value.resetAt) rateBuckets.delete(key)
    }
  }
}

// ===== provider token 加密（AES-256-GCM） =====
export function encryptSecret(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cryptoKey, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'v1:' + Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

export function decryptSecret(payload) {
  if (typeof payload !== 'string' || !payload.startsWith('v1:')) throw new Error('密文格式不合法')
  const raw = Buffer.from(payload.slice(3), 'base64url')
  if (raw.length < 28) throw new Error('密文长度不合法')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', cryptoKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// ===== OAuth state（HMAC 签名，含 userId / provider / 时间戳） =====
export function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${hmacHex(stateKey, body)}`
}

export function verifyOAuthState(state) {
  if (typeof state !== 'string') throw new HttpError(400, 'OAuth state 缺失')
  const parts = state.split('.')
  if (parts.length !== 2) throw new HttpError(400, 'OAuth state 格式不合法')
  const [body, sig] = parts
  if (!safeEqualHex(sig, hmacHex(stateKey, body))) throw new HttpError(400, 'OAuth state 校验失败')
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new HttpError(400, 'OAuth state 内容不合法')
  }
  const issuedAt = Number(payload && payload.t)
  if (!Number.isFinite(issuedAt)) throw new HttpError(400, 'OAuth state 内容不合法')
  if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) throw new HttpError(400, 'OAuth state 已过期')
  return payload
}
