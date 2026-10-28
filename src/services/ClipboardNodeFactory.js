// ===== 剪贴板多态智能监听与孵化 =====
// 对应需求 5：复制内容切回页面后，根据 MIME 类型分发生成 笔记 / 相册 / 收藏 节点。
import { useAppStore } from '../stores/app.js'
import { canvasEnsureNode } from './canvasBridge.js'

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 读取剪贴板并孵化实体 + 节点：
 * - image/*        → 相册(photo) 节点
 * - 含 URL 的文本   → 收藏(collection / 书签) 节点
 * - 纯文本          → 笔记(memo) 节点
 * @returns {Promise<{ok:boolean, results:Array}>}
 */
export async function incubateClipboard() {
  const store = useAppStore()
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    return { ok: false, error: '当前浏览器不支持剪贴板读取 API' }
  }
  let items
  try {
    items = await navigator.clipboard.read()
  } catch (e) {
    return { ok: false, error: '读取剪贴板被拒绝（需在页面获得焦点后授权）' }
  }
  const results = []
  for (const item of items) {
    const types = item.types || []
    const imgType = types.find((t) => t.startsWith('image/'))
    if (imgType) {
      const blob = await item.getType(imgType)
      const dataUrl = await blobToDataUrl(blob)
      const r = store.addPhoto({ name: '剪贴板图片', dataUrl, tags: '' })
      if (r.ok) results.push({ ok: true, type: 'photo', refId: r.photo.id, node: canvasEnsureNode('photo', r.photo.id, { center: true, color: 'pink' }) })
      continue
    }
    if (types.includes('text/uri-list') || types.includes('text/plain')) {
      const text = await item.getType(types.includes('text/plain') ? 'text/plain' : 'text/uri-list').then((b) => b.text())
      const url = (text || '').match(/https?:\/\/\S+/)
      if (url) {
        const r = store.addCollection({ title: url[0], content: '', category: '书签', url: url[0], fileMeta: null })
        if (r.ok) results.push({ ok: true, type: 'collection', refId: r.collection.id, node: canvasEnsureNode('collection', r.collection.id, { center: true, color: 'blue' }) })
      } else {
        const r = store.addMemo({ title: (text || '').slice(0, 40) || '剪贴板笔记', markdown: text || '', tags: '' })
        if (r.ok) results.push({ ok: true, type: 'memo', refId: r.memo.id, node: canvasEnsureNode('memo', r.memo.id, { center: true, color: 'amber' }) })
      }
    }
  }
  return { ok: true, results }
}
