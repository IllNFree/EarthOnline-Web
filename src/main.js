import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router/index.js'
import { useAppStore } from './stores/app.js'
import App from './App.vue'
import './styles/main.css'
import { registerSW } from 'virtual:pwa-register'
import { updateState } from './services/appUpdate.js'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// v2.1.0 终极封板：全局异常兜底（独立于组件树的错误也归口处理，避免整页白屏）
// 同时把真实堆栈写入 window.__errs，便于 QA 脚本定位具体组件/行号（如 toFixed 异常）
window.__errs = window.__errs || []
app.config.errorHandler = (err, instance, info) => {
  // 仅记录，不阻断 —— 组件级 Error Boundary 负责兜底 UI
  try {
    const stack = (err && (err.stack || err.message)) || String(err)
    window.__errs.push((err && err.message) + ' | info=' + info + '\n' + stack)
    console.error('[EO] 全局异常已隔离：', err && err.message, info, '\n', stack)
  } catch (e) {}
}

// 预加载存档，再挂载，避免首屏闪烁
const store = useAppStore()
store.init().then(() => {
  app.mount('#app')
  // 本地预览不注册 Service Worker（否则旧缓存会盖住新构建）
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const updateSW = registerSW({
      immediate: true,
      // 3.0：检测到新版本不再静默 skipWaiting，交给 UpdateBanner 让用户主动刷新，避免打断正在编辑的内容
      onNeedRefresh() { updateState.needRefresh = true },
      onOfflineReady() { updateState.offlineReady = true },
      onRegisteredSW(swUrl, reg) {
        // 每小时主动检查一次新版本（长驻 PWA / 桌面壳场景不会自动发现更新）
        if (reg) setInterval(() => { reg.update().catch(() => {}) }, 60 * 60 * 1000)
      }
    })
    updateState.applyUpdate = () => { try { updateSW(true) } catch (e) { location.reload() } }
  }
})
