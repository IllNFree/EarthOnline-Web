<script setup>
// ===== 双向链接级联选择器（需求 4 编辑层）：@ 触发，按类型 Tab 过滤，跨模块检索 =====
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { searchEntities, listEntitiesByType } from '../services/EntitySearchProvider.js'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import Icon from './Icon.vue'

const emit = defineEmits(['select', 'close'])
const store = useAppStore()
const q = ref('')
const activeTab = ref('memo')

const tabs = [
  { key: 'memo', label: '笔记', icon: 'note' },
  { key: 'task', label: '任务', icon: 'tasks' },
  { key: 'item', label: '背包', icon: 'backpack' },
  { key: 'photo', label: '相册', icon: 'image' },
  { key: 'collection', label: '收藏', icon: 'star' },
  { key: 'location', label: '足迹', icon: 'map-pin' }
]

const results = computed(() => {
  const query = q.value.trim()
  if (query) return searchEntities(store.data, query, [activeTab.value])
  return listEntitiesByType(store.data, activeTab.value)
})

function pick(e) { emit('select', e); emit('close') }
</script>

<template>
  <div class="entity-picker glass glass-strong" role="dialog">
    <div class="ep-tabs">
      <button
        v-for="t in tabs" :key="t.key"
        class="ep-tab" :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        <Icon :name="t.icon" :size="16" /> {{ t.label }}
      </button>
    </div>
    <div class="ep-search">
      <Icon name="search" :size="16" />
      <input v-model="q" :placeholder="'搜索' + (BI_LINK_TYPES[activeTab] || {}).label" autofocus />
    </div>
    <div class="ep-list">
      <button v-for="e in results" :key="e.type + e.id" class="ep-item" @click="pick(e)">
        <Icon :name="e.icon" :size="16" />
        <span class="ep-title">{{ e.title }}</span>
        <span v-if="e.sub" class="ep-sub">{{ e.sub }}</span>
      </button>
      <div v-if="!results.length" class="ep-empty muted">暂无可关联的{{ (BI_LINK_TYPES[activeTab] || {}).label }}</div>
    </div>
  </div>
</template>

<style scoped>
.entity-picker { width: min(92vw, 360px); padding: 12px; border-radius: var(--eo-radius-sm); }
.ep-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.ep-tab {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600; color: var(--eo-ink-soft);
  background: var(--eo-chip); transition: all .14s ease;
}
.ep-tab.active { color: #fff; background: linear-gradient(135deg, var(--eo-primary), var(--eo-primary-deep)); }
.ep-search { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border); margin-bottom: 8px; }
.ep-search input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; }
.ep-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.ep-item { display: flex; align-items: center; gap: 8px; padding: 10px 10px; border-radius: 10px; text-align: left; transition: background .14s ease; }
.ep-item:hover { background: var(--eo-chip); }
.ep-title { font-size: 14px; font-weight: 600; color: var(--eo-ink); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ep-sub { font-size: 11px; color: var(--eo-ink-soft); }
.ep-empty { text-align: center; padding: 20px; font-size: 13px; }
</style>
