// ============================================================
// 主页唱片卡音频引擎（开源组件 makenoise · 底层 Howler.js）
// makenoise 提供框架无关的播放器抽象：播放 / 暂停 / 进度 / 定位 / 队列，
// 并内置浏览器媒体控制集成。这里以单例方式挂载，供画布内的唱片卡共用。
// ============================================================
import { createPlayer } from 'makenoise'

let player = null

export function getCanvasPlayer() {
  if (!player) {
    player = createPlayer({
      volume: 0.6,
      progressInterval: 200,
      // 画布内可能有多个唱片卡，交给浏览器媒体控制反而突兀 → 关闭
      mediaSession: false,
      repeat: 'one'
    })
  }
  return player
}

// 当前正在播放的卡片标识（同一时刻只允许一张唱片在放）
let activeKey = null
export function getActiveAudioKey() { return activeKey }
export function setActiveAudioKey(k) { activeKey = k }

export function destroyCanvasPlayer() {
  if (player) { try { player.destroy() } catch (e) { /* ignore */ } }
  player = null
  activeKey = null
}
