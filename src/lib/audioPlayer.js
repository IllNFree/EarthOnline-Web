// ============================================================
// 主页唱片卡音频引擎（开源组件 makenoise · 底层 Howler.js）
// makenoise 提供框架无关的播放器抽象：播放 / 暂停 / 进度 / 定位 / 队列，
// 并内置浏览器媒体控制集成。这里以单例方式挂载，供画布内的唱片卡共用。
// ============================================================
import { createPlayer } from 'makenoise'

let player = null

function savedVolume() {
  try {
    const v = Number(localStorage.getItem('eo:music_volume'))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6
  } catch (e) { return 0.6 }
}

export function getCanvasPlayer() {
  if (!player) {
    player = createPlayer({
      volume: savedVolume(),
      progressInterval: 200,
      // 系统媒体控制（锁屏 / 耳机键）由歌曲信息驱动；画布内切歌时元数据会跟着更新
      mediaSession: true,
      repeat: 'all'
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
