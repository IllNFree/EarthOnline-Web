-- EarthOnline Cloudflare D1 schema
-- 应用方式：npx wrangler d1 execute eo-sync --remote --file=./schema.sql
-- 本地开发：npx wrangler d1 execute eo-sync --local --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 每个用户一份整包快照，data 存 JSON 字符串；rev 用于乐观并发控制。
CREATE TABLE IF NOT EXISTS snapshots (
  user_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  data TEXT NOT NULL
);

-- 第三方 OAuth token：enc 为 AES-256-GCM 密文（v1:<base64url>），明文永不落库。
CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  enc TEXT NOT NULL,
  connected_at TEXT,
  PRIMARY KEY (user_id, provider)
);

-- 已吊销会话：jti 为主键，exp 为毫秒时间戳，认证时查一次。
CREATE TABLE IF NOT EXISTS revoked (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);
