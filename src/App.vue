<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { motion, AnimatePresence } from 'motion-v'
import { useMediaQuery } from '@vueuse/core'
import { useAppStore } from './stores/app.js'
import { useDialogStore } from './stores/dialog.js'
import { routeVariants } from './lib/motion.js'
import { xpLevelInfo } from './lib/model.js'
import Icon from './components/Icon.vue'
import GlassDialog from './components/GlassDialog.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const routerPush = useRouter().push
const level = computed(() => xpLevelInfo(store.xp))
// 双模式自适应：≥900px = 电脑网站（侧边栏），<900px = 手机 PWA（底部悬浮导航）
const isDesktop = useMediaQuery('(min-width: 900px)')

// 壁纸透出度：对齐 Android 公式 alpha × (深色 ? 0.4 : 1.0)
const wallStyle = computed(() => {
  if (!store.data.wallpaper) return null
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const op = (Number(store.data.wallAlpha) || 0.5) * (dark ? 0.4 : 1.0)
  return { backgroundImage: 'url(' + store.data.wallpaper + ')', opacity: op }
})

const navItems = [
  { name: 'home', icon: 'home', label: '主页' },
  { name: 'tasks', icon: 'tasks', label: '任务' },
  { name: 'backpack', icon: 'backpack', label: '背包' },
  { name: 'notes', icon: 'note', label: '笔记' },
  { name: 'settings', icon: 'settings', label: '设置' }
]
// 电脑侧边栏导航（分组，覆盖全部页面）
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
    { name: 'steam', icon: 'cloud', label: 'Steam 游戏库' },
    { name: 'ai', icon: 'sparkles', label: 'AI 中枢' },
    { name: 'achievements', icon: 'trophy', label: '成就殿堂' },
    { name: 'stats', icon: 'chart', label: '数据中心' }
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

let mq
let spotlightHandler = null
// 主 Tab 路由（Esc 返回逻辑中的「非二级页」）
const MAIN_PATHS = ['/', '/tasks', '/backpack', '/notes', '/settings']
let escHandler = null
onMounted(() => {
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
      <span class="muted">v1.0.6 · 双端自适应</span>
    </div>
  </aside>

  <div class="statusbar">
    <div class="statusbar__top">
      <span class="title">{{ title }}</span>
      <span class="spacer"></span>
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

  <!-- 弹簧页面转场：blur + y + scale -->
  <AnimatePresence mode="wait">
    <motion.div :key="route.path" class="route-wrap" :variants="routeVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </motion.div>
  </AnimatePresence>

  <!-- AI 快捷中枢悬浮入口（手机 PWA 模式专属） -->
  <motion.button v-if="!isDesktop" class="ai-fab" :while-hover="{ y: -1, scale: 1.02 }" :while-press="{ scale: 0.94 }" :transition="{ type: 'spring', stiffness: 420, damping: 24 }" @click="$router.push('/ai')" aria-label="AI 中枢">
    <Icon name="sparkles" :size="26" />
  </motion.button>

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
</template>

<style scoped>
.ghost-btn { color: #fff; display: inline-flex; padding: 4px; opacity: .92; }
.ghost-btn:active { opacity: .6; }

.route-wrap { position: absolute; inset: 0; z-index: 1; }

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
