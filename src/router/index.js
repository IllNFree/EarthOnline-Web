import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '地球Online' } },
  { path: '/tasks', name: 'tasks', component: () => import('../views/Tasks.vue'), meta: { title: '任务' } },
  { path: '/backpack', name: 'backpack', component: () => import('../views/Backpack.vue'), meta: { title: '背包' } },
  { path: '/notes', name: 'notes', component: () => import('../views/Notes.vue'), meta: { title: '笔记' } },
  { path: '/album', name: 'album', component: () => import('../views/Album.vue'), meta: { title: '相册' } },
  { path: '/map', name: 'map', component: () => import('../views/Map.vue'), meta: { title: '足迹地图' } },
  { path: '/steam', name: 'steam', component: () => import('../views/Steam.vue'), meta: { title: 'Steam 游戏库' } },
  { path: '/ai', name: 'ai', component: () => import('../views/Ai.vue'), meta: { title: 'AI 中枢' } },
  { path: '/profile', redirect: '/settings' },
  { path: '/achievements', name: 'achievements', component: () => import('../views/Achievements.vue'), meta: { title: '成就殿堂' } },
  { path: '/stats', name: 'stats', component: () => import('../views/Stats.vue'), meta: { title: '数据中心' } },
  { path: '/notifications', redirect: '/settings' },
  { path: '/ledger', name: 'ledger', component: () => import('../views/Ledger.vue'), meta: { title: '记账' } },
  { path: '/privacy', name: 'privacy', component: () => import('../views/Privacy.vue'), meta: { title: '隐私政策' } },
  { path: '/trash', name: 'trash', component: () => import('../views/Trash.vue'), meta: { title: '回收站' } },
  { path: '/whiteboard', name: 'whiteboard', component: () => import('../views/WhiteboardHome.vue'), meta: { title: '画布' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/CustomDashboard.vue'), meta: { title: '自定义看板' } },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '设置' } }
]

export const router = createRouter({ history: createWebHashHistory(), routes })
