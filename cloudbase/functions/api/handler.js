'use strict'

// EarthOnline 腾讯云 CloudBase 后端核心逻辑（手写路由，不依赖 express）。
// 与 ../server、../cloudflare 的 API 契约保持一致；本文件不引入 @cloudbase/node-sdk，
// 存储层通过 createStore(db) 适配，本地测试可传入内存假 DB。

const crypto = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(crypto.scrypt)

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// 邮箱验证码：10 分钟有效、每码最多试 5 次、同邮箱 60 秒限发一次、每小时最多 5 封。
const CODE_TTL_MS = 10 * 60 * 1000
const CODE_MAX_ATTEMPTS = 5
const CODE_RESEND_INTERVAL_MS = 60 * 1000
const CODE_HOURLY_MAX = 5
const MAX_SYNC_BYTES = 20 * 1024 * 1024
// 请求体硬上限，留出 JSON 外壳（baseRev / updatedAt / 引号）的余量，data 本体再精确校验 20MB。
const MAX_SYNC_BODY_BYTES = MAX_SYNC_BYTES + 1024 * 1024
const MAX_SMALL_BODY_BYTES = 64 * 1024
// 分片长度按字符串长度切，单份 ≤200KB，规避 CloudBase 单文档体积上限。
const CHUNK_CHARS = 200 * 1024
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const SCRYPT_KEY_LEN = 64
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEV_MASTER_KEY = 'eo-cloudbase-dev-master-key-please-set-EO_MASTER_KEY'

const COLLECTIONS = ['users', 'snapshots', 'oauth_tokens', 'revoked']
const BASE_ORIGINS = [
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
]
// 链接封面：8 秒超时、最多跟随 3 次重定向、响应体超过 3MB 直接中止、结果内存缓存 1 小时。
const COVER_TIMEOUT_MS = 8000
const COVER_MAX_REDIRECTS = 3
const COVER_MAX_BYTES = 3 * 1024 * 1024
const COVER_CACHE_TTL_MS = 60 * 60 * 1000
const COVER_CACHE_MAX = 200
// 封面抓取会发起出站请求：单 IP 每分钟 30 次（独立于登录限流桶）
const COVER_RATE_MAX = 30
const COVER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// ===== 第三方 OAuth（GitHub）=====
// client_secret 只读环境变量；上游 access_token 用 AES-256-GCM 加密落库，永不返回前端。
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const OAUTH_PROVIDERS = {
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
const OAUTH_PROXY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

// ===== 集合：不存在则尝试创建；创建失败不阻塞启动 =====
// CloudBase 对「写入不存在集合」会自动建集合，因此这里只做尽力而为的预创建，
// 任何失败（权限、SDK 版本差异、并发创建）都忽略，避免冷启动整体失败。
async function ensureCollections(db) {
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
    } catch (err) {
      // 已存在 / 无权限 / SDK 不支持，都直接跳过
    }
  }
}

// SDK 出错时有时返回 {code,message} 而不是抛异常，统一转成异常避免被误判成业务冲突。
function unwrap(res, action) {
  if (res && typeof res === 'object' && res.code) {
    throw new Error(`${action}失败：${res.message || res.code}`)
  }
  return res
}

// ===== 存储适配：只使用 CloudBase node-sdk 的 collection/where/get/add/update/remove 子集 =====
function createStore(db) {
  const collection = (name) => db.collection(name)

  const toUser = (doc) =>
    doc
      ? { id: doc.uid, email: doc.email, createdAt: doc.createdAt, passwordHash: doc.passwordHash }
      : null

  async function findUserByEmail(email) {
    const res = unwrap(await collection('users').where({ email }).limit(1).get(), '查询用户')
    return toUser((res && res.data ? res.data : [])[0])
  }

  async function getUserById(uid) {
    const res = unwrap(await collection('users').where({ uid }).limit(1).get(), '查询用户')
    return toUser((res && res.data ? res.data : [])[0])
  }

  /**
   * 邮箱唯一：先查重再写入；并发注册时同 email 只保留 _id 最小的一条，
   * 自己没被保留就返回 null（调用方转 409）。
   */
  async function createUser(email, passwordHash) {
    const existing = await findUserByEmail(email)
    if (existing) return null

    const user = {
      uid: crypto.randomBytes(12).toString('hex'),
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    }
    const added = unwrap(await collection('users').add(user), '创建用户')
    const addedId = (added && (added.id || added._id)) || null
    const created = { id: user.uid, email: user.email, createdAt: user.createdAt, passwordHash: user.passwordHash }

    const res = unwrap(await collection('users').where({ email }).get(), '查询用户')
    const docs = (res && res.data) || []
    if (docs.length <= 1) return created

    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)))
    const keep = docs[0]
    const selfId = addedId || (docs.find((doc) => doc.uid === user.uid) || {})._id
    for (const doc of docs.slice(1)) {
      try {
        await collection('users').where({ _id: doc._id }).remove()
      } catch {
        // 清理失败不影响本次结果（下次注册还会再收敛一次）
      }
    }
    return keep && keep._id === selfId ? created : null
  }

  async function readHead(uid) {
    const res = unwrap(await collection('snapshots').where({ _id: uid }).limit(1).get(), '读取快照头')
    return (res && res.data ? res.data : [])[0] || null
  }

  async function readParts(uid, rev, count) {
    const res = unwrap(
      await collection('snapshots').where({ uid, rev }).limit(Math.min(count, 400)).get(),
      '读取快照分片'
    )
    const docs = (res && res.data) || []
    if (docs.length !== count) throw new HttpError(500, '快照分片缺失')
    const parts = new Array(count)
    for (const doc of docs) {
      const idx = Number(doc.idx)
      if (!Number.isInteger(idx) || idx < 0 || idx >= count || typeof doc.part !== 'string') {
        throw new HttpError(500, '快照分片缺失')
      }
      parts[idx] = doc.part
    }
    for (const part of parts) {
      if (typeof part !== 'string') throw new HttpError(500, '快照分片缺失')
    }
    return parts
  }

  /** 头文档是唯一提交点；旧版单文档里的 data 字段优先读取，下次 PUT 时迁移为分片。 */
  async function getSnapshot(uid) {
    const head = await readHead(uid)
    if (!head) return { rev: 0, updatedAt: null, data: null, exists: false }

    const rev = Number(head.rev) || 0
    const updatedAt = head.updatedAt || null
    if (head.data !== undefined && head.data !== null) {
      try {
        return { rev, updatedAt, data: JSON.parse(head.data), exists: true }
      } catch {
        throw new HttpError(500, '快照数据损坏')
      }
    }

    const count = Number(head.chunks) || 0
    if (!count) {
      if (!rev) return { rev: 0, updatedAt, data: null, exists: true }
      throw new HttpError(500, '快照分片缺失')
    }

    const parts = await readParts(uid, rev, count)
    try {
      return { rev, updatedAt, data: JSON.parse(parts.join('')), exists: true }
    } catch {
      throw new HttpError(500, '快照分片缺失')
    }
  }

  /**
   * 乐观并发：baseRev 必须与头文档 rev 相同才写入。
   * 先把新分片写到 "<uid>#<newRev>#<i>"（不覆盖旧 rev），全部成功后才更新头文档；
   * 头文档更新失败/冲突时清掉本次分片，绝不提交不完整数据。
   */
  async function putSnapshot(uid, baseRev, data, updatedAt) {
    const head = await readHead(uid)
    const currentRev = head ? Number(head.rev) || 0 : 0
    if (Number(baseRev) !== currentRev) return { conflict: true, snapshot: await getSnapshot(uid) }

    const rev = currentRev + 1
    const nextUpdatedAt = typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString()
    const json = typeof data === 'string' ? data : JSON.stringify(data)
    const chunks = json.length ? Math.ceil(json.length / CHUNK_CHARS) : 0

    try {
      for (let i = 0; i < chunks; i += 1) {
        const part = json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)
        unwrap(await collection('snapshots').doc(`${uid}#${rev}#${i}`).set({ uid, rev, idx: i, part }), '写入快照分片')
      }
    } catch (err) {
      try {
        await collection('snapshots').where({ uid, rev }).remove()
      } catch {
        // 清理失败不影响头文档指针
      }
      throw err
    }

    const meta = { rev, updatedAt: nextUpdatedAt, size: json.length, chunks, updated: Date.now() }
    if (head) {
      const res = unwrap(
        await collection('snapshots').where({ _id: uid, rev: currentRev }).update({ ...meta, data: db.command.remove() }),
        '提交快照'
      )
      const changes = Number(res && (res.updated !== undefined ? res.updated : res.modified)) || 0
      if (changes !== 1) {
        try {
          await collection('snapshots').where({ uid, rev }).remove()
        } catch {
          // 忽略清理失败
        }
        return { conflict: true, snapshot: await getSnapshot(uid) }
      }
    } else {
      unwrap(await collection('snapshots').doc(uid).set(meta), '创建快照头')
    }

    if (head && currentRev > 0) {
      try {
        await collection('snapshots').where({ uid, rev: currentRev }).remove()
      } catch {
        // 旧分片清理失败不影响已提交数据
      }
    }
    return { conflict: false, rev, updatedAt: nextUpdatedAt }
  }

  async function isRevoked(digest) {
    const res = unwrap(await collection('revoked').where({ digest }).limit(1).get(), '查询吊销记录')
    return Boolean(res && res.data && res.data.length)
  }

  async function revoke(digest, exp) {
    unwrap(await collection('revoked').add({ digest, exp: Number(exp) || 0 }), '写入吊销记录')
  }

  async function getOAuthToken(uid, provider) {
    const res = unwrap(await collection('oauth_tokens').where({ uid, provider }).limit(1).get(), '读取授权记录')
    const doc = (res && res.data ? res.data : [])[0]
    return doc
      ? { enc: doc.enc, connectedAt: doc.connectedAt || null, scope: doc.scope || '' }
      : null
  }

  async function saveOAuthToken(uid, provider, record) {
    const patch = {
      enc: record.enc,
      connectedAt: record.connectedAt || new Date().toISOString(),
      scope: record.scope || ''
    }
    const res = unwrap(await collection('oauth_tokens').where({ uid, provider }).update(patch), '更新授权记录')
    const changes = Number(res && (res.updated !== undefined ? res.updated : res.modified)) || 0
    if (changes > 0) return
    try {
      unwrap(await collection('oauth_tokens').add({ uid, provider, ...patch }), '创建授权记录')
    } catch {
      // 并发写入时补一次更新
      unwrap(await collection('oauth_tokens').where({ uid, provider }).update(patch), '更新授权记录')
    }
  }

  return {
    findUserByEmail,
    getUserById,
    createUser,
    getSnapshot,
    putSnapshot,
    isRevoked,
    revoke,
    getOAuthToken,
    saveOAuthToken
  }
}

// ===== PostgreSQL 适配器：CloudBase PG 环境的云函数通过协议直连（PGHOST/PGUSER/PGPASSWORD 由平台注入） =====
// 四张表：eo_users / eo_snapshots / eo_revoked / eo_oauth。首次调用自动建表。
async function createPgStore(pool) {
  async function ensureTables() {
    await pool.query(`
      create table if not exists eo_users (
        uid text primary key,
        email text unique not null,
        password_hash text not null,
        created_at timestamptz not null default now()
      );
      create table if not exists eo_snapshots (
        uid text primary key,
        rev integer not null default 0,
        updated_at timestamptz,
        data jsonb,
        updated bigint
      );
      create table if not exists eo_revoked (
        digest text primary key,
        exp bigint not null default 0
      );
      create table if not exists eo_oauth (
        uid text not null,
        provider text not null,
        enc text not null,
        connected_at timestamptz,
        scope text,
        primary key (uid, provider)
      );
    `)
  }

  const toUser = (row) =>
    row ? { id: row.uid, email: row.email, createdAt: row.created_at, passwordHash: row.password_hash } : null

  async function findUserByEmail(email) {
    const r = await pool.query('select uid, email, password_hash, created_at from eo_users where email = $1 limit 1', [email])
    return toUser(r.rows[0])
  }

  async function getUserById(uid) {
    const r = await pool.query('select uid, email, password_hash, created_at from eo_users where uid = $1 limit 1', [uid])
    return toUser(r.rows[0])
  }

  async function createUser(email, passwordHash) {
    const uid = crypto.randomBytes(12).toString('hex')
    try {
      const r = await pool.query(
        'insert into eo_users (uid, email, password_hash) values ($1, $2, $3) returning uid, email, created_at',
        [uid, email, passwordHash]
      )
      return { id: r.rows[0].uid, email: r.rows[0].email, createdAt: r.rows[0].created_at, passwordHash }
    } catch (err) {
      if (err && err.code === '23505') return null
      throw err
    }
  }

  async function getSnapshot(uid) {
    const r = await pool.query('select rev, updated_at, data from eo_snapshots where uid = $1 limit 1', [uid])
    const row = r.rows[0]
    if (!row) return { rev: 0, updatedAt: null, data: null, exists: false }
    return { rev: Number(row.rev) || 0, updatedAt: row.updated_at ? row.updated_at.toISOString() : null, data: row.data ?? null, exists: true }
  }

  async function putSnapshot(uid, baseRev, data, updatedAt) {
    const nextUpdatedAt = typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString()
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    if (Number(baseRev) === 0) {
      const r = await pool.query(
        `insert into eo_snapshots (uid, rev, updated_at, data, updated)
         values ($1, 1, $2, $3::jsonb, $4)
         on conflict (uid) do nothing
         returning rev`,
        [uid, nextUpdatedAt, JSON.stringify(parsed), Date.now()]
      )
      if (!r.rowCount) return { conflict: true, snapshot: await getSnapshot(uid) }
      return { conflict: false, rev: 1, updatedAt: nextUpdatedAt }
    }
    const r = await pool.query(
      `update eo_snapshots set rev = rev + 1, updated_at = $3, data = $4::jsonb, updated = $5
       where uid = $1 and rev = $2
       returning rev`,
      [uid, Number(baseRev), nextUpdatedAt, JSON.stringify(parsed), Date.now()]
    )
    if (!r.rowCount) return { conflict: true, snapshot: await getSnapshot(uid) }
    return { conflict: false, rev: Number(r.rows[0].rev), updatedAt: nextUpdatedAt }
  }

  async function isRevoked(digest) {
    const r = await pool.query('select 1 from eo_revoked where digest = $1 limit 1', [digest])
    return r.rowCount > 0
  }

  async function revoke(digest, exp) {
    await pool.query(
      'insert into eo_revoked (digest, exp) values ($1, $2) on conflict (digest) do update set exp = excluded.exp',
      [digest, Number(exp) || 0]
    )
  }

  async function markVerified(uid) {
    throw new Error('pg 适配器已停用')
  }

  async function updatePassword(uid, passwordHash) {
    await pool.query('update eo_users set password_hash = $2 where uid = $1', [uid, passwordHash])
  }

  async function bumpTokenVersion(uid) {
    const r = await pool.query('update eo_users set tok_ver = tok_ver + 1 where uid = $1 returning tok_ver', [uid])
    return r.rowCount ? Number(r.rows[0].tok_ver) : 0
  }

  async function insertCode() {
    throw new Error('pg 适配器已停用')
  }

  async function latestCode() {
    throw new Error('pg 适配器已停用')
  }

  async function recentCodeCount() {
    throw new Error('pg 适配器已停用')
  }

  async function markCodeUsed() {
    throw new Error('pg 适配器已停用')
  }

  async function setCodeAttempts() {
    throw new Error('pg 适配器已停用')
  }

  await ensureTables()
  return {
    findUserByEmail,
    getUserById,
    createUser,
    getSnapshot,
    putSnapshot,
    isRevoked,
    revoke,
    markVerified,
    updatePassword,
    bumpTokenVersion,
    insertCode,
    latestCode,
    recentCodeCount,
    markCodeUsed,
    setCodeAttempts
  }
}

// ===== PostgreSQL(RDB) 适配器：走 CloudBase 内网 OpenAPI 的 PostgREST 网关 =====
// app.rdb() 返回 PostgREST 客户端（HTTP 到 /v1/rdb/rest），不需要数据库公网地址/密码，
// 也不需要 VPC；权限由云函数运行时凭证控制。四张表由 oneoff SQL 预先建好。
function createRdbStore(app) {
  const client = app.rdb()

  async function run(builder, action) {
    let res
    try {
      res = await builder
    } catch (err) {
      throw new Error(`${action}失败：${(err && err.message) || err}`)
    }
    if (res && res.error) {
      const e = new Error(`${action}失败：${res.error.message || JSON.stringify(res.error)}`)
      e.code = res.error.code
      e.details = res.error.details
      throw e
    }
    return res
  }

  const toUser = (row) =>
    row
      ? {
          id: row.uid,
          email: row.email,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          passwordHash: row.password_hash,
          emailVerified: Boolean(row.email_verified),
          tokVer: Number(row.tok_ver) || 0
        }
      : null

  const isDuplicate = (err) => {
    const code = String((err && err.code) || '')
    return code === '23505' || /2350[1-9]$/.test(code)
  }

  const USER_COLUMNS = 'uid,email,password_hash,created_at,email_verified,tok_ver'

  async function findUserByEmail(email) {
    const res = await run(
      client.from('eo_users').select(USER_COLUMNS).eq('email', email).limit(1),
      '查询用户'
    )
    return toUser((res.data || [])[0])
  }

  async function getUserById(uid) {
    const res = await run(
      client.from('eo_users').select(USER_COLUMNS).eq('uid', uid).limit(1),
      '查询用户'
    )
    return toUser((res.data || [])[0])
  }

  async function createUser(email, passwordHash) {
    const uid = crypto.randomBytes(12).toString('hex')
    try {
      const res = await run(
        client.from('eo_users').insert([{ uid, email, password_hash: passwordHash }]).select('uid,email,created_at'),
        '创建用户'
      )
      const row = (res.data || [])[0]
      return row
        ? {
            id: row.uid,
            email: row.email,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
            passwordHash,
            emailVerified: false,
            tokVer: 0
          }
        : null
    } catch (err) {
      if (isDuplicate(err)) return null
      throw err
    }
  }

  async function getSnapshot(uid) {
    const res = await run(
      client.from('eo_snapshots').select('rev,updated_at,data').eq('uid', uid).limit(1),
      '读取快照'
    )
    const row = (res.data || [])[0]
    if (!row) return { rev: 0, updatedAt: null, data: null, exists: false }
    let data = null
    if (row.data !== null && row.data !== undefined) {
      try {
        data = JSON.parse(row.data)
      } catch {
        throw new HttpError(500, '快照数据损坏')
      }
    }
    return {
      rev: Number(row.rev) || 0,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      data,
      exists: true
    }
  }

  async function putSnapshot(uid, baseRev, data, updatedAt) {
    const nextUpdatedAt = typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString()
    const json = typeof data === 'string' ? data : JSON.stringify(data)
    const rev = Number(baseRev) + 1

    if (Number(baseRev) === 0) {
      try {
        await run(
          client
            .from('eo_snapshots')
            .insert([{ uid, rev: 1, updated_at: nextUpdatedAt, data: json, updated: Date.now() }])
            .select('rev'),
          '创建快照'
        )
      } catch (err) {
        if (isDuplicate(err)) return { conflict: true, snapshot: await getSnapshot(uid) }
        throw err
      }
      return { conflict: false, rev: 1, updatedAt: nextUpdatedAt }
    }

    const res = await run(
      client
        .from('eo_snapshots')
        .update({ rev, updated_at: nextUpdatedAt, data: json, updated: Date.now() })
        .eq('uid', uid)
        .eq('rev', Number(baseRev))
        .select('rev'),
      '更新快照'
    )
    if (!res.data || !res.data.length) return { conflict: true, snapshot: await getSnapshot(uid) }
    return { conflict: false, rev, updatedAt: nextUpdatedAt }
  }

  async function isRevoked(digest) {
    const res = await run(client.from('eo_revoked').select('digest').eq('digest', digest).limit(1), '查询吊销记录')
    return Boolean(res.data && res.data.length)
  }

  async function revoke(digest, exp) {
    await run(
      client.from('eo_revoked').upsert([{ digest, exp: Number(exp) || 0 }], { onConflict: 'digest' }).select('digest'),
      '写入吊销记录'
    )
  }

  async function markVerified(uid) {
    await run(
      client
        .from('eo_users')
        .update({ email_verified: true, verified_at: new Date().toISOString() })
        .eq('uid', uid)
        .select('uid'),
      '更新邮箱验证状态'
    )
  }

  async function updatePassword(uid, passwordHash) {
    await run(
      client.from('eo_users').update({ password_hash: passwordHash }).eq('uid', uid).select('uid'),
      '更新密码'
    )
  }

  /** 重置密码后递增会话版本号，使该账号已签发的所有旧 token 立即失效。 */
  async function bumpTokenVersion(uid) {
    const res = await run(client.from('eo_users').select('tok_ver').eq('uid', uid).limit(1), '读取会话版本')
    const row = (res.data || [])[0]
    if (!row) return 0
    const next = (Number(row.tok_ver) || 0) + 1
    await run(
      client.from('eo_users').update({ tok_ver: next }).eq('uid', uid).select('uid'),
      '更新会话版本'
    )
    return next
  }

  async function insertCode(email, purpose, codeHash, exp) {
    await run(
      client
        .from('eo_codes')
        .insert([{ email, purpose, code_hash: codeHash, exp, attempts: 0, used: false }]),
      '写入验证码'
    )
  }

  async function latestCode(email, purpose) {
    const res = await run(
      client
        .from('eo_codes')
        .select('id,code_hash,exp,attempts,created_at')
        .eq('email', email)
        .eq('purpose', purpose)
        .eq('used', false)
        .order('created_at', { ascending: false })
        .limit(1),
      '读取验证码'
    )
    const row = (res.data || [])[0]
    return row
      ? {
          id: Number(row.id),
          hash: row.code_hash,
          exp: row.exp,
          attempts: Number(row.attempts) || 0,
          createdAt: row.created_at
        }
      : null
  }

  async function recentCodeCount(email, purpose, sinceIso) {
    const res = await run(
      client
        .from('eo_codes')
        .select('id')
        .eq('email', email)
        .eq('purpose', purpose)
        .gte('created_at', sinceIso),
      '统计验证码'
    )
    return (res.data || []).length
  }

  async function markCodeUsed(id) {
    await run(client.from('eo_codes').update({ used: true }).eq('id', id), '标记验证码已用')
  }

  async function setCodeAttempts(id, attempts) {
    await run(client.from('eo_codes').update({ attempts }).eq('id', id), '更新验证码尝试次数')
  }

  return {
    findUserByEmail,
    getUserById,
    createUser,
    getSnapshot,
    putSnapshot,
    isRevoked,
    revoke,
    markVerified,
    updatePassword,
    bumpTokenVersion,
    insertCode,
    latestCode,
    recentCodeCount,
    markCodeUsed,
    setCodeAttempts
  }
}

// ===== 云存储适配器：体验版环境没有文档型数据库时，用对象存储承载同一套接口 =====
// 布局：eo/users/<sha256(email)>.json、eo/snap/<uid>.json、eo/revoked/<digest>.json、eo/oauth/<uid>_<provider>.json
// 说明：对象存储单文件无 512KB 限制，因此快照整份写入，不需要分片。
function createStorageStore(app) {
  // 兼容新旧 SDK：v2/v3 既可能挂在 app.storage()，也可能直接在 app 上
  const storage = typeof app.storage === 'function' ? app.storage() : app

  async function putJson(key, obj) {
    await storage.uploadFile({
      cloudPath: key,
      fileContent: Buffer.from(JSON.stringify(obj), 'utf8')
    })
  }

  async function getJson(key) {
    try {
      const res = await storage.downloadFile({ fileID: key })
      const buf = res && res.fileContent
      if (!buf) return null
      return JSON.parse(Buffer.from(buf).toString('utf8'))
    } catch {
      return null
    }
  }

  const emailKey = (email) => 'eo/users/' + crypto.createHash('sha256').update(String(email)).digest('hex') + '.json'
  const snapKey = (uid) => 'eo/snap/' + uid + '.json'
  const revKey = (digest) => 'eo/revoked/' + digest + '.json'
  const oauthKey = (uid, provider) => 'eo/oauth/' + uid + '_' + provider + '.json'
  const toUser = (doc) =>
    doc ? { id: doc.uid, email: doc.email, createdAt: doc.createdAt, passwordHash: doc.passwordHash } : null

  async function findUserByEmail(email) {
    return toUser(await getJson(emailKey(email)))
  }

  async function getUserById(uid) {
    const user = toUser(await getJson('eo/users/' + uid + '.json'))
    return user
  }

  async function createUser(email, passwordHash) {
    const existing = await findUserByEmail(email)
    if (existing) return null
    const user = {
      uid: crypto.randomBytes(12).toString('hex'),
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    }
    await putJson(emailKey(email), user)
    await putJson('eo/users/' + user.uid + '.json', user)
    return { id: user.uid, email: user.email, createdAt: user.createdAt, passwordHash: user.passwordHash }
  }

  async function getSnapshot(uid) {
    const doc = await getJson(snapKey(uid))
    if (!doc) return { rev: 0, updatedAt: null, data: null, exists: false }
    return { rev: Number(doc.rev) || 0, updatedAt: doc.updatedAt || null, data: doc.data ?? null, exists: true }
  }

  async function putSnapshot(uid, baseRev, data, updatedAt) {
    const current = await getSnapshot(uid)
    if (Number(baseRev) !== current.rev) return { conflict: true, snapshot: current }
    const rev = current.rev + 1
    const nextUpdatedAt = typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString()
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    await putJson(snapKey(uid), { rev, updatedAt: nextUpdatedAt, data: parsed, updated: Date.now() })
    return { conflict: false, rev, updatedAt: nextUpdatedAt }
  }

  async function isRevoked(digest) {
    return Boolean(await getJson(revKey(digest)))
  }

  async function revoke(digest, exp) {
    await putJson(revKey(digest), { digest, exp: Number(exp) || 0 })
  }

  async function getOAuthToken(uid, provider) {
    const doc = await getJson(oauthKey(uid, provider))
    return doc ? { enc: doc.enc, connectedAt: doc.connectedAt || null, scope: doc.scope || '' } : null
  }

  async function saveOAuthToken(uid, provider, record) {
    await putJson(oauthKey(uid, provider), {
      uid,
      provider,
      enc: record.enc,
      connectedAt: record.connectedAt || new Date().toISOString(),
      scope: record.scope || ''
    })
  }

  return {
    findUserByEmail,
    getUserById,
    createUser,
    getSnapshot,
    putSnapshot,
    isRevoked,
    revoke,
    getOAuthToken,
    saveOAuthToken
  }
}

// ===== 工具 =====
function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex')
    const bb = Buffer.from(String(b), 'hex')
    return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function lowerHeaders(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const key of Object.keys(input)) {
    const value = input[key]
    out[String(key).toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value)
  }
  return out
}

function pathOf(event) {
  let raw = String((event && event.path) || '/')
  const q = raw.indexOf('?')
  if (q >= 0) raw = raw.slice(0, q)
  let path = raw.replace(/\/+$/, '') || '/'
  // CloudBase HTTP 访问服务可能剥掉绑定的 /api 路由前缀，两种形态都接。
  if (!path.startsWith('/api')) path = path === '/' ? '/api' : '/api' + path
  return path
}

function queryOf(event) {
  if (event && event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters
  }
  const raw = String((event && event.path) || '')
  const q = raw.indexOf('?')
  const out = {}
  if (q < 0) return out
  const params = new URLSearchParams(raw.slice(q + 1))
  for (const [key, value] of params) out[key] = value
  return out
}

function rawBodyOf(event) {
  let raw = event && event.body
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') raw = JSON.stringify(raw)
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8')
  return raw
}

function readJson(raw, limit) {
  if (Buffer.byteLength(raw, 'utf8') > limit) throw new HttpError(413, '请求体过大')
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

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function clientIpOf(headers, event) {
  const forwarded = headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  const direct = headers['x-real-ip'] || headers['client-ip'] || headers['x-client-ip']
  if (direct) return direct
  return String((event && event.requestContext && event.requestContext.sourceIp) || 'unknown')
}

function hostOf(headers) {
  return String(headers['x-forwarded-host'] || headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
}

// ===== 链接封面抓取：只取 HTML 里的 og:image / twitter:image，不转发图片二进制 =====
// SSRF 防护：拒绝 localhost / 127.* / 10.* / 172.16-31.* / 192.168.* / 169.254.* / ::1，
// 以及带端口的内网探测（hostname 本身已剥离端口，逐跳重定向也重新校验）。
function hostnameIsPrivate(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::' || host === '::1') return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  if (host.includes(':')) {
    // IPv6：链路本地 / 唯一本地地址 / 回环
    if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true
    const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return hostnameIsPrivate(mapped[1])
  }
  return false
}

function publicHttpUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw))
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (hostnameIsPrivate(parsed.hostname)) return null
  return parsed
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function attrOf(tag, name) {
  const m = String(tag).match(new RegExp(name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'))
  return m ? m[2] : ''
}

/** 从 HTML 中取 og:image / twitter:image，解析为绝对 URL；没有则返回 null。 */
function parseCoverImage(html, baseUrl) {
  const keys = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src']
  const found = {}
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const key = (attrOf(tag, 'property') || attrOf(tag, 'name')).trim().toLowerCase()
    if (!keys.includes(key) || found[key]) continue
    const content = attrOf(tag, 'content').trim()
    if (content) found[key] = content
  }
  for (const key of keys) {
    if (!found[key]) continue
    let abs
    try {
      abs = new URL(decodeHtmlEntities(found[key]), baseUrl).toString()
    } catch {
      continue
    }
    if (/^https?:\/\//i.test(abs)) return abs
  }
  return null
}

/** 流式读取 HTML，累计超过 3MB 立即取消，避免把大响应读进内存。 */
async function readHtmlLimited(res) {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > COVER_MAX_BYTES) return null
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > COVER_MAX_BYTES ? null : buf.toString('utf8')
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > COVER_MAX_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // 取消失败不影响本轮判定的「超限」
      }
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 手动跟随重定向（最多 3 次），每跳都做 http(s) + 内网校验；整体 8 秒超时。 */
async function fetchCoverImage(startUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS)
  try {
    let current = startUrl
    for (let hop = 0; hop <= COVER_MAX_REDIRECTS; hop += 1) {
      const target = publicHttpUrl(current)
      // 跳转到非 http(s) 或内网地址时直接停止，不跟随
      if (!target) return null
      const res = await fetch(target.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': COVER_UA, Accept: 'text/html,application/xhtml+xml' }
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return null
        current = new URL(location, target).toString()
        continue
      }
      if (!res.ok) return null
      const type = String(res.headers.get('content-type') || '').toLowerCase()
      if (type && !type.includes('html') && !type.startsWith('text/')) return null
      const html = await readHtmlLimited(res)
      if (!html) return null
      return parseCoverImage(html, target.toString())
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ===== 入口：每次请求复用同一 handler 实例（密钥/限流缓存挂在闭包里） =====
function createHandler({ store, env = process.env, logger = console, db = null }) {
  const keyCache = new Map()
  const rateBuckets = new Map()
  const coverBuckets = new Map()
  const coverCache = new Map()
  let warnedDevKey = false

  // 封面缓存：1 小时有效、最多 200 条；命中时 ok 与 url 直接返回，null 结果也缓存。
  function readCoverCache(key) {
    const hit = coverCache.get(key)
    if (!hit) return undefined
    if (Date.now() >= hit.expireAt) {
      coverCache.delete(key)
      return undefined
    }
    return hit.image
  }

  function writeCoverCache(key, image) {
    const now = Date.now()
    if (coverCache.size >= COVER_CACHE_MAX) {
      for (const [k, v] of coverCache) {
        if (now >= v.expireAt) coverCache.delete(k)
      }
      while (coverCache.size >= COVER_CACHE_MAX) coverCache.delete(coverCache.keys().next().value)
    }
    coverCache.set(key, { image, expireAt: now + COVER_CACHE_TTL_MS })
  }

  function masterRaw() {
    const raw = String((env && env.EO_MASTER_KEY) || '').trim()
    if (raw) return raw
    if (!warnedDevKey) {
      warnedDevKey = true
      logger.warn('[eo-api] 未设置 EO_MASTER_KEY，正在使用固定开发密钥；生产环境必须在函数环境变量中配置。')
    }
    return DEV_MASTER_KEY
  }

  function keys() {
    const raw = masterRaw()
    const cached = keyCache.get(raw)
    if (cached) return cached
    const master = crypto.createHash('sha256').update(raw).digest()
    const derived = {
      session: Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'eo/session-token', 32)),
      code: Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'eo/verify-code', 32)),
      // OAuth：state 签名密钥 + access_token 加密密钥（与登录态互不复用）
      oauthState: Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'eo/oauth-state', 32)),
      secret: Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'eo/oauth-secret', 32))
    }
    keyCache.set(raw, derived)
    return derived
  }

  // ----- OAuth state（HMAC 签名，含 uid / provider / redirectUri / 时间戳） -----
  function signOAuthState(payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    return `${body}.${hmacHex(keys().oauthState, body)}`
  }
  function verifyOAuthState(state) {
    if (typeof state !== 'string') throw new HttpError(400, 'OAuth state 缺失')
    const parts = state.split('.')
    if (parts.length !== 2) throw new HttpError(400, 'OAuth state 格式不合法')
    const [body, sig] = parts
    if (!safeEqualHex(sig, hmacHex(keys().oauthState, body))) throw new HttpError(400, 'OAuth state 校验失败')
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

  // ----- 上游 token 加密（AES-256-GCM，存库格式 v1:base64url(iv|tag|ciphertext)） -----
  function encryptSecret(plaintext) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', keys().secret, iv)
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()])
    return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
  }
  function decryptSecret(payload) {
    if (typeof payload !== 'string' || !payload.startsWith('v1:')) throw new Error('密文格式不合法')
    const raw = Buffer.from(payload.slice(3), 'base64url')
    if (raw.length < 28) throw new Error('密文长度不合法')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', keys().secret, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  }

  function oauthProvider(providerId) {
    const provider = OAUTH_PROVIDERS[String(providerId || '').toLowerCase()]
    if (!provider) throw new HttpError(404, '未知 provider')
    return provider
  }
  function oauthCredentials(provider) {
    const clientId = String((env && env[provider.clientIdEnv]) || '').trim()
    const clientSecret = String((env && env[provider.clientSecretEnv]) || '').trim()
    return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) }
  }
  function assertOAuthConfigured(provider) {
    if (!oauthCredentials(provider).configured) {
      throw new HttpError(501, `未配置 ${provider.label} OAuth（请在云函数环境变量中设置 ${provider.clientIdEnv} / ${provider.clientSecretEnv}）`)
    }
  }
  // 回调地址：优先 EO_PUBLIC_BASE_URL（自定义域名），否则跟随本次请求的 host
  function oauthCallbackUrl(provider, headers) {
    const configured = String((env && env.EO_PUBLIC_BASE_URL) || '').trim().replace(/\/+$/, '')
    const base = configured || ('https://' + hostOf(headers))
    return `${base}/api/oauth/${provider.id}/callback`
  }
  function assertAllowedRedirect(redirectUri, headers) {
    if (typeof redirectUri !== 'string' || !redirectUri.trim()) throw new HttpError(400, '缺少 redirectUri')
    let url
    try {
      url = new URL(redirectUri.trim())
    } catch {
      throw new HttpError(400, 'redirectUri 不合法')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'redirectUri 不合法')
    if (!allowedOriginsOf(headers).has(url.origin)) throw new HttpError(400, 'redirectUri 不在允许的回调域名列表内')
    return url.toString()
  }


  function hmacHex(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest('hex')
  }

  // ----- 密码：与 server/ 版一致的 scrypt（16B salt / 64B 派生 / timingSafeEqual） -----
  const DUMMY_HASH = `${Buffer.alloc(16).toString('hex')}:${Buffer.alloc(SCRYPT_KEY_LEN).toString('hex')}`

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16)
    const hash = await scrypt(String(password), salt, SCRYPT_KEY_LEN, SCRYPT_OPTIONS)
    return `${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`
  }

  async function verifyPassword(stored, password) {
    if (typeof stored !== 'string' || !stored.includes(':')) return false
    const [saltHex, hashHex] = stored.split(':')
    if (!saltHex || !hashHex) return false
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    if (!salt.length || !expected.length) return false
    try {
      const actual = Buffer.from(await scrypt(String(password), salt, expected.length, SCRYPT_OPTIONS))
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    } catch {
      return false
    }
  }

  // ----- 会话：uid.exp.tokVer.jti.sig（HMAC-SHA256 / 30 天 / 吊销写 revoked） -----
  function issueSession(uid, tokVer = 0) {
    const exp = Date.now() + SESSION_TTL_MS
    const jti = crypto.randomBytes(12).toString('base64url')
    const body = `${uid}.${exp}.${Number(tokVer) || 0}.${jti}`
    return `${body}.${hmacHex(keys().session, body)}`
  }

  async function verifySession(token) {
    if (typeof token !== 'string' || !token) return null
    const parts = token.split('.')
    if (parts.length !== 5) return null
    const [uid, expText, verText, jti, sig] = parts
    const exp = Number(expText)
    if (!uid || !jti || !Number.isFinite(exp) || exp <= Date.now()) return null
    if (!safeEqualHex(sig, hmacHex(keys().session, `${uid}.${expText}.${verText}.${jti}`))) return null
    // 重置密码会递增 tok_ver，账号被删除则查不到用户 —— 两种情况都让旧 token 失效。
    const user = await store.getUserById(uid)
    if (!user) return null
    if ((Number(verText) || 0) !== Number(user.tokVer || 0)) return null
    const digest = hashToken(token)
    if (await store.isRevoked(digest)) return null
    return { uid, exp, jti, token, digest }
  }

  // ----- 邮箱验证码：6 位数字，只存 HMAC 摘要，10 分钟过期 -----
  function generateCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  }

  function codeDigest(email, purpose, code) {
    return hmacHex(keys().code, `${purpose}:${email}:${code}`)
  }

  let mailer = null
  let mailerReady = false

  function mailTransport() {
    if (mailerReady) return mailer
    mailerReady = true
    const host = String((env && env.SMTP_HOST) || '').trim()
    const user = String((env && env.SMTP_USER) || '').trim()
    const pass = String((env && env.SMTP_PASS) || '').trim()
    if (!host || !user || !pass) return null
    const port = Number((env && env.SMTP_PORT) || 465)
    const nodemailer = require('nodemailer')
    mailer = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    })
    return mailer
  }

  async function sendCodeMail(email, code, purpose) {
    const transport = mailTransport()
    if (!transport) throw new HttpError(503, '邮件服务未配置，请联系管理员')
    const from = String((env && env.SMTP_FROM) || '').trim() || String(env.SMTP_USER || '').trim()
    const action = purpose === 'reset' ? '重置密码' : '验证邮箱'
    const text = `你正在${action}，验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略本邮件。`
    try {
      await transport.sendMail({
        from,
        to: email,
        subject: `【地球Online】${action}验证码 ${code}`,
        text,
        html: `<p>你正在${action}，验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>10 分钟内有效，若非本人操作请忽略本邮件。</p>`
      })
    } catch (err) {
      logger.error('[eo-api] 验证码邮件发送失败：', (err && err.message) || err)
      throw new HttpError(502, '验证码邮件发送失败，请稍后重试')
    }
  }

  // ----- CORS -----
  function allowedOriginsOf(headers) {
    const set = new Set(BASE_ORIGINS)
    String((env && env.ALLOWED_ORIGIN) || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach((origin) => set.add(origin))
    const host = hostOf(headers)
    if (host) {
      // 静态托管与函数同域：允许当前请求所在域名（http/https 各一份）
      set.add(`https://${host}`)
      set.add(`http://${host}`)
    }
    return set
  }

  function corsOf(headers) {
    const out = { Vary: 'Origin' }
    const origin = headers.origin
    if (origin && allowedOriginsOf(headers).has(origin)) {
      out['Access-Control-Allow-Origin'] = origin
      out['Access-Control-Allow-Credentials'] = 'true'
    }
    return out
  }

  function json(statusCode, payload, cors) {
    return {
      statusCode,
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(payload)
    }
  }

  function checkRateLimit(ip, buckets = rateBuckets, max = RATE_LIMIT_MAX) {
    const now = Date.now()
    let bucket = buckets.get(ip)
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      buckets.set(ip, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) throw new HttpError(429, '请求过于频繁，请稍后再试')
    if (buckets.size > 5000) {
      for (const [key, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(key)
      }
    }
  }

  async function requireAuth(headers) {
    const header = String(headers.authorization || '')
    if (!header.startsWith('Bearer ')) throw new HttpError(401, '未认证')
    const token = header.slice(7).trim()
    if (!token) throw new HttpError(401, '未认证')
    const session = await verifySession(token)
    if (!session) throw new HttpError(401, '登录已失效，请重新登录')
    return session
  }

  function debugCodeOf(code) {
    // 仅联调期可用：EO_MAIL_DEBUG=1 时把验证码回显在响应里，便于自动化验收；上线必须关闭。
    return String((env && env.EO_MAIL_DEBUG) || '') === '1' ? { debugCode: code } : {}
  }

  // ===== 验证码签发与校验 =====
  async function issueCode(email, purpose) {
    const now = Date.now()
    const latest = await store.latestCode(email, purpose)
    if (latest && latest.createdAt) {
      const elapsed = now - new Date(latest.createdAt).getTime()
      if (elapsed >= 0 && elapsed < CODE_RESEND_INTERVAL_MS) {
        throw new HttpError(429, `请 ${Math.ceil((CODE_RESEND_INTERVAL_MS - elapsed) / 1000)} 秒后再获取验证码`)
      }
    }
    const hourly = await store.recentCodeCount(email, purpose, new Date(now - 60 * 60 * 1000).toISOString())
    if (hourly >= CODE_HOURLY_MAX) throw new HttpError(429, '该邮箱获取验证码过于频繁，请 1 小时后再试')

    const code = generateCode()
    await store.insertCode(email, purpose, codeDigest(email, purpose, code), new Date(now + CODE_TTL_MS).toISOString())
    await sendCodeMail(email, code, purpose)
    return code
  }

  /** 校验并消费验证码；成功返回 true，失败抛出 400。 */
  async function consumeCode(email, purpose, code) {
    if (!/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, '验证码格式不正确')
    const record = await store.latestCode(email, purpose)
    if (!record) throw new HttpError(400, '验证码不存在或已失效，请重新获取')
    if (record.attempts >= CODE_MAX_ATTEMPTS) throw new HttpError(429, '尝试次数过多，请重新获取验证码')
    const exp = new Date(record.exp).getTime()
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new HttpError(400, '验证码已过期，请重新获取')

    if (!safeEqualHex(codeDigest(email, purpose, String(code)), record.hash)) {
      await store.setCodeAttempts(record.id, record.attempts + 1)
      throw new HttpError(400, '验证码不正确')
    }
    await store.markCodeUsed(record.id)
    return true
  }

  function assertPassword(password) {
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, '密码至少 8 位')
    if (password.length > 512) throw new HttpError(400, '密码过长')
  }

  // ===== 路由 =====
  async function route(method, path, headers, body, query, event) {
    const cors = corsOf(headers)

    if (path.startsWith('/api/auth/')) checkRateLimit(clientIpOf(headers, event))

    if (method === 'GET' && path === '/api/health') {
      return json(200, { ok: true, time: new Date().toISOString() }, cors)
    }

    // 粘贴链接自动取封面：只回图片 URL，不代理图片二进制。
    if (method === 'GET' && path === '/api/cover') {
      // 会对目标站点发起出站请求，按 IP 限流，避免被当作探测代理
      checkRateLimit(clientIpOf(headers, event), coverBuckets, COVER_RATE_MAX)
      const target = publicHttpUrl(String((query && query.url) || '').trim())
      if (!target) throw new HttpError(400, '链接不合法或指向内网地址')
      const cacheKey = target.toString()
      const cached = readCoverCache(cacheKey)
      if (cached !== undefined) return json(200, { ok: Boolean(cached), url: cached || null }, cors)

      let image = null
      try {
        image = await fetchCoverImage(cacheKey)
      } catch (err) {
        // 超时 / 网络失败不写缓存，允许稍后重试
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[eo-api] 封面抓取失败：', (err && err.message) || err)
        }
        return json(200, { ok: false, url: null }, cors)
      }
      writeCoverCache(cacheKey, image)
      return json(200, { ok: Boolean(image), url: image || null }, cors)
    }

    if (method === 'POST' && path === '/api/auth/register') {
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const email = normalizeEmail(payload.email)
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
      assertPassword(password)

      const existing = await store.findUserByEmail(email)
      if (existing && existing.emailVerified) throw new HttpError(409, '该邮箱已注册，请直接登录')
      if (existing) {
        // 未完成验证的账号：允许覆盖为最新密码并用新验证码继续激活
        await store.updatePassword(existing.id, await hashPassword(password))
      } else {
        const user = await store.createUser(email, await hashPassword(password))
        if (!user) throw new HttpError(409, '该邮箱已注册，请直接登录')
      }
      const code = await issueCode(email, 'register')
      return json(201, { ok: true, needVerify: true, email, ...debugCodeOf(code) }, cors)
    }

    if (method === 'POST' && path === '/api/auth/send-code') {
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const email = normalizeEmail(payload.email)
      const purpose = payload.purpose === 'reset' ? 'reset' : 'register'
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
      const user = await store.findUserByEmail(email)
      if (!user) throw new HttpError(404, '该邮箱尚未注册')
      if (purpose === 'register' && user.emailVerified) {
        throw new HttpError(409, '该邮箱已完成验证，请直接登录')
      }
      const code = await issueCode(email, purpose)
      return json(200, { ok: true, ...debugCodeOf(code) }, cors)
    }

    if (method === 'POST' && path === '/api/auth/verify') {
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const email = normalizeEmail(payload.email)
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
      const user = await store.findUserByEmail(email)
      if (!user) throw new HttpError(404, '该邮箱尚未注册')
      if (user.emailVerified) {
        return json(200, { token: issueSession(user.id, user.tokVer), user: publicUser(user) }, cors)
      }
      await consumeCode(email, 'register', payload.code)
      await store.markVerified(user.id)
      const fresh = (await store.getUserById(user.id)) || { ...user, emailVerified: true }
      return json(200, { token: issueSession(fresh.id, fresh.tokVer), user: publicUser(fresh) }, cors)
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const email = normalizeEmail(payload.email)
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (!email || !password) throw new HttpError(400, '缺少 email 或 password')
      const user = await store.findUserByEmail(email)
      // 用户不存在时也跑一次 scrypt，避免通过响应耗时枚举邮箱。
      const valid = await verifyPassword(user ? user.passwordHash : DUMMY_HASH, password)
      if (!user || !valid) throw new HttpError(401, '邮箱或密码错误')
      if (!user.emailVerified) throw new HttpError(403, '邮箱尚未验证，请先完成验证')
      return json(200, { token: issueSession(user.id, user.tokVer), user: publicUser(user) }, cors)
    }

    if (method === 'POST' && path === '/api/auth/reset') {
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const email = normalizeEmail(payload.email)
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
      assertPassword(password)
      const user = await store.findUserByEmail(email)
      if (!user) throw new HttpError(404, '该邮箱尚未注册')
      await consumeCode(email, 'reset', payload.code)
      await store.updatePassword(user.id, await hashPassword(password))
      // 递增会话版本：重置后所有旧 token 立即失效
      await store.bumpTokenVersion(user.id)
      return json(200, { ok: true }, cors)
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const session = await requireAuth(headers)
      await store.revoke(session.digest, session.exp)
      return json(200, { ok: true }, cors)
    }

    if (method === 'GET' && path === '/api/me') {
      const session = await requireAuth(headers)
      const user = await store.getUserById(session.uid)
      if (!user) throw new HttpError(401, '用户不存在')
      return json(200, { user: publicUser(user) }, cors)
    }

    // ===== 第三方 OAuth（GitHub）：status / start / callback + 受控代理 =====
    // 与 server/server.mjs 的契约完全一致：前端只需 /api/oauth/status、/api/oauth/github/start、
    // /api/oauth/github/callback、/api/proxy/github，CloudBase 版补齐后三种部署方式同一套代码。
    function oauthStoreReady() {
      if (typeof store.getOAuthToken !== 'function' || typeof store.saveOAuthToken !== 'function') {
        throw new HttpError(501, '当前存储适配器不支持 OAuth 授权记录')
      }
    }

    if (method === 'GET' && path === '/api/oauth/status') {
      const session = await requireAuth(headers)
      oauthStoreReady()
      const providers = {}
      for (const id of Object.keys(OAUTH_PROVIDERS)) {
        const record = await store.getOAuthToken(session.uid, id)
        providers[id] = { connected: Boolean(record), connectedAt: record ? record.connectedAt || null : null }
      }
      return json(200, { providers }, cors)
    }

    const oauthStart = /^\/api\/oauth\/([^/]+)\/start$/.exec(path)
    if (method === 'POST' && oauthStart) {
      checkRateLimit(clientIpOf(headers, event))
      const session = await requireAuth(headers)
      const provider = oauthProvider(oauthStart[1])
      assertOAuthConfigured(provider)
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const redirectUri = assertAllowedRedirect(payload.redirectUri, headers)
      const state = signOAuthState({ u: session.uid, p: provider.id, r: redirectUri, t: Date.now() })
      const authorize = new URL(provider.authorizeUrl)
      authorize.searchParams.set('client_id', oauthCredentials(provider).clientId)
      authorize.searchParams.set('redirect_uri', oauthCallbackUrl(provider, headers))
      authorize.searchParams.set('scope', provider.scope)
      authorize.searchParams.set('state', state)
      return json(200, { url: authorize.toString() }, cors)
    }

    const oauthCallback = /^\/api\/oauth\/([^/]+)\/callback$/.exec(path)
    if (method === 'GET' && oauthCallback) {
      const provider = oauthProvider(oauthCallback[1])
      assertOAuthConfigured(provider)
      oauthStoreReady()
      const state = query.state
      const code = query.code
      if (!state) throw new HttpError(400, '缺少 state')
      const payload = verifyOAuthState(state)
      if (payload.p !== provider.id) throw new HttpError(400, 'OAuth state 与 provider 不匹配')
      if (!code) throw new HttpError(400, '缺少 code')

      const { clientId, clientSecret } = oauthCredentials(provider)
      let tokenResponse
      try {
        tokenResponse = await fetch(provider.tokenUrl, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'EarthOnline-CloudBase' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: oauthCallbackUrl(provider, headers)
          }),
          signal: AbortSignal.timeout(20000)
        })
      } catch {
        throw new HttpError(502, `${provider.label} token 交换请求失败`)
      }
      if (!tokenResponse.ok) throw new HttpError(502, `${provider.label} token 交换失败（HTTP ${tokenResponse.status}）`)
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
      await store.saveOAuthToken(payload.u, provider.id, {
        enc: encryptSecret(accessToken),
        connectedAt: new Date().toISOString(),
        scope: String(tokenData.scope || provider.scope)
      })
      const target = new URL(payload.r)
      target.searchParams.set('connected', provider.id)
      // 浏览器整页跳转回前端：直接回 302，不经过 JSON 包装
      return {
        statusCode: 302,
        headers: { ...cors, Location: target.toString(), 'Cache-Control': 'no-store' },
        body: ''
      }
    }

    const proxyMatch = /^\/api\/proxy\/([^/]+)$/.exec(path)
    if (method === 'POST' && proxyMatch) {
      checkRateLimit(clientIpOf(headers, event))
      const session = await requireAuth(headers)
      oauthStoreReady()
      const provider = oauthProvider(proxyMatch[1])
      const record = await store.getOAuthToken(session.uid, provider.id)
      if (!record) throw new HttpError(401, `未连接 ${provider.label}`)
      let token
      try {
        token = decryptSecret(record.enc)
      } catch {
        throw new HttpError(401, `未连接 ${provider.label}（凭据不可用，请重新授权）`)
      }
      const payload = readJson(body, MAX_SMALL_BODY_BYTES)
      const upstreamPath = typeof payload.path === 'string' ? payload.path : ''
      if (!upstreamPath.startsWith('/') || upstreamPath.startsWith('//') || upstreamPath.includes('..')) {
        throw new HttpError(400, 'path 必须是站内相对路径，例如 /user')
      }
      const upstreamMethod = String(payload.method || 'GET').toUpperCase()
      if (!OAUTH_PROXY_METHODS.includes(upstreamMethod)) throw new HttpError(400, '不支持的 method')
      const upHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: provider.accept,
        'User-Agent': 'EarthOnline-CloudBase'
      }
      const init = { method: upstreamMethod, headers: upHeaders, signal: AbortSignal.timeout(20000) }
      if (payload.body !== undefined && upstreamMethod !== 'GET' && upstreamMethod !== 'DELETE') {
        upHeaders['Content-Type'] = 'application/json'
        init.body = JSON.stringify(payload.body)
      }
      let upstream
      try {
        upstream = await fetch(provider.apiBase + upstreamPath, init)
      } catch {
        throw new HttpError(502, `${provider.label} 上游请求失败`)
      }
      const text = await upstream.text()
      if (!text) return json(200, { status: upstream.status, payload: {} }, cors)
      let upstreamPayload
      try {
        upstreamPayload = JSON.parse(text)
      } catch {
        throw new HttpError(502, `${provider.label} 上游返回非 JSON 内容`)
      }
      return json(200, { status: upstream.status, payload: upstreamPayload }, cors)
    }

    if (path === '/api/sync') {
      const session = await requireAuth(headers)
      if (method === 'GET') {
        const snapshot = await store.getSnapshot(session.uid)
        return json(200, { rev: snapshot.rev, updatedAt: snapshot.updatedAt, data: snapshot.data }, cors)
      }
      if (method === 'PUT') {
        const payload = readJson(body, MAX_SYNC_BODY_BYTES)
        if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === null) {
          throw new HttpError(400, '缺少 data')
        }
        if (typeof payload.data !== 'object' || Array.isArray(payload.data)) {
          throw new HttpError(400, 'data 必须是 JSON 对象')
        }
        if (Buffer.byteLength(JSON.stringify(payload.data), 'utf8') > MAX_SYNC_BYTES) {
          throw new HttpError(413, 'data 超过 20MB 上限')
        }
        const result = await store.putSnapshot(session.uid, payload.baseRev, payload.data, payload.updatedAt)
        if (result.conflict) {
          return json(
            409,
            {
              rev: result.snapshot.rev,
              updatedAt: result.snapshot.updatedAt,
              data: result.snapshot.data
            },
            cors
          )
        }
        return json(200, { rev: result.rev, updatedAt: result.updatedAt }, cors)
      }
      throw new HttpError(405, '不支持的请求方法')
    }

    throw new HttpError(404, '接口不存在')
  }

  return async function handle(event) {
    const headers = lowerHeaders(event && event.headers)
    const method = String((event && (event.httpMethod || event.method)) || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...corsOf(headers),
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      }
    }

    const cors = corsOf(headers)
    try {
      const path = pathOf(event)
      const query = queryOf(event)
      const body = rawBodyOf(event)
      return await route(method, path, headers, body, query, event)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof HttpError ? err.message : '服务器内部错误'
      if (!(err instanceof HttpError)) {
        logger.error('[eo-api] 未处理异常：', (err && err.message) || err)
      }
      // 调试期：未处理异常把真实原因带出（仅当 EO_DEBUG=1 生效，验证后移除）
      const extra = (err instanceof HttpError || !env.EO_DEBUG) ? {} : { detail: String((err && err.message) || err), code: (err && err.code) || '' }
      return json(status, Object.assign({ error: message }, extra), cors)
    }
  }
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt, emailVerified: Boolean(user.emailVerified) }
}

module.exports = {
  HttpError,
  COLLECTIONS,
  DEV_MASTER_KEY,
  ensureCollections,
  createStore,
  createRdbStore,
  createStorageStore,
  createHandler,
  publicUser
}
