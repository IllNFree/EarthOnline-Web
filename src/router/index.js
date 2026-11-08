import { createRouter, createWebHashHistory } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { builtinEnabled } from '../services/builtinPlugins.js'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '地球Online' } },
  { path: '/tasks', name: 'tasks', component: () => import('../views/Tasks.vue'), meta: { title: '任务' } },
  { path: '/backpack', name: 'backpack', component: () => import('../views/Backpack.vue'), meta: { title: '背包' } },
  { path: '/notes', name: 'notes', component: () => import('../views/Notes.vue'), meta: { title: '笔记' } },
  { path: '/album', name: 'album', component: () => import('../views/Album.vue'), meta: { title: '相册' } },
  // 音乐播放页：入口只从画布音乐卡进入
  { path: '/music', name: 'music', component: () => import('../views/Music.vue'), meta: { title: '音乐' } },
  { path: '/map', name: 'map', component: () => import('../views/Map.vue'), meta: { title: '足迹地图' } },
  // 模块三：Steam 游戏库插件化 —— 路由保留但受插件开关控制（关闭后自动回主页）
  { path: '/steam', name: 'steam', component: () => import('../views/Steam.vue'), meta: { title: 'Steam 游戏库', builtin: 'steam' } },
  { path: '/ai', name: 'ai', component: () => import('../views/Ai.vue'), meta: { title: 'AI 中枢' } },
  { path: '/profile', name: 'profile', component: () => import('../views/Profile.vue'), meta: { title: '个人主页' } },
  { path: '/achievements', name: 'achievements', component: () => import('../views/Achievements.vue'), meta: { title: '成就殿堂' } },
  { path: '/notifications', redirect: '/settings' },
  { path: '/ledger', name: 'ledger', component: () => import('../views/Ledger.vue'), meta: { title: '记账' } },
  { path: '/privacy', name: 'privacy', component: () => import('../views/Privacy.vue'), meta: { title: '隐私政策' } },
  { path: '/terms', name: 'terms', component: () => import('../views/Terms.vue'), meta: { title: '用户协议与免责声明' } },
  { path: '/trash', name: 'trash', component: () => import('../views/Trash.vue'), meta: { title: '回收站' } },
  // v2.1.0 终极重构：仪表盘页已删除，主页唯一入口即画布（/ 路由即画布）
  // 数据中心（周期报告）保留为独立统计页
  { path: '/stats', name: 'stats', component: () => import('../views/Stats.vue'), meta: { title: '数据中心' } },
  { path: '/dashboard', redirect: '/stats' },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '设置' } },
  { path: '/plugins', name: 'plugins', component: () => import('../views/Plugins.vue'), meta: { title: '插件中心' } },
  // 兜底：无效 / 过期链接不再白屏，直接回到画布首页
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({ history: createWebHashHistory(), routes })

// 模块三：内置插件关闭时，其专属路由不可达（自动回主页）
router.beforeEach((to) => {
  const key = to.meta && to.meta.builtin
  if (!key) return true
  try {
    const store = useAppStore()
    if (!builtinEnabled(store, key)) return '/'
  } catch (e) { /* store 未就绪时放行 */ }
  return true
})
