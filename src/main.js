import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router/index.js'
import { useAppStore } from './stores/app.js'
import App from './App.vue'
import './styles/main.css'
import { registerSW } from 'virtual:pwa-register'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 预加载存档，再挂载，避免首屏闪烁
const store = useAppStore()
store.init().then(() => {
  app.mount('#app')
  registerSW({ immediate: true })
})
