// ===== Steam 游戏库拉取（Web 端仅云端，符合设计；Native 端同理） =====
// v2.0.0 P1：内置代理解决跨域 —— 应用自带 /steam-api 反代
//   · dev/preview：vite.config.js server.proxy
//   · 生产：零依赖 Node 服务 server.js
// Steam 官方接口不返回 CORS 头，浏览器直连会被拦截；现在默认走内置代理，零配置可用。
// 仍保留「自定义代理前缀」：用户填写后优先生效（自建代理 / 企业内网场景）。

// 内置代理前缀（同源相对路径，静态托管时不存在会自动回落到直连并如实报错）
export const BUILTIN_PROXY = '/steam-api/'

function buildUrl(cfg) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  const api = 'IPlayerService/GetOwnedGames/v0001/'
  const qs = '?key=' + encodeURIComponent(key) +
    '&steamid=' + encodeURIComponent(sid) +
    '&format=json&include_appinfo=1&include_played_free_games=1'
  const userProxy = (cfg.proxy || '').trim()
  if (userProxy) {
    // 用户代理：约定为「前缀拼接式」，直接拼目标地址
    return userProxy + encodeURIComponent('https://api.steampowered.com/' + api + qs)
  }
  return BUILTIN_PROXY + api + qs
}

export async function fetchSteamGames(cfg, opts) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  if (!key || !sid) return { ok: false, error: '请先填写 Steam API Key 与 Steam ID', games: [] }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 20000)
  const headers = {}
  // 若用户填的是「代理前缀=完整代理地址」通常无需额外头；保留扩展位。
  try {
    const res = await fetch(buildUrl(cfg), { headers, signal: ctrl.signal })
    if (!res.ok) {
      // 401 多为 key 无效；其余如实返回
      if (res.status === 401) return { ok: false, error: '密钥无效或被拒绝（401）', games: [] }
      return { ok: false, error: 'HTTP ' + res.status, games: [] }
    }
    const json = await res.json()
    const games = (json && json.response && json.response.games) || []
    const list = games
      .filter((g) => g && g.appid && g.name)
      .map((g) => ({
        appid: g.appid,
        name: g.name,
        playtimeHours: Math.round(((g.playtime_forever || 0) / 60) * 10) / 10,
        logoUrl: g.img_logo_url
          ? 'https://media.steampowered.com/steamcommunity/public/images/apps/' + g.appid + '/' + g.img_logo_url + '.jpg'
          : ''
      }))
      .sort((a, b) => (b.playtimeHours || 0) - (a.playtimeHours || 0))
    return { ok: true, games: list, count: list.length }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时' : (e && e.message) || '网络错误'
    // 浏览器跨域拦截通常表现为 TypeError: Failed to fetch
    const corsHint = /Failed to fetch|NetworkError|CORS|cross-origin/i.test(msg)
    return {
      ok: false,
      error: corsHint
        ? '网络被跨域(CORS)拦截：内置代理不可用时可尝试在设置里填写自定义代理前缀，或改用本机 npm run dev。'
        : msg,
      games: []
    }
  } finally {
    clearTimeout(timer)
  }
}
