// ===== 链接封面：后端抓取 og:image / twitter:image，失败回退站点 favicon / 稳定渐变占位 =====
// 后端只返回图片 URL，不转发图片二进制；任何失败都静默返回 null，不阻塞保存流程。
import { loadCloudConfig } from './cloud.js'

const COVER_TIMEOUT_MS = 10000

function baseOf(cfg) {
  return String((cfg && cfg.baseUrl) || '').replace(/\/+$/, '')
}

function hostOf(url) {
  try {
    const u = new URL(String(url))
    return /^https?:$/.test(u.protocol) ? u.hostname : ''
  } catch (e) {
    return ''
  }
}

/** 调用云函数 /api/cover 取封面：返回图片 URL，取不到返回 null。 */
export async function fetchLinkCover(url) {
  const link = String(url || '').trim()
  if (!/^https?:\/\//i.test(link)) return null
  const cfg = loadCloudConfig()
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), COVER_TIMEOUT_MS) : null
  try {
    const res = await fetch(baseOf(cfg) + '/api/cover?url=' + encodeURIComponent(link), {
      method: 'GET',
      ...(ctrl ? { signal: ctrl.signal } : {})
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const image = data && data.ok && typeof data.url === 'string' ? data.url : ''
    return /^https?:\/\//i.test(image) ? image : null
  } catch (e) {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 站点 favicon（DuckDuckGo 图标服务），用于封面抓取失败时的静默回退。 */
export function faviconFor(url) {
  const host = hostOf(url)
  return host ? 'https://icons.duckduckgo.com/ip3/' + host + '.ico' : ''
}

// 固定色板（与主题呼应），按域名哈希取色，保证同一链接每次颜色一致（不引入新的随机色）。
const COVER_GRADIENTS = [
  ['#F7C873', '#E9835B'],
  ['#8FB8A8', '#5E8F7C'],
  ['#A9B7E8', '#6E7FBF'],
  ['#D6A8C8', '#A76F92'],
  ['#E3B7A0', '#BF8567'],
  ['#9FCAD6', '#5D97A8'],
  ['#C9C08C', '#9C9159'],
  ['#B8A8D6', '#8270A8']
]

/** 无封面占位：域名首字 + 稳定渐变色（同域名恒定）。 */
export function coverFallback(url) {
  const host = hostOf(url)
  const name = host.replace(/^www\./, '')
  const initial = (name.charAt(0) || '·').toUpperCase()
  let seed = 0
  for (let i = 0; i < host.length; i += 1) seed = (seed + host.charCodeAt(i)) % 9973
  const pair = COVER_GRADIENTS[seed % COVER_GRADIENTS.length]
  return { initial, gradient: `linear-gradient(135deg, ${pair[0]} 0%, ${pair[1]} 100%)` }
}
