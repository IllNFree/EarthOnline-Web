// ===== 用户设置封装（薄层）：统一读写 app store 中的偏好开关 =====
// 对应需求 1 / 6：主页默认视图、右键菜单开关、剪贴板监听开关等集中落库。
import { useAppStore } from '../stores/app.js'

export function useUserSettings() {
  const store = useAppStore()
  return {
    get homeDefaultView() { return store.data.homeDefaultView },
    set homeDefaultView(v) { store.data.homeDefaultView = v === 'canvas' ? 'canvas' : 'dashboard'; store.persist() },
    get enableCustomContextMenu() { return store.data.enableCustomContextMenu },
    set enableCustomContextMenu(v) { store.data.enableCustomContextMenu = !!v; store.persist() },
    get enableClipboardWatch() { return store.data.enableClipboardWatch },
    set enableClipboardWatch(v) { store.data.enableClipboardWatch = !!v; store.persist() }
  }
}
