// ============================================================
// 主页唱片卡演示音源生成器（程序化合成，无版权素材）
// 用法：npm run icons:audio  →  public/audio/demo-loop.wav
// 合成一段可无缝循环的和弦铺底（Am–F–C–G），循环点做等长交叉淡化，
// 保证唱片卡「播放 / 暂停 / 拖动进度」在真实音频上工作。
// ============================================================
import fs from 'fs'
import path from 'path'

const RATE = 22050
const DUR = 12          // 秒
const FADE = 0.4        // 秒（循环点交叉淡化长度）
const TOTAL = Math.floor(RATE * DUR)
const XFADE = Math.floor(RATE * FADE)

// ---- 音高 ----
const A4 = 440
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name)
  const semi = NOTE[m[1]] + (Number(m[2]) - 4) * 12 - 9 // 相对 A4 的半音
  return A4 * Math.pow(2, semi / 12)
}

// ---- 和弦进行：Am → F → C → G，每段 3 秒 ----
const CHORDS = [
  { t: 'A2', notes: ['A3', 'C4', 'E4'] },
  { t: 'F2', notes: ['F3', 'A3', 'C4'] },
  { t: 'C3', notes: ['C4', 'E4', 'G4'] },
  { t: 'G2', notes: ['G3', 'B3', 'D4'] },
]
const SEG = TOTAL / CHORDS.length

// ---- 音色：基频 + 二次谐波（三角波感），加轻微失谐拍频 ----
function voice(phase, f, amp) {
  return amp * (Math.sin(phase) + 0.28 * Math.sin(2 * phase) + 0.10 * Math.sin(3 * phase))
}

const buf = new Float32Array(TOTAL + XFADE)
for (let i = 0; i < buf.length; i++) {
  const t = i / RATE
  const ci = Math.min(CHORDS.length - 1, Math.floor(t / SEG))
  const local = t - ci * SEG
  // 段落内包络：起音柔和、尾端渐弱（与循环淡化叠加更自然）
  const env = Math.min(1, local / 0.25) * Math.min(1, (SEG - local) / 0.35)
  const ch = CHORDS[ci]
  let s = 0
  ch.notes.forEach((n, idx) => {
    const f = freq(n)
    const amp = 0.30 / (idx + 1.4)
    // 失谐：两个微偏的同音叠加，产生缓慢的立体声拍频
    s += voice(2 * Math.PI * f * 0.9994 * t, f, amp)
    s += voice(2 * Math.PI * f * 1.0006 * t, f, amp)
  })
  // 低音根音
  s += voice(2 * Math.PI * freq(ch.t) * t, freq(ch.t), 0.34)
  // 缓慢的呼吸感 LFO
  s *= 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.12 * t)
  buf[i] = s * env * 0.22
}

// ---- 循环点交叉淡化：把尾部 XFADE 段混回开头 ----
for (let i = 0; i < XFADE; i++) {
  const k = i / XFADE
  buf[i] = buf[i] * k + buf[TOTAL + i] * (1 - k)
}

// ---- 输出 16bit PCM WAV ----
const dataBytes = TOTAL * 2
const wav = Buffer.alloc(44 + dataBytes)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + dataBytes, 4)
wav.write('WAVE', 8)
wav.write('fmt ', 12)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)          // PCM
wav.writeUInt16LE(1, 22)          // mono
wav.writeUInt32LE(RATE, 24)
wav.writeUInt32LE(RATE * 2, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(dataBytes, 40)
for (let i = 0; i < TOTAL; i++) {
  const v = Math.max(-1, Math.min(1, buf[i]))
  wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
}

const outDir = path.join(process.cwd(), 'public/audio')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'demo-loop.wav')
fs.writeFileSync(out, wav)
console.log(`✓ 已生成 public/audio/demo-loop.wav — ${DUR}s / ${RATE}Hz 单声道 / ${(wav.length / 1024).toFixed(0)} KB`)
