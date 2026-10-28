<script setup>
import { computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { motion } from 'motion-v'
import { useMediaQuery } from '@vueuse/core'
import { useAppStore } from './stores/app.js'
import { useDialogStore } from './stores/dialog.js'
import { xpLevelInfo, APP_INFO } from './lib/model.js'
import Icon from './components/Icon.vue'
import GlassDialog from './components/GlassDialog.vue'
import GlobalContextMenu from './components/GlobalContextMenu.vue'
import { openContextMenu } from './composables/useContextMenu.js'
import GlobalDragOverlay from './components/GlobalDragOverlay.vue'
import HazeToast from './components/HazeToast.vue'
import { useWebDAVSync } from './composables/useWebDAVSync.js'
import { useGlobalDropZone } from './composables/useGlobalDropZone.js'
import { useClipboardWatcher } from './composables/useClipboardWatcher.js'
import { useNotificationService } from './composables/useNotificationService.js'

const store = useAppStore()
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
const level = computed(() => xpLevelInfo(store.xp))
// 双模式自适应：≥900px = 电脑网站（侧边栏），<900px = 手机 PWA（底部悬浮导航）
const isDesktop = useMediaQuery('(min-width: 900px)')
// 模块五：FAB 自适应 —— 宽屏（≥1024px）/ 横屏隐藏，移动端 / 竖屏窄屏显示（触控可达）
const isWide = useMediaQuery('(min-width: 1024px)')
const isPortrait = useMediaQuery('(orientation: portrait)')
// 规则：PC 宽屏隐藏；横屏隐藏；窄屏竖屏显示
const showFab = computed(() => !isWide.value && (isPortrait.value || !isDesktop.value))

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

const navItems = [
  { name: 'home', icon: 'home', label: '主页' },
  { name: 'tasks', icon: 'tasks', label: '任务' },
  { name: 'backpack', icon: 'backpack', label: '背包' },
  { name: 'notes', icon: 'note', label: '笔记' },
  { name: 'dashboard', icon: 'chart', label: '数据' },
  { name: 'settings', icon: 'settings', label: '设置' }
]
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
    { name: 'dashboard', icon: 'chart', label: '数据中心' },
    { name: 'steam', icon: 'cloud', label: 'Steam 游戏库' },
    { name: 'ai', icon: 'sparkles', label: 'AI 中枢' },
    { name: 'achievements', icon: 'trophy', label: '成就殿堂' }
  ] },
  { label: '系统', items: [
    { name: 'trash', icon: 'trash', label: '回收站' },
    { name: 'settings', icon: 'settings', label: '设置' }
  ] }
]
function goSide(n) { routerPush('/' + (n.name === 'home' ? '' : n.name)) }
const profile = computed(() => store.data.profile)
const displayName = computed(() => profile.value.name || '旅行者')
const avatarStyle = computed(() => profile.value.avatarData
  ? { backgroundImage: 'url(' + profile.value.avatarData + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
  : {})
const title = computed(() => route.meta.title || '地球Online')

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

let mq
let spotlightHandler = null
let ctxHandler = null
// 主 Tab 路由（Esc 返回逻辑中的「非二级页」）
const MAIN_PATHS = ['/', '/tasks', '/backpack', '/notes', '/settings']
let escHandler = null

// 模块四：全局右键菜单 —— 监听 contextmenu，构建差异化菜单并交给 useContextMenu 渲染。
// 红线：enableCustomContextMenu 关闭时 openContextMenu 内部直接 return 不拦截 → 原生菜单放行。
function buildContextItems(el) {
  const items = [
    { icon: 'tasks', label: '新建任务', action: () => routerPush('/tasks') },
    { icon: 'note', label: '写笔记', action: () => routerPush('/notes') },
    { icon: 'wallet', label: '记一笔', action: () => routerPush('/ledger') }
  ]
  // 若右键落在带 data-ctx 的元素上，追加其声明的自定义项（多区域差异化）
  if (el && el.dataset && el.dataset.ctx) {
    try {
      const extra = JSON.parse(el.dataset.ctx)
      if (Array.isArray(extra)) extra.forEach((it) => it && it.label && items.push(it))
    } catch { /* 忽略非法声明 */ }
  }
  items.push({ icon: 'home', label: '回到主页', action: () => routerPush('/') })
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
  store.applyTheme()
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener && mq.addEventListener('change', () => { if (store.theme === 'auto') store.applyTheme() })
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
    if (e.key !== 'Escape') return
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
  <!-- 暖色透光氛围层（液态玻璃底光） -->
  <div class="ambient" aria-hidden="true">
    <span class="blob b1"></span>
    <span class="blob b2"></span>
    <span class="blob b3"></span>
  </div>
  <div v-if="wallStyle" class="wallpaper" :style="wallStyle" aria-hidden="true"></div>

  <!-- 电脑网站模式：左侧固定液态玻璃侧边栏（≥900px） -->
  <aside v-if="isDesktop" class="sidebar glass glass-strong" aria-label="主导航">
    <!-- 用户信息卡：头像 / 昵称 / 等级进度（点击进入设置页个人资料区） -->
    <button class="side-user" @click="routerPush('/settings')" aria-label="个人资料与设置">
      <span class="side-user__avatar" :style="avatarStyle">
        <Icon v-if="!profile.avatarData" name="user" :size="22" />
      </span>
      <span class="side-user__meta">
        <span class="side-user__name">{{ displayName }}</span>
        <span class="side-user__lv">Lv.{{ level.level }} · {{ level.stage.label }}</span>
        <span class="side-user__track"><i :style="{ width: level.pct + '%' }"></i></span>
        <span class="side-user__xp">{{ store.xp }} XP</span>
      </span>
    </button>
    <div class="side-brand">
      <span class="side-logo"><img src="/icons/icon.svg" alt="" style="width:100%;height:100%;display:block" /></span>
      <span>地球Online</span>
    </div>
    <nav class="side-nav">
      <template v-for="g in sideGroups" :key="g.label">
        <div class="side-section">{{ g.label }}</div>
        <button v-for="n in g.items" :key="g.label + n.name" class="side-item"
          :class="{ active: route.name === n.name }" @click="goSide(n)">
          <Icon :name="n.icon" :size="19" />
          <span>{{ n.label }}</span>
        </button>
      </template>
    </nav>
    <div class="side-foot">
      <span class="muted">v{{ APP_INFO.version }} · 双端自适应</span>
    </div>
  </aside>

  <div class="statusbar">
    <div class="statusbar__top">
      <span class="title">{{ title }}</span>
      <span class="spacer"></span>
      <button class="ghost-btn" @click="openSearch" aria-label="全局搜索"><Icon name="search" :size="20" /></button>
      <button class="ghost-btn" @click="$router.push('/settings')" aria-label="设置">
        <Icon name="settings" :size="20" />
      </button>
    </div>
    <!-- 全局 XP 等级进度条（仅保留等级，已废弃连击） -->
    <div class="xpbar">
      <span class="xpbar__lv">Lv.{{ level.level }} · {{ level.stage.label }}</span>
      <span class="xpbar__track"><i :style="{ width: level.pct + '%' }"></i></span>
      <span class="xpbar__xp">{{ store.xp }} XP</span>
    </div>
  </div>

  <!-- 页面切换：CSS 过渡（入场 + 离场），不依赖 JS 动画库，永不出现「停在透明态」的空白页 -->
  <div class="route-wrap">
    <router-view v-slot="{ Component }">
      <transition name="page" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>

  <!-- 全局新增 FAB：移动端 / 竖屏窄屏显示（触控可达）；PC 宽屏隐藏（已有快捷入口与右键菜单） -->
  <motion.button v-if="store.quickAdd && showFab" class="quick-fab" :while-hover="{ y: -1, scale: 1.02 }" :while-press="{ scale: 0.94 }" :transition="{ type: 'spring', stiffness: 420, damping: 24 }" @click="store.runQuickAdd()" aria-label="新增">
    <Icon name="plus" :size="26" />
  </motion.button>

  <!-- AI 快捷中枢悬浮入口（手机 PWA 模式专属） -->
  <motion.button v-if="!isDesktop" class="ai-fab" :while-hover="{ y: -1, scale: 1.02 }" :while-press="{ scale: 0.94 }" :transition="{ type: 'spring', stiffness: 420, damping: 24 }" @click="$router.push('/ai')" aria-label="AI 中枢">
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

  <!-- 手机 PWA 模式：底部悬浮胶囊导航（<900px） -->
  <nav v-if="!isDesktop" class="bottomnav">
    <motion.button v-for="n in navItems" :key="n.name" class="nav-item"
      :class="{ active: route.name === n.name }"
      :while-press="{ scale: 0.9 }" :transition="{ type: 'spring', stiffness: 420, damping: 22 }"
      @click="$router.push('/' + (n.name === 'home' ? '' : n.name))">
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

  <!-- v2.1.0：全局生产力组件根级挂载 -->
  <GlobalContextMenu />
  <GlobalDragOverlay />
  <HazeToast />
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
  background: linear-gradient(135deg, var(--eo-primary-soft), var(--eo-primary-deep));
  color: #fff; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.18) inset, 0 14px 30px -10px rgba(176, 133, 83, 0.62);
  transition: transform .2s cubic-bezier(.22, 1, .36, 1), box-shadow .2s ease;
}
.quick-fab::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,255,255,0.30) 0%, transparent 45%);
  opacity: .7; mix-blend-mode: screen;
}
.quick-fab:active { transform: scale(.94); }
.quick-fab svg { position: relative; z-index: 1; }

/* ---- 断网全局横幅 ---- */
.offline-bar {
  position: fixed; z-index: 62; left: 12px; right: 12px; top: 8px;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 16px;
  font-size: 13px; font-weight: 600; color: var(--eo-ink);
  background: rgba(255, 244, 229, .92);
  border: 1px solid rgba(214, 152, 90, .5);
  box-shadow: var(--eo-shadow-soft);
}
.netbar-enter-active, .netbar-leave-active { transition: opacity .22s ease, transform .22s ease; }
.netbar-enter-from, .netbar-leave-to { opacity: 0; transform: translateY(-8px); }

/* ---- 全局搜索面板 ---- */
.search-mask {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(28, 22, 16, .34); backdrop-filter: blur(6px);
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
.search-item:hover { background: var(--eo-chip); transform: translateX(2px); }

.side-user {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 10px 12px; margin-bottom: 8px; border-radius: 16px; text-align: left;
  background: var(--eo-chip); transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s ease;
}
.side-user:hover { transform: translateY(-1px); background: rgba(212, 163, 115, 0.24); }
.side-user__avatar {
  width: 44px; height: 44px; border-radius: 14px; flex: none; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--eo-primary-soft), var(--eo-primary-deep)); color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
}
.side-user__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.side-user__name { font-weight: 700; font-size: 14px; color: var(--eo-ink); }
.side-user__lv { font-size: 11px; color: var(--eo-primary-deep); font-weight: 600; }
.side-user__track { height: 5px; border-radius: 99px; background: var(--eo-glass-border); overflow: hidden; }
.side-user__track i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #E9CFA9, #D4A373); }
.side-user__xp { font-size: 10px; color: var(--eo-ink-soft); }

.ambient .blob { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; }
.ambient .b1 { width: 320px; height: 320px; top: -60px; left: -40px; background: radial-gradient(circle, rgba(212,180,130,.5), transparent 70%); }
.ambient .b2 { width: 360px; height: 360px; bottom: -80px; right: -60px; background: radial-gradient(circle, rgba(212,163,115,.45), transparent 70%); }
.ambient .b3 { width: 260px; height: 260px; top: 40%; left: 50%; background: radial-gradient(circle, rgba(240,225,200,.4), transparent 70%); }

.ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
  background:
    radial-gradient(ellipse 45% 40% at 15% 18%, rgba(240, 224, 196, 0.4), transparent 55%),
    radial-gradient(ellipse 40% 38% at 85% 12%, rgba(226, 205, 172, 0.28), transparent 50%),
    radial-gradient(ellipse 45% 42% at 75% 88%, rgba(235, 218, 190, 0.32), transparent 55%),
    radial-gradient(ellipse 40% 36% at 20% 82%, rgba(220, 200, 168, 0.24), transparent 50%);
}
</style>
