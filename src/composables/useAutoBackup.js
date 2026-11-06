// 定时静默备份 + 回收站自动清理：每 intervalMin 分钟把当前已落库状态写入本地备份环（保留最近 5 份）。
import { onMounted, onUnmounted } from 'vue'
import { loadState } from '../lib/storage.js'

const KEY = 'eo_auto_backup_v1'
const KEEP = 5

export function useAutoBackup(store) {
  let timer = null
  async function backup() {
    if (store.data.autoBackup && store.data.autoBackup.enabled === false) return
    try {
      const state = await loadState()
      const list = JSON.parse(localStorage.getItem(KEY) || '[]')
      list.unshift({ ts: Date.now(), state })
      while (list.length > KEEP) list.pop()
      localStorage.setItem(KEY, JSON.stringify(list))
    } catch (e) {}
  }
  function start() {
    const mins = Math.max(1, Number((store.data.autoBackup && store.data.autoBackup.intervalMin) || 30))
    if (timer) clearInterval(timer)
    timer = setInterval(backup, mins * 60000)
  }
  onMounted(() => { start(); setTimeout(backup, 3000) })
  onUnmounted(() => { if (timer) clearInterval(timer) })
  return { backup, start }
}
