// ===== 静态网页一键导出（需求 11）：DOM 克隆 + 计算样式内联化 + Blob 下载 =====
// 红线：导出文件中 Haze（backdrop-filter）必须有静态降级呈现，避免非现代浏览器完全消失。
const INLINE_PROPS = [
  'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'border', 'border-radius', 'border-top', 'border-bottom', 'font-family', 'font-size',
  'font-weight', 'line-height', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'box-shadow',
  'display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'min-height',
  'opacity', 'transform', 'text-align', 'text-shadow', 'overflow', 'flex', 'gap', 'align-items', 'justify-content'
]

export function useHtmlExport() {
  /** 将节点内联化并拼装独立 HTML（backdrop-filter 静态降级为半透明白底） */
  function inlineStyles(root) {
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return
      const cs = getComputedStyle(node)
      const hasHaze = cs.backdropFilter && cs.backdropFilter !== 'none'
      let css = ''
      INLINE_PROPS.forEach((p) => {
        const v = cs.getPropertyValue(p)
        if (v) css += p + ':' + v + ';'
      })
      // 静态降级：移除实时毛玻璃，改用半透明白底近似 Haze
      if (hasHaze) {
        const bg = cs.backgroundColor || 'rgba(255,255,255,0)'
        // 在已有背景色基础上叠加不透明度，确保可读性
        css = css.replace(/backdrop-filter:[^;]*;?/g, '')
        css += 'background-color:rgba(255,255,255,.86);'
        if (cs.color && cs.color.indexOf('255, 255, 255') >= 0) css += 'color:#1E1A16;'
      }
      node.style.cssText = css
      node.removeAttribute('class')
      node.removeAttribute('id')
    })
  }

  function exportNode(el, meta) {
    if (!el || typeof document === 'undefined') return
    const clone = el.cloneNode(true)
    inlineStyles(clone)
    const title = (meta && meta.title) || '地球Online 静态导出'
    const html =
      '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + title + '</title>' +
      '<style>html,body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;}' +
      'img{max-width:100%}.eo-export-note{padding:10px 14px;font-size:12px;color:#6B645C;background:#F0EBE4}</style>' +
      '</head><body>' +
      '<div class="eo-export-note">本页面由地球Online 导出，静态只读副本（导出时间：' + new Date().toLocaleString() + '）</div>' +
      clone.outerHTML + '</body></html>'
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (meta && meta.filename) || ('地球Online-导出-' + new Date().toISOString().slice(0, 10) + '.html')
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return { exportNode }
}

// ===== 画布导出（需求 8 / 11）：把白板节点 + 连线序列化为只读 HTML =====
const NODE_BG = {
  amber: '#F5E9DA', blue: '#DCE8F5', pink: '#F5DEE8', green: '#E1F0E2', purple: '#ECE8F5', gray: '#E8E8E8'
}
const TYPE_LABEL = { task: '任务', memo: '笔记', item: '物品', photo: '照片', collection: '收藏', location: '足迹', insight: '洞察', profile: '资料', game: '游戏' }

export function exportCanvas(nodes, edges, resolve) {
  if (typeof document === 'undefined') return
  const live = nodes.filter((n) => !n.deletedAt)
  const nodeHtml = live.map((n) => {
    const e = resolve ? resolve(n) : null
    let body = ''
    if (n.type === 'task') body = e ? e.title : '（已删除）'
    else if (n.type === 'memo') body = e ? (e.title + '\n' + (e.markdown || '').slice(0, 100)) : (n.text || '')
    else if (n.type === 'photo') body = e ? '<img src="' + e.dataUrl + '" style="max-width:100%;border-radius:8px"/>' : '（已删除）'
    else if (n.type === 'collection') body = e ? e.title : '（已删除）'
    else if (n.type === 'item') body = e ? (e.name + ' ×' + e.count) : '（已删除）'
    else if (n.type === 'location') body = e ? e.name : '（已删除）'
    else if (n.type === 'insight') body = '收支洞察'
    else if (n.type === 'profile') body = '个人资料'
    else body = n.text || ''
    return '<div style="position:absolute;left:' + n.x + 'px;top:' + n.y + 'px;width:' + n.w + 'px;height:' + n.h + 'px;' +
      'background:' + (NODE_BG[n.color] || NODE_BG.amber) + ';border:1px solid rgba(0,0,0,.12);border-radius:14px;' +
      'box-sizing:border-box;padding:8px 10px;overflow:hidden;box-shadow:0 10px 24px -14px rgba(120,90,50,.5);' +
      'font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#3A2F22">' +
      '<div style="font-size:11px;font-weight:700;opacity:.6">' + (TYPE_LABEL[n.type] || n.type) + '</div>' +
      '<div style="font-size:13px;font-weight:700;margin-top:2px;white-space:pre-wrap;overflow:hidden">' + escapeHtml(body) + '</div>' +
      '</div>'
  }).join('\n')

  const edgeHtml = edges.filter((e) => !e.deletedAt).map((e) => {
    const a = live.find((n) => n.id === e.from), b = live.find((n) => n.id === e.to)
    if (!a || !b) return ''
    return '<line x1="' + (a.x + a.w / 2) + '" y1="' + (a.y + a.h / 2) + '" x2="' + (b.x + b.w / 2) + '" y2="' + (b.y + b.h / 2) + '" stroke="rgba(123,111,168,.7)" stroke-width="2"/>'
  }).join('\n')

  const width = Math.max(1200, ...live.map((n) => n.x + n.w), 200)
  const height = Math.max(800, ...live.map((n) => n.y + n.h), 200)

  const html =
    '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>地球Online 画布导出</title>' +
    '<style>html,body{margin:0;background:#EDE7DF;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}' +
    '.note{padding:10px 14px;font-size:12px;color:#6B645C;background:#F0EBE4}</style></head><body>' +
    '<div class="note">地球Online 画布静态只读副本（导出时间：' + new Date().toLocaleString() + '）· Haze 已静态降级为半透明卡片</div>' +
    '<svg width="' + width + '" height="' + height + '" style="position:absolute;left:0;top:0;overflow:visible">' + edgeHtml + '</svg>' +
    nodeHtml + '</body></html>'

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '地球Online-画布-' + new Date().toISOString().slice(0, 10) + '.html'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

