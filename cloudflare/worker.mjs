// EarthOnline Cloudflare Workers 后端：账号 / 同步 / OAuth 网关。
// 零第三方依赖，路由手写，全部持久数据落 D1。与 server/ 的 Node 版 API 契约保持一致。
//
// 部署前必须配置的 secret：EO_MASTER_KEY（会话签名 / OAuth state / provider token 加密的根密钥）
// 可选变量：ALLOWED_ORIGIN（部署后的前端域名）、EO_PUBLIC_BASE_URL（OAuth 回调的对外地址）、
//           GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET（缺失时 OAuth start 返回 501）

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const MAX_SYNC_BYTES = 20 * 1024 * 1024
// 请求体硬上限，留出 JSON 外壳（baseRev / updatedAt / 引号）的余量，data 本体再精确校验 20MB。
const MAX_SYNC_BODY_BYTES = MAX_SYNC_BYTES + 1024 * 1024
const MAX_SMALL_BODY_BYTES = 64 * 1024
const PBKDF2_ITERATIONS = 100000
const PBKDF2_BYTES = 24
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 未配置 EO_MASTER_KEY 时的开发密钥：只能本地调试用，部署必须执行 wrangler secret put EO_MASTER_KEY。
const DEV_MASTER_KEY = 'eo-sync-dev-master-key-please-set-EO_MASTER_KEY'
const BASE_ORIGINS = [
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
]

const PROVIDERS = {
  github: {
    id: 'github',
    label: 'GitHub',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    apiBase: 'https://api.github.com',
    scope: 'repo',
    accept: 'application/vnd.github+json'
  }
}

// ===== 错误 / 工具 =====
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const encoder = new TextEncoder()
function enc(value) {
  return encoder.encode(String(value))
}

function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** 恒定时间比较：长度不同直接 false（两侧都是本服务固定的摘要长度）。 */
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

function randomBytes(size) {
  return crypto.getRandomValues(new Uint8Array(size))
}

function hexId(size = 12) {
  const bytes = randomBytes(size)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

// ===== CORS =====
function allowedOrigins(env) {
  const set = new Set(BASE_ORIGINS)
  const extra = String((env && env.ALLOWED_ORIGIN) || '')
  extra
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .forEach((s) => set.add(s))
  return set
}

function corsHeaders(origin, env) {
  const headers = new Headers()
  headers.set('Vary', 'Origin')
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return headers
}

function sendJson(status, payload, cors) {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(payload), { status, headers })
}

// ===== 密钥派生（WebCrypto 不提供 scrypt / 直连 AES，统一用 HKDF-SHA256 派生） =====
const derivedCache = new Map()
const cryptoKeyCache = new Map()

function masterSecret(env) {
  const raw = String((env && env.EO_MASTER_KEY) || '').trim()
  return raw || DEV_MASTER_KEY
}

async function derivedBytes(env, label) {
  const cacheKey = `${masterSecret(env)}\u0000${label}`
  const cached = derivedCache.get(cacheKey)
  if (cached) return cached
  const promise = (async () => {
    const master = new Uint8Array(await crypto.subtle.digest('SHA-256', enc(masterSecret(env))))
    const ikm = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: enc('eo-sync/v1'), info: enc(label) },
      ikm,
      256
    )
    return new Uint8Array(bits)
  })()
  derivedCache.set(cacheKey, promise)
  return promise
}

async function hmacKey(env, label) {
  const cacheKey = `hmac\u0000${label}\u0000${masterSecret(env)}`
  const cached = cryptoKeyCache.get(cacheKey)
  if (cached) return cached
  const bytes = await derivedBytes(env, label)
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  cryptoKeyCache.set(cacheKey, key)
  return key
}

async function aesKey(env) {
  const cacheKey = `aes\u0000${masterSecret(env)}`
  const cached = cryptoKeyCache.get(cacheKey)
  if (cached) return cached
  const bytes = await derivedBytes(env, 'eo/provider-token')
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  cryptoKeyCache.set(cacheKey, key)
  return key
}

async function hmacBytes(key, message) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(message)))
}

// ===== 密码：PBKDF2-SHA256 / 10 万次 / 16B salt / 24B 派生，存 base64url(salt):base64url(hash) =====
const DUMMY_HASH = `${b64url(new Uint8Array(16))}:${b64url(new Uint8Array(PBKDF2_BYTES))}`

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    PBKDF2_BYTES * 8
  )
  return new Uint8Array(bits)
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  return `${b64url(salt)}:${b64url(await pbkdf2(String(password), salt))}`
}

async function verifyPassword(stored, password) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false
  const [saltText, hashText] = stored.split(':')
  if (!saltText || !hashText) return false
  let salt
  let expected
  try {
    salt = fromB64url(saltText)
    expected = fromB64url(hashText)
  } catch {
    return false
  }
  if (!salt.length || !expected.length) return false
  try {
    return safeEqual(await pbkdf2(String(password), salt), expected)
  } catch {
    return false
  }
}

// ===== 会话令牌：uid.exp.jti.sig（HMAC-SHA256 + base64url），吊销写 D1 =====
async function issueSession(env, uid) {
  const exp = Date.now() + SESSION_TTL_MS
  const jti = b64url(randomBytes(12))
  const body = `${uid}.${exp}.${jti}`
  const sig = b64url(await hmacBytes(await hmacKey(env, 'eo/session-token'), body))
  return `${body}.${sig}`
}

/** 校验签名、过期时间，并查一次吊销表；失败返回 null。 */
async function verifySession(env, token) {
  if (typeof token !== 'string' || !token) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [uid, expText, jti, sig] = parts
  const exp = Number(expText)
  if (!uid || !jti || !Number.isFinite(exp) || exp <= Date.now()) return null
  let actual
  try {
    actual = fromB64url(sig)
  } catch {
    return null
  }
  const expected = await hmacBytes(await hmacKey(env, 'eo/session-token'), `${uid}.${expText}.${jti}`)
  if (!safeEqual(actual, expected)) return null
  const revoked = await env.DB.prepare('SELECT jti FROM revoked WHERE jti = ?').bind(jti).first()
  if (revoked) return null
  return { uid, exp, jti, token }
}

async function revokeSession(env, session) {
  await env.DB.prepare('INSERT OR REPLACE INTO revoked (jti, exp) VALUES (?, ?)')
    .bind(session.jti, session.exp)
    .run()
  await env.DB.prepare('DELETE FROM revoked WHERE exp < ?').bind(Date.now()).run()
}

async function requireAuth(request, env) {
  const header = String(request.headers.get('authorization') || '')
  if (!header.startsWith('Bearer ')) throw new HttpError(401, '未认证')
  const token = header.slice(7).trim()
  if (!token) throw new HttpError(401, '未认证')
  const session = await verifySession(env, token)
  if (!session) throw new HttpError(401, '登录已失效，请重新登录')
  return session
}

// ===== 限流（每 IP 每分钟 10 次，仅 /api/auth/*，仅当前 Worker 实例内存，尽力而为） =====
const rateBuckets = new Map()

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function checkRateLimit(ip) {
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateBuckets.set(ip, bucket)
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) throw new HttpError(429, '请求过于频繁，请稍后再试')
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now >= value.resetAt) rateBuckets.delete(key)
    }
  }
}

// ===== 请求体 =====
async function readJson(request, limit = MAX_SMALL_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > limit) throw new HttpError(413, '请求体过大')
  const raw = await request.text()
  if (!raw) return {}
  if (enc(raw).length > limit) throw new HttpError(413, '请求体过大')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, '请求体必须是 JSON 对象')
  }
  return parsed
}

// ===== 用户 / 快照（D1） =====
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function publicUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at }
}

function isUniqueViolation(err) {
  return /unique|constraint/i.test(String((err && err.message) || ''))
}

async function createUser(env, email, passwordHash) {
  const id = hexId(12)
  const createdAt = new Date().toISOString()
  try {
    await env.DB.prepare('INSERT INTO users (id, email, pass, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, email, passwordHash, createdAt)
      .run()
  } catch (err) {
    // 并发注册撞车时靠 UNIQUE(email) 兜底，返回 null 由调用方转 409。
    if (isUniqueViolation(err)) return null
    throw err
  }
  return { id, email, created_at: createdAt }
}

async function getSnapshot(env, uid) {
  const row = await env.DB.prepare('SELECT rev, updated_at, data FROM snapshots WHERE user_id = ?').bind(uid).first()
  if (!row) return { rev: 0, updatedAt: null, data: null, exists: false }
  let data = null
  try {
    data = row.data === null || row.data === undefined ? null : JSON.parse(row.data)
  } catch {
    data = null
  }
  return {
    rev: Number(row.rev) || 0,
    updatedAt: row.updated_at || null,
    data,
    exists: true
  }
}

/**
 * 乐观并发：baseRev 必须与服务端 rev 相同才写入。
 * 写操作用 WHERE rev = baseRev 做条件更新，避免并发 PUT 互相覆盖。
 */
async function putSnapshot(env, uid, baseRev, data, updatedAt) {
  const current = await getSnapshot(env, uid)
  if (Number(baseRev) !== current.rev) return { conflict: true, snapshot: current }
  const rev = current.rev + 1
  const nextUpdatedAt = typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString()
  const json = JSON.stringify(data)
  if (current.exists) {
    const result = await env.DB.prepare(
      'UPDATE snapshots SET rev = ?, updated_at = ?, data = ? WHERE user_id = ? AND rev = ?'
    )
      .bind(rev, nextUpdatedAt, json, uid, current.rev)
      .run()
    const changes = result.meta && (result.meta.changes !== undefined ? result.meta.changes : result.meta.rows_written)
    if (changes !== 1) return { conflict: true, snapshot: await getSnapshot(env, uid) }
  } else {
    try {
      await env.DB.prepare('INSERT INTO snapshots (user_id, rev, updated_at, data) VALUES (?, ?, ?, ?)')
        .bind(uid, rev, nextUpdatedAt, json)
        .run()
    } catch (err) {
      if (isUniqueViolation(err)) return { conflict: true, snapshot: await getSnapshot(env, uid) }
      throw err
    }
  }
  return { conflict: false, rev, updatedAt: nextUpdatedAt }
}

// ===== Provider token 加密（AES-256-GCM，格式 v1:<base64url(iv|tag|ciphertext)>） =====
async function encryptSecret(env, plaintext) {
  const key = await aesKey(env)
  const iv = randomBytes(12)
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, enc(String(plaintext)))
  )
  return `v1:${b64url(new Uint8Array([...iv, ...sealed]))}`
}

async function decryptSecret(env, payload) {
  if (typeof payload !== 'string' || !payload.startsWith('v1:')) throw new Error('密文格式不合法')
  const raw = fromB64url(payload.slice(3))
  if (raw.length < 28) throw new Error('密文长度不合法')
  const iv = raw.subarray(0, 12)
  const sealed = raw.subarray(12)
  const key = await aesKey(env)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, sealed)
  return new TextDecoder().decode(plain)
}

// ===== OAuth state（HMAC 签名，含 uid / provider / redirectUri / 时间戳） =====
async function signOAuthState(env, payload) {
  const body = b64url(enc(JSON.stringify(payload)))
  return `${body}.${b64url(await hmacBytes(await hmacKey(env, 'eo/oauth-state'), body))}`
}

async function verifyOAuthState(env, state) {
  if (typeof state !== 'string' || !state) throw new HttpError(400, 'OAuth state 缺失')
  const parts = state.split('.')
  if (parts.length !== 2) throw new HttpError(400, 'OAuth state 格式不合法')
  const [body, sig] = parts
  let actual
  try {
    actual = fromB64url(sig)
  } catch {
    throw new HttpError(400, 'OAuth state 格式不合法')
  }
  const expected = await hmacBytes(await hmacKey(env, 'eo/oauth-state'), body)
  if (!safeEqual(actual, expected)) throw new HttpError(400, 'OAuth state 校验失败')
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)))
  } catch {
    throw new HttpError(400, 'OAuth state 内容不合法')
  }
  const issuedAt = Number(payload && payload.t)
  if (!Number.isFinite(issuedAt)) throw new HttpError(400, 'OAuth state 内容不合法')
  if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) throw new HttpError(400, 'OAuth state 已过期')
  return payload
}

// ===== OAuth provider =====
function getProvider(providerId) {
  const provider = PROVIDERS[String(providerId || '').toLowerCase()]
  if (!provider) throw new HttpError(404, '未知 provider')
  return provider
}

function credentialsOf(env, provider) {
  const clientId = String((env && env[provider.clientIdEnv]) || '').trim()
  const clientSecret = String((env && env[provider.clientSecretEnv]) || '').trim()
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) }
}

function assertConfigured(env, provider) {
  const { configured } = credentialsOf(env, provider)
  if (!configured) {
    throw new HttpError(
      501,
      `未配置 ${provider.label} OAuth（设置环境变量 ${provider.clientIdEnv} / ${provider.clientSecretEnv}）`
    )
  }
}

function publicBaseUrl(request, env) {
  const fromEnv = String((env && env.EO_PUBLIC_BASE_URL) || '').trim()
  return (fromEnv || new URL(request.url).origin).replace(/\/+$/, '')
}

function callbackUrlOf(request, env, provider) {
  return `${publicBaseUrl(request, env)}/api/oauth/${provider.id}/callback`
}

function assertAllowedRedirect(redirectUri, env) {
  if (typeof redirectUri !== 'string' || !redirectUri.trim()) throw new HttpError(400, '缺少 redirectUri')
  let url
  try {
    url = new URL(redirectUri.trim())
  } catch {
    throw new HttpError(400, 'redirectUri 不合法')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'redirectUri 不合法')
  if (!allowedOrigins(env).has(url.origin)) throw new HttpError(400, 'redirectUri 不在允许的回调域名列表内')
  return url.toString()
}

async function oauthStart(request, env, providerId, uid, body) {
  const provider = getProvider(providerId)
  assertConfigured(env, provider)
  const redirectUri = assertAllowedRedirect(body && body.redirectUri, env)
  const state = await signOAuthState(env, { u: uid, p: provider.id, r: redirectUri, t: Date.now() })
  const authorize = new URL(provider.authorizeUrl)
  authorize.searchParams.set('client_id', credentialsOf(env, provider).clientId)
  authorize.searchParams.set('redirect_uri', callbackUrlOf(request, env, provider))
  authorize.searchParams.set('scope', provider.scope)
  authorize.searchParams.set('state', state)
  return { url: authorize.toString() }
}

async function oauthCallback(request, env, providerId, searchParams) {
  const provider = getProvider(providerId)
  assertConfigured(env, provider)
  const state = searchParams.get('state')
  const code = searchParams.get('code')
  if (!state) throw new HttpError(400, '缺少 state')
  const payload = await verifyOAuthState(env, state)
  if (payload.p !== provider.id) throw new HttpError(400, 'OAuth state 与 provider 不匹配')
  if (!code) throw new HttpError(400, '缺少 code')

  const { clientId, clientSecret } = credentialsOf(env, provider)
  let tokenResponse
  try {
    tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'EarthOnline-Cloudflare'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrlOf(request, env, provider)
      }),
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    throw new HttpError(502, `${provider.label} token 交换请求失败`)
  }
  if (!tokenResponse.ok) {
    throw new HttpError(502, `${provider.label} token 交换失败（HTTP ${tokenResponse.status}）`)
  }

  let tokenData
  try {
    tokenData = await tokenResponse.json()
  } catch {
    throw new HttpError(502, `${provider.label} token 交换返回非 JSON`)
  }
  const accessToken = tokenData && tokenData.access_token
  if (!accessToken || typeof accessToken !== 'string') {
    throw new HttpError(502, `${provider.label} 授权失败（未获得 access_token）`)
  }

  await env.DB.prepare(
    `INSERT INTO oauth_tokens (user_id, provider, enc, connected_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET enc = excluded.enc, connected_at = excluded.connected_at`
  )
    .bind(payload.u, provider.id, await encryptSecret(env, accessToken), new Date().toISOString())
    .run()

  const target = new URL(payload.r)
  target.searchParams.set('connected', provider.id)
  return target.toString()
}

async function oauthProxy(env, providerId, uid, body) {
  const provider = getProvider(providerId)
  const record = await env.DB.prepare('SELECT enc FROM oauth_tokens WHERE user_id = ? AND provider = ?')
    .bind(uid, provider.id)
    .first()
  if (!record) throw new HttpError(401, `未连接 ${provider.label}`)

  let token
  try {
    token = await decryptSecret(env, record.enc)
  } catch {
    throw new HttpError(401, `未连接 ${provider.label}（本地凭据不可用，请重新授权）`)
  }

  const upstreamPath = typeof body.path === 'string' ? body.path : ''
  if (!upstreamPath.startsWith('/') || upstreamPath.startsWith('//') || upstreamPath.includes('..')) {
    throw new HttpError(400, 'path 必须是站内相对路径，例如 /user')
  }
  const method = String(body.method || 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new HttpError(400, '不支持的 method')

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: provider.accept,
    'User-Agent': 'EarthOnline-Cloudflare'
  }
  const init = { method, headers, signal: AbortSignal.timeout(20000) }
  if (body.body !== undefined && method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body.body)
  }

  let upstream
  try {
    upstream = await fetch(provider.apiBase + upstreamPath, init)
  } catch {
    throw new HttpError(502, `${provider.label} 上游请求失败`)
  }

  const text = await upstream.text()
  if (!text) return { status: upstream.status, payload: {} }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new HttpError(502, `${provider.label} 上游返回非 JSON 内容`)
  }
  return { status: upstream.status, payload }
}

async function oauthStatus(env, uid) {
  const providers = {}
  for (const id of Object.keys(PROVIDERS)) {
    const record = await env.DB.prepare(
      'SELECT connected_at FROM oauth_tokens WHERE user_id = ? AND provider = ?'
    )
      .bind(uid, id)
      .first()
    providers[id] = { connected: Boolean(record), connectedAt: record ? record.connected_at || null : null }
  }
  return { providers }
}

// ===== 路由 =====
async function route(request, env, cors) {
  const url = new URL(request.url)
  const method = request.method || 'GET'
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path.startsWith('/api/auth/')) checkRateLimit(clientIp(request))

  if (method === 'GET' && path === '/api/health') {
    return sendJson(200, { ok: true, time: new Date().toISOString() }, cors)
  }

  if (method === 'POST' && path === '/api/auth/register') {
    const body = await readJson(request)
    const email = normalizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
    if (password.length < 8) throw new HttpError(400, '密码至少 8 位')
    if (password.length > 512) throw new HttpError(400, '密码过长')
    const user = await createUser(env, email, await hashPassword(password))
    if (!user) throw new HttpError(409, '该邮箱已注册')
    return sendJson(201, { token: await issueSession(env, user.id), user: publicUser(user) }, cors)
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const body = await readJson(request)
    const email = normalizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) throw new HttpError(400, '缺少 email 或 password')
    const row = await env.DB.prepare('SELECT id, email, pass, created_at FROM users WHERE email = ?')
      .bind(email)
      .first()
    // 用户不存在时也跑一次 PBKDF2，避免通过响应耗时枚举邮箱。
    const valid = await verifyPassword(row ? row.pass : DUMMY_HASH, password)
    if (!row || !valid) throw new HttpError(401, '邮箱或密码错误')
    return sendJson(200, { token: await issueSession(env, row.id), user: publicUser(row) }, cors)
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const session = await requireAuth(request, env)
    await revokeSession(env, session)
    return sendJson(200, { ok: true }, cors)
  }

  if (method === 'GET' && path === '/api/me') {
    const session = await requireAuth(request, env)
    const row = await env.DB.prepare('SELECT id, email, created_at FROM users WHERE id = ?')
      .bind(session.uid)
      .first()
    if (!row) throw new HttpError(401, '用户不存在')
    return sendJson(200, { user: publicUser(row) }, cors)
  }

  if (path === '/api/sync') {
    const session = await requireAuth(request, env)
    if (method === 'GET') {
      const snapshot = await getSnapshot(env, session.uid)
      return sendJson(200, { rev: snapshot.rev, updatedAt: snapshot.updatedAt, data: snapshot.data }, cors)
    }
    if (method === 'PUT') {
      const body = await readJson(request, MAX_SYNC_BODY_BYTES)
      if (!Object.prototype.hasOwnProperty.call(body, 'data') || body.data === null) {
        throw new HttpError(400, '缺少 data')
      }
      if (typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw new HttpError(400, 'data 必须是 JSON 对象')
      }
      if (enc(JSON.stringify(body.data)).length > MAX_SYNC_BYTES) {
        throw new HttpError(413, 'data 超过 20MB 上限')
      }
      const result = await putSnapshot(env, session.uid, body.baseRev, body.data, body.updatedAt)
      if (result.conflict) {
        return sendJson(
          409,
          {
            rev: result.snapshot.rev,
            updatedAt: result.snapshot.updatedAt,
            data: result.snapshot.data
          },
          cors
        )
      }
      return sendJson(200, { rev: result.rev, updatedAt: result.updatedAt }, cors)
    }
    throw new HttpError(405, '不支持的请求方法')
  }

  if (method === 'GET' && path === '/api/oauth/status') {
    const session = await requireAuth(request, env)
    return sendJson(200, await oauthStatus(env, session.uid), cors)
  }

  const startMatch = /^\/api\/oauth\/([^/]+)\/start$/.exec(path)
  if (method === 'POST' && startMatch) {
    const session = await requireAuth(request, env)
    const body = await readJson(request)
    return sendJson(200, await oauthStart(request, env, startMatch[1], session.uid, body), cors)
  }

  const callbackMatch = /^\/api\/oauth\/([^/]+)\/callback$/.exec(path)
  if (method === 'GET' && callbackMatch) {
    const location = await oauthCallback(request, env, callbackMatch[1], url.searchParams)
    const headers = new Headers(cors)
    headers.set('Location', location)
    headers.set('Cache-Control', 'no-store')
    return new Response(null, { status: 302, headers })
  }

  const proxyMatch = /^\/api\/proxy\/([^/]+)$/.exec(path)
  if (method === 'POST' && proxyMatch) {
    const session = await requireAuth(request, env)
    const body = await readJson(request, 1024 * 1024)
    const result = await oauthProxy(env, proxyMatch[1], session.uid, body)
    return sendJson(result.status, result.payload, cors)
  }

  throw new HttpError(404, '接口不存在')
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') {
      const headers = new Headers(cors)
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      headers.set('Access-Control-Max-Age', '86400')
      return new Response(null, { status: 204, headers })
    }

    try {
      return await route(request, env, cors)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof HttpError ? err.message : '服务器内部错误'
      if (!(err instanceof HttpError)) console.error('[eo-sync] 未处理异常：', (err && err.message) || err)
      return sendJson(status, { error: message }, cors)
    }
  }
}
