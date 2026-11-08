// ===== 全局「就地预览」状态（v3.0.2）=====
// 任意页面 / 画布卡片调用 open(type,id) 即可打开居中玻璃预览，不产生路由跳转。
// stack 保存浏览历史，预览里的关联 chip 可以继续点开并一层层返回。
import { reactive } from 'vue'

const state = reactive({
  show: false,
  current: null, // { type, id }
  stack: []
})

export function usePreview() {
  function open(type, id) {
    if (!type || !id) return
    if (state.current) state.stack.push({ ...state.current })
    state.current = { type: String(type), id: String(id) }
    state.show = true
  }
  function back() {
    const prev = state.stack.pop()
    if (prev) state.current = prev
  }
  function close() {
    state.show = false
    state.current = null
    state.stack.length = 0
  }
  return { state, open, back, close }
}

export default usePreview
