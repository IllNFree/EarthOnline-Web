#!/usr/bin/env node
// EarthOnline 零依赖账号 / 同步 / OAuth 网关。仅用 node 内置模块，可平移至 Cloudflare Workers。
// 启动：node server/server.mjs   端口默认 8787（PORT 覆盖）
import http from 'node:http'
import {
  ALLOWED_ORIGINS,
  DATA_DIR,
  MAX_SMALL_BODY_BYTES,
  MAX_SYNC_BODY_BYTES,
  MAX_SYNC_BYTES,
  PORT
} from './config.mjs'
import { HttpError } from './errors.mjs'
import * as auth from './auth.mjs'
import * as oauth from './oauth.mjs'
import * as store from './store.mjs'

const HOST = process.env.HOST || '127.0.0.1'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DUMMY_HASH = '00'.repeat(16) + ':' + '00'.repeat(64)

// ===== 响应 / CORS =====
function corsHeaders(origin) {
  const headers = { Vary: 'Origin' }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function sendJson(res, status, payload, cors) {
  if (res.headersSent) return res.end()
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...cors,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt }
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// ===== 请求体 =====
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, '请求体过大'))
      if (!size) return resolve('')
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => reject(new HttpError(400, '读取请求体失败')))
  })
}

async function readJson(req, limit = MAX_SMALL_BODY_BYTES) {
  const raw = await readBody(req, limit)
  if (!raw) return {}
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

function requireAuth(req) {
  const header = String(req.headers.authorization || '')
  if (!header.startsWith('Bearer ')) throw new HttpError(401, '未认证')
  const token = header.slice(7).trim()
  if (!token) throw new HttpError(401, '未认证')
  const session = auth.verifySession(token)
  if (!session) throw new HttpError(401, '登录已失效，请重新登录')
  return session
}

// ===== 路由 =====
async function handle(req, res, cors) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const method = req.method || 'GET'
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path.startsWith('/api/auth/')) {
    auth.checkRateLimit(req.socket.remoteAddress || 'unknown')
  }

  if (method === 'GET' && path === '/api/health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() }, cors)
  }

  if (method === 'POST' && path === '/api/auth/register') {
    const body = await readJson(req)
    const email = normalizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
    if (password.length < 8) throw new HttpError(400, '密码至少 8 位')
    if (password.length > 512) throw new HttpError(400, '密码过长')
    const user = await store.createUser(email, await auth.hashPassword(password))
    if (!user) throw new HttpError(409, '该邮箱已注册')
    return sendJson(res, 201, { token: auth.issueSession(user.id), user: publicUser(user) }, cors)
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const body = await readJson(req)
    const email = normalizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) throw new HttpError(400, '缺少 email 或 password')
    const user = await store.findUserByEmail(email)
    // 用户不存在时也跑一次 scrypt，避免通过响应耗时枚举邮箱。
    const valid = await auth.verifyPassword(user ? user.passwordHash : DUMMY_HASH, password)
    if (!user || !valid) throw new HttpError(401, '邮箱或密码错误')
    return sendJson(res, 200, { token: auth.issueSession(user.id), user: publicUser(user) }, cors)
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const session = requireAuth(req)
    await auth.revokeSession(session.token)
    return sendJson(res, 200, { ok: true }, cors)
  }

  if (method === 'GET' && path === '/api/me') {
    const session = requireAuth(req)
    const user = await store.getUserById(session.uid)
    if (!user) throw new HttpError(401, '用户不存在')
    return sendJson(res, 200, { user: publicUser(user) }, cors)
  }

  if (path === '/api/sync') {
    const session = requireAuth(req)
    if (method === 'GET') {
      const snapshot = await store.getSnapshot(session.uid)
      return sendJson(res, 200, snapshot, cors)
    }
    if (method === 'PUT') {
      const body = await readJson(req, MAX_SYNC_BODY_BYTES)
      if (!Object.prototype.hasOwnProperty.call(body, 'data') || body.data === null) {
        throw new HttpError(400, '缺少 data')
      }
      if (typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw new HttpError(400, 'data 必须是 JSON 对象')
      }
      if (Buffer.byteLength(JSON.stringify(body.data)) > MAX_SYNC_BYTES) {
        throw new HttpError(413, 'data 超过 20MB 上限')
      }
      const result = await store.putSnapshot(session.uid, body.baseRev, body.data, body.updatedAt)
      if (result.conflict) {
        const snapshot = result.snapshot
        return sendJson(res, 409, { rev: snapshot.rev, updatedAt: snapshot.updatedAt, data: snapshot.data }, cors)
      }
      return sendJson(res, 200, { rev: result.rev, updatedAt: result.updatedAt }, cors)
    }
    throw new HttpError(405, '不支持的请求方法')
  }

  if (method === 'GET' && path === '/api/oauth/status') {
    const session = requireAuth(req)
    return sendJson(res, 200, await oauth.status(session.uid), cors)
  }

  const startMatch = /^\/api\/oauth\/([^/]+)\/start$/.exec(path)
  if (method === 'POST' && startMatch) {
    const session = requireAuth(req)
    const body = await readJson(req)
    return sendJson(res, 200, oauth.start(startMatch[1], session.uid, body), cors)
  }

  const callbackMatch = /^\/api\/oauth\/([^/]+)\/callback$/.exec(path)
  if (method === 'GET' && callbackMatch) {
    const location = await oauth.callback(callbackMatch[1], url.searchParams)
    res.writeHead(302, { ...cors, Location: location, 'Cache-Control': 'no-store' })
    return res.end()
  }

  const proxyMatch = /^\/api\/proxy\/([^/]+)$/.exec(path)
  if (method === 'POST' && proxyMatch && path.startsWith('/api/proxy/')) {
    const session = requireAuth(req)
    const body = await readJson(req, 1024 * 1024)
    const result = await oauth.proxy(proxyMatch[1], session.uid, body)
    return sendJson(res, result.status, result.payload, cors)
  }

  throw new HttpError(404, '接口不存在')
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    })
    return res.end()
  }

  handle(req, res, cors).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof HttpError ? err.message : '服务器内部错误'
    if (!(err instanceof HttpError)) console.error('[server] 未处理异常：', err && err.message)
    sendJson(res, status, { error: message }, cors)
  })
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[EarthOnline] 端口 ${PORT} 已被占用。请设置环境变量 PORT 换一个端口，例如：PORT=8788 node server/server.mjs`
    )
    process.exit(1)
  }
  console.error('[EarthOnline] 服务启动失败：', err && err.message)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  })
}

await store.ensureDataDir()
await auth.init()

server.listen(PORT, HOST, () => {
  console.log(`[EarthOnline] API 已启动 → http://${HOST}:${PORT}（健康检查：/api/health）`)
  console.log(`[EarthOnline] 数据目录：${DATA_DIR}`)
})
