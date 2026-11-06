// ===== 外部媒体导入：文件 / 文件夹递归扫描（最深 5 层） =====
// 支持两种入口：
//   · 系统文件夹选择器（File System Access API，可直接拿到目录树）
//   · 拖拽文件夹（webkitGetAsEntry 递归）
// 单个文件导入后生成媒体节点，缩略图异步补全；视频播放地址仅存在于当前会话。

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']
export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma']
export const TEXT_EXT = ['txt', 'md', 'markdown', 'log', 'csv', 'json']

const MAX_DEPTH = 5
const MAX_FILES = 600

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}
export function kindOfFile(file) {
  const ext = extOf(file.name)
  const type = file.type || ''
  if (IMAGE_EXT.includes(ext) || type.startsWith('image/')) return 'image'
  if (VIDEO_EXT.includes(ext) || type.startsWith('video/')) return 'video'
  if (AUDIO_EXT.includes(ext) || type.startsWith('audio/')) return 'audio'
  // 文本类只认纯文本格式：docx/pdf 等二进制文档不做「假装能读」的处理
  if (TEXT_EXT.includes(ext) || type.startsWith('text/')) return 'text'
  return null
}

// ---------- 缩略图 ----------
function loadVideoFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'metadata'
    let done = false
    const finish = (img) => {
      if (done) return
      done = true
      v.src = ''
      URL.revokeObjectURL(url)
      resolve(img)
    }
    const timer = setTimeout(() => finish(null), 5000)
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.3, (v.duration || 1) * 0.2)
      } catch (e) { finish(null) }
    }
    v.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        const max = 360
        const ratio = v.videoWidth / v.videoHeight || 1.6
        canvas.width = max
        canvas.height = Math.round(max / ratio)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        clearTimeout(timer)
        finish({ url: canvas.toDataURL('image/jpeg', 0.72), duration: v.duration || 0, w: v.videoWidth, h: v.videoHeight })
      } catch (e) { clearTimeout(timer); finish(null) }
    }
    v.onerror = () => { clearTimeout(timer); finish(null) }
    v.src = url
  })
}

async function makeThumb(file, kind) {
  if (kind === 'video') return loadVideoFrame(file)
  const max = 360
  try {
    if (extOf(file.name) === 'svg') {
      const text = await file.text()
      const blob = new Blob([text], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const img = await loadImg(url)
      URL.revokeObjectURL(url)
      return { url: compressImg(img, max) }
    }
    const bitmap = await createImageBitmap(file)
    const ratio = bitmap.width / bitmap.height
    const w = Math.min(max, bitmap.width)
    const h = Math.round(w / ratio)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close && bitmap.close()
    return { url: canvas.toDataURL('image/jpeg', 0.74), w: w, h: h }
  } catch (e) {
    return null
  }
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
function compressImg(img, max) {
  const ratio = img.width / img.height || 1
  const w = Math.min(max, img.width || max)
  const h = Math.round(w / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.74)
}

// ---------- 目录递归 ----------
export async function walkDirectoryHandle(dirHandle, depth = 1, base = '', out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out
  try {
    for await (const entry of dirHandle.values()) {
      if (out.length >= MAX_FILES) break
      if (entry.kind === 'directory') {
        await walkDirectoryHandle(entry, depth + 1, base ? base + '/' + entry.name : entry.name, out)
      } else if (entry.kind === 'file') {
        const kind = kindOfFile({ name: entry.name, type: '' })
        if (!kind) continue
        try {
          const file = await entry.getFile()
          out.push({ file, kind, path: base ? base + '/' + entry.name : entry.name, depth })
        } catch (e) { /* 读取失败的文件跳过 */ }
      }
    }
  } catch (e) { /* 目录不可读 */ }
  return out
}

function readAllEntries(reader) {
  return new Promise((resolve) => {
    const acc = []
    const read = () => {
      reader.readEntries((entries) => {
        if (!entries.length) { resolve(acc); return }
        acc.push(...entries)
        read()
      }, () => resolve(acc))
    }
    read()
  })
}

export async function walkEntry(entry, depth = 1, base = '', out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej))
    const kind = kindOfFile(file)
    if (kind) out.push({ file, kind, path: base ? base + '/' + entry.name : entry.name, depth })
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    const entries = await readAllEntries(reader)
    for (const e of entries) {
      if (out.length >= MAX_FILES) break
      await walkEntry(e, depth + 1, base ? base + '/' + entry.name : entry.name, out)
    }
  }
  return out
}

export async function collectFromDataTransfer(dt) {
  const items = Array.from(dt.items || [])
  const out = []
  for (const it of items) {
    if (it.kind !== 'file') continue
    const entry = it.webkitGetAsEntry && it.webkitGetAsEntry()
    if (entry) await walkEntry(entry, 1, '', out)
    else {
      const f = it.getAsFile && it.getAsFile()
      if (f) {
        const kind = kindOfFile(f)
        if (kind) out.push({ file: f, kind, path: f.name, depth: 1 })
      }
    }
  }
  if (!out.length && dt.files) {
    Array.from(dt.files).forEach((f) => {
      const kind = kindOfFile(f)
      if (kind) out.push({ file: f, kind, path: f.webkitRelativePath || f.name, depth: 1 })
    })
  }
  return out
}

// ---------- 创建节点 ----------
export function mediaTitle(meta) {
  const name = meta.file.name.replace(/\.[^.]+$/, '')
  return name.length > 48 ? name.slice(0, 46) + '…' : name
}

export function createMediaNodes(ws, metas, opts = {}) {
  const cols = Math.max(2, Math.min(6, opts.cols || 4))
  const gapX = 26
  const gapY = 26
  const startX = opts.x != null ? opts.x : -((cols * 280) / 2)
  const startY = opts.y != null ? opts.y : -120
  const created = []
  // 音频不是一张张卡片：整批合成一个「文件夹歌单」卡，tracks 里存本地 Blob URL（会话内离线可播）
  const audioMetas = metas.filter((m) => m.kind === 'audio')
  const rest = metas.filter((m) => m.kind !== 'audio')
  if (audioMetas.length) {
    const folder = inferFolderName(audioMetas)
    const tracks = audioMetas.slice(0, 200).map((m) => ({
      title: m.file.name.replace(/\.[^.]+$/, ''),
      src: URL.createObjectURL(m.file),
      source: 'local',
      format: extOf(m.file.name) || 'mp3'
    }))
    const node = ws.addNode({
      spaceId: opts.spaceId || ws.currentId,
      kind: 'card',
      cardKind: 'audio',
      title: folder,
      x: startX, y: startY, w: 460, h: 220,
      color: '#C9A57F',
      silent: true,
      cardData: {
        title: folder,
        tracks,
        activeIndex: 0,
        folderPath: audioMetas[0].path || '',
        localFolder: true
      }
    })
    node._localObjectUrls = tracks.map((t) => t.src)
    created.push({ node, kind: 'audio', count: tracks.length })
  }
  rest.forEach((meta, i) => {
    const isVideo = meta.kind === 'video'
    const isText = meta.kind === 'text'
    const w = isVideo ? 286 : 260
    const h = isVideo ? 236 : (isText ? 220 : 216)
    const x = startX + (i % cols) * (w + gapX)
    const y = startY + Math.floor(i / cols) * (h + gapY) + (audioMetas.length ? 240 : 0)
    if (isText) {
      // 纯文本 / Markdown：直接生成一张「文档卡」，正文异步读入（见 fillTextBodies）
      const node = ws.addNode({
        spaceId: opts.spaceId || ws.currentId,
        kind: 'card',
        cardKind: 'doc',
        title: mediaTitle(meta),
        body: meta.path || meta.file.name,
        x, y, w, h,
        color: '#C4B79A',
        silent: true,
        cardData: { title: mediaTitle(meta), body: '正在读取…', filePath: meta.path || meta.file.name }
      })
      created.push({ node, file: meta.file, kind: 'text' })
      return
    }
    const objectUrl = URL.createObjectURL(meta.file)
    const node = ws.addNode({
      spaceId: opts.spaceId || ws.currentId,
      kind: meta.kind,
      title: mediaTitle(meta),
      body: (meta.path || meta.file.name) + (meta.depth > 1 ? '\n第 ' + meta.depth + ' 层' : ''),
      x, y, w, h,
      color: isVideo ? '#C99C8C' : '#A8BBCB',
      silent: true,
      media: {
        name: meta.file.name,
        type: meta.kind,
        path: meta.path || meta.file.name,
        size: meta.file.size,
        thumb: null,
        w: null,
        h: null,
        src: objectUrl
      }
    })
    node._objectUrl = objectUrl
    created.push({ node, file: meta.file, kind: meta.kind })
  })
  ws.touch('media:import', { index: true })
  return created
}

// 歌单卡标题取最浅一级目录名（如 D:\音乐 → 音乐）；散文件则用「本地音乐」
function inferFolderName(audioMetas) {
  const firstPath = audioMetas[0].path || ''
  const segs = firstPath.split(/[\\/]/).filter(Boolean)
  if (segs.length > 1) return segs[0].length > 32 ? segs[0].slice(0, 30) + '…' : segs[0]
  return '本地音乐'
}

// 文本卡正文回填：最多读 120KB（超大日志不占内存），Markdown 原样交给 MarkdownView
export async function fillTextBodies(ws, created) {
  // 一次最多读 30 个文本，避免整目录都是日志时卡住主线程
  const list = created.filter((x) => x.kind === 'text').slice(0, 30)
  for (const item of list) {
    try {
      const text = await item.file.text()
      const body = text.length > 120000 ? text.slice(0, 120000) + '\n\n…（文件过长，仅预览前 120KB）' : text
      const node = ws.nodeById(item.node.id)
      if (node) {
        node.cardData = { ...(node.cardData || {}), body }
        node.body = body.slice(0, 200)
        ws.touch('media:text', { index: false })
      }
    } catch (e) {
      const node = ws.nodeById(item.node.id)
      if (node) node.cardData = { ...(node.cardData || {}), body: '（读取失败，文件可能已被移动或没有权限）' }
    }
  }
  ws.saveNow()
}

// 异步补缩略图：并发 3，逐张回填；超过 60KB 的缩略图不落盘（避免 localStorage 爆掉）
export async function fillThumbnails(ws, created, onProgress) {
  // 音频已在歌单卡里（无需缩略图），文本走 fillTextBodies
  const queue = created.filter((x) => x.kind === 'image' || x.kind === 'video')
  let done = 0
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      try {
        const meta = await makeThumb(item.file, item.kind)
        if (meta) {
          const node = ws.nodeById(item.node.id)
          if (node && node.media) {
            node.media.thumb = meta.url && meta.url.length < 90000 ? meta.url : null
            node.media.w = meta.w || node.media.w
            node.media.h = meta.h || node.media.h
            node.media.duration = meta.duration
          }
          ws.touch('media:thumb', { index: false })
        }
      } catch (e) { /* 单张失败不影响批次 */ }
      done++
      if (onProgress) onProgress(done, created.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  ws.saveNow()
}

// ---------- Electron 桌面壳：按绝对路径导入（D:\音乐） ----------
export const isDesktopShell = () => !!(typeof window !== 'undefined' && window.eoDesktop && window.eoDesktop.listDir)

// 桌面壳内：目录扫描 → 直接生成节点，媒体地址是 eo-media:// 自定义协议（刷新 / 重启后仍可用）
export async function createPathMediaNodes(ws, dirPath, opts = {}) {
  const bridge = window.eoDesktop
  if (!bridge) throw new Error('桌面壳未启用')
  const res = await bridge.listDir(dirPath, { maxFiles: 600 })
  if (!res || !res.ok) throw new Error((res && res.error) || '读取目录失败')
  const items = res.items || []
  const created = []
  const startX = opts.x != null ? opts.x : -560
  const startY = opts.y != null ? opts.y : -120
  const cols = 4, gapX = 26, gapY = 26
  const audio = items.filter((x) => x.kind === 'audio')
  if (audio.length) {
    const name = dirPath.split(/[\\/]/).filter(Boolean).pop() || '本地音乐'
    const tracks = audio.slice(0, 200).map((x) => ({
      title: x.name.replace(/\.[^.]+$/, ''),
      src: x.url,
      source: 'local-path',
      format: extOf(x.name) || 'mp3'
    }))
    const node = ws.addNode({
      spaceId: opts.spaceId || ws.currentId, kind: 'card', cardKind: 'audio',
      title: name, x: startX, y: startY, w: 460, h: 220, color: '#C9A57F', silent: true,
      cardData: { title: name, tracks, activeIndex: 0, folderPath: dirPath, localFolder: true, desktopPath: true }
    })
    created.push({ node, kind: 'audio', count: tracks.length })
  }
  const rest = items.filter((x) => x.kind !== 'audio')
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i]
    const px = startX + (i % cols) * (286 + gapX)
    const py = startY + Math.floor(i / cols) * (236 + gapY) + (audio.length ? 240 : 0)
    if (x.kind === 'text') {
      let body = '正在读取…'
      try {
        const r = await bridge.readText(dirPath, x.path)
        body = r && r.ok ? r.text : '（读取失败）'
      } catch (e) { body = '（读取失败）' }
      const node = ws.addNode({
        spaceId: opts.spaceId || ws.currentId, kind: 'card', cardKind: 'doc',
        title: mediaTitle({ file: { name: x.name } }), body: x.path,
        x: px, y: py, w: 260, h: 220, color: '#C4B79A', silent: true,
        cardData: { title: x.name.replace(/\.[^.]+$/, ''), body, filePath: x.absPath }
      })
      created.push({ node, kind: 'text' })
      continue
    }
    // 图片 / 视频：直接用 eo-media:// 地址，桌面上无需再生成 base64 缩略图
    const node = ws.addNode({
      spaceId: opts.spaceId || ws.currentId, kind: x.kind,
      title: x.name.replace(/\.[^.]+$/, ''), body: x.path,
      x: px, y: py, w: 286, h: 236,
      color: x.kind === 'video' ? '#C99C8C' : '#A8BBCB', silent: true,
      media: { name: x.name, type: x.kind, path: x.absPath, size: x.size, thumb: x.kind === 'image' ? x.url : null, w: null, h: null, src: x.url }
    })
    created.push({ node, kind: x.kind })
  }
  ws.touch('media:path-import', { index: true })
  return created
}

// 选择文件夹（必须在用户手势中调用）
export async function pickDirectory() {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ mode: 'read', id: 'eo-media' })
  } catch (e) {
    return null
  }
}
