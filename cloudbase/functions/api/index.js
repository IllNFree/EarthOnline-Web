'use strict'

// CloudBase 云函数入口：一个函数承载全部 /api 路由（HTTP 访问服务 → 本函数）。
// 事件格式：{ path, httpMethod, headers, body, isBase64Encoded, queryStringParameters }
// 返回格式：{ statusCode, headers, body }
//
// 存储选择：
//   EO_STORE=rdb（默认）→ CloudBase 内网 PostgREST 网关（app.rdb()），
//                          不暴露数据库公网地址、不需要密码/VPC，数据在环境自带 PostgreSQL
//   EO_STORE=db          → 云数据库文档型（需环境已开通文档型数据库）
//   EO_STORE=storage     → 云对象存储（需环境支持 storage SDK）

const tcbPackage = require('@cloudbase/node-sdk')
const sdk = tcbPackage && tcbPackage.default ? tcbPackage.default : tcbPackage
const {
  ensureCollections,
  createStore,
  createRdbStore,
  createStorageStore,
  createHandler
} = require('./handler.js')

const app = sdk.init({
  env: process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID || sdk.SYMBOL_CURRENT_ENV
})

let readyPromise = null

function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const mode = String(process.env.EO_STORE || 'rdb')
      if (mode === 'db') {
        const db = app.database()
        await ensureCollections(db)
        return createHandler({ store: createStore(db), env: process.env })
      }
      if (mode === 'storage') {
        return createHandler({ store: createStorageStore(app), env: process.env })
      }
      return createHandler({ store: createRdbStore(app), env: process.env })
    })().catch((err) => {
      // 冷启动失败时允许下次请求重试
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

exports.main = async function main(event) {
  try {
    const handle = await ready()
    return await handle(event)
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: '服务初始化失败',
        code: (err && err.code) || '',
        detail: String((err && err.message) || err)
      })
    }
  }
}
