// 第三方 OAuth 网关（以 GitHub 为例，provider 结构可扩展）：
// client_secret 只在本进程使用，上游 token 加密落盘，绝不返回前端。
import { ALLOWED_ORIGINS, PUBLIC_BASE_URL } from './config.mjs'
import { HttpError } from './errors.mjs'
import * as auth from './auth.mjs'
import * as store from './store.mjs'

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

export const PROVIDER_IDS = Object.keys(PROVIDERS)

function getProvider(providerId) {
  const provider = PROVIDERS[String(providerId || '').toLowerCase()]
  if (!provider) throw new HttpError(404, '未知 provider')
  return provider
}

function credentialsOf(provider) {
  const clientId = String(process.env[provider.clientIdEnv] || '').trim()
  const clientSecret = String(process.env[provider.clientSecretEnv] || '').trim()
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) }
}

function assertConfigured(provider) {
  const { configured } = credentialsOf(provider)
  if (!configured) {
    throw new HttpError(
      501,
      `未配置 ${provider.label} OAuth（设置环境变量 ${provider.clientIdEnv} / ${provider.clientSecretEnv}）`
    )
  }
}

function callbackUrlOf(provider) {
  return `${PUBLIC_BASE_URL}/api/oauth/${provider.id}/callback`
}

function assertAllowedRedirect(redirectUri) {
  if (typeof redirectUri !== 'string' || !redirectUri.trim()) throw new HttpError(400, '缺少 redirectUri')
  let url
  try {
    url = new URL(redirectUri.trim())
  } catch {
    throw new HttpError(400, 'redirectUri 不合法')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'redirectUri 不合法')
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new HttpError(400, 'redirectUri 不在允许的回调域名列表内')
  return url.toString()
}

export function start(providerId, uid, body) {
  const provider = getProvider(providerId)
  assertConfigured(provider)
  const redirectUri = assertAllowedRedirect(body && body.redirectUri)
  const state = auth.signOAuthState({
    u: uid,
    p: provider.id,
    r: redirectUri,
    t: Date.now()
  })
  const authorize = new URL(provider.authorizeUrl)
  authorize.searchParams.set('client_id', credentialsOf(provider).clientId)
  authorize.searchParams.set('redirect_uri', callbackUrlOf(provider))
  authorize.searchParams.set('scope', provider.scope)
  authorize.searchParams.set('state', state)
  return { url: authorize.toString() }
}

/** 校验 state、用 client_secret 换 token、加密落盘，返回最终 302 目标地址。 */
export async function callback(providerId, searchParams) {
  const provider = getProvider(providerId)
  assertConfigured(provider)
  const state = searchParams.get('state')
  const code = searchParams.get('code')
  if (!state) throw new HttpError(400, '缺少 state')
  const payload = auth.verifyOAuthState(state)
  if (payload.p !== provider.id) throw new HttpError(400, 'OAuth state 与 provider 不匹配')
  if (!code) throw new HttpError(400, '缺少 code')

  const { clientId, clientSecret } = credentialsOf(provider)
  let tokenResponse
  try {
    tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'EarthOnline-Server'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrlOf(provider)
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
    enc: auth.encryptSecret(accessToken),
    connectedAt: new Date().toISOString(),
    scope: String(tokenData.scope || provider.scope)
  })

  const target = new URL(payload.r)
  target.searchParams.set('connected', provider.id)
  return target.toString()
}

/** 用用户的 provider token 转发请求，只回传上游 JSON，不泄漏 token 与上游响应头。 */
export async function proxy(providerId, uid, body) {
  const provider = getProvider(providerId)
  const record = await store.getOAuthToken(uid, provider.id)
  if (!record) throw new HttpError(401, `未连接 ${provider.label}`)

  let token
  try {
    token = auth.decryptSecret(record.enc)
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
    'User-Agent': 'EarthOnline-Server'
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

export async function status(uid) {
  const providers = {}
  for (const id of PROVIDER_IDS) {
    const record = await store.getOAuthToken(uid, id)
    providers[id] = { connected: Boolean(record), connectedAt: record ? record.connectedAt || null : null }
  }
  return { providers }
}
