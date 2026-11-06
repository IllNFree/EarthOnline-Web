// ===== 内置插件（模块三：Steam 游戏库插件化） =====
// 内置插件随应用发布，以普通插件条目形态出现在「插件中心」，可随时开关。
// 关闭时：导航入口 / 页面路由 / 画布数据面板 / 相关数据全部隐藏。
import { BUILTIN_PLUGINS, isBuiltinEnabled } from '../lib/model.js'
import { pluginRegistry, createPluginAPI } from './PluginAPI.js'

export { BUILTIN_PLUGINS, isBuiltinEnabled }

// 挂载单个内置插件：注册导航入口 + 画布面板归属
export function mountBuiltinPlugin(manifest, notify) {
  const def = BUILTIN_PLUGINS.find((b) => b.id === manifest.id)
  if (!def) return
  const api = createPluginAPI({ getData: () => manifest.__getData ? manifest.__getData() : {}, notify, owner: manifest.id })
  if (def.nav) api.registerNav(def.nav)
  if (def.panelKind) api.registerPanel({ kind: def.panelKind, label: def.label })
}

// 应用启动时挂载全部已启用的内置插件
export function mountEnabledBuiltinPlugins(store, notify) {
  ;(store.data.plugins || []).filter((p) => p.source === 'builtin' && p.enabled).forEach((p) => {
    try {
      const m = Object.assign({}, p, { __getData: () => store.data })
      mountBuiltinPlugin(m, notify)
    } catch (e) { pluginRegistry.errors[p.id] = String((e && e.message) || e) }
  })
}

// 某个内置插件当前是否启用（基于已安装清单）
export function builtinEnabled(store, builtinKey) {
  const def = BUILTIN_PLUGINS.find((b) => b.builtin === builtinKey)
  if (!def) return false
  return isBuiltinEnabled(store.data.plugins, def.id)
}

// 某内置插件对应的画布面板是否应显示（关闭插件 ⇒ 面板隐藏）
export function builtinPanelVisible(store, builtinKey, kind) {
  const def = BUILTIN_PLUGINS.find((b) => b.builtin === builtinKey)
  if (!def || def.panelKind !== kind) return true
  return builtinEnabled(store, builtinKey)
}
