// 零依赖配置：仅用 node 内置能力，便于后续平移到 Cloudflare Workers。
import path from 'node:path'

export const SERVER_DIR = import.meta.dirname
export const DATA_DIR = path.join(SERVER_DIR, 'data')

export const PORT = Number(process.env.PORT) || 8787
export const PUBLIC_BASE_URL = (process.env.EO_PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')

// 前端开发 / 预览地址，可用 EO_ALLOWED_ORIGINS（逗号分隔）追加部署后的域名。
export const ALLOWED_ORIGINS = new Set(
  (process.env.EO_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .concat([
      'http://localhost:4173',
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://127.0.0.1:5173'
    ])
)

export const MAX_SYNC_BYTES = 20 * 1024 * 1024
// 请求体硬上限，留出 JSON 外壳（baseRev / updatedAt / 引号）的余量，data 本体再精确校验 20MB。
export const MAX_SYNC_BODY_BYTES = MAX_SYNC_BYTES + 1024 * 1024
export const MAX_SMALL_BODY_BYTES = 64 * 1024
