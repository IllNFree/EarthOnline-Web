// ===== 全局动画架构（需求 6）：路由级 View Transitions + CSS 降级 =====
// 严格从 design-tokens 取动画参数，禁止页面内硬编码 duration/easing。
import { ANIM } from '../lib/design-tokens.js'

/** 浏览器是否支持 View Transitions API */
export const supportsViewTransition =
  typeof document !== 'undefined' && typeof document.startViewTransition === 'function'

/**
 * 包裹一次「视图更新」（通常是路由切换或 DOM 重排），优先走 View Transitions API；
 * 不支持的浏览器自动降级为直接执行（由 CSS <Transition> 兜底路由动画）。
 * @param {Function} update 返回 Promise 或同步的视图更新回调
 */
export function withPageTransition(update) {
  if (!supportsViewTransition) {
    const r = update()
    return r instanceof Promise ? r : Promise.resolve(r)
  }
  return document.startViewTransition(update)
}

/** 返回路由 <transition> 统一使用的 JS 钩子参数（保持与 CSS 一致） */
export function pageTransitionProps() {
  return {
    enterActiveClass: 'eo-vt-enter-active',
    leaveActiveClass: 'eo-vt-leave-active',
    enterFromClass: 'eo-vt-enter-from',
    leaveToClass: 'eo-vt-leave-to'
  }
}

export const ANIM_CONST = ANIM
