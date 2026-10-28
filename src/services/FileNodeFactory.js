// ===== 文件拖入自动孵化：外部文件 → 收藏条目 + 画布媒体节点 =====
// 对应需求 4：MP3 / 图片 / PDF 等拖入后自动识别类型并生成节点。
import { useAppStore } from '../stores/app.js'
import { canvasEnsureNode } from './canvasBridge.js'

export function detectFileType(file) {
  const t = file.type || ''
  const name = (file.name || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('video/')) return 'video'
  if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  return 'file'
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 把拖入的文件孵化为实体 + 画布节点。
 * 图片 → 相册(photo) 节点；音频 / 视频 / PDF → 收藏(collection) 节点（带文件元数据）。
 */
export async function incubateFile(file, opts) {
  const store = useAppStore()
  const kind = detectFileType(file)
  const title = file.name || '文件'
  let type, refId
  if (kind === 'image') {
    const dataUrl = await fileToDataUrl(file)
    const r = store.addPhoto({ name: title, dataUrl, tags: '' })
    if (!r.ok) return { ok: false, error: r.error }
    type = 'photo'; refId = r.photo.id
  } else {
    const dataUrl = await fileToDataUrl(file)
    const r = store.addCollection({
      title, content: '', category: '文件', url: '',
      fileMeta: { name: file.name, mime: file.type, size: file.size, dataUrl }
    })
    if (!r.ok) return { ok: false, error: r.error }
    type = 'collection'; refId = r.collection.id
  }
  const node = canvasEnsureNode(type, refId, {
    center: true,
    color: kind === 'image' ? 'pink' : 'blue',
    text: title
  })
  return { ok: true, kind, type, refId, node }
}
