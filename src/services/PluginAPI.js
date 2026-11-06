// ===== 模块六：平台化插件系统核心 =====
// PluginAPI 契约 + 沙箱隔离（本地 JS 走 Proxy 沙箱；URL 走 iframe sandbox）。
// 红线：插件绝不能直接操作 window / document / IndexedDB / localStorage，
// 只能通过本 API 经授权后读写受限数据；任何插件运行错误都被捕获，不白屏。
import { reactive } from 'vue'
import { useAppStore } from '../stores/app.js'

// 全局插件注册表（响应式，UI 直接读取渲染）
export const pluginRegistry = reactive({
  routes: {},        // path -> { owner, path, title, icon, render?, renderHTML? }
  contextMenus: [],  // { owner, id, label, icon, run }
  canvasNodes: {},   // type -> { owner, type, label, color }
  navItems: {},      // id -> { owner, name, icon, label, path }（插件提供的左侧导航入口）
  panels: {},        // kind -> { owner, kind, label }（插件拥有的画布数据面板）
  errors: {},        // id -> 最近一次错误信息
  _iframes: {}       // id -> { iframe, bridge }（仅 URL 插件）
})

export const PLUGIN_PERMISSIONS = [
  { key: 'store:read', label: '读取应用数据（只读，不可修改）' },
  { key: 'route', label: '注册自定义页面路由' },
  { key: 'canvasNode', label: '在画布挂载自定义节点类型' },
  { key: 'contextMenu', label: '在右键菜单添加自定义项' },
  { key: 'network', label: '发起网络请求（fetch / XHR）' }
]

function recordError(id, e) {
  const msg = e && e.message ? e.message : String(e)
  pluginRegistry.errors[id] = msg
  // eslint-disable-next-line no-console
  console.warn('[插件] ' + id + ' 运行异常：', e)
}

// 受限数据代理：只读，写操作一律拒绝（即便授权 store:write 也走显式 API）
function makeStoreProxy(getData) {
  const handler = {
    get(t, k) {
      if (k === Symbol.toPrimitive || k === 'toJSON') return undefined
      const v = t[k]
      if (typeof v === 'object' && v !== null) return new Proxy(v, handler)
      return v
    },
    set() { throw new Error('插件无权写入应用数据（请申请 store:write 并经 API 操作）') },
    deleteProperty() { throw new Error('插件无权删除应用数据') }
  }
  return new Proxy(getData(), handler)
}

// 构建一个插件可调用 API 实例（owner = 插件 id，用于卸载时回收）
export function createPluginAPI({ getData, notify, owner }) {
  return {
    version: '1.0',
    // 注册一个页面路由：render(ctx) 返回 HTML 字符串（本地插件）；renderHTML 为静态串（URL 插件）
    registerRoute(meta) {
      if (!meta || !meta.path) return
      pluginRegistry.routes[meta.path] = {
        owner,
        path: meta.path,
        title: meta.title || '插件页面',
        icon: meta.icon || 'puzzle',
        render: typeof meta.render === 'function' ? meta.render : null,
        renderHTML: typeof meta.renderHTML === 'string' ? meta.renderHTML : ''
      }
    },
    // 在画布注册一种节点类型
    registerCanvasNode(meta) {
      if (!meta || !meta.type) return
      pluginRegistry.canvasNodes[meta.type] = { owner, type: meta.type, label: meta.label || meta.type, color: meta.color || '#2C2C2C' }
    },
    // 在右键菜单注册一个自定义项（run 为函数，本地插件专用）
    registerContextMenu(item) {
      if (!item || !item.label) return
      pluginRegistry.contextMenus.push({ owner, id: item.id || ('pm_' + Math.random().toString(36).slice(2, 8)), label: item.label, icon: item.icon || 'puzzle', run: typeof item.run === 'function' ? item.run : null })
    },
    // 注册一个左侧导航入口（插件化迁移：如 Steam 游戏库）
    registerNav(meta) {
      if (!meta || !meta.path) return
      pluginRegistry.navItems[owner] = {
        owner,
        name: meta.name || owner,
        icon: meta.icon || 'puzzle',
        label: meta.label || meta.name || owner,
        path: meta.path
      }
    },
    // 声明插件拥有的画布数据面板（关闭插件时该面板一并隐藏）
    registerPanel(meta) {
      if (!meta || !meta.kind) return
      pluginRegistry.panels[meta.kind] = { owner, kind: meta.kind, label: meta.label || meta.kind }
    },
    // 受限只读数据访问
    accessStore() { return makeStoreProxy(getData) },
    // 轻量提示
    toast(msg) { notify(msg) },
    perms: (p) => p
  }
}

// ---------- 本地 JS 插件：Proxy 沙箱执行 ----------
export function runLocalPlugin(manifest, code, api) {
  const sandbox = {
    eoPlugin: (setup) => { try { setup(api) } catch (e) { recordError(manifest.id, e) } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN
  }
  const handler = {
    get(t, p) {
      if (p in t) return t[p]
      if (p === 'window' || p === 'globalThis' || p === 'self' || p === 'parent' || p === 'top') return proxy
      // 直操 DOM / 本地存储 —— 一律阻断
      if (p === 'document' || p === 'localStorage' || p === 'indexedDB' || p === 'sessionStorage' || p === 'indexedDB') return undefined
      // 网络：仅授权 network 时放行
      if (p === 'fetch' || p === 'XMLHttpRequest') return (manifest.permissions || []).includes('network') ? (p === 'fetch' ? fetch : XMLHttpRequest) : undefined
      return undefined
    },
    set() { return false },
    has() { return true }
  }
  const proxy = new Proxy(sandbox, handler)
  try {
    // 插件代码需调用 eoPlugin(setupFn) 完成注册；作用域内仅能访问沙箱白名单
    const fn = new Function('api', 'with(this){\n' + String(code) + '\n}\n')
    fn.call(proxy, api)
  } catch (e) { recordError(manifest.id, e) }
}

// ---------- URL 插件：iframe sandbox 隔离 ----------
export function loadUrlPlugin(manifest, notify) {
  return fetch(manifest.entry)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text() })
    .then((code) => {
      const api = createPluginAPI({ getData: () => useAppStore().data, notify, owner: manifest.id })
      const bridge = (ev) => {
        const d = ev.data || {}
        if (d.__eo === 'registerRoute') pluginRegistry.routes[d.path] = { owner: manifest.id, path: d.path, title: d.title || '插件页面', icon: d.icon || 'puzzle', render: null, renderHTML: d.renderHTML || '' }
        else if (d.__eo === 'registerContextMenu') pluginRegistry.contextMenus.push({ owner: manifest.id, id: d.id || ('pm_' + Math.random().toString(36).slice(2, 8)), label: d.label, icon: d.icon || 'puzzle', run: null })
        else if (d.__eo === 'registerCanvasNode') pluginRegistry.canvasNodes[d.type] = { owner: manifest.id, type: d.type, label: d.label || d.type, color: d.color || '#2C2C2C' }
        else if (d.__eo === 'toast') notify(d.msg)
        else if (d.__eo === 'error') recordError(manifest.id, d.msg)
      }
      window.addEventListener('message', bridge)
      const srcdoc = '<!doctype html><meta charset="utf-8"><script>' +
        'var __eoMenus={};' +
        'var api={version:"1.0",' +
        'registerRoute:function(m){parent.postMessage(Object.assign({__eo:"registerRoute"},m),"*")},' +
        'registerCanvasNode:function(m){parent.postMessage(Object.assign({__eo:"registerCanvasNode"},m),"*")},' +
        'registerContextMenu:function(m){__eoMenus[m.id]=m.run;parent.postMessage(Object.assign({__eo:"registerContextMenu"},m),"*")},' +
        'toast:function(msg){parent.postMessage({__eo:"toast",msg:msg},"*")},' +
        'accessStore:function(){return{}},' +
        'perms:function(p){return p}};' +
        'window.addEventListener("message",function(ev){var d=ev.data||{};if(d.__eoRun&&__eoMenus[d.__eoRun]){try{__eoMenus[d.__eoRun]()}catch(e){parent.postMessage({__eo:"error",msg:String(e)},"*")}}});' +
        'window.eoPlugin=function(setup){try{setup(api)}catch(e){parent.postMessage({__eo:"error",msg:String(e)},"*")}};' +
        'try{' + code + '}catch(e){parent.postMessage({__eo:"error",msg:String(e)},"*")}' +
        '<\/script>'
      const iframe = document.createElement('iframe')
      iframe.sandbox = 'allow-scripts'
      iframe.style.display = 'none'
      iframe.srcdoc = srcdoc
      document.body.appendChild(iframe)
      pluginRegistry._iframes[manifest.id] = { iframe, bridge }
    })
    .catch((e) => recordError(manifest.id, e))
}

// 卸载某插件：回收其注册的所有路由 / 菜单 / 节点 / 导航入口 / 面板，并销毁 iframe
export function unloadPlugin(manifest) {
  const id = manifest.id
  Object.keys(pluginRegistry.routes).forEach((p) => { if (pluginRegistry.routes[p].owner === id) delete pluginRegistry.routes[p] })
  pluginRegistry.contextMenus = pluginRegistry.contextMenus.filter((m) => m.owner !== id)
  Object.keys(pluginRegistry.canvasNodes).forEach((t) => { if (pluginRegistry.canvasNodes[t].owner === id) delete pluginRegistry.canvasNodes[t] })
  Object.keys(pluginRegistry.navItems).forEach((k) => { if (pluginRegistry.navItems[k].owner === id) delete pluginRegistry.navItems[k] })
  Object.keys(pluginRegistry.panels).forEach((k) => { if (pluginRegistry.panels[k].owner === id) delete pluginRegistry.panels[k] })
  const rec = pluginRegistry._iframes[id]
  if (rec) {
    if (rec.bridge) window.removeEventListener('message', rec.bridge)
    if (rec.iframe && rec.iframe.parentNode) rec.iframe.parentNode.removeChild(rec.iframe)
    delete pluginRegistry._iframes[id]
  }
  delete pluginRegistry.errors[id]
}

// 应用启动时挂载所有已启用插件（本地代码从 localStorage 读取，避免入库同步外泄）
export function mountEnabledPlugins(notify) {
  const store = useAppStore()
  ;(store.data.plugins || []).filter((p) => p.enabled).forEach((p) => {
    try {
      if (p.source === 'url') loadUrlPlugin(p, notify)
      else {
        const code = localStorage.getItem('eo_plugin_code_' + p.id)
        if (code) runLocalPlugin(p, code, createPluginAPI({ getData: () => store.data, notify, owner: p.id }))
      }
    } catch (e) { recordError(p.id, e) }
  })
}

export const PLUGIN_CODE_PREFIX = 'eo_plugin_code_'
