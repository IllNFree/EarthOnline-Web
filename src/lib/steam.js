// ===== Steam 游戏库拉取（仅云端，Web 端无法运行本地模型，同理 Steam 仅云端调用） =====
// 说明：Steam Web API 默认不返回 CORS 头，浏览器直连会被拦截。
// 因此提供可选的「CORS 代理前缀」配置（由用户自填可信代理），未配置时如实报告跨域错误，绝不伪造数据。

function buildUrl(cfg) {
  const key = (cfg.apiKey || '').trim()
  const sid = (cfg.steamId || '').trim()
  const base = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/'
  const qs = '?key=' + encodeURIComponent(key) +
    '&steamid=' + encodeURIComponent(sid) +
    '&format=json&include_appinfo=1&include_played_free_games=1'
  const target = base + qs
  const proxy = (cfg.proxy || '').trim()
  return proxy ? proxy + encodeURIComponent(target) : target
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
        ? '跨域(CORS)被拦截：请在设置中填写 CORS 代理前缀，或用自有后端代理 Steam 请求。'
        : msg,
      games: []
    }
  } finally {
    clearTimeout(timer)
  }
}
