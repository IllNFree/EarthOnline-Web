<script setup>
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { growthStageOf, getLifeStats } from '../lib/model.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const have = computed(() => new Set(store.data.achievements.map((a) => a.key)))
const stage = computed(() => growthStageOf(store.xp))
const life = computed(() => getLifeStats(store.data.birthDate))
const tab = ref('all')

// 分类（视图层派生，不动契约文件）：按图标与 key 前缀归类
function catOf(a) {
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
const filtered = computed(() => tab.value === 'all' ? ACHIEVEMENTS : ACHIEVEMENTS.filter((a) => catOf(a) === tab.value))
</script>

<template>
  <div class="page wide">
    <div class="glass card">
      <div class="row between">
        <div>
          <div style="font-size:22px;font-weight:800">{{ store.data.achievements.length }} / {{ ACHIEVEMENTS.length }}</div>
          <div class="muted" style="font-size:13px">已解锁成就 · {{ store.xp }} XP</div>
        </div>
        <div class="avatar" style="width:56px;height:56px"><Icon :name="stage.icon" :size="28" /></div>
      </div>
      <div class="bar" style="margin-top:10px"><i :style="{ width: (store.data.achievements.length / ACHIEVEMENTS.length * 100) + '%' }"></i></div>
    </div>

    <!-- 分类 Tab -->
    <div class="row wrap" style="gap:6px;margin:12px 0">
      <button v-for="c in CATS" :key="c.key" class="chip" :style="tab === c.key ? 'background:var(--eo-primary);color:#fff' : ''" @click="tab = c.key">
        {{ c.label }}<span v-if="c.key !== 'all'" class="muted" style="margin-left:2px"> {{ counts[c.key] || 0 }}</span>
      </button>
    </div>

    <div class="grid2">
      <div v-for="a in filtered" :key="a.key" class="glass card" style="margin:0;padding:12px;opacity:.5" :style="have.has(a.key) ? 'opacity:1' : ''">
        <div class="row" style="gap:10px">
          <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon :name="a.icon" :size="20" /></span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px">{{ have.has(a.key) ? a.title : '???' }}</div>
            <div class="muted" style="font-size:11px">{{ a.desc }}</div>
            <span class="chip" style="margin-top:4px">+{{ a.xp }} XP</span>
          </div>
          <Icon v-if="have.has(a.key)" name="checklist" :size="18" style="color:var(--eo-good)" />
        </div>
      </div>
    </div>
  </div>
</template>
