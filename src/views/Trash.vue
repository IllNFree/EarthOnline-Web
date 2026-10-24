<script setup>
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { trashKindLabel } from '../lib/ops.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const dialog = useDialogStore()
function kindOf(t) {
  const arr = { task: store.data.tasks, item: store.data.items, collection: store.data.collections, memo: store.data.memos, location: store.data.locations, photo: store.data.photos }[t.kind]
  return arr && Array.isArray(t.data) ? t.data[0] : (t.data || {})
}
function label(t) { const d = kindOf(t); return d.title || d.name || (d.markdown ? d.markdown.slice(0, 20) : '未命名') }
async function emptyAll() {
  const ok = await dialog.confirm({ title: '清空回收站', message: '将永久删除全部回收站内容，不可恢复。', danger: true, confirmText: '永久删除' })
  if (!ok) return
  store.emptyTrash(); store.showToast('已清空回收站')
}
async function purge(t) {
  const ok = await dialog.confirm({ title: '永久删除', message: '该项将被永久删除，不可恢复。', danger: true, confirmText: '永久删除' })
  if (!ok) return
  store.purgeTrashEntry(t.id)
}
</script>

<template>
  <div class="page wide">
    <div class="row between" style="margin-bottom:12px">
      <div class="muted">共 {{ store.data.trash.length }} 项 · 30 天内可恢复</div>
      <button v-if="store.data.trash.length" class="chip danger" @click="emptyAll">清空</button>
    </div>
    <div class="cols-2">
    <div v-for="t in store.data.trash" :key="t.id" class="glass list-item">
      <span class="avatar"><Icon name="trash" :size="18" /></span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">{{ label(t) }}</div>
        <div class="muted" style="font-size:12px">{{ trashKindLabel(t.kind) }} · 删除于 {{ t.deletedAt }}</div>
      </div>
      <button class="btn ghost" @click="store.restoreFromTrash(t.id); store.showToast('已恢复')"><Icon name="layers" :size="16" /> 恢复</button>
      <button class="ghost-btn" @click="purge(t)"><Icon name="x" :size="16" /></button>
    </div>
    </div>
    <div v-if="!store.data.trash.length" class="muted" style="text-align:center;padding:40px">回收站是空的</div>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.chip.danger { background: rgba(217, 105, 78, .16); color: var(--eo-bad); }
</style>
