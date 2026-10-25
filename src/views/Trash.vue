<script setup>
import { computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { trashKindLabel } from '../lib/ops.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const dialog = useDialogStore()

// v2.0.0 P0：回收站不再是独立数组，而是「各集合内带 deletedAt 的实体」的实时派生视图
const items = computed(() => store.trashItems)
function label(rec) { return rec.title || rec.name || (rec.markdown ? rec.markdown.slice(0, 20) : '未命名') }
function dayOf(iso) { return String(iso || '').slice(0, 10) }
async function emptyAll() {
  const ok = await dialog.confirm({ title: '清空回收站', message: '将永久删除全部回收站内容，不可恢复。', danger: true, confirmText: '永久删除' })
  if (!ok) return
  store.emptyTrash(); store.showToast('已清空回收站')
}
async function purge(t) {
  const ok = await dialog.confirm({ title: '永久删除', message: '该项将被永久删除，不可恢复。', danger: true, confirmText: '永久删除' })
  if (!ok) return
  store.purgeTrashEntry(t.id); store.showToast('已永久删除')
}
</script>

<template>
  <div class="page wide">
    <div class="row between" style="margin-bottom:12px">
      <div class="muted">共 {{ items.length }} 项 · 30 天内可恢复</div>
      <button v-if="items.length" class="chip danger" @click="emptyAll">清空</button>
    </div>
    <div class="cols-2">
      <div v-for="t in items" :key="t.id" class="glass list-item">
        <span class="avatar"><Icon name="trash" :size="18" /></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">{{ label(t.data) }}</div>
          <div class="muted" style="font-size:12px">{{ trashKindLabel(t.kind) }} · 删除于 {{ dayOf(t.deletedAt) }}</div>
        </div>
        <button class="btn ghost" @click="store.restoreFromTrash(t.id); store.showToast('已恢复')"><Icon name="layers" :size="16" /> 恢复</button>
        <button class="ghost-btn" @click="purge(t)"><Icon name="x" :size="16" /></button>
      </div>
    </div>
    <div v-if="!items.length" class="glass card empty-state">
      <span class="empty-illo"><Icon name="trash" :size="30" /></span>
      <div style="font-weight:700;font-size:15px">回收站是空的</div>
      <div class="muted" style="font-size:12px;margin-top:6px">删除的任务 / 物品 / 收藏 / 笔记 / 足迹 / 照片会在这里保留 30 天</div>
    </div>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.chip.danger { background: rgba(217, 105, 78, .16); color: var(--eo-bad); }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 44px 18px; text-align: center; }
.empty-illo {
  width: 62px; height: 62px; border-radius: 22px; margin-bottom: 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
</style>
