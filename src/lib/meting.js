// ===== 网易云歌单 / 歌词：公共 Meting 接口（免 Key，多源兜底） =====
// 用法：loadPlaylist(id) 拉整张歌单；loadLyric(url) 拉 LRC 文本。
// 歌单按 6 小时缓存在 localStorage，避免每次进画布都重复请求。

const CACHE_MS = 6 * 60 * 60 * 1000
const SOURCES = [
  (id) => 'https://api.injahow.cn/meting/?server=netease&type=playlist&id=' + id,
  (id) => 'https://api.i-meto.com/meting/api?server=netease&type=playlist&id=' + id,
  (id) => 'https://api.moeyao.cn/meting/?server=netease&type=playlist&id=' + id
]

function cacheKey(id) { return 'eo:meting:playlist:' + id }

function readCache(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(id)) || 'null')
    if (!raw || !Array.isArray(raw.tracks) || !raw.tracks.length) return null
    if (Date.now() - (raw.at || 0) > CACHE_MS) return null
    return raw.tracks
  } catch (e) { return null }
}
function writeCache(id, tracks) {
  try { localStorage.setItem(cacheKey(id), JSON.stringify({ at: Date.now(), tracks })) } catch (e) { /* 配额满时忽略 */ }
}

async function fetchJson(url) {
  const ctl = new AbortController()
  const to = setTimeout(() => ctl.abort(), 9000)
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally { clearTimeout(to) }
}

function normalize(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((t) => {
      if (!t) return null
      const src = String(t.url || t.src || '').replace(/^http:\/\//i, 'https://')
      if (!src) return null
      return {
        title: String(t.name || t.title || '未命名音乐'),
        artist: String(t.artist || t.author || ''),
        src,
        cover: String(t.pic || t.cover || '').replace(/^http:\/\//i, 'https://'),
        lrc: String(t.lrc || '').replace(/^http:\/\//i, 'https://'),
        source: 'meting',
        format: 'mp3'
      }
    })
    .filter(Boolean)
}

// 三源并发，先返回且非空的胜出；全部失败返回空数组
export async function loadPlaylist(id) {
  const pid = String(id || '').trim()
  if (!pid) return []
  const hit = readCache(pid)
  if (hit) return hit
  const tasks = SOURCES.map((build) =>
    fetchJson(build(pid)).then((j) => {
      const tracks = normalize(j)
      if (!tracks.length) throw new Error('empty')
      return tracks
    })
  )
  try {
    const tracks = await Promise.any(tasks)
    writeCache(pid, tracks)
    return tracks
  } catch (e) { return [] }
}

// 单曲歌词缓存（内存级，切歌来回不重复请求）
const lyricMap = new Map()
export async function loadLyric(track) {
  const url = String((track && track.lrc) || '')
  if (!url) return []
  if (lyricMap.has(url)) return lyricMap.get(url)
  try {
    const ctl = new AbortController()
    const to = setTimeout(() => ctl.abort(), 8000)
    const r = await fetch(url, { signal: ctl.signal })
    clearTimeout(to)
    if (!r.ok) return []
    const text = await r.text()
    const lines = parseLrc(text)
    lyricMap.set(url, lines)
    return lines
  } catch (e) { return [] }
}

// LRC → [{ t: 秒, text }]，忽略空行与纯时间戳
export function parseLrc(text) {
  const out = []
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g
  String(text || '').split(/\r?\n/).forEach((line) => {
    let m
    let lastEnd = 0
    while ((m = re.exec(line))) {
      const frac = m[3] ? Number('0.' + m[3]) : 0
      const t = Number(m[1]) * 60 + Number(m[2]) + frac
      out.push({ t, text: line.slice(re.lastIndex).trim() })
      lastEnd = re.lastIndex
    }
    void lastEnd
  })
  return out.filter((x) => x.text).sort((a, b) => a.t - b.t)
}
