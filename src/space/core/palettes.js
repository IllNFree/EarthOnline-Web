// ===== 色彩预设（微暖灰白体系） =====
// 所有节点色只作为「极克制的点缀」：卡片始终白底，仅左侧色条 / 图标 / 空间卡片底色使用低饱和色。
export const PALETTES = [
  {
    id: 'warm', name: '暖砂', colors: ['#E8B86D', '#DDA77B', '#C9A77C', '#B79A8B', '#D7C4A3', '#A99A86']
  },
  {
    id: 'sage', name: '鼠尾草', colors: ['#9DB3A0', '#B4C3A8', '#8FA9A3', '#C3CBB8', '#A9B7B0', '#7F9A8E']
  },
  {
    id: 'mist', name: '雾蓝', colors: ['#A8BBCB', '#B9C7D4', '#93A9BC', '#C6D3DA', '#9FB2C1', '#8296A8']
  },
  {
    id: 'clay', name: '陶土', colors: ['#C99C8C', '#D5AFA0', '#B88A7D', '#E0C3B4', '#C7A69A', '#A9806F']
  },
  {
    id: 'ink', name: '墨灰', colors: ['#9A9A96', '#B4B2AC', '#80807C', '#C8C5BD', '#A6A5A0', '#6F706C']
  },
  {
    id: 'rose', name: '干玫瑰', colors: ['#D3A6A6', '#E0BEBE', '#BE8F8F', '#E8CDCD', '#C9AAAA', '#A87C7C']
  }
]

export const DEFAULT_COLORS = ['#2C2C2C', '#C99C8C', '#9DB3A0', '#A8BBCB', '#E8B86D', '#9A9A96']

export function paletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0]
}

// 稳定散列 → 同一节点每次打开都拿到同一颜色
export function autoColor(seed, paletteId = 'warm') {
  const p = paletteById(paletteId)
  let h = 0
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) % 997
  return p.colors[h % p.colors.length]
}

export function tintOf(hex, alpha = 0.12) {
  if (!hex || !hex.startsWith('#')) return 'rgba(255,255,255,0.5)'
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

export function inkFor(hex) {
  // 低饱和点缀色之上，文字始终回到暖深灰，保证可读性
  return '#2C2C2C'
}
