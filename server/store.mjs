// 落盘存储：全部使用 node:fs，原子写（tmp + rename），密钥文件尽量 0600。
// 结构：
//   server/data/.secret          主密钥（可用 EO_MASTER_KEY 覆盖）
//   server/data/users.json       用户索引（id / email / createdAt / passwordHash）
//   server/data/u_<uid>.json     每个用户一份同步快照 { rev, updatedAt, data }
//   server/data/revoked.json     已吊销会话 { sha256(token): expMs }
//   server/data/oauth_tokens.json 每用户每 provider 一条加密 token
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { DATA_DIR } from './config.mjs'

const USERS_FILE = path.join(DATA_DIR, 'users.json')
const REVOKED_FILE = path.join(DATA_DIR, 'revoked.json')
const OAUTH_FILE = path.join(DATA_DIR, 'oauth_tokens.json')
const SECRET_FILE = path.join(DATA_DIR, '.secret')

const locks = new Map()

/** 同一 key 上的写操作串行执行，避免并发 PUT 丢更新。 */
export function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve()
  const run = prev.then(fn)
  locks.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  )
  return run
}

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    throw new Error(`数据文件损坏或不可读：${path.basename(file)}`)
  }
}

async function writeJson(file, value, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value), { mode })
  await fs.rename(tmp, file)
}

// ===== 主密钥 =====
export async function loadOrCreateSecret() {
  const fromEnv = String(process.env.EO_MASTER_KEY || '').trim()
  if (fromEnv) return Buffer.from(fromEnv, 'utf8')
  try {
    const existing = (await fs.readFile(SECRET_FILE, 'utf8')).trim()
    if (existing) return Buffer.from(existing, 'utf8')
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err
  }
  const secret = randomBytes(32).toString('hex')
  await fs.writeFile(SECRET_FILE, secret, { mode: 0o600 })
  return Buffer.from(secret, 'utf8')
}

// ===== 吊销集合 =====
export async function loadRevoked() {
  const db = await readJson(REVOKED_FILE, { tokens: {} })
  const map = new Map()
  const tokens = (db && db.tokens) || {}
  for (const [digest, exp] of Object.entries(tokens)) {
    if (Number(exp) > Date.now()) map.set(digest, Number(exp))
  }
  return map
}

export async function saveRevoked(map) {
  return withLock('revoked', async () => {
    const tokens = {}
    for (const [digest, exp] of map) {
      if (exp > Date.now()) tokens[digest] = exp
    }
    await writeJson(REVOKED_FILE, { tokens })
  })
}

// ===== 用户 =====
export async function findUserByEmail(email) {
  const db = await readJson(USERS_FILE, { users: [] })
  return (db.users || []).find((u) => u.email === email) || null
}

export async function getUserById(uid) {
  const db = await readJson(USERS_FILE, { users: [] })
  return (db.users || []).find((u) => u.id === uid) || null
}

/** 返回 null 表示邮箱已存在（在锁内检查，避免并发注册撞车）。 */
export async function createUser(email, passwordHash) {
  return withLock('users', async () => {
    const db = await readJson(USERS_FILE, { users: [] })
    if (!Array.isArray(db.users)) db.users = []
    if (db.users.some((u) => u.email === email)) return null
    const user = {
      id: randomBytes(12).toString('hex'),
      email,
      createdAt: new Date().toISOString(),
      passwordHash
    }
    db.users.push(user)
    await writeJson(USERS_FILE, db)
    return user
  })
}

// ===== 同步快照 =====
function snapshotFile(uid) {
  if (!/^[0-9a-f]{24}$/.test(uid)) throw new Error('非法 uid')
  return path.join(DATA_DIR, `u_${uid}.json`)
}

export async function getSnapshot(uid) {
  const snap = await readJson(snapshotFile(uid), null)
  if (!snap) return { rev: 0, updatedAt: null, data: null }
  return {
    rev: Number(snap.rev) || 0,
    updatedAt: snap.updatedAt || null,
    data: snap.data === undefined ? null : snap.data
  }
}

/**
 * 乐观并发：baseRev 必须与服务端 rev 相同才写入。
 * 返回 { conflict: false, rev, updatedAt } 或 { conflict: true, snapshot }。
 */
export async function putSnapshot(uid, baseRev, data, updatedAt) {
  const file = snapshotFile(uid)
  return withLock(`u:${uid}`, async () => {
    const current = await readJson(file, null)
    const cur = current
      ? {
          rev: Number(current.rev) || 0,
          updatedAt: current.updatedAt || null,
          data: current.data === undefined ? null : current.data
        }
      : { rev: 0, updatedAt: null, data: null }
    if (Number(baseRev) !== cur.rev) return { conflict: true, snapshot: cur }
    const next = {
      rev: cur.rev + 1,
      updatedAt: typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString(),
      data
    }
    await writeJson(file, next)
    return { conflict: false, rev: next.rev, updatedAt: next.updatedAt }
  })
}

// ===== OAuth token（密文） =====
async function readOAuthDb() {
  const db = await readJson(OAUTH_FILE, {})
  return db && typeof db === 'object' ? db : {}
}

export async function getOAuthToken(uid, provider) {
  const db = await readOAuthDb()
  const perUser = db[uid]
  return (perUser && perUser[provider]) || null
}

export async function saveOAuthToken(uid, provider, record) {
  return withLock('oauth', async () => {
    const db = await readOAuthDb()
    if (!db[uid]) db[uid] = {}
    db[uid][provider] = record
    await writeJson(OAUTH_FILE, db)
  })
}
