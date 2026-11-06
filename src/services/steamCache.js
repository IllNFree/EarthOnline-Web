// ===== Steam 游戏库缓存（跨页面共享）=====
// Steam 页拉取成功后写入，画布「Steam 游戏库」面板节点直接读取展示。
// 画布只做展示，绝不主动发起网络请求（面板节点是被动渲染）。
import { ref } from 'vue'

export const steamGames = ref([])
export const steamTotal = ref(0)
export const steamMeta = ref({ cfg: null, at: '' })

export function setSteamCache(games, count, cfg) {
  steamGames.value = Array.isArray(games) ? games.slice(0, 60) : []
  steamTotal.value = Number(count) || steamGames.value.length
  steamMeta.value = { cfg: cfg || null, at: new Date().toISOString() }
}
