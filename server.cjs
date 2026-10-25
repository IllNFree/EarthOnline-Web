/**
 * 地球Online Web · 生产静态服务（零第三方依赖）
 *
 * 职责：
 *  1) 以 dist/ 为根提供静态资源（index.html 走 no-cache，避免版本更新后仍命中旧缓存）
 *  2) 内置 Steam Web API 反向代理 /steam-api/* → https://api.steampowered.com/*
 *     —— Steam 官方接口不返回 CORS 头，浏览器直连必被拦截，此处与 vite dev proxy 同语义，
 *        使线上也能零配置拉取游戏库（对齐 Android 原生直连体验）
 */
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

// 静态根：优先 webroot（部署用的已构建副本），其次 dist（本地构建产物）
const ROOT = [path.join(__dirname, 'webroot'), path.join(__dirname, 'dist')]
    .find((d) => fs.existsSync(path.join(d, 'index.html'))) || path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
}

function send(res, code, headers, body) {
  res.writeHead(code, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers))
  if (body) res.end(body)
  else res.end()
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const full = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''))
  if (!full.startsWith(ROOT)) return send(res, 403, { 'Content-Type': 'text/plain' }, 'forbidden')
  fs.stat(full, (err, st) => {
    const target = err || !st.isFile() ? path.join(ROOT, 'index.html') : full
    fs.readFile(target, (e2, buf) => {
      if (e2) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found')
      const ext = path.extname(target).toLowerCase()
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      if (target.endsWith('index.html')) headers['Cache-Control'] = 'no-cache, must-revalidate'
      else headers['Cache-Control'] = 'public, max-age=31536000, immutable'
      send(res, 200, headers, buf)
    })
  })
}

/** Steam 反代：/steam-api/IPlayerService/... → https://api.steampowered.com/IPlayerService/... */
function proxySteam(req, res, pathname) {
  const upstream = pathname.replace(/^\/steam-api\/?/, '')
  const target = 'https://api.steampowered.com/' + upstream + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')
  let u
  try { u = new URL(target) } catch (e) { return send(res, 400, { 'Content-Type': 'text/plain' }, 'bad target') }
  const upstreamReq = https.request(
    { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20000 },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      up.pipe(res)
    }
  )
  upstreamReq.on('timeout', () => { upstreamReq.destroy(); send(res, 504, { 'Content-Type': 'text/plain' }, 'upstream timeout') })
  upstreamReq.on('error', () => send(res, 502, { 'Content-Type': 'text/plain' }, 'upstream error'))
  upstreamReq.end()
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0]
  if (pathname.startsWith('/steam-api/')) return proxySteam(req, res, pathname)
  return serveStatic(req, res, pathname)
})

server.listen(PORT, HOST, () => {
  console.log('地球Online Web listening on ' + HOST + ':' + PORT + ' (dist=' + ROOT + ')')
})
