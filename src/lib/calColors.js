// 日历事件分类 → 马卡龙色（accent 系，柔和但可辨识）。
// 被 MonthGrid（日期格色条）与 CanvasPanelNode（今日 chip / 临近条目）共用，保证同一分类全站同色。
import { MACARON_PALETTE } from './palette.js'

// 兜底调色板：未知分类按出现顺序稳定分配，避免每次渲染变色
const PALETTE = [
  MACARON_PALETTE.blue.accent,
  MACARON_PALETTE.purple.accent,
  MACARON_PALETTE.green.accent,
  MACARON_PALETTE.pink.accent,
  MACARON_PALETTE.amber.accent,
  MACARON_PALETTE.gray.accent
]
// 已知语义分类 → 固定色（与「待办=蓝」的用户心智一致）
const KNOWN = {
  todo: MACARON_PALETTE.blue.accent,
  task: MACARON_PALETTE.amber.accent,
  work: MACARON_PALETTE.purple.accent,
  meeting: MACARON_PALETTE.purple.accent,
  study: MACARON_PALETTE.green.accent,
  health: MACARON_PALETTE.green.accent,
  exercise: MACARON_PALETTE.green.accent,
  life: MACARON_PALETTE.pink.accent,
  fun: MACARON_PALETTE.pink.accent,
  default: MACARON_PALETTE.amber.accent
}

// 从任务列表构建「分类 → 颜色」映射（按首次出现顺序分配未知分类，渲染稳定）
export function buildCatColorMap(tasks) {
  const map = {}
  let i = 0
  ;(tasks || []).forEach((t) => {
    const c = t && t.category
    if (!c) return
    if (map[c] === undefined) map[c] = KNOWN[c] || PALETTE[i++ % PALETTE.length]
  })
  return map
}

export function colorOf(map, cat) {
  if (!cat) return KNOWN.default
  if (map && map[cat] !== undefined) return map[cat]
  return KNOWN[cat] || KNOWN.default
}
