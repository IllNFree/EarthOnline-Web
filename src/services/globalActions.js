// ===== 全局核心动作（模块五） =====
// 刷新数据 / 立即备份 / 本地搜索 —— 由「全局右键菜单」与「画布空白右键菜单」共用，
// 避免同一套逻辑两处实现导致行为漂移。
import { pushBackup, loadDavConfig } from '../lib/webdav.js'

// 刷新数据：从本地存储重新载入，并同步成就 / 回收站过期清理
export async function refreshData(store) {
  try {
    await store.init()
    store.applyTheme()
    store.showToast('数据已刷新')
  } catch (e) {
    store.showToast('刷新失败：' + (e && e.message ? e.message : '未知错误'))
  }
}

// 立即备份：读取本机 WebDAV 配置并手动推送一次
export async function backupNow(store, onNeedConfig) {
  const cfg = loadDavConfig()
  if (!cfg.url) {
    store.showToast('尚未配置 WebDAV，请先到「设置 → 数据 · 备份」填写')
    if (typeof onNeedConfig === 'function') onNeedConfig()
    return
  }
  if (!store.requireOnline('立即备份')) return
  store.showToast('正在备份…')
  try {
    const r = await pushBackup(cfg, store.data)
    if (r.ok) {
      store.data.lastSyncAt = r.syncedAt || new Date().toISOString()
      store.persist()
      store.setSyncError('')
      store.showToast('已备份到 WebDAV')
    } else {
      store.setSyncError(r.error || '备份失败')
      store.showToast('备份失败：' + (r.error || '未知错误'))
    }
  } catch (e) {
    const msg = (e && e.message) || '未知错误'
    store.setSyncError(msg)
    store.showToast('备份失败：' + msg)
  }
}

// 本地搜索：唤起全局搜索框并聚焦输入框
export function openGlobalSearch(store) {
  store.toggleSearch(true)
  setTimeout(() => {
    const el = document.getElementById('eo-global-search')
    if (el && el.focus) el.focus()
  }, 60)
}
