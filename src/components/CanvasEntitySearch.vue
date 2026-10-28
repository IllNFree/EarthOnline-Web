<script setup>
// ===== 全局实体检索 + 节点快速定位 / 创建 =====
// 对应需求 12：输入关键词命中实体后，可「定位节点」或「在此处创建」。
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { canvasEnsureNode, canvasFocus, canvasIsActive } from '../services/canvasBridge.js'
import Icon from './Icon.vue'

const emit = defineEmits(['close'])
const store = useAppStore()
const q = ref('')

const results = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) return []
  const out = []
  const push = (type, list, nameFn, idFn) => {
    list.forEach((e) => {
      const name = nameFn(e)
      if (name && name.toLowerCase().includes(t)) out.push({ type, id: idFn(e), name, hasNode: false })
    })
  }
  push('task', store.live.tasks, (e) => e.title, (e) => e.id)
  push('memo', store.live.memos, (e) => e.title, (e) => e.id)
  push('item', store.live.items, (e) => e.name, (e) => e.id)
  push('photo', store.live.photos, (e) => e.name, (e) => e.id)
  push('collection', store.live.collections, (e) => e.title, (e) => e.id)
  push('location', store.live.locations, (e) => e.name, (e) => e.id)
  // 标记已有节点
  out.forEach((r) => {
    r.hasNode = !!store.data.whiteboardNodes.find((n) => !n.deletedAt && n.type === r.type && n.refId === r.id)
  })
  return out.slice(0, 40)
})

const TYPE_LABEL = { task: '任务', memo: '笔记', item: '物品', photo: '照片', collection: '收藏', location: '足迹' }

function activate(r) {
  const existing = store.data.whiteboardNodes.find((n) => !n.deletedAt && n.type === r.type && n.refId === r.id)
  if (existing) { canvasFocus(existing); return }
  const node = canvasEnsureNode(r.type, r.id, { center: true })
  if (node) canvasFocus(node)
}
</script>

<template>
  <div class="ces-mask" @pointerdown.self="emit('close')">
    <div class="glass ces-panel">
      <div class="row between" style="margin-bottom:10px">
        <span style="font-weight:700">实体检索 · 定位节点</span>
        <button class="btn ghost" @click="emit('close')"><Icon name="close" :size="16" /></button>
      </div>
      <input v-model="q" class="ces-input" placeholder="搜索任务 / 笔记 / 物品 / 照片 / 收藏 / 足迹…" autofocus />
      <div class="ces-list">
        <div v-if="!results.length" class="muted" style="font-size:13px;padding:10px 0">输入关键词开始检索（{{ canvasIsActive() ? '可直接在画布定位/创建节点' : '画布未打开，仅展示结果' }}）</div>
        <div v-for="r in results" :key="r.type + r.id" class="ces-item" @click="activate(r)">
          <span class="ces-tag">{{ TYPE_LABEL[r.type] }}</span>
          <span class="ces-name">{{ r.name }}</span>
          <span class="ces-act">{{ r.hasNode ? '定位节点' : '创建节点' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ces-mask { position: fixed; inset: 0; z-index: 90; background: rgba(20, 16, 10, 0.32); display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }
.ces-panel { width: min(560px, 92vw); max-height: 70vh; display: flex; flex-direction: column; padding: 16px; border-radius: 18px; }
.ces-input { width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--eo-glass-border); background: var(--eo-glass); color: var(--eo-ink); font-size: 14px; margin-bottom: 10px; }
.ces-list { overflow-y: auto; flex: 1; min-height: 0; }
.ces-item { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 10px; cursor: pointer; }
.ces-item:hover { background: var(--eo-chip); }
.ces-tag { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: var(--eo-primary-soft); color: #fff; flex: none; }
.ces-name { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ces-act { font-size: 11px; color: var(--eo-primary-deep); font-weight: 700; flex: none; }
</style>
