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
