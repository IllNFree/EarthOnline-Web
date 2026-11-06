// 本地桩测试：用内存假 DB 跑通 handler 的全部路由 + 持久化读写逻辑。
// 运行：在 cloudbase/functions/api 里执行 npm install，然后 node ../../test-runner.mjs
import assert from 'node:assert/strict'
import handlerModule from './functions/api/handler.js'

const { ensureCollections, createStore, createHandler } = handlerModule

// ===== 内存假 DB：模拟 @cloudbase/node-sdk 用到的 collection/where/limit/get/add/update/remove/doc =====
function applyPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && value.__delete === true) delete target[key]
    else target[key] = value
  }
}

class FakeDB {
  constructor() {
    this.collections = new Map()
    this.seq = 0
    this.command = { remove: () => ({ __delete: true }) }
  }

  async createCollection(name) {
    if (this.collections.has(name)) throw new Error('collection already exists')
    this.collections.set(name, new Map())
    return { ok: true }
  }

  collection(name) {
    if (!this.collections.has(name)) throw new Error('collection not exists')
    const rows = this.collections.get(name)

    const query = (cond = null, max = null) => {
      const select = () => {
        let list = Array.from(rows.values())
        if (cond) list = list.filter((doc) => Object.keys(cond).every((key) => doc[key] === cond[key]))
        if (max !== null) list = list.slice(0, max)
        return list
      }
      return {
        where: (next) => query(next, max),
        limit: (n) => query(cond, n),
        get: async () => ({ data: select().map((doc) => ({ ...doc })) }),
        count: async () => ({ total: select().length }),
        update: async (patch) => {
          const list = select()
          for (const doc of list) applyPatch(doc, patch)
          return { updated: list.length }
        },
        remove: async () => {
          const list = select()
          for (const doc of list) rows.delete(doc._id)
          return { deleted: list.length }
        },
        add: async (input) => {
          const _id = input._id === undefined ? `doc_${String(++this.seq).padStart(6, '0')}` : String(input._id)
          if (rows.has(_id)) throw new Error('duplicate _id')
          rows.set(_id, { ...input, _id })
          return { id: _id }
        }
      }
    }

    const api = query()
    api.doc = (id) => {
      const _id = String(id)
      return {
        get: async () => ({ data: rows.has(_id) ? [{ ...rows.get(_id) }] : [] }),
        set: async (input) => {
          rows.set(_id, { ...input, _id })
          return { updated: 1 }
        },
        update: async (patch) => {
          if (!rows.has(_id)) return { updated: 0 }
          applyPatch(rows.get(_id), patch)
          return { updated: 1 }
        },
        remove: async () => {
          const existed = rows.has(_id)
          rows.delete(_id)
          return { deleted: existed ? 1 : 0 }
        }
      }
    }
    return api
  }

  docs(name) {
    return Array.from(this.collections.get(name)?.values() || []).map((doc) => ({ ...doc }))
  }

  setDoc(name, id, doc) {
    this.collections.get(name).set(String(id), { ...doc, _id: String(id) })
  }

  removeDoc(name, id) {
    this.collections.get(name).delete(String(id))
  }

  size(name) {
    return this.collections.get(name)?.size || 0
  }
}

// ===== 请求构造 =====
let ipSeq = 0
function nextIp() {
  ipSeq = (ipSeq % 200) + 1
  return `10.0.${Math.floor(ipSeq / 250)}.${ipSeq}`
}

function makeEvent(method, path, opts = {}) {
  const headers = {
    host: 'eo-test.example.com',
    origin: opts.origin || 'https://eo-test.example.com',
    'x-forwarded-for': opts.ip || nextIp(),
    ...(opts.headers || {})
  }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const event = {
    path,
    httpMethod: method,
    headers,
    isBase64Encoded: false,
    queryStringParameters: opts.query || {}
  }
  if (opts.body !== undefined) {
    event.body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  return event
}

async function call(handler, method, path, opts = {}) {
  const response = await handler(makeEvent(method, path, opts))
  let body = null
  if (response.body) {
    try {
      body = JSON.parse(response.body)
    } catch {
      body = null
    }
  }
  return { status: response.statusCode, headers: response.headers, body, raw: response.body }
}

// ===== 测试执行器 =====
const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.error(`  FAIL  ${name}\n        ${err.message}`)
  }
}

const env = {
  EO_MASTER_KEY: 'eo-cloudbase-test-master-key-0123456789',
  ALLOWED_ORIGIN: 'https://front.example.com'
}
const db = new FakeDB()

await ensureCollections(db)
await ensureCollections(db) // 第二次：验证集合已存在时能兜底（并发首次创建路径）

const store = createStore(db)
const handler = createHandler({
  store,
  env,
  logger: { warn: () => {}, error: (...args) => console.error('[handler]', ...args) }
})

const email = 'tester@example.com'
const password = 'password1234'
let token = ''
let uid = ''

// ===== 1. 集合初始化（健康检查 / 基础能力） =====
await check('集合自动创建且重复调用不报错（users/snapshots/oauth_tokens/revoked）', () => {
  for (const name of ['users', 'snapshots', 'oauth_tokens', 'revoked']) {
    assert.ok(db.collections.has(name), `缺少集合 ${name}`)
  }
})

await check('GET /api/health → 200 {ok:true,time}', async () => {
  const r = await call(handler, 'GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(typeof r.body.time, 'string')
})

await check('OPTIONS 预检 → 204 + CORS 同域放行', async () => {
  const r = await call(handler, 'OPTIONS', '/api/sync')
  assert.equal(r.status, 204)
  assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://eo-test.example.com')
  assert.equal(r.headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, DELETE, OPTIONS')
})

await check('未知路由 → 404 {error}', async () => {
  const r = await call(handler, 'GET', '/api/unknown')
  assert.equal(r.status, 404)
  assert.equal(r.body.error, '接口不存在')
})

// ===== 2. 注册 / 登录 =====
await check('POST /api/auth/register 非法邮箱 → 400', async () => {
  const r = await call(handler, 'POST', '/api/auth/register', { body: { email: 'not-an-email', password } })
  assert.equal(r.status, 400)
})

await check('POST /api/auth/register 密码 <8 位 → 400', async () => {
  const r = await call(handler, 'POST', '/api/auth/register', { body: { email, password: 'short' } })
  assert.equal(r.status, 400)
})

await check('POST /api/auth/register 成功 → 201 {token,user}', async () => {
  const r = await call(handler, 'POST', '/api/auth/register', { body: { email, password } })
  assert.equal(r.status, 201)
  assert.equal(typeof r.body.token, 'string')
  assert.equal(r.body.token.split('.').length, 4)
  assert.equal(r.body.user.email, email)
  assert.match(r.body.user.id, /^[0-9a-f]{24}$/)
  assert.equal(typeof r.body.user.createdAt, 'string')
  token = r.body.token
  uid = r.body.user.id
})

await check('POST /api/auth/register 重复邮箱 → 409（数据库只留一条用户）', async () => {
  const r = await call(handler, 'POST', '/api/auth/register', { body: { email, password } })
  assert.equal(r.status, 409)
  assert.equal(db.size('users'), 1)
})

await check('POST /api/auth/login 成功 → 200 同结构', async () => {
  const r = await call(handler, 'POST', '/api/auth/login', { body: { email, password } })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.email, email)
  assert.equal(r.body.token.split('.').length, 4)
  token = r.body.token
})

await check('POST /api/auth/login 密码错误 → 401', async () => {
  const r = await call(handler, 'POST', '/api/auth/login', { body: { email, password: 'wrong-password' } })
  assert.equal(r.status, 401)
})

// ===== 3. /api/me =====
await check('GET /api/me（Bearer）→ 200 {user}', async () => {
  const r = await call(handler, 'GET', '/api/me', { token })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.email, email)
})

await check('GET /api/me 无 token → 401', async () => {
  const r = await call(handler, 'GET', '/api/me')
  assert.equal(r.status, 401)
  assert.equal(r.body.error, '未认证')
})

// ===== 4. 同步 rev 0 → 1 → 2 与 409 =====
const payloadV1 = { app: { tasks: [{ id: 't1', title: '第一版' }] }, space: { nodes: [] } }
const payloadV2 = { app: { tasks: [{ id: 't1', title: '第二版' }] }, space: { nodes: [{ id: 'n1' }] } }

await check('GET /api/sync 首次 → {rev:0, updatedAt:null, data:null}', async () => {
  const r = await call(handler, 'GET', '/api/sync', { token })
  assert.equal(r.status, 200)
  assert.equal(r.body.rev, 0)
  assert.equal(r.body.updatedAt, null)
  assert.equal(r.body.data, null)
})

await check('PUT /api/sync baseRev=0 → rev 1，data 以分片落库', async () => {
  const r = await call(handler, 'PUT', '/api/sync', {
    token,
    body: { baseRev: 0, data: payloadV1, updatedAt: '2026-01-01T00:00:00.000Z' }
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.rev, 1)
  assert.equal(r.body.updatedAt, '2026-01-01T00:00:00.000Z')

  const head = db.docs('snapshots').find((item) => item._id === uid)
  assert.ok(head, '快照头未落库')
  assert.equal(head.rev, 1)
  assert.equal(head.chunks, 1)
  assert.ok(!('data' in head), '头文档不应包含 data')
  const chunk = db.docs('snapshots').find((item) => item.uid === uid && item.rev === 1 && item.idx === 0)
  assert.ok(chunk, '分片未落库')
  assert.equal(JSON.parse(chunk.part).app.tasks[0].title, '第一版')
})

await check('GET /api/sync 读回 rev1（原样存取）', async () => {
  const r = await call(handler, 'GET', '/api/sync', { token })
  assert.equal(r.status, 200)
  assert.equal(r.body.rev, 1)
  assert.equal(r.body.updatedAt, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(r.body.data, payloadV1)
})

await check('PUT /api/sync baseRev=1 → rev 2', async () => {
  const r = await call(handler, 'PUT', '/api/sync', {
    token,
    body: { baseRev: 1, data: payloadV2, updatedAt: '2026-01-02T00:00:00.000Z' }
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.rev, 2)
  assert.equal(r.body.updatedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(db.docs('snapshots').find((item) => item._id === uid).rev, 2)
})

await check('PUT /api/sync 旧 baseRev=0 → 409 + 服务端 rev/data', async () => {
  const r = await call(handler, 'PUT', '/api/sync', {
    token,
    body: { baseRev: 0, data: { app: {}, space: {} }, updatedAt: '2026-01-03T00:00:00.000Z' }
  })
  assert.equal(r.status, 409)
  assert.equal(r.body.rev, 2)
  assert.deepEqual(r.body.data, payloadV2)
})

await check('PUT /api/sync 缺少 data → 400', async () => {
  const r = await call(handler, 'PUT', '/api/sync', { token, body: { baseRev: 2 } })
  assert.equal(r.status, 400)
})

// ===== 5. 登出与吊销 =====
await check('POST /api/auth/logout → {ok:true} 并写入 revoked', async () => {
  const r = await call(handler, 'POST', '/api/auth/logout', { token })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(db.size('revoked'), 1)
})

await check('登出后旧 token 调 /api/me → 401（吊销生效）', async () => {
  const r = await call(handler, 'GET', '/api/me', { token })
  assert.equal(r.status, 401)
})

// 重新登录拿新 token，供后续 OAuth 用例使用
await call(handler, 'POST', '/api/auth/login', { body: { email, password } }).then((r) => {
  token = r.body.token
})

// ===== 6. OAuth / proxy =====
await check('POST /api/oauth/github/start 未配置环境变量 → 501', async () => {
  const r = await call(handler, 'POST', '/api/oauth/github/start', {
    token,
    body: { redirectUri: 'https://eo-test.example.com/callback' }
  })
  assert.equal(r.status, 501)
})

await check('GET /api/oauth/status → {providers:{github:{connected:false}}}', async () => {
  const r = await call(handler, 'GET', '/api/oauth/status', { token })
  assert.equal(r.status, 200)
  assert.equal(r.body.providers.github.connected, false)
  assert.equal(r.body.providers.github.connectedAt, null)
})

await check('POST /api/proxy/github 无 token → 401', async () => {
  const r = await call(handler, 'POST', '/api/proxy/github', { body: { path: '/user', method: 'GET' } })
  assert.equal(r.status, 401)
})

await check('POST /api/proxy/github 已登录但未连接 → 401', async () => {
  const r = await call(handler, 'POST', '/api/proxy/github', {
    token,
    body: { path: '/user', method: 'GET' }
  })
  assert.equal(r.status, 401)
  assert.match(r.body.error, /未连接 GitHub/)
})

await check('存储层：oauth_tokens 落库后 status 变为已连接', async () => {
  await store.saveOAuthToken(uid, 'github', {
    enc: 'v1:test-ciphertext',
    connectedAt: '2026-02-01T00:00:00.000Z',
    scope: 'repo'
  })
  const record = await store.getOAuthToken(uid, 'github')
  assert.equal(record.connectedAt, '2026-02-01T00:00:00.000Z')

  const r = await call(handler, 'GET', '/api/oauth/status', { token })
  assert.equal(r.body.providers.github.connected, true)
  assert.equal(r.body.providers.github.connectedAt, '2026-02-01T00:00:00.000Z')
  assert.equal(db.size('oauth_tokens'), 1)
})

// ===== 7. /api/auth/* 限流 =====
await check('/api/auth/login 同 IP 超过 10 次/分钟 → 429', async () => {
  const ip = '203.0.113.77'
  for (let i = 0; i < 10; i += 1) {
    const r = await call(handler, 'POST', '/api/auth/login', { ip, body: { email: 'nobody@example.com', password: 'x'.repeat(9) } })
    assert.equal(r.status, 401)
  }
  const r = await call(handler, 'POST', '/api/auth/login', { ip, body: { email: 'nobody@example.com', password: 'x'.repeat(9) } })
  assert.equal(r.status, 429)
})

// ===== 8. 分片快照（规避单文档体积上限） =====
const legacyPayload = { app: { tasks: [{ id: 'legacy' }] }, space: {} }

await check('旧单文档 data 兼容：GET 优先返回，下一次 PUT 自动迁移为分片', async () => {
  db.setDoc('snapshots', uid, { rev: 3, updatedAt: '2026-02-02T00:00:00.000Z', data: JSON.stringify(legacyPayload) })

  const got = await call(handler, 'GET', '/api/sync', { token })
  assert.equal(got.status, 200)
  assert.equal(got.body.rev, 3)
  assert.deepEqual(got.body.data, legacyPayload)

  const next = { app: { tasks: [{ id: 'legacy-2' }] }, space: {} }
  const put = await call(handler, 'PUT', '/api/sync', {
    token,
    body: { baseRev: 3, data: next, updatedAt: '2026-02-03T00:00:00.000Z' }
  })
  assert.equal(put.status, 200)
  assert.equal(put.body.rev, 4)

  const head = db.docs('snapshots').find((item) => item._id === uid)
  assert.ok(!('data' in head), '迁移后头文档不应残留 data')
  assert.equal(head.chunks, 1)

  const back = await call(handler, 'GET', '/api/sync', { token })
  assert.deepEqual(back.body.data, next)
})

const bigBlob = 'x'.repeat(2 * 1024 * 1024)
const bigPayload = { app: { blob: bigBlob }, space: {} }
let bigRev = 0

await check('大快照 ~2MB PUT 后 GET 完整还原（长度与内容一致）', async () => {
  const put = await call(handler, 'PUT', '/api/sync', {
    token,
    body: { baseRev: 4, data: bigPayload, updatedAt: '2026-03-01T00:00:00.000Z' }
  })
  assert.equal(put.status, 200)
  assert.equal(put.body.rev, 5)
  bigRev = put.body.rev

  const got = await call(handler, 'GET', '/api/sync', { token })
  assert.equal(got.status, 200)
  assert.equal(got.body.rev, 5)
  assert.equal(got.body.data.app.blob.length, bigBlob.length)
  assert.equal(got.body.data.app.blob, bigBlob)
})

await check('分片数量正确（2MB / 200KB ≈ 11 片）且头文档不含 data', () => {
  const head = db.docs('snapshots').find((item) => item._id === uid)
  const expectedChunks = Math.ceil(JSON.stringify(bigPayload).length / (200 * 1024))
  assert.ok(expectedChunks >= 11, `分片数偏少：${expectedChunks}`)
  assert.equal(head.rev, bigRev)
  assert.equal(head.chunks, expectedChunks)
  assert.equal(head.size, JSON.stringify(bigPayload).length)
  assert.ok(!('data' in head))

  const chunks = db.docs('snapshots').filter((item) => item.uid === uid && item.rev === bigRev)
  assert.equal(chunks.length, expectedChunks)
  for (const chunk of chunks) assert.ok(chunk.part.length <= 200 * 1024, `分片超限：${chunk.part.length}`)
  const joined = chunks.sort((a, b) => a.idx - b.idx).map((item) => item.part).join('')
  assert.equal(JSON.parse(joined).app.blob, bigBlob)
})

await check('模拟分片缺失 → 500 {error:"快照分片缺失"}，不返回半截', async () => {
  const chunks = db.docs('snapshots').filter((item) => item.uid === uid && item.rev === bigRev)
  db.removeDoc('snapshots', chunks[5]._id)

  const got = await call(handler, 'GET', '/api/sync', { token })
  assert.equal(got.status, 500)
  assert.equal(got.body.error, '快照分片缺失')
  assert.equal(got.body.data, undefined)
})

// ===== 汇总 =====
const passed = results.filter((item) => item.ok).length
const failed = results.length - passed
console.log('')
console.log(`===== 结果：${passed} 通过 / ${failed} 失败（共 ${results.length} 项） =====`)
if (failed) {
  for (const item of results.filter((entry) => !entry.ok)) console.error(`  - ${item.name}: ${item.error}`)
  process.exitCode = 1
} else {
  console.log('全部通过。')
}
