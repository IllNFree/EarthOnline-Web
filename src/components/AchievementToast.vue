<script setup>
// ===== 模块五：沉浸式成就解锁反馈（Haze 满血 + 稀有度特效）=====
// 右下角液态玻璃气泡，按 rarity 展示不同光效（epic/legendary 带流光描边）。
// 2026-11-06：展示时长 6 秒、可点击 / 点 × 手动关闭，文案与卡片加宽加高，音效改为 WebAudio 实时合成。
import { useAppStore } from '../stores/app.js'
import Icon from './Icon.vue'

const store = useAppStore()
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' }
</script>

<template>
  <div class="ach-feed" aria-live="polite">
    <transition-group name="ach">
      <div
        v-for="a in store.achievementFeed"
        :key="a.id"
        class="ach-toast glass glass-strong"
        :class="['r-' + (a.rarity || 'common'), { leaving: a.leaving }]"
        role="status"
        @click="store.dismissAchievement(a.id)"
      >
        <div class="ach-icon"><Icon :name="a.icon || 'trophy'" :size="26" /></div>
        <div class="ach-body">
          <div class="ach-rar">{{ RARITY_LABEL[a.rarity] || '普通' }}成就解锁</div>
          <div class="ach-title">{{ a.title }}</div>
          <div class="ach-desc">{{ a.desc }}</div>
        </div>
        <button class="ach-close" title="关闭" aria-label="关闭" @click.stop="store.dismissAchievement(a.id)">
          <Icon name="x" :size="13" />
        </button>
        <span class="ach-shine" aria-hidden="true"></span>
        <span class="ach-progress" aria-hidden="true"></span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.ach-feed {
  position: fixed; right: 18px; bottom: 90px; z-index: 92;
  display: flex; flex-direction: column; gap: 10px; pointer-events: none;
  width: min(92vw, 380px);
}
/* 电脑端无底部悬浮导航 → 收回到真正的右下角贴边 */
@media (min-width: 900px) { .ach-feed { bottom: 22px; } }
.ach-toast {
  position: relative; overflow: hidden; pointer-events: auto; cursor: pointer;
  display: flex; align-items: flex-start; gap: 13px; padding: 15px 16px 17px;
  border-radius: var(--eo-radius-sm);
  box-shadow: var(--eo-shadow), inset 0 1px 0 var(--eo-glass-hi);
  animation: achIn .42s cubic-bezier(.2,.8,.2,1);
}
.ach-toast.leaving { opacity: 0; transform: translateX(24px) scale(.96); transition: opacity .55s ease, transform .55s ease; }
@keyframes achIn { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
.ach-icon {
  flex: none; width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center;
  color: #fff; background: var(--eo-primary);
  box-shadow: 0 8px 18px -8px rgba(44, 44, 44, .18);
}
.ach-body { flex: 1; min-width: 0; padding-right: 16px; }
.ach-rar { font-size: 11px; font-weight: 700; letter-spacing: .06em; opacity: .8; }
.ach-title { font-size: 16px; font-weight: 800; color: var(--eo-ink); line-height: 1.35; }
.ach-desc { font-size: 12px; line-height: 1.5; opacity: .66; margin-top: 2px; word-break: break-word; }
.ach-close {
  position: absolute; top: 8px; right: 8px; z-index: 2;
  width: 20px; height: 20px; border-radius: 7px; display: grid; place-items: center;
  color: var(--eo-ink-soft); opacity: .55; background: transparent; cursor: pointer;
}
.ach-close:hover { opacity: 1; background: rgba(44, 44, 44, .08); }

/* 稀有度配色与光效（Haze 满血，不降级） */
.r-rare .ach-icon { background: linear-gradient(135deg, #C9C5BE, #8C8C8C); }
.r-epic .ach-icon { background: linear-gradient(135deg, #BDB8B0, #8C8C8C); }
.r-legendary .ach-icon { background: linear-gradient(135deg, #D8D4CD, #8C8C8C); }
.r-epic, .r-legendary { border: 1px solid rgba(200, 196, 189, .5); }
/* 流光描边：史诗/传说级专属 */
.ach-shine { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.r-epic .ach-shine, .r-legendary .ach-shine {
  opacity: 1;
  background: linear-gradient(120deg, transparent 30%, rgba(226, 222, 215, .55) 50%, transparent 70%);
  background-size: 220% 100%;
  animation: achShine 2.2s linear infinite;
}
@keyframes achShine { from { background-position: 120% 0; } to { background-position: -120% 0; } }
/* 底部 6 秒倒计时细线（与 notifyAchievement 的 6000ms 同步） */
.ach-progress {
  position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background: linear-gradient(90deg, var(--accent, #8C8C8C), rgba(140, 140, 140, .25));
  transform-origin: left center;
  animation: achProgress 6s linear forwards;
}
@keyframes achProgress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
