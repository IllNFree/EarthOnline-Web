// ===== 暖白画布卡面色板（v2.5.3 唯一来源）=====
// 2026-11-03 晚改版（用户参考稿）：主题强调色全面转暖 ——
// 黄（日历/主视觉）、珊瑚（相册/倒计时感）、鼠尾草、暖蓝、雪青、奶油，
// 与画布暖白底（--eo-bg #FAF8F3）同一温度；accent = 同色系深暖色，用于图标芯片 / 悬停描边环。
// 消费方：EntityNode.vue（PALETTE/STICKY）、GlobalContextMenu.vue（右键选色板）。
export const MACARON_PALETTE = {
  amber:  { card: '#F7CF6B', cardD: '#372B10', accent: '#C08A1E', deep: '#6B4A0C' },
  blue:   { card: '#DCEAF7', cardD: '#1C2A38', accent: '#6FA5D8', deep: '#2F5E8F' },
  pink:   { card: '#F5A48D', cardD: '#3A241C', accent: '#D26A4A', deep: '#8A3A22' },
  green:  { card: '#D8EDD4', cardD: '#1E3020', accent: '#6FB573', deep: '#376B3D' },
  purple: { card: '#E6DFF8', cardD: '#282438', accent: '#9C85D6', deep: '#57419B' },
  gray:   { card: '#F6EFE2', cardD: '#2A2A2C', accent: '#A89A82', deep: '#5C5446' }
}
// 便利贴与 PALETTE 同源派生，杜绝两份硬编码
export const STICKY_COLORS = Object.fromEntries(
  Object.entries(MACARON_PALETTE).map(([k, v]) => [k, v.card])
)
export const STICKY_COLORS_D = Object.fromEntries(
  Object.entries(MACARON_PALETTE).map(([k, v]) => [k, v.cardD])
)
