// ===== 设备性能探测与帧率计 =====
// 3D 空间过渡、阴影、迷你地图实时刷新均据此降级；宁可少一个动效，也不掉帧。

export function detectDeviceTier() {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const cores = nav.hardwareConcurrency || 4
  const mem = nav.deviceMemory || 8
  const ua = nav.userAgent || ''
  const mobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  let tier = 'high'
  let reason = ''
  if (mobile) { tier = 'low'; reason = '移动端' }
  else if (cores <= 4) { tier = 'low'; reason = 'CPU 核心 ' + cores }
  else if (mem <= 4) { tier = 'low'; reason = '内存 ' + mem + 'GB' }
  else if (dpr > 2.5 && cores <= 6) { tier = 'mid'; reason = '高分屏 / 中等 CPU' }
  else if (cores <= 6) { tier = 'mid'; reason = 'CPU 核心 ' + cores }
  return { tier, reason, cores, mem, mobile, dpr }
}

export class FpsMeter {
  constructor() {
    this.frames = 0
    this.start = 0
    this.fps = 60
    this.low = false
    this.samples = []
  }
  tick(now) {
    if (!this.start) this.start = now
    this.frames++
    const elapsed = now - this.start
    if (elapsed >= 700) {
      const fps = Math.round(this.frames * 1000 / elapsed)
      this.fps = fps
      this.frames = 0
      this.start = now
      this.samples.push(fps)
      if (this.samples.length > 8) this.samples.shift()
      const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
      this.low = this.samples.length >= 3 && avg < 42
      return true
    }
    return false
  }
}
