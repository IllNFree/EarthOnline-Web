// ===== 地球Online 桌面壳（Electron 主进程）=====
// 目的：Web 端受浏览器沙箱限制，只能「选择文件夹」而不能填 D:\音乐 这类绝对路径。
// 这里通过 IPC 提供：目录扫描 / 文本读取 / 本地媒体文件 URL（自定义协议 eo-media://）。
// 安全：contextIsolation + 无 nodeIntegration，渲染层只拿到白名单方法。
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const DEV_URL = process.env.EO_DEV_URL || 'http://localhost:8092'
const IS_DEV = !app.isPackaged

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma']
const TEXT_EXT = ['txt', 'md', 'markdown', 'log', 'csv', 'json']

function kindOf(name) {
  const ext = (/\.[a-z0-9]+$/i.exec(name) || [''])[0].slice(1).toLowerCase()
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (TEXT_EXT.includes(ext)) return 'text'
  return null
}

// 本地文件 → eo-media://local/<urlencoded absolute path>，避免 file:// 在 http 源下被跨域拦截
function toMediaUrl(p) {
  return 'eo-media://local' + encodeURI('/' + p.replace(/\\/g, '/').replace(/^\/+/, ''))
}
function fromMediaUrl(u) {
  const obj = new URL(u)
  return decodeURIComponent(obj.pathname.replace(/^\/+/, ''))
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'eo-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

async function walk(dir, depth, maxFiles, base, out) {
  if (depth > 5 || out.length >= maxFiles) return
  let entries = []
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) { return }
  for (const ent of entries) {
    if (out.length >= maxFiles) break
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await walk(full, depth + 1, maxFiles, base ? base + '/' + ent.name : ent.name, out)
    } else if (ent.isFile()) {
      const kind = kindOf(ent.name)
      if (!kind) continue
      let size = 0
      try { size = (await fs.promises.stat(full)).size } catch (e) { /* ignore */ }
      out.push({
        name: ent.name,
        path: base ? base + '/' + ent.name : ent.name,
        absPath: full,
        kind,
        size,
        url: toMediaUrl(full)
      })
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#F4F2EE',
    autoHideMenuBar: true,
    title: '地球Online',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  if (IS_DEV) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  // 外链一律交给系统浏览器，应用内不开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}

app.whenReady().then(() => {
  protocol.handle('eo-media', async (req) => {
    try {
      const filePath = fromMediaUrl(req.url)
      return await net.fetch(pathToFileURL(filePath).toString(), { headers: req.headers })
    } catch (e) {
      return new Response('not found', { status: 404 })
    }
  })

  // 选择文件夹（系统对话框）
  ipcMain.handle('eo:pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择文件夹' })
    return r.canceled ? null : r.filePaths[0]
  })

  // 扫描绝对路径目录：返回可导入的媒体 / 文本清单
  ipcMain.handle('eo:list-dir', async (evt, dirPath, opts = {}) => {
    if (!dirPath || !path.isAbsolute(dirPath)) return { ok: false, error: '请输入绝对路径，例如 D:\\音乐' }
    try {
      const stat = await fs.promises.stat(dirPath)
      if (!stat.isDirectory()) return { ok: false, error: '该路径不是文件夹' }
    } catch (e) {
      return { ok: false, error: '路径不存在或无法访问' }
    }
    const out = []
    await walk(dirPath, 1, Math.min(600, opts.maxFiles || 600), '', out)
    return { ok: true, items: out, dirPath }
  })

  // 读纯文本 / Markdown（最多 240KB）
  ipcMain.handle('eo:read-text', async (evt, dirPath, relPath) => {
    try {
      const full = relPath ? path.join(dirPath, relPath) : dirPath
      const buf = await fs.promises.readFile(full)
      return { ok: true, text: buf.slice(0, 240 * 1024).toString('utf8') }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('eo:open-external', async (evt, p) => {
    if (typeof p === 'string' && path.isAbsolute(p)) shell.openPath(p)
    return true
  })

  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
