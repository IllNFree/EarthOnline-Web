<script setup>
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { motion } from 'motion-v'
import { useMediaQuery } from '@vueuse/core'
import { useAppStore } from './stores/app.js'
import { useDialogStore } from './stores/dialog.js'
import { initCloudAutoSync } from './lib/cloud.js'
import { APP_INFO } from './lib/model.js'
import { builtinEnabled } from './services/builtinPlugins.js'
import Icon from './components/Icon.vue'
import GlassDialog from './components/GlassDialog.vue'
import GlobalContextMenu from './components/GlobalContextMenu.vue'
import { openContextMenu } from './composables/useContextMenu.js'
import { getCanvasPlayer } from './lib/audioPlayer.js'
import GlobalDragOverlay from './components/GlobalDragOverlay.vue'
import HazeToast from './components/HazeToast.vue'
import AchievementToast from './components/AchievementToast.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import { useWebDAVSync } from './composables/useWebDAVSync.js'
import { useGlobalDropZone } from './composables/useGlobalDropZone.js'
import { useClipboardWatcher } from './composables/useClipboardWatcher.js'
import { useNotificationService } from './composables/useNotificationService.js'
import EntityPreviewDialog from './components/EntityPreviewDialog.vue'
import ws from './space/spaceInstance.js'
import { startEntityLinkBridge } from './space/core/entityRefs.js'

const store = useAppStore()
// 画布连线 ↔ 功能关联（biLinks）双向桥接：全局只启动一次
startEntityLinkBridge(ws, store)
const dialog = useDialogStore()
const route = useRoute()
const router = useRouter()
const routerPush = router.push

// v2.1.0：全局生产力 composables 根级装配（红线 3：全局复用，页面内不重复造轮子）
useWebDAVSync()
const drop = useGlobalDropZone()
drop.activate()
const clip = useClipboardWatcher()
clip.activate()
clip.state.onAccept = (text) => {
  const r = store.addMemo({ title: '剪贴板速记', markdown: text || '' })
  if (r.ok) { store.showToast('已存入笔记'); router.push('/notes') }
}
const notif = useNotificationService()
notif.activate()
// 全局拖拽上传：图片直接入相册（页面组件亦可自行注册 onFiles 消费）
drop.onFiles((files) => {
  if (!files || !files.length) return
  let added = 0
  files.forEach((f) => {
    if (f.type && f.type.startsWith('image/')) {
      const r = new FileReader()
      r.onload = () => { store.addPhoto({ name: f.name || '拖入图片', dataUrl: r.result, category: '拖入' }); added++ }
      r.readAsDataURL(f)
    }
  })
  // 模块六：拖拽上传里程碑（触发 Web 专属成就）
  store.bumpMilestone('dragUpload')
  setTimeout(() => { if (added) store.showToast('已存入相册 ' + added + ' 张') }, 300)
})
// 双模式自适应：≥900px = 电脑网站（侧边栏），<900px = 手机 PWA（底部悬浮导航）
const isDesktop = useMediaQuery('(min-width: 900px)')
// 模块五：FAB 自适应 —— 宽屏（≥1024px）/ 横屏隐藏，移动端 / 竖屏窄屏显示（触控可达）
const isWide = useMediaQuery('(min-width: 1024px)')
const isPortrait = useMediaQuery('(orientation: portrait)')
// 规则：PC 宽屏隐藏；横屏隐藏；窄屏竖屏显示
const showFab = computed(() => !isWide.value && (isPortrait.value || !isDesktop.value))
// AI 悬浮入口只在创作类页面出现，避免遮挡设置/成就等页面的底部控件
const showAiFab = computed(() => !isDesktop.value && !moreOpen.value && ['home', 'tasks', 'backpack', 'notes'].includes(route.name))

// 壁纸层：wallAlpha 存的是「不透明度 alpha」(0=完全透明看不见, 1=完全实体)
// 滑块展示「透明度」(0%=实体, 100%=彻底透明)，因此这里用的是 1 - 透明度
const wallStyle = computed(() => {
  if (!store.data.wallpaper) return null
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const raw = Number(store.data.wallAlpha)
  const alpha = isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
  const op = alpha * (dark ? 0.4 : 1.0)
  const blur = Number(store.data.wallBlur) || 0
  const style = { backgroundImage: 'url(' + store.data.wallpaper + ')', opacity: op }
  if (blur > 0) {
    // 模糊会露出边缘空隙 → 轻微放大补偿
    style.filter = 'blur(' + blur + 'px)'
    style.transform = 'scale(' + (1 + blur / 160) + ')'
  }
  return style
})

// 手机底栏：只放 5 个最高频入口；其余全部收进「更多」
const navItems = [
  { name: 'home', icon: 'home', label: '主页' },
  { name: 'tasks', icon: 'tasks', label: '任务' },
  { name: 'backpack', icon: 'backpack', label: '背包' },
  { name: 'notes', icon: 'note', label: '笔记' },
  { name: '__more', icon: 'more', label: '更多' }
]
// 「更多」抽屉：保证手机端所有页面可达（Steam 跟随插件开关）
const MORE_PAGES = [
  { name: 'profile', icon: 'user', label: '个人主页' },
  { name: 'dashboard', icon: 'chart', label: '数据中心' },
  { name: 'album', icon: 'album', label: '相册' },
  { name: 'map', icon: 'map-pin', label: '足迹' },
  { name: 'ledger', icon: 'wallet', label: '记账' },
  { name: 'achievements', icon: 'trophy', label: '成就殿堂' },
  { name: 'ai', icon: 'sparkles', label: 'AI 中枢' },
  { name: 'plugins', icon: 'puzzle', label: '插件中心' },
  { name: 'steam', icon: 'cloud', label: 'Steam' },
  { name: 'trash', icon: 'trash', label: '回收站' },
  { name: 'settings', icon: 'settings', label: '设置' }
]
const moreOpen = ref(false)
const moreItems = computed(() => MORE_PAGES.filter((n) => n.name !== 'steam' || builtinEnabled(store, 'steam')))
const moreActive = computed(() => moreItems.value.some((n) => route.name === n.name))
function goMore(n) {
  moreOpen.value = false
  if (n.name === '__search') openSearch()
  else routerPush('/' + n.name)
}
// 电脑侧边栏导航（分组，覆盖全部页面）；白板已收拢至主页内部 Tab，不再单独入口
const sideGroups = [
  { label: '主功能', items: [
    { name: 'home', icon: 'home', label: '主页' },
    { name: 'tasks', icon: 'tasks', label: '任务' },
    { name: 'backpack', icon: 'backpack', label: '背包' },
    { name: 'notes', icon: 'note', label: '笔记' },
    { name: 'album', icon: 'album', label: '相册' },
    { name: 'map', icon: 'map-pin', label: '足迹' },
    { name: 'ledger', icon: 'wallet', label: '记账' }
  ] },
  { label: '扩展', items: [
    { name: 'achievements', icon: 'trophy', label: '成就殿堂' },
    { name: 'dashboard', icon: 'chart', label: '数据中心' },
    { name: 'ai', icon: 'sparkles', label: 'AI 中枢' },
    { name: 'plugins', icon: 'puzzle', label: '插件中心' },
    { name: 'steam', icon: 'cloud', label: 'Steam 游戏库' }
  ] },
  { label: '系统', items: [
    { name: 'trash', icon: 'trash', label: '回收站' },
    { name: 'settings', icon: 'settings', label: '设置' }
  ] }
]
// 内置插件入口跟随开关：Steam 插件关闭后侧边栏不再显示（与插件中心/画布卡片保持一致）
const visibleSideGroups = computed(() => sideGroups.map((g) => ({
  ...g,
  items: g.items.filter((n) => n.name !== 'steam' || builtinEnabled(store, 'steam'))
})))
function goSide(n) {
  routerPush('/' + (n.name === 'home' ? '' : n.name))
}
const profile = computed(() => store.data.profile)
const displayName = computed(() => profile.value.name || '旅行者')
// 头像兜底链：avatarData 图片（损坏自动降级）→ 姓名首字 → user 图标 —— 任何情况都不留空白
const avatarBroken = ref(false)
watch(() => profile.value.avatarData, () => { avatarBroken.value = false })
const avatarSrc = computed(() => (profile.value.avatarData && !avatarBroken.value) ? profile.value.avatarData : '')
const avatarStyle = computed(() => avatarSrc.value
  ? { backgroundImage: 'url(' + avatarSrc.value + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
  : {})
const title = computed(() => route.meta.title || '地球Online')
// 卡片圆角（设置页可调）→ 全局 CSS 变量
watchEffect(() => {
  const r = Number(store.data.cardRadius) || 18
  try { document.documentElement.style.setProperty('--eo-card-radius', r + 'px') } catch (e) {}
})
// 侧边栏折叠态（本地持久化）：桌面端常驻悬浮导航
const navCollapsed = ref(false)
function applyNavWidth() {
  try { document.documentElement.style.setProperty('--eo-sidebar-w', navCollapsed.value ? '72px' : '236px') } catch (e) {}
}
function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  try { localStorage.setItem('eo_sidebar_collapsed', navCollapsed.value ? '1' : '0') } catch (e) {}
  applyNavWidth()
}

function installNow() {
  const p = store.installPrompt
  if (p && p.prompt) { p.prompt(); p.userChoice.then(() => { store.installPrompt = null }) }
}
function dismissInstall() { store.installPrompt = null }

// ---------- 全局搜索（Esc 关闭 / 结果直达路由） ----------
let searchInputEl = null
async function openSearch() {
  store.toggleSearch(true)
  await nextTick()
  searchInputEl = document.getElementById('eo-global-search')
  if (searchInputEl) searchInputEl.focus()
}
function closeSearch() { store.toggleSearch(false) }
function goResult(route) {
  routerPush(route)
  closeSearch()
}
const resultCount = computed(() => store.searchResults.reduce((n, g) => n + g.items.length, 0))

// 系统深浅色偏好监听：默认跟随 auto 主题（此前未初始化，mounted 里访问会抛异常）
let mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
let spotlightHandler = null
let ctxHandler = null
// 主 Tab 路由（Esc 返回逻辑中的「非二级页」）
const MAIN_PATHS = ['/', '/tasks', '/backpack', '/notes', '/settings']
let escHandler = null

// 模块四：全局右键菜单 —— 监听 contextmenu，构建差异化菜单并交给 useContextMenu 渲染。
// 红线：enableCustomContextMenu 关闭时 openContextMenu 内部直接 return 不拦截 → 原生菜单放行。

// ---------- 页面级右键菜单（导航型：只列当前页面真正相关的入口） ----------
// 每页用独立函数返回数组，避免共享对象被后续 data-ctx 追加污染。
const ctxGo = (icon, label, path) => ({ icon, label, action: () => routerPush(path) })
// 当前页已注册 quickAdd（新建任务/写笔记/加照片/记一笔）时直接内联执行，不跳同页
function ctxQuickAdd(icon, label) {
  return { icon, label, action: () => store.runQuickAdd() }
}
function ctxMusicMenu() {
  let p = null
  let st = null
  try { p = getCanvasPlayer(); st = p.getState() } catch (e) { /* ignore */ }
  const isPlaying = !!(st && st.playing)
  const items = [{
    icon: isPlaying ? 'pause' : 'play',
    label: isPlaying ? '暂停' : '播放',
    action: () => { try { isPlaying ? p.pause() : p.play() } catch (e) { /* ignore */ } }
  }]
  if (st && st.current) {
    items.push({ icon: 'arrowleft', label: '上一首', action: () => { try { p.previous() } catch (e) { /* ignore */ } } })
    items.push({ icon: 'arrow', label: '下一首', action: () => { try { p.next() } catch (e) { /* ignore */ } } })
  }
  items.push(ctxGo('home', '返回画布', '/'))
  return items
}
const PAGE_MENUS = {
  home: () => [
    ctxGo('image', '上传照片', '/album?add=1'),
    ctxGo('tasks', '新建任务', '/tasks?add=1'),
    ctxGo('note', '写笔记', '/notes?add=1'),
    ctxGo('wallet', '记一笔', '/ledger')
  ],
  tasks: () => [
    ctxQuickAdd('plus', '新建任务'),
    ctxGo('trash', '回收站', '/trash'),
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('settings', '设置', '/settings')
  ],
  notes: () => [
    ctxQuickAdd('plus', '写笔记'),
    ctxGo('trash', '回收站', '/trash'),
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('settings', '设置', '/settings')
  ],
  ledger: () => [
    ctxQuickAdd('plus', '记一笔'),
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('tasks', '任务', '/tasks'),
    ctxGo('settings', '设置', '/settings')
  ],
  album: () => [
    ctxQuickAdd('plus', '添加照片'),
    ctxGo('backpack', '背包', '/backpack'),
    ctxGo('map-pin', '足迹', '/map'),
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('settings', '设置', '/settings')
  ],
  backpack: () => [
    ctxGo('album', '相册', '/album'),
    ctxGo('achievements', '成就殿堂', '/achievements'),
    ctxGo('settings', '设置', '/settings')
  ],
  achievements: () => [
    ctxGo('user', '个人主页', '/profile'),
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('backpack', '背包', '/backpack')
  ],
  stats: () => [
    ctxGo('wallet', '记一笔', '/ledger'),
    ctxGo('tasks', '任务', '/tasks'),
    ctxGo('achievements', '成就殿堂', '/achievements')
  ],
  map: () => [
    ctxGo('album', '相册', '/album'),
    ctxGo('tasks', '任务', '/tasks'),
    ctxGo('user', '个人主页', '/profile')
  ],
  profile: () => [
    ctxGo('achievements', '成就殿堂', '/achievements'),
    ctxGo('album', '相册', '/album'),
    ctxGo('settings', '设置', '/settings')
  ],
  settings: () => [
    ctxGo('puzzle', '插件中心', '/plugins'),
    ctxGo('shield', '隐私政策', '/privacy'),
    ctxGo('file', '用户协议', '/terms'),
    ctxGo('trash', '回收站', '/trash')
  ],
  plugins: () => [
    ctxGo('settings', '设置', '/settings'),
    ctxGo('shield', '隐私政策', '/privacy'),
    ctxGo('file', '用户协议', '/terms')
  ],
  steam: () => [
    ctxGo('chart', '数据中心', '/stats'),
    ctxGo('achievements', '成就殿堂', '/achievements'),
    ctxGo('settings', '设置', '/settings')
  ],
  trash: () => [
    ctxGo('tasks', '任务', '/tasks'),
    ctxGo('note', '笔记', '/notes'),
    ctxGo('settings', '设置', '/settings')
  ],
  privacy: () => [
    ctxGo('settings', '设置', '/settings'),
    ctxGo('file', '用户协议', '/terms')
  ],
  terms: () => [
    ctxGo('settings', '设置', '/settings'),
    ctxGo('shield', '隐私政策', '/privacy')
  ],
  ai: () => [
    ctxGo('tasks', '任务', '/tasks'),
    ctxGo('note', '笔记', '/notes'),
    ctxGo('puzzle', '插件中心', '/plugins')
  ],
  music: ctxMusicMenu
}
// 未知路由（如插件内页）回退到通用生产入口
function ctxFallback() {
  return [
    ctxGo('tasks', '新建任务', '/tasks?add=1'),
    ctxGo('note', '写笔记', '/notes?add=1'),
    ctxGo('wallet', '记一笔', '/ledger')
  ]
}
function buildContextItems(el) {
  const build = PAGE_MENUS[route.name] || ctxFallback
  const items = build()
  // 若右键落在带 data-ctx 的元素上，追加其声明的自定义项（多区域差异化）
  if (el && el.dataset && el.dataset.ctx) {
    try {
      const extra = JSON.parse(el.dataset.ctx)
      if (Array.isArray(extra)) extra.forEach((it) => it && it.label && items.push(it))
    } catch { /* 忽略非法声明 */ }
  }
  // 主页/播放页已自带回程项，不再重复「回到主页」
  const noHome = route.name === 'home' || items.some((it) => it && (it.label === '回到主页' || it.label === '返回画布'))
  if (!noHome) items.push({ icon: 'home', label: '回到主页', action: () => routerPush('/') })
  return items
}
function onContextMenu(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-ctx], .glass, .page, body') : document.body
  const ok = openContextMenu(e, buildContextItems(el))
  if (!ok) { /* 开关关闭：不拦截，原生菜单出现 */ }
}
onMounted(() => {
  // 模块四：注册全局右键拦截（开关关闭时 openContextMenu 自动放行原生菜单）
  ctxHandler = onContextMenu
  document.addEventListener('contextmenu', ctxHandler)
  // 移除内联启动屏（消除首访白屏闪烁）
  const sp = document.getElementById('eo-splash')
  if (sp) { sp.style.transition = 'opacity .28s ease'; sp.style.opacity = '0'; setTimeout(() => sp.remove(), 300) }
  try { navCollapsed.value = localStorage.getItem('eo_sidebar_collapsed') === '1' } catch (e) {}
  applyNavWidth()
  // 设置页切换「导航默认收起」时同步
  window.addEventListener('eo-sidebar-set', (ev) => {
    navCollapsed.value = !!(ev && ev.detail)
    applyNavWidth()
  })
  // 云端自动同步（未登录时为空操作；断网静默跳过，本地照常用）
  initCloudAutoSync(store)
  store.applyTheme()

  mq && mq.addEventListener && mq.addEventListener('change', () => { if (store.theme === 'auto') store.applyTheme() })
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); store.installPrompt = e })
  // 光标聚光灯：把指针坐标注入最近的玻璃卡片（CSS radial-gradient 消费 --mx/--my）
  spotlightHandler = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.glass') : null
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px')
    el.style.setProperty('--my', (e.clientY - r.top) + 'px')
  }
  document.addEventListener('pointermove', spotlightHandler, { passive: true })
  // 全局 Esc：① 关全局确认弹窗 ② 广播 eo-esc（弹窗/搜索等组件自行消费） ③ 二级页返回上一页
  escHandler = (e) => {
    // Ctrl / Cmd + K：任意页面唤起全局搜索
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      if (!store.searchOpen) openSearch()
      return
    }
    if (e.key !== 'Escape') return
    if (moreOpen.value) { moreOpen.value = false; return }
    if (dialog.open) { dialog.close(false); return }
    if (store.searchOpen) { store.toggleSearch(false); return }
    const ev = new CustomEvent('eo-esc')
    document.dispatchEvent(ev)
    if (ev.defaultPrevented) return // 有组件消费（如关闭弹窗/搜索）
    const p = route.path
    if (!MAIN_PATHS.includes(p)) {
      if (window.history.state && window.history.state.back != null) routerPush(window.history.state.back)
      else routerPush('/')
    }
  }
  document.addEventListener('keydown', escHandler)
})
onUnmounted(() => {
  mq && mq.removeEventListener && mq.removeEventListener('change', () => {})
  if (spotlightHandler) document.removeEventListener('pointermove', spotlightHandler)
  if (escHandler) document.removeEventListener('keydown', escHandler)
  if (ctxHandler) document.removeEventListener('contextmenu', ctxHandler)
})
</script>

<template>
  <div v-if="wallStyle" class="wallpaper" :style="wallStyle" aria-hidden="true"></div>

  <!-- 电脑网站模式：左侧固定垂直导航栏（≥900px）——贴死最左侧、通高、无品牌块，主菜单顶格 -->
  <aside v-if="isDesktop && route.name !== 'music'" class="sidebar" :class="{ 'is-collapsed': navCollapsed }" aria-label="主导航">
    <div class="side-top">
      <button class="side-collapse" :title="navCollapsed ? '展开导航' : '收起导航'" :aria-label="navCollapsed ? '展开导航' : '收起导航'" @click="toggleNav">
        <Icon :name="navCollapsed ? 'chevron-right' : 'chevron-left'" :size="17" />
      </button>
    </div>
    <button class="side-search" title="全局搜索" @click="openSearch" aria-label="全局搜索">
      <Icon name="search" :size="18" />
      <span v-if="!navCollapsed">全局搜索</span>
      <kbd v-if="!navCollapsed">Esc</kbd>
    </button>
    <nav class="side-nav">
      <template v-for="g in visibleSideGroups" :key="g.label">
        <div v-if="!navCollapsed" class="side-section">{{ g.label }}</div>
        <div v-else class="side-divider"></div>
        <button v-for="n in g.items" :key="g.label + n.name" class="side-item"
          :class="{ active: route.name === n.name }" :title="n.label" @click="goSide(n)">
          <Icon :name="n.icon" :size="19" />
          <span v-if="!navCollapsed">{{ n.label }}</span>
        </button>
      </template>
    </nav>
    <div class="side-bottom">
      <div v-if="!navCollapsed" class="side-divider"></div>
      <button class="side-user" :title="'个人主页 · ' + displayName" @click="routerPush('/profile')" aria-label="进入个人主页">
        <span class="side-user__avatar" :style="avatarStyle">
          <img v-if="avatarSrc" :src="avatarSrc" alt="" @error="avatarBroken = true" style="width:100%;height:100%;object-fit:cover;display:block" />
          <span v-else-if="displayName" class="side-user__letter">{{ displayName[0] }}</span>
          <Icon v-else name="user" :size="20" />
        </span>
        <span v-if="!navCollapsed" class="side-user__meta">
          <span class="side-user__name">{{ displayName }}</span>
        </span>
        <Icon v-if="!navCollapsed" name="chevron-right" :size="15" class="side-user__go" />
      </button>
    </div>
  </aside>

  <!-- 页面切换：CSS 过渡（入场 + 离场），不依赖 JS 动画库，永不出现「停在透明态」的空白页 -->
  <div class="route-wrap">
    <router-view v-slot="{ Component, route }">
      <!-- 主页（无限画布）用 KeepAlive 缓存：切到别的页面再回来时，
           画布实例不销毁 —— 视口（缩放/平移）、选中态、滚动位置全部原样保留，
           用户「切出去时怎么样，回来就怎么样」。其余页面正常切换即销毁。
           ⚠️ 缓存页切回时【不重播入场动画】：页面从未真正离开（实例在内存中），
           若重播 .page-enter 的 translateY(8px) 位移过渡，用户会看到「画布抖一下、
           从左往右移」。故仅对真正切换的页面启用过渡。 -->
      <transition :name="route.name === 'home' ? 'page-none' : 'page'" mode="out-in">
        <keep-alive :include="['HomeView']">
          <component :is="Component" />
        </keep-alive>
      </transition>
    </router-view>
  </div>

  <!-- 全局新增 FAB：移动端 / 竖屏窄屏显示（触控可达）；PC 宽屏隐藏（已有快捷入口与右键菜单） -->
  <motion.button v-if="store.quickAdd && showFab && !moreOpen" class="quick-fab" :while-hover="{ y: -1, scale: 1.02 }" :while-press="{ scale: 0.94 }" :transition="{ type: 'spring', stiffness: 420, damping: 24 }" @click="store.runQuickAdd()" aria-label="新增">
    <Icon name="plus" :size="26" />
  </motion.button>

  <!-- AI 快捷中枢悬浮入口（手机 PWA 模式专属） -->
  <motion.button v-if="showAiFab" class="ai-fab" :while-hover="{ y: -1, scale: 1.02 }" :while-press="{ scale: 0.94 }" :transition="{ type: 'spring', stiffness: 420, damping: 24 }" @click="$router.push('/ai')" aria-label="AI 中枢">
    <Icon name="sparkles" :size="26" />
  </motion.button>

  <!-- 断网全局提示横幅（对齐 Android NetworkMonitor 离线横幅） -->
  <transition name="netbar">
    <div v-if="!store.online" class="offline-bar glass">
      <Icon name="cloud" :size="18" />
      <span>当前处于离线状态，云端同步与 AI 对话暂不可用</span>
    </div>
  </transition>

  <!-- 全局搜索面板：6 类聚合 + 直达路由 -->
  <transition name="fade">
    <div v-if="store.searchOpen" class="search-mask" @click.self="closeSearch">
      <div class="search-panel glass glass-strong">
        <div class="search-field">
          <Icon name="search" :size="18" />
          <input id="eo-global-search" v-model="store.searchQuery" placeholder="搜索任务 / 物品 / 收藏 / 笔记 / 足迹 / 成就" />
          <button class="ghost-btn" @click="closeSearch"><Icon name="x" :size="16" /></button>
        </div>
        <div class="search-body">
          <div v-if="!store.searchQuery.trim()" class="muted" style="text-align:center;padding:30px">输入关键词开始检索全站数据</div>
          <template v-else>
            <div v-for="g in store.searchResults" :key="g.type" class="search-group">
              <div class="search-group__title"><Icon :name="g.icon" :size="14" /> {{ g.label }} · {{ g.items.length }}</div>
              <button v-for="it in g.items" :key="it.id" class="search-item" @click="goResult(g.route)">
                <span style="font-weight:600">{{ it.title }}</span>
                <span class="muted" style="font-size:12px">{{ it.sub }}</span>
              </button>
            </div>
            <div v-if="!resultCount" class="muted" style="text-align:center;padding:30px">没有匹配的内容</div>
          </template>
        </div>
      </div>
    </div>
  </transition>

  <!-- 手机端「更多」抽屉：搜索 + 全部次级页面，保证竖屏下无死角可达 -->
  <transition name="fade">
    <div v-if="!isDesktop && moreOpen" class="more-mask" @click.self="moreOpen = false">
      <div class="more-sheet glass glass-strong">
        <div class="more-head">
          <span>更多</span>
          <button class="ghost-btn" @click="moreOpen = false" aria-label="关闭"><Icon name="x" :size="16" /></button>
        </div>
        <button v-if="store.installPrompt" class="more-install" @click="installNow(); moreOpen = false">
          <Icon name="download" :size="16" /> 安装「地球Online」到桌面
        </button>
        <div class="more-grid">
          <button class="more-cell" @click="goMore({ name: '__search' })">
            <span class="more-cell__ico"><Icon name="search" :size="22" /></span>
            <span>搜索</span>
          </button>
          <button v-for="n in moreItems" :key="n.name" class="more-cell"
            :class="{ active: route.name === n.name }" @click="goMore(n)">
            <span class="more-cell__ico"><Icon :name="n.icon" :size="22" /></span>
            <span>{{ n.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </transition>

  <!-- 手机 PWA 模式：底部悬浮胶囊导航（<900px） -->
  <nav v-if="!isDesktop && route.name !== 'music'" class="bottomnav">
    <motion.button v-for="n in navItems" :key="n.name" class="nav-item"
      :class="{ active: n.name === '__more' ? moreActive : route.name === n.name }"
      :while-press="{ scale: 0.9 }" :transition="{ type: 'spring', stiffness: 420, damping: 22 }"
      @click="n.name === '__more' ? (moreOpen = true) : $router.push('/' + (n.name === 'home' ? '' : n.name))">
      <Icon :name="n.icon" />
      <span>{{ n.label }}</span>
    </motion.button>
  </nav>

  <!-- 安装引导横幅 -->
  <div v-if="store.installPrompt" class="install-bar glass">
    <Icon name="download" :size="18" />
    <span>添加到主屏幕，获得原生般体验</span>
    <button class="btn" @click="installNow">安装</button>
    <button class="ghost-btn" @click="dismissInstall"><Icon name="x" :size="16" /></button>
  </div>

  <transition name="fade">
    <div v-if="store.toast" class="toast">{{ store.toast }}</div>
  </transition>

  <!-- 全局液态玻璃弹窗（替代原生 confirm/alert） -->
  <GlassDialog />
  <!-- v3.0.2：关联内容就地预览（不跳页） -->
  <EntityPreviewDialog />

  <!-- v2.1.0：全局生产力组件根级挂载 -->
  <GlobalContextMenu />
  <GlobalDragOverlay />
  <HazeToast />
  <!-- 成就解锁右下角气泡（6 秒 / 可点击关闭） -->
  <AchievementToast />
  <!-- 新版本提示（PWA 检测到更新后由用户主动刷新） -->
  <UpdateBanner />
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); display: inline-flex; padding: 4px; opacity: .92; }
.ghost-btn:active { opacity: .6; }

.route-wrap { position: absolute; inset: 0; z-index: 1; }

/* ---- 全局新增 FAB（右下角，压在 AI 悬浮球之上） ---- */
.quick-fab {
  position: fixed; right: 18px; z-index: 60;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 158px);
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-primary);
  color: #fff; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.18) inset, 0 14px 30px -10px rgba(44, 44, 44, .18);
  transition: transform .2s cubic-bezier(.22, 1, .36, 1), box-shadow .2s ease;
}
.quick-fab::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,255,255,0.30) 0%, transparent 45%);
  opacity: .7; mix-blend-mode: screen;
}
.quick-fab:active { opacity: .82; }
.quick-fab svg { position: relative; z-index: 1; }

/* ---- 断网全局横幅 ---- */
.offline-bar {
  position: fixed; z-index: 62; left: 12px; right: 12px; top: 8px;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 16px;
  font-size: 13px; font-weight: 600; color: var(--eo-ink);
  background: rgba(250, 248, 243, .92);
  border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow-soft);
}
.netbar-enter-active, .netbar-leave-active { transition: opacity .22s ease, transform .22s ease; }
.netbar-enter-from, .netbar-leave-to { opacity: 0; transform: translateY(-8px); }

/* ---- 全局搜索面板 ---- */
.search-mask {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(28, 28, 27, .34); backdrop-filter: blur(6px);
  display: flex; justify-content: center; padding: 10vh 14px 24px;
}
.search-panel {
  width: 100%; max-width: 560px; max-height: 74vh;
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--eo-radius);
}
.search-field { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--eo-glass-border); }
.search-field input { flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; outline: none; }
.search-body { overflow-y: auto; padding: 8px 10px 14px; }
.search-group { margin-bottom: 10px; }
.search-group__title {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; font-size: 11px; font-weight: 700; letter-spacing: .08em;
  color: var(--eo-primary-deep);
}
.search-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; padding: 9px 12px; border-radius: 12px; text-align: left;
  transition: background .16s ease, transform .16s ease;
}
.search-item:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); opacity: 1; }

/* 顶栏移除后：全局搜索入口下沉到侧边栏（保持原生 Haze 液态玻璃质感） */
.side-search {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 9px 12px; margin-bottom: 10px; border-radius: 16px;
  background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
  box-shadow: inset 0 1px 0 var(--eo-glass-hi);
  color: var(--eo-ink-soft); font-size: 13px; font-weight: 600; text-align: left;
  transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s ease;
}
.side-search:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); opacity: 1; }
.is-collapsed .side-search { justify-content: center; padding: 9px 0; }
.side-search span { flex: 1; min-width: 0; }
.side-search kbd {
  flex: none; font-family: inherit; font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 6px; opacity: .6;
  background: rgba(44, 44, 44, .08); border: 1px solid var(--eo-glass-border);
}
[data-theme='dark'] .side-search:hover { box-shadow: var(--eo-shadow-lift); }
[data-theme='dark'] .side-search kbd { background: rgba(255, 255, 255, .10); }

/* 侧栏自身材质由全局 main.css 的 .sidebar 提供（固定贴左 / 通高 / Haze 毛玻璃），
   这里只负责内部构件的排布与状态。 */
.side-top { display: flex; align-items: center; gap: 6px; padding: 2px 2px 8px; }
.side-bottom { flex: none; margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
/* 头像区与导航项同一套度量（padding / 圆角 / 高度），保证与底部「设置」等按钮完全对齐 */
.side-user {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 10px 12px; border-radius: 14px; text-align: left;
  background: rgba(44, 44, 44, 0.10);
  transition: background .2s ease, opacity .2s ease;
}
.side-user:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); opacity: 1; }
.side-user__go { flex: none; color: var(--eo-ink-faint); }
.is-collapsed .side-user { padding: 10px 0; justify-content: center; }
.is-collapsed .side-user__avatar { width: 38px; height: 38px; border-radius: 12px; }
.side-user__letter { font-size: 16px; font-weight: 800; color: #fff; line-height: 1; }
.side-collapse {
  flex: none; width: 32px; height: 32px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
  color: var(--eo-ink-soft); cursor: pointer;
  box-shadow: inset 0 1px 0 var(--eo-glass-hi);
  transition: transform .24s cubic-bezier(.22,1,.36,1), background .18s ease, color .18s ease;
}
.side-collapse:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.is-collapsed .side-collapse { margin-left: auto; margin-right: auto; }
.side-divider { height: 1px; margin: 8px 6px; background: var(--eo-glass-border); opacity: .8; }
.side-user__avatar {
  width: 40px; height: 40px; border-radius: 13px; flex: none; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-primary); color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
}
.side-user__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.side-user__name { font-weight: 700; font-size: 14px; color: var(--eo-ink); }

/* ---- 手机「更多」抽屉 ---- */
.more-mask {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(28, 28, 27, .34); backdrop-filter: blur(6px);
  display: flex; align-items: flex-end;
}
.more-sheet {
  width: 100%; max-height: 72vh; overflow-y: auto;
  padding: 10px 14px calc(18px + env(safe-area-inset-bottom, 0px));
  border-radius: 24px 24px 0 0;
  animation: more-up .24s cubic-bezier(.22, 1, .36, 1);
}
@keyframes more-up { from { transform: translateY(28px); opacity: .5 } to { transform: none; opacity: 1 } }
.more-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 2px 12px; font-size: 15px; font-weight: 800; color: var(--eo-ink);
}
.more-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.more-cell {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  min-width: 0; padding: 14px 6px; border-radius: 16px; text-align: center;
  font-size: 12px; font-weight: 600; color: var(--eo-ink-soft);
  background: rgba(255, 255, 255, .55); border: 1px solid var(--eo-glass-border);
}
[data-theme='dark'] .more-cell { background: rgba(255, 255, 255, .06); }
.more-cell span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.more-cell.active { color: var(--eo-primary-deep); border-color: var(--eo-primary); }
.more-cell__ico {
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 14px;
  background: var(--eo-primary); color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35);
}
.more-cell.active .more-cell__ico { opacity: .92; }
.more-install {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; margin-bottom: 10px; padding: 11px 12px; border-radius: 14px;
  background: var(--eo-primary); color: #fff; font-size: 13px; font-weight: 700;
}

</style>
