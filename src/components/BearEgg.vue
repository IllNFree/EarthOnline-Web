<script setup>
// ===== 头像旁的卡通小熊彩蛋（致敬《消逝的光芒》）=====
// 点击计数跨会话累计：1–3 次「我爱你」、4 次「我说我爱你」、5 次「别碰我」、
// 6 次「你自找的」→ 爆炸 + 解锁成就 + 尝试关闭网页；爆炸后小熊永久消失。
import { ref, computed, onBeforeUnmount } from 'vue'
import { useAppStore } from '../stores/app.js'
import { achievementMeta } from '../lib/achievements.js'
import { todayStr } from '../lib/model.js'

const CLICK_KEY = 'eo_egg_bear_clicks'
const GONE_KEY = 'eo_egg_bear_gone'
const ACH_KEY = 'egg_self_inflicted'
const SAID_MS = 1200

const store = useAppStore()

const clicks = ref(0)
const gone = ref(false)
try {
  clicks.value = Number(localStorage.getItem(CLICK_KEY) || 0) || 0
  gone.value = localStorage.getItem(GONE_KEY) === '1'
} catch (e) { /* 隐私模式忽略 */ }

const bubble = ref('')
const exploding = ref(false)
// 表情随点击次数递进：微笑 → 平静 → 不悦 → 愤怒
const mood = computed(() => {
  const n = Math.min(clicks.value, 6)
  if (n >= 6) return 'angry'
  if (n === 5) return 'annoyed'
  if (n === 4) return 'calm'
  return 'smile'
})
let bubbleTimer = null
let boomTimer = null
let exitTimer = null

function persistClicks() {
  try { localStorage.setItem(CLICK_KEY, String(clicks.value)) } catch (e) { /* ignore */ }
}
function say(text, ms = SAID_MS) {
  bubble.value = text
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => { bubble.value = '' }, ms)
}
function unlock() {
  const has = (store.data.achievements || []).some((a) => a.key === ACH_KEY)
  if (has) return
  store.data.achievements.push({ key: ACH_KEY, unlockedAt: todayStr() })
  store.persist()
  store.notifyAchievement(achievementMeta(ACH_KEY))
}
function boom() {
  exploding.value = true
  gone.value = true
  try { localStorage.setItem(GONE_KEY, '1') } catch (e) { /* ignore */ }
  unlock()
  // 爆炸动画 <1s；随后尝试关闭窗口，若被浏览器拦截则退出当前页
  exitTimer = setTimeout(() => {
    try { window.close() } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (!window.closed) {
        try { location.replace('about:blank') } catch (e) { /* ignore */ }
      }
    }, 80)
  }, 900)
}
function onBearClick() {
  if (gone.value || exploding.value) return
  clicks.value += 1
  persistClicks()
  const n = clicks.value
  if (n <= 3) { say('我爱你'); return }
  if (n === 4) { say('我说我爱你'); return }
  if (n === 5) { say('别碰我'); return }
  if (n === 6) {
    say('你自找的', 600)
    boomTimer = setTimeout(boom, 600)
    return
  }
  // 计数被外部篡改（>6）时直接按最后一次处理
  say('你自找的', 600)
  boomTimer = setTimeout(boom, 600)
}

onBeforeUnmount(() => {
  clearTimeout(bubbleTimer)
  clearTimeout(boomTimer)
  clearTimeout(exitTimer)
})
</script>

<template>
  <div v-if="!gone && !exploding" class="bear-egg">
    <button class="bear-btn" type="button" aria-label="小熊" @click="onBearClick">
      <svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
        <circle cx="18" cy="15" r="9.5" fill="#A8815B" />
        <circle cx="46" cy="15" r="9.5" fill="#A8815B" />
        <circle cx="18" cy="15" r="5" fill="#6B4B31" />
        <circle cx="46" cy="15" r="5" fill="#6B4B31" />
        <circle cx="32" cy="34" r="19.5" fill="#B98F66" />
        <ellipse cx="32" cy="42" rx="10.5" ry="7.6" fill="#F2E5D4" />
        <ellipse cx="32" cy="38.6" rx="3.4" ry="2.5" fill="#3E2B1B" />

        <!-- 表情：微笑 -->
        <template v-if="mood === 'smile'">
          <circle cx="24.5" cy="29.5" r="2.7" fill="#3E2B1B" />
          <circle cx="39.5" cy="29.5" r="2.7" fill="#3E2B1B" />
          <circle cx="25.4" cy="28.6" r=".8" fill="#FFFFFF" />
          <circle cx="40.4" cy="28.6" r=".8" fill="#FFFFFF" />
          <ellipse cx="20.5" cy="36" rx="3.4" ry="2.1" fill="#D69678" opacity=".45" />
          <ellipse cx="43.5" cy="36" rx="3.4" ry="2.1" fill="#D69678" opacity=".45" />
          <path d="M32 41.2v2.4M32 43.6c-1.5 1.8-4.4 1.3-4.4-.4" stroke="#3E2B1B" stroke-width="1.2" fill="none" stroke-linecap="round" />
        </template>

        <!-- 表情：平静 -->
        <template v-else-if="mood === 'calm'">
          <circle cx="24.5" cy="29.5" r="2.6" fill="#3E2B1B" />
          <circle cx="39.5" cy="29.5" r="2.6" fill="#3E2B1B" />
          <circle cx="25.4" cy="28.6" r=".8" fill="#FFFFFF" />
          <circle cx="40.4" cy="28.6" r=".8" fill="#FFFFFF" />
          <path d="M28 44.6h8" stroke="#3E2B1B" stroke-width="1.3" stroke-linecap="round" />
        </template>

        <!-- 表情：不悦（皱眉） -->
        <template v-else-if="mood === 'annoyed'">
          <path d="M20.6 26.4 27.4 28.6" stroke="#3E2B1B" stroke-width="1.7" stroke-linecap="round" />
          <path d="M43.4 26.4 36.6 28.6" stroke="#3E2B1B" stroke-width="1.7" stroke-linecap="round" />
          <circle cx="24.5" cy="30.2" r="2.3" fill="#3E2B1B" />
          <circle cx="39.5" cy="30.2" r="2.3" fill="#3E2B1B" />
          <path d="M28.2 45.2c1.9-1.8 4.1-1.8 6 0" stroke="#3E2B1B" stroke-width="1.3" fill="none" stroke-linecap="round" />
        </template>

        <!-- 表情：愤怒 -->
        <template v-else>
          <path d="M20 24.8 27.6 28.2" stroke="#3E2B1B" stroke-width="2" stroke-linecap="round" />
          <path d="M44 24.8 36.4 28.2" stroke="#3E2B1B" stroke-width="2" stroke-linecap="round" />
          <path d="M22.2 31.4 26.8 29.8" stroke="#3E2B1B" stroke-width="2.1" stroke-linecap="round" />
          <path d="M41.8 31.4 37.2 29.8" stroke="#3E2B1B" stroke-width="2.1" stroke-linecap="round" />
          <ellipse cx="32" cy="44.6" rx="6" ry="4" fill="#3E2B1B" />
          <path d="M27.6 43.1h8.8" stroke="#F2E5D4" stroke-width="1.5" stroke-linecap="round" />
          <path d="M45.4 22.6l3.4 1.2M45.4 26.6l3.4-1.2" stroke="#B9452F" stroke-width="1.6" stroke-linecap="round" />
        </template>
      </svg>
    </button>
    <transition name="bear-pop">
      <div v-if="bubble" class="bear-say">{{ bubble }}</div>
    </transition>
  </div>

  <Teleport to="body">
    <div v-if="exploding" class="egg-boom" aria-hidden="true">
      <div class="egg-boom-flash"></div>
      <div class="egg-boom-ring"></div>
      <div class="egg-boom-ring egg-boom-ring--late"></div>
    </div>
  </Teleport>
</template>

<style scoped>
.bear-egg { position: absolute; right: -10px; bottom: -8px; z-index: 4; }
.bear-btn {
  display: block; padding: 0; border: none; background: none; line-height: 0;
  border-radius: 50%; filter: drop-shadow(0 3px 6px rgba(44, 44, 44, .18));
  transition: transform .18s var(--eo-lift-ease);
}
.bear-btn:hover { transform: translateY(-2px) rotate(-4deg); }
.bear-btn:active { transform: translateY(0) rotate(3deg); }
.bear-say {
  position: absolute; left: 50%; bottom: calc(100% + 4px); transform: translateX(-50%);
  padding: 7px 12px; border-radius: 12px; white-space: nowrap;
  font-size: 13px; font-weight: 600; color: var(--eo-ink);
  background: var(--eo-surface); border: 1px solid var(--eo-glass-border);
  box-shadow: var(--eo-shadow-soft);
}
.bear-say::after {
  content: ""; position: absolute; left: 50%; top: 100%; width: 7px; height: 7px;
  margin-left: -3.5px; margin-top: -4px; transform: rotate(45deg);
  background: var(--eo-surface); border-right: 1px solid var(--eo-glass-border);
  border-bottom: 1px solid var(--eo-glass-border);
}
.bear-pop-enter-active, .bear-pop-leave-active { transition: opacity .16s ease, transform .16s ease; }
.bear-pop-enter-from, .bear-pop-leave-to { opacity: 0; transform: translateX(-50%) translateY(4px); }

/* 爆炸：纯 CSS，小于 1s */
.egg-boom { position: fixed; inset: 0; z-index: 120; pointer-events: none; overflow: hidden; }
.egg-boom-flash {
  position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(circle at 50% 50%, #FFFFFF 0%, rgba(255, 255, 255, .72) 38%, rgba(255, 255, 255, 0) 78%);
  animation: eggFlash .84s ease-out forwards;
}
.egg-boom-ring {
  position: absolute; left: calc(50% - 6vmax); top: calc(50% - 6vmax); width: 12vmax; height: 12vmax;
  border-radius: 50%; opacity: 0; border: 1.6vmax solid rgba(255, 255, 255, .88);
  animation: eggRing .84s cubic-bezier(.2, .7, .2, 1) forwards;
}
.egg-boom-ring--late { border-color: rgba(44, 44, 44, .5); animation-delay: .1s; }
@keyframes eggFlash { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
@keyframes eggRing {
  0% { opacity: 0; transform: scale(.2); }
  18% { opacity: .9; }
  100% { opacity: 0; transform: scale(2.6); }
}
@media (prefers-reduced-motion: reduce) {
  .bear-btn, .bear-pop-enter-active, .bear-pop-leave-active { transition: none; }
}
</style>
