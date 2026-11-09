<script setup>
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { ACHIEVEMENTS, achievementProgress, achievementMeta } from '../lib/achievements.js'
import { todayStr } from '../lib/model.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const tab = ref('all')
const sortMode = ref('cat')

const unlockedMap = computed(() => {
  const m = {}
  ;(store.data.achievements || []).forEach((a) => { m[a.key] = a.unlockedAt || '' })
  return m
})
const unlockedCount = computed(() => store.data.achievements.length)
const pct = computed(() => Math.round((unlockedCount.value / ACHIEVEMENTS.length) * 100))

// 分类（视图层派生，不动契约文件）：按图标与 key 前缀归类
function catOf(a) {
  if (a.key.startsWith('web_')) return 'web'
  if (a.key.startsWith('egg') || a.key === 'walmart_egg') return 'egg'
  if (a.icon === 'flag') return 'task'
  if (a.icon === 'note') return 'memo'
  if (a.icon === 'backpack' || a.icon === 'star') return 'pack'
  if (a.icon === 'map-pin') return 'map'
  if (a.icon === 'calendar' || a.icon === 'cake') return 'time'
  return 'misc'
}
const CATS = [
  { key: 'all', label: '全部' },
  { key: 'web', label: 'Web 专属' },
  { key: 'task', label: '任务' },
  { key: 'memo', label: '笔记' },
  { key: 'pack', label: '背包' },
  { key: 'map', label: '足迹' },
  { key: 'time', label: '时光' },
  { key: 'egg', label: '彩蛋' },
  { key: 'misc', label: '综合' }
]
const counts = computed(() => {
  const m = { all: ACHIEVEMENTS.length }
  ACHIEVEMENTS.forEach((a) => { const c = catOf(a); m[c] = (m[c] || 0) + 1 })
  return m
})
// 隐藏成就说明：首次显示，可关闭（localStorage 记忆）
const HINT_KEY = 'eo_hint_hidden'
const showHint = ref(true)
try { showHint.value = !localStorage.getItem(HINT_KEY) } catch (e) { /* 隐私模式忽略 */ }
function dismissHint() {
  showHint.value = false
  try { localStorage.setItem(HINT_KEY, '1') } catch (e) { /* ignore */ }
}

const filtered = computed(() => {
  const base = tab.value === 'all' ? ACHIEVEMENTS : ACHIEVEMENTS.filter((a) => catOf(a) === tab.value)
  const list = base.map((a) => ({
    ...a,
    unlocked: !!unlockedMap.value[a.key],
    unlockedAt: unlockedMap.value[a.key] || '',
    prog: achievementProgress(a.key, store.data)
  }))
  if (sortMode.value === 'recent') {
    return list.sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
      if (a.unlocked && b.unlocked) return (b.unlockedAt || '').localeCompare(a.unlockedAt || '')
      return 0
    })
  }
  return list
})

// 彩蛋成就「你被骗了」：点击卡片先弹「千万别点」诱饵，确认后才解锁并打开视频
const RICK_KEY = 'egg_rickroll'
const baitOpen = ref(false)
const rickOpen = ref(false)
const RICK_EMBED = 'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&autoplay=1&high_quality=1&danmaku=0'
function openBait() {
  if (unlockedMap.value[RICK_KEY]) return
  baitOpen.value = true
}
function unlockRickroll() {
  baitOpen.value = false
  if (unlockedMap.value[RICK_KEY]) return
  store.data.achievements.push({ key: RICK_KEY, unlockedAt: todayStr() })
  store.persist()
  store.notifyAchievement(achievementMeta(RICK_KEY))
  // 点击即播：内嵌播放器层，用户手势直接触发，不再外跳新标签页
  rickOpen.value = true
}
</script>

<template>
  <div class="page wide">
    <div class="glass card ach-overview">
      <div class="row between">
        <div>
          <div class="ach-big">{{ unlockedCount }} <span class="ach-total">/ {{ ACHIEVEMENTS.length }}</span></div>
          <div class="muted" style="font-size:13px">已解锁成就 · 完成度 {{ pct }}%</div>
        </div>
        <div class="avatar" style="width:56px;height:56px"><Icon name="trophy" :size="28" /></div>
      </div>
      <div class="bar" style="margin-top:10px"><i :style="{ width: pct + '%' }"></i></div>
      <div v-if="showHint" class="ach-hint">
        <span>隐藏成就达成前不显示任何提示，其余成就均显示达成条件与进度</span>
        <button class="ach-hint-close" @click="dismissHint">不再显示</button>
      </div>
    </div>

    <!-- 分类 Tab -->
    <div class="row wrap" style="gap:6px;margin:12px 0 8px">
      <button v-for="c in CATS" :key="c.key" class="chip" :style="tab === c.key ? 'background:var(--eo-primary);color:#fff' : ''" @click="tab = c.key">
        {{ c.label }}<span v-if="c.key !== 'all'" class="muted" style="margin-left:2px"> {{ counts[c.key] || 0 }}</span>
      </button>
    </div>
    <div class="row between" style="margin-bottom:10px">
      <div class="muted" style="font-size:12px">共 {{ filtered.length }} 项</div>
      <button class="chip" @click="sortMode = sortMode === 'cat' ? 'recent' : 'cat'">
        <Icon name="clock" :size="13" /> {{ sortMode === 'cat' ? '按分类' : '最近解锁' }}
      </button>
    </div>

    <div class="grid2 ach-grid">
      <div v-for="a in filtered" :key="a.key" class="glass card ach-card"
        :class="a.unlocked ? 'on' : 'off'"
        @click="a.key === RICK_KEY ? openBait() : null">
        <div class="row" style="gap:10px">
          <span class="avatar ach-ico"><Icon :name="a.icon" :size="20" /></span>
          <div style="flex:1;min-width:0">
            <div class="ach-name">
              {{ a.unlocked || !a.secret ? a.title : (a.key === RICK_KEY ? '??? · 千万别点' : '???') }}
            </div>
            <div class="muted ach-cond">{{ a.secret && !a.unlocked ? '达成方式未知' : a.desc }}</div>
            <div v-if="a.unlocked" class="ach-date">解锁于 {{ a.unlockedAt || '—' }}</div>
            <div v-else-if="a.prog && a.prog.goal > 1 && !a.secret" class="ach-prog">
              <i :style="{ width: Math.min(100, (a.prog.cur / a.prog.goal) * 100) + '%' }"></i>
              <span>{{ a.prog.cur }}/{{ a.prog.goal }}</span>
            </div>
          </div>
          <Icon v-if="a.unlocked" name="checklist" :size="18" style="color:var(--eo-ink)" />
        </div>
      </div>
    </div>

    <!-- 彩蛋诱饵：确认后才解锁「你被骗了」并跳转视频 -->
    <Modal title="千万别点" :show="baitOpen" @close="baitOpen = false">
      <div class="bait">
        <p class="bait-line">你确定要点吗？</p>
        <p class="bait-sub">我劝过你了。</p>
        <div class="bait-actions">
          <button class="btn" @click="baitOpen = false">算了</button>
          <button class="btn primary" @click="unlockRickroll">我就要点</button>
        </div>
      </div>
    </Modal>

    <Teleport to="body">
      <div v-if="rickOpen" class="rick-mask" @click.self="rickOpen = false">
        <div class="rick-box">
          <iframe :src="RICK_EMBED" allow="autoplay; encrypted-media; fullscreen" allowfullscreen scrolling="no" frameborder="0"></iframe>
          <button class="btn" @click="rickOpen = false">关闭</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ach-big { font-size: 24px; font-weight: 800; color: var(--eo-ink); }
.ach-total { font-size: 14px; font-weight: 600; color: var(--eo-ink-soft); }
.ach-overview { padding-bottom: 14px; }
.ach-hint {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 10px; padding: 8px 10px;
  border-radius: 10px; background: var(--eo-chip); font-size: 11.5px; line-height: 1.65; color: var(--eo-ink-soft);
}
.ach-hint span { flex: 1; }
.ach-hint-close { flex: none; font-size: 11px; font-weight: 600; color: var(--eo-ink); opacity: .7; }
.ach-hint-close:hover { opacity: 1; }
.ach-grid { align-items: stretch; }
.ach-card { margin: 0; padding: 12px; position: relative; overflow: hidden; }
.ach-card.off { opacity: .68; }
.ach-card.off .ach-name { color: var(--eo-ink-soft); }
.ach-ico { background: var(--eo-chip); color: var(--eo-primary-deep); }
.ach-name { font-weight: 700; font-size: 14px; color: var(--eo-ink); }
.ach-cond { font-size: 11px; line-height: 1.5; }
.ach-date { font-size: 10px; margin-top: 3px; color: var(--eo-ink-soft); }
.ach-prog { position: relative; height: 16px; margin-top: 6px; border-radius: 99px; background: var(--eo-glass-border); overflow: hidden; }
.ach-prog i { position: absolute; inset: 0 auto 0 0; background: var(--eo-primary); opacity: .55; }
.ach-prog span { position: relative; z-index: 1; font-size: 10px; font-weight: 700; line-height: 16px; padding-left: 7px; }
@media (max-width: 520px) {
  .ach-big { font-size: 20px; }
}
.bait { padding: 14px 2px 6px; text-align: center; }
.bait-line { margin: 0; font-size: 16px; font-weight: 700; color: var(--eo-ink); }
.bait-sub { margin: 6px 0 16px; font-size: 13px; color: var(--eo-ink-soft); }
.bait-actions { display: flex; gap: 10px; justify-content: center; }
.bait-actions .btn { min-width: 96px; }
.rick-mask { position: fixed; inset: 0; z-index: 95; background: rgba(20,18,24,.86); display: flex; align-items: center; justify-content: center; padding: 16px; }
.rick-box { width: min(92vw, 860px); display: flex; flex-direction: column; gap: 10px; }
.rick-box iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 14px; background: #000; }
.rick-box .btn { align-self: flex-end; }
</style>
