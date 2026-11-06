// 拖拽守卫：真实拖拽（超过阈值）结束后的极短时间内，抑制浏览器补发的 click
// 误触发画布卡片跳转。普通单击不设置该窗口，跳转照常生效。
export const dragGuard = { suppressJumpUntil: 0 }
