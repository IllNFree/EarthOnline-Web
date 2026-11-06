// ===== 沉浸式成就音效服务（模块五）=====
// 使用 howler.js 封装全局 AudioService，预加载 普通 / 稀有 / 传说 三档音效。
// 由于项目零外部资源红线，三档音效用 WebAudio 合成正弦波后编码为 WAV dataURI 供 Howler 播放，
// 不依赖任何二进制音频文件；若后续要替换为真实音效，仅需改 TIERS[*].url 即可。
import { Howl, Howler } from 'howler'

const SAMPLE_RATE = 22050

// 生成单音正弦波采样（带淡入淡出包络，避免爆音）
function toneSamples(freq, dur, gain = 0.5, type = 'sine') {
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    let s
    const ph = 2 * Math.PI * freq * t
    if (type === 'triangle') s = (2 / Math.PI) * Math.asin(Math.sin(ph))
    else if (type === 'square') s = Math.sign(Math.sin(ph)) * 0.6
    else s = Math.sin(ph)
    // 5ms 淡入淡出
    const env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.005)
    out[i] = s * gain * env
  }
  return out
}
function concat(...bufs) {
  let len = 0
  bufs.forEach((b) => (len += b.length))
  const out = new Float32Array(len)
  let off = 0
  bufs.forEach((b) => { out.set(b, off); off += b.length })
  return out
}
// 编码为 16bit PCM mono WAV 的 base64 dataURI
function encodeWav(samples) {
  const bytesPer = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPer)
  const dv = new DataView(buffer)
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * bytesPer, true); ws(8, 'WAVE')
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint32(24, SAMPLE_RATE, true); dv.setUint32(28, SAMPLE_RATE * bytesPer, true)
  dv.setUint16(32, bytesPer, true); dv.setUint16(34, 16, true)
  ws(36, 'data'); dv.setUint32(40, samples.length * bytesPer, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    off += 2
  }
  // ArrayBuffer -> base64
  const u8 = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

// 三档音效：普通（单音）/ 稀有（双音上行）/ 传说（三音琶音带光晕）
const TIERS = {
  common: { src: [encodeWav(toneSamples(523.25, 0.18, 0.4))] },
  rare: { src: [encodeWav(concat(toneSamples(523.25, 0.12, 0.4), toneSamples(783.99, 0.16, 0.4)))] },
  legendary: {
    src: [encodeWav(concat(
      toneSamples(523.25, 0.1, 0.38),
      toneSamples(659.25, 0.1, 0.38),
      toneSamples(1046.5, 0.22, 0.42)
    ))]
  }
}
const RARITY_TIER = { common: 'common', rare: 'rare', epic: 'rare', legendary: 'legendary' }

let loaded = false
const pool = {}

function ensure() {
  if (loaded) return
  Object.keys(TIERS).forEach((k) => {
    pool[k] = new Howl({ src: TIERS[k].src, format: ['wav'], preload: true, html5: false, volume: 0.6 })
  })
  loaded = true
}

export const AudioService = {
  /** 解锁音频上下文（需在用户手势后调用一次，满足浏览器自动播放策略） */
  unlock() {
    try {
      ensure()
      const ctx = getCtx()
      if (ctx) {
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
        // iOS Safari 兜底：播放一次静音帧彻底解锁输出通道
        try {
          const b = ctx.createBuffer ? ctx.createBuffer(1, 1, 22050) : null
          const src = b && ctx.createBufferSource ? ctx.createBufferSource() : null
          if (src && ctx.destination) { src.buffer = b; src.connect(ctx.destination); src.start(0) }
        } catch (e) {}
      }
      if (Howler._autoUnlock && Howler._autoUnlock()) { /* 已触发自动解锁 */ }
    } catch (e) {}
  },
  /** 播放指定稀有度的音效；静音或上下文不可用时静默失败 */
  play(rarity) {
    const store = globalThis.__EO_STORE__
    const muted = store && store.data && store.data.achievementSoundMuted
    if (muted) return
    try {
      ensure()
      const ctx = getCtx()
      if (ctx && ctx.createOscillator) {
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
        chime(ctx, rarity)
        return
      }
      // 无 WebAudio（极老浏览器）时回退到 Howler 预生成音
      const tier = RARITY_TIER[rarity] || 'common'
      const h = pool[tier]
      if (h) h.play()
    } catch (e) {}
  },
  setMuted(m) {
    try { Howler.mute(!!m) } catch (e) {}
  }
}

// 缓存 AudioContext（优先复用 Howler 已创建的上下文）
let _ctx = null
function getCtx() {
  if (_ctx && _ctx.createOscillator) return _ctx
  try {
    const c = Howler.ctx || (globalThis.Howler && globalThis.Howler.ctx)
    if (c && c.createOscillator) { _ctx = c; return _ctx }
  } catch (e) {}
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (AC) { _ctx = new AC(); return _ctx }
  } catch (e) {}
  return null
}

// 成就音效：WebAudio 实时合成「钟琴双音」，比预生成 WAV 更响、更长、更清晰
// （三音琶音给传说级；每个音带一层倍频泛音，衰减约 0.6s）
function chime(ctx, rarity) {
  const NOTES = {
    common: [659.25, 880],
    rare: [659.25, 987.77],
    epic: [587.33, 880, 1174.66],
    legendary: [523.25, 659.25, 880, 1046.5]
  }
  const notes = NOTES[rarity] || NOTES.common
  const t0 = ctx.currentTime + 0.02
  const gap = 0.16
  const dur = 0.62
  notes.forEach((f, i) => {
    const start = t0 + i * gap
    const peak = 0.42
    // 主音（三角波更柔和） + 倍频泛音（正弦，做出「铃」的通透感）
    const layers = [
      { type: 'triangle', freq: f, gain: peak },
      { type: 'sine', freq: f * 2, gain: peak * 0.28 }
    ]
    layers.forEach((ly) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = ly.type
      osc.frequency.setValueAtTime(ly.freq, start)
      // 轻微下滑，避免机械感
      if (osc.frequency.exponentialRampToValueAtTime) {
        osc.frequency.exponentialRampToValueAtTime(ly.freq * 0.97, start + dur)
      }
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(ly.gain, start + 0.018)
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + dur + 0.02)
    })
  })
}
