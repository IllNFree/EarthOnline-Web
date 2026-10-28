// ===== Steam 游戏库拉取（Web 端仅云端，符合设计；Native 端同理） =====
// v2.0.0 P1：内置代理解决跨域 —— 应用自带 /steam-api 反代
//   · dev/preview：vite.config.js server.proxy
//   · 生产：零依赖 Node 服务 server.cjs
// Steam 官方接口不返回 CORS 头，浏览器直连会被拦截；现在默认走内置代理，零配置可用。
// 仍保留「自定义代理前缀」：用户填写后优先生效（自建代理 / 企业内网场景）。

// 内置代理前缀（同源相对路径，静态托管时不存在会自动回落到直连并如实报错）
export const BUILTIN_PROXY = '/steam-api/'

// 模块三：封面图（Steam 官方 CDN，无需鉴权）
//   · header.jpg   460×215 横版（用作 Haze 毛玻璃背景）
//   · library_600x900.jpg 竖版封面
export function steamCover(appid, kind) {
  const id = String(appid || '')
  if (!id) return ''
  if (kind === 'portrait') return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/library_600x900.jpg'
  return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg'
}

function buildUrl(cfg, apiPath, query) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  const qs = '?key=' + encodeURIComponent(key) +
    '&steamid=' + encodeURIComponent(sid) +
    (query || '')
  const userProxy = (cfg.proxy || '').trim()
  if (userProxy) {
    // 用户代理：约定为「前缀拼接式」，直接拼目标地址
    return userProxy + encodeURIComponent('https://api.steampowered.com/' + apiPath + qs)
  }
  return BUILTIN_PROXY + apiPath + qs
}

async function getJSON(url, timeout) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout || 20000)
  const headers = {}
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: '密钥无效或被拒绝（401）', data: null }
      return { ok: false, error: 'HTTP ' + res.status, data: null }
    }
    return { ok: true, data: await res.json() }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时' : (e && e.message) || '网络错误'
    // 浏览器跨域拦截通常表现为 TypeError: Failed to fetch
    const corsHint = /Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)
    return {
      ok: false,
      error: corsHint
        ? '网络被跨域(CORS)拦截：内置代理不可用时可尝试在设置里填写自定义代理前缀，或改用本机 npm run dev。'
        : msg,
      data: null
    }
  } finally {
    clearTimeout(timer)
  }
}

// 全部游戏库（总时长 / 封面 / logo）
export async function fetchSteamGames(cfg, opts) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  if (!key || !sid) return { ok: false, error: '请先填写 Steam API Key 与 Steam ID', games: [] }

  const url = buildUrl(cfg, 'IPlayerService/GetOwnedGames/v0001/',
    '&format=json&include_appinfo=1&include_played_free_games=1')
  const r = await getJSON(url, (opts && opts.timeout) || 20000)
  if (!r.ok) return { ok: false, error: r.error, games: [] }

  const games = (r.data && r.data.response && r.data.response.games) || []
  const list = games
    .filter((g) => g && g.appid && g.name)
    .map((g) => ({
      appid: g.appid,
      name: g.name,
      playtimeHours: Math.round(((g.playtime_forever || 0) / 60) * 10) / 10,
      logoUrl: g.img_logo_url
        ? 'https://media.steampowered.com/steamcommunity/public/images/apps/' + g.appid + '/' + g.img_logo_url + '.jpg'
        : '',
      coverUrl: steamCover(g.appid, 'header'),
      portraitUrl: steamCover(g.appid, 'portrait'),
      // 近两周时长（分钟 → 小时）与上次运行时间，由 GetRecentPlayedGames 补齐
      recentHours: 0,
      lastPlayedTime: 0
    }))
    .sort((a, b) => (b.playtimeHours || 0) - (a.playtimeHours || 0))
  return { ok: true, games: list, count: list.length }
}

// 近两周游玩数据：GetRecentPlayedGames 直接返回 playtime_2_weeks 与 last_played_time
export async function fetchRecentPlaytime(cfg, opts) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  if (!key || !sid) return { ok: false, error: '请先填写 Steam API Key 与 Steam ID', recent: {} }
  const url = buildUrl(cfg, 'IPlayerService/GetRecentPlayedGames/v0001/', '&format=json&count=100')
  const r = await getJSON(url, (opts && opts.timeout) || 20000)
  if (!r.ok) return { ok: false, error: r.error, recent: {} }
  const arr = (r.data && r.data.response && r.data.response.games) || []
  const recent = {}
  arr.forEach((g) => {
    if (!g || !g.appid) return
    recent[g.appid] = {
      // playtime_2_weeks 单位为分钟
      recentHours: Math.round(((g.playtime_2_weeks || 0) / 60) * 10) / 10,
      lastPlayedTime: g.last_played_time || 0
    }
  })
  return { ok: true, recent }
}

// 单个游戏的成就列表（展开卡片时按需拉取，避免一次性请求全部游戏）
// GetPlayerAchievements 返回该游戏全部成就及解锁状态，无需 schema key
export async function fetchGameAchievements(cfg, appid, opts) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  if (!key || !sid) return { ok: false, error: '请先填写 Steam API Key 与 Steam ID', achievements: [] }
  const url = buildUrl(cfg, 'ISteamUserStats/GetPlayerAchievements/v0001/', '&appid=' + encodeURIComponent(appid) + '&l=zh')
  const r = await getJSON(url, (opts && opts.timeout) || 20000)
  if (!r.ok) return { ok: false, error: r.error, achievements: [] }
  const arr = (r.data && r.data.playerstats && r.data.playerstats.achievements) || []
  const list = arr.map((a) => ({
    key: a.apiname || a.name,
    name: (a.name || a.displayName || a.apiname || '').replace(/\s*».*$/, ''),
    desc: a.description || '',
    unlocked: a.achieved === 1,
    unlockTime: a.unlocktime || 0,
    icon: a.icon || ''
  }))
  return {
    ok: true,
    achievements: list,
    unlocked: list.filter((a) => a.unlocked).length,
    total: list.length
  }
}
