<script setup>
// ===== v2.1.0 模块四：统一关联实体弹窗（唯一事实来源，全应用复用）=====
// 任务 / 笔记 / 相册 / 足迹 / 背包 / 收藏 / 记账 的详情页统一使用本组件。
// 底层只写 biLinks 一张关联表，画布连线与详情页关联共用，双向自动同步。
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../stores/app.js'
import { searchEntities, listEntitiesByType } from '../services/EntitySearchProvider.js'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import Icon from './Icon.vue'

const props = defineProps({
  sourceType: { type: String, default: '' },
  sourceId: { type: String, default: '' },
  show: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
const store = useAppStore()

const TABS = [
  { key: 'all', label: '全部', icon: 'search' },
  { key: 'task', label: '任务', icon: 'tasks' },
  { key: 'memo', label: '笔记', icon: 'note' },
  { key: 'item', label: '背包', icon: 'backpack' },
  { key: 'collection', label: '收藏', icon: 'star' },
  { key: 'photo', label: '相册', icon: 'image' },
  { key: 'location', label: '足迹', icon: 'map-pin' },
  { key: 'ledger', label: '记账', icon: 'wallet' }
]

const activeTab = ref('all')
const q = ref('')
const selected = ref(new Set())

// 每次打开时重置为「当前已关联的目标集合」（含反向：只要有一端指向我即视为已关联）
watch(() => props.show, (v) => {
  if (!v) return
  activeTab.value = 'all'
  q.value = ''
  const set = new Set()
  store.data.biLinks.filter((b) => !b.deletedAt).forEach((b) => {
    if (b.sourceType === props.sourceType && b.sourceId === props.sourceId) set.add(b.targetType + ':' + b.targetId)
    if (b.targetType === props.sourceType && b.targetId === props.sourceId) set.add(b.sourceType + ':' + b.sourceId)
  })
  selected.value = set
})

const results = computed(() => {
  const list = activeTab.value === 'all'
    ? (q.value.trim() ? searchEntities(store.data, q.value.trim()) : allEntities())
    : listEntitiesByType(store.data, activeTab.value)
  return list.filter((e) => !(e.type === props.sourceType && e.id === props.sourceId))
})

function allEntities() {
  const out = []
  Object.keys(BI_LINK_TYPES).forEach((t) => { out.push(...listEntitiesByType(store.data, t)) })
  return out.slice(0, 200)
}

function toggle(e) {
  const k = e.type + ':' + e.id
  const next = new Set(selected.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selected.value = next
}
function isSel(e) { return selected.value.has(e.type + ':' + e.id) }

function save() {
  const targets = Array.from(selected.value).map((k) => { const i = k.indexOf(':'); return { type: k.slice(0, i), id: k.slice(i + 1) } })
  store.setEntityRelations(props.sourceType, props.sourceId, targets)
  store.showToast('关联已更新（' + targets.length + ' 项）· 画布连线同步完成')
  emit('close')
}
</script>

<template>
  <div v-if="show" class="esd-mask" @click.self="emit('close')">
    <div class="esd-dialog glass glass-strong" role="dialog">
      <div class="esd-head">
        <div class="esd-title"><Icon name="link" :size="18" /> 关联实体</div>
        <button class="ghost-btn" @click="emit('close')"><Icon name="x" :size="18" /></button>
      </div>
      <div class="esd-sub muted">
        跨模块勾选实体建立<b>双向</b>关联：任一端添加 / 解除，另一端与画布连线即时同步。
      </div>

      <div class="ep-tabs">
        <button v-for="t in TABS" :key="t.key" class="ep-tab" :class="{ active: activeTab === t.key }" @click="activeTab = t.key">
          <Icon :name="t.icon" :size="15" /> {{ t.label }}
        </button>
      </div>

      <div class="ep-search">
        <Icon name="search" :size="16" />
        <input v-model="q" placeholder="搜索所有类型的实体…" />
      </div>

      <div class="ep-list">
        <button v-for="e in results" :key="e.type + ':' + e.id" class="ep-item" :class="{ sel: isSel(e) }" @click="toggle(e)">
          <span class="ep-check" :class="{ on: isSel(e) }"><Icon v-if="isSel(e)" name="check" :size="13" /></span>
          <Icon :name="e.icon" :size="16" />
          <span class="ep-title">{{ e.title }}</span>
          <span class="ep-type">{{ (BI_LINK_TYPES[e.type] || {}).label }}</span>
        </button>
        <div v-if="!results.length" class="ep-empty muted">没有匹配的实体</div>
      </div>

      <div class="esd-foot">
        <span class="muted">已选 {{ selected.size }} 项</span>
        <button class="btn" @click="save"><Icon name="checklist" :size="16" /> 保存关联</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.esd-mask { position: fixed; inset: 0; z-index: 92; background: rgba(28, 28, 27, .36); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
.esd-dialog { width: min(94vw, 460px); max-height: 84vh; display: flex; flex-direction: column; border-radius: var(--eo-radius); overflow: hidden; box-shadow: var(--eo-shadow); }
.esd-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 4px; }
.esd-title { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 16px; color: var(--eo-ink); }
.esd-sub { padding: 0 16px 10px; font-size: 12px; line-height: 1.6; }
.ep-tabs { display: flex; gap: 4px; flex-wrap: wrap; padding: 0 16px 8px; }
.ep-tab { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--eo-ink-soft); background: var(--eo-chip); transition: transform .12s ease; }
.ep-tab.active { color: var(--eo-ink); background: rgba(44, 44, 44, 0.1); }
.ep-search { display: flex; align-items: center; gap: 8px; margin: 0 16px 8px; padding: 8px 12px; border-radius: 999px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border); }
.ep-search input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; color: var(--eo-ink); }
.ep-list { flex: 1; overflow-y: auto; padding: 0 12px 8px; display: flex; flex-direction: column; gap: 2px; }
.ep-item { display: flex; align-items: center; gap: 8px; padding: 10px; border-radius: 10px; text-align: left; transition: background .14s ease; }
.ep-item:hover { background: var(--eo-chip); }
.ep-item.sel { background: rgba(44, 44, 44, .2); }
.ep-check { width: 18px; height: 18px; border-radius: 6px; border: 1.5px solid var(--eo-glass-border); display: grid; place-items: center; color: #fff; flex: none; }
.ep-check.on { background: var(--eo-primary); border-color: var(--eo-primary); }
.ep-title { font-size: 14px; font-weight: 600; color: var(--eo-ink); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ep-type { font-size: 11px; color: var(--eo-ink-soft); flex: none; }
.ep-empty { text-align: center; padding: 20px; font-size: 13px; }
.esd-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--eo-glass-border); }
</style>
