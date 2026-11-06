// ===== Steam 游戏库拉取（Web 端仅云端，符合设计；Native 端同理） =====
// v2.0.0 P1：内置代理解决跨域 —— 应用自带 /steam-api 反代
//   · dev/preview：vite.config.js server.proxy
//   · 生产：零依赖 Node 服务 server.cjs
// Steam 官方接口不返回 CORS 头，浏览器直连会被拦截；现在默认走内置代理，零配置可用。
// 仍保留「自定义代理前缀」：用户填写后优先生效（自建代理 / 企业内网场景）。

// 内置代理前缀（同源相对路径，静态托管时不存在会自动回落到直连并如实报错）
export const BUILTIN_PROXY = '/steam-api/'

// 模块三：封面图（Steam 官方 CDN，无需鉴权）
//   · header.jpg   460×215 横版（旧版，低清，仅作 404 兜底）
//   · library_600x900_2x.jpg 1200×1800 竖版高清（默认采用，参考小黑盒 / 官方库视图）
export function steamCover(appid, kind) {
  const id = String(appid || '')
  if (!id) return ''
  if (kind === 'portrait') return steamCoverHD(appid)
  return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg'
}
// 高清竖版封面（满血 Haze 卡片主图）：优先 fastly，404 时回退 akamai，再回退 header（红线 3）。
export function steamCoverHD(appid) {
  const id = String(appid || '')
  if (!id) return ''
  return 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + id + '/library_600x900_2x.jpg'
}
export function steamCoverHDAlt(appid) {
  const id = String(appid || '')
  if (!id) return ''
  return 'https://steamcdn-a.akamaihd.net/steam/apps/' + id + '/library_600x900_2x.jpg'
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
      portraitUrl: steamCoverHD(g.appid),
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

// 个人基础档案：GetPlayerSummaries（头像 / 昵称 / 自定义网址 / 建号时间）
// + GetSteamLevel（社区等级）。账号年龄由 timecreated 推算。
// 注意：Steam Web API 不返回「个人简介(bio)」与「展柜(showcases)」，
// 这两项必须在 UI 里提供手动录入兜底（红线 3：API 隐私受限时优雅降级）。
export async function fetchSteamProfile(cfg, opts) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  if (!key || !sid) return { ok: false, error: '请先填写 Steam API Key 与 Steam ID', profile: null }

  const url = buildUrl(cfg, 'ISteamUser/GetPlayerSummaries/v2/', '')
  const r = await getJSON(url, (opts && opts.timeout) || 20000)
  if (!r.ok) return { ok: false, error: r.error, profile: null }
  const p = (r.data && r.data.response && r.data.response.players && r.data.response.players[0]) || null
  if (!p) return { ok: false, error: '未找到该 Steam ID 对应的玩家资料', profile: null }

  // 社区等级：失败不影响档案主体展示（静默降级为 0 并提示）
  let level = 0
  try {
    const lr = await getJSON(buildUrl(cfg, 'IPlayerService/GetSteamLevel/v1/', ''), (opts && opts.timeout) || 20000)
    if (lr.ok) level = (lr.data && lr.data.response && lr.data.response.player_level) || 0
  } catch (e) { /* 静默降级 */ }

  const created = p.timecreated ? Number(p.timecreated) : 0
  const nowS = Math.floor(Date.now() / 1000)
  const ageYears = created ? Math.max(0, Math.floor((nowS - created) / 31557600)) : 0

  return {
    ok: true,
    profile: {
      steamId: p.steamid || sid,
      personaName: p.personaname || '',
      avatarFull: p.avatarfull || p.avatar || '',
      avatarMedium: p.avatarmedium || p.avatar || '',
      profileUrl: p.profileurl || '',
      // GetPlayerSummaries/v2 不返回 bio；缺省空串，由手动录入兜底
      bio: p.summary || '',
      timecreated: created,
      accountAgeYears: ageYears,
      level,
      personastate: p.personastate || 0,
      lastlogoff: p.lastlogoff || 0
    }
  }
}
