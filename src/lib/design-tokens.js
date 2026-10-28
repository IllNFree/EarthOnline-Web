// ===== 设计令牌（v2.1.0）：动画常量 + 全局视觉语义 =====
// 集中管理动画参数，严禁在页面内硬编码 duration / easing / delay。
// 说明：项目为纯 JS（无 TS 构建链），故以 .js 导出常量模块，供 composables / 组件统一引用。
export const ANIM = {
  // 路由级页面过渡
  pageDuration: 260,
  pageLeaveDuration: 160,
  // 组件级过渡
  itemDuration: 220,
  // 缓动曲线（cubic-bezier）
  ease: 'cubic-bezier(.22, 1, .36, 1)',       // 标准入场/悬浮
  easeSoft: 'cubic-bezier(.34, 1.56, .64, 1)', // 弹簧回弹（按压）
  easeLeave: 'ease',                            // 离场
  // 错峰 stagger
  staggerStep: 40,
  staggerMax: 8,
  // 全局提示气泡
  toastDuration: 2600,
  // 拖拽浮层淡入
  overlayDuration: 180
}

// 原生 CSS 过渡字符串（组件内直接绑定 style）
export function transition(duration = ANIM.itemDuration, ease = ANIM.ease) {
  return `opacity ${duration}ms ${ease}, transform ${duration}ms ${ease}`
}

// 缓动曲线导出（用于 Web Animations API）
export const EASING = {
  standard: ANIM.ease,
  spring: ANIM.easeSoft,
  leave: ANIM.easeLeave
}

// 颜色语义（与 main.css 同步，便于 JS 侧动态计算）
export const TOKENS = {
  primary: '#D4A373',
  primaryDeep: '#B08553',
  primarySoft: '#E3BE97',
  accent: '#C9A87C',
  good: '#4E9668',
  bad: '#C4634C',
  radius: 22,
  radiusSm: 14,
  // 收入/支出（记账图表对齐 Android）：收入绿 / 支出红
  income: '#34C759',
  expense: '#FF3B30'
}
