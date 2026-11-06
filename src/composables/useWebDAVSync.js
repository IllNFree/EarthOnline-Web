// ===== WebDAV 无感自动同步（需求 1）：启动静默拉取 + 页面隐藏时推送 =====
// 复用现有 webdav.js（契约一致：远端文件名 / 主键合并 / lastSyncAt / 软删除）。
// 刻意「彻底隐藏同步弹窗」：本模块不弹任何 toast / 弹窗，仅在后台静默执行。
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { pullBackup, pushBackup, mergeBackup, remoteIsNewer, DEFAULT_REMOTE_PATH, loadDavConfig } from '../lib/webdav.js'

const DAV_KEY = 'eo_webdav_cfg_v2'
function loadDav() {
  return loadDavConfig()
}

export function useWebDAVSync() {
  const store = useAppStore()
  let started = false

  async function silentPull() {
    const cfg = loadDav()
    if (!cfg.autoSync || !cfg.url || !store.online) return
    try {
      const r = await pullBackup(cfg)
      if (!r.ok) { store.setSyncError(r.error || '云端拉取失败'); return }
      store.setSyncError('')
      const remote = r.payload
      if (!remoteIsNewer(remote.exportedAt, store.data.lastSyncAt)) return
      const { patch } = mergeBackup(store.data, remote.state)
      Object.keys(patch).forEach((k) => { store.data[k] = patch[k] })
      store.persist()
      store.data.lastSyncAt = remote.exportedAt || new Date().toISOString()
    } catch (e) { store.setSyncError((e && e.message) || '云端拉取失败') }
  }

  async function silentPush() {
    const cfg = loadDav()
    if (!cfg.autoSync || !cfg.url || !store.online) return
    try {
      const r = await pushBackup(cfg, store.data)
      if (r.ok) { store.data.lastSyncAt = r.syncedAt || new Date().toISOString(); store.setSyncError('') }
      else store.setSyncError(r.error || '云端推送失败')
    } catch (e) { store.setSyncError((e && e.message) || '云端推送失败') }
  }

  function onVisibility() {
    // 页面切到后台（document.hidden === true）时自动推送
    if (document.hidden) silentPush()
  }

  function start() {
    if (started) return
    started = true
    // 启动静默拉取（不弹窗）
    silentPull()
    document.addEventListener('visibilitychange', onVisibility)
  }
  function stop() {
    document.removeEventListener('visibilitychange', onVisibility)
    started = false
  }

  onMounted(start)
  onUnmounted(stop)
  return { silentPull, silentPush, start, stop }
}
