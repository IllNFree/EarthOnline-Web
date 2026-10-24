// ===== 备份 / 导入（保持 fileMetaJson 跨端契约） =====
// Web 端附件以 dataURL 内联存储；导出时映射为 fileMetaJson 便于其他端还原。
import { APP_INFO } from './model.js'

// 从 state 中抽取内联附件（dataURL 形式），生成 fileMetaJson
function collectAttachments(state) {
  const atts = []
  const push = (id, dataUrl) => {
    if (!dataUrl || !String(dataUrl).startsWith('data:')) return
    const mime = (dataUrl.split(';')[0] || 'data:').replace('data:', '') || 'application/octet-stream'
    atts.push({ id, mime, dataUrl })
  }
  ;(state.items || []).forEach((i) => push('item:' + i.id, i.cover))
  ;(state.collections || []).forEach((c) => push('col:' + c.id, c.cover))
  if (state.profile && state.profile.avatarData) push('avatar', state.profile.avatarData)
  return atts
}

export function buildBackup(state) {
  const attachments = collectAttachments(state)
  const fileMetaJson = {}
  attachments.forEach((a) => { fileMetaJson[a.id] = { mime: a.mime, fileUri: a.id } })
  return {
    schema: 'earth-online-backup',
    version: 1,
    app: APP_INFO.appName,
    platform: 'web',
    exportedAt: new Date().toISOString(),
    fileMetaJson,
    attachments,
    state
  }
}
export function serializeBackup(state) {
  return JSON.stringify(buildBackup(state), null, 2)
}
// 导入：合并 attachments 回 cover 字段，再返回净化后的 state
export function parseBackup(text) {
  const obj = typeof text === 'string' ? JSON.parse(text) : text
  if (!obj || !obj.state) throw new Error('备份格式不合法')
  const attMap = {}
  ;(obj.attachments || []).forEach((a) => { attMap[a.id] = a.dataUrl })
  const st = obj.state
  ;(st.items || []).forEach((i) => { if (i.cover && attMap['item:' + i.id]) i.cover = attMap['item:' + i.id] })
  ;(st.collections || []).forEach((c) => { if (c.cover && attMap['col:' + c.id]) c.cover = attMap['col:' + c.id] })
  if (st.profile && st.profile.avatarData && attMap['avatar']) st.profile.avatarData = attMap['avatar']
  return st
}
export function downloadBackup(state, filename) {
  const blob = new Blob([serializeBackup(state)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || ('地球Online-备份-' + new Date().toISOString().slice(0, 10) + '.json')
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
