<script setup>
// 任务节点（递归渲染父子嵌套，支持无限层级）
import { ref, computed, inject } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { TASK_CATEGORY, TASK_STATUS } from '../lib/model.js'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'

const props = defineProps({
  task: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  batch: { type: Boolean, default: false },
  selectedIds: { type: Object, default: () => new Set() }
})
const emit = defineEmits(['select'])
const store = useAppStore()
const dialog = useDialogStore()
const openEditor = inject('taskEditor', null)

const open = ref(true)
const showNote = ref(false)
const children = computed(() => store.live.tasks.filter((t) => t.parentId === props.task.id))

function catLabel(c) { return (TASK_CATEGORY[c] || {}).label || c }
function statusLabel(s) { return (TASK_STATUS[s] || {}).label || s }
function toggle() { store.toggleTaskDone(props.task.id); store.showToast('已更新') }
function select() { emit('select', props.task.id) }

function collectSubtreeIds(root) {
  const out = []
  const stack = [root.id]
  while (stack.length) {
    const id = stack.pop()
    out.push(id)
    store.live.tasks.filter((t) => t.parentId === id).forEach((c) => stack.push(c.id))
  }
  return out
}
async function remove() {
  const ok = await dialog.confirm({ title: '删除任务', message: '该任务及其全部子任务将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  collectSubtreeIds(props.task).forEach((id) => store.deleteTask(id))
  store.showToast('已移入回收站')
}
function edit() { if (openEditor) openEditor(props.task, null) }
function addChild() { if (openEditor) openEditor(null, props.task.id) }
</script>

<template>
  <div class="tnode" :style="{ marginLeft: depth > 0 ? '22px' : '0' }">
    <div class="glass list-item" @click="batch ? select() : null">
      <input v-if="batch" type="checkbox" :checked="selectedIds.has(task.id)" @click.stop="select()" />
      <button class="avatar" :class="task.status === 'done' ? 'status-done' : ''" @click.stop="toggle"
              :style="task.status === 'done'
                ? 'background:linear-gradient(135deg,#B8C9BC,#8FA98F);color:#fff'
                : 'background:linear-gradient(135deg,var(--eo-primary-soft),var(--eo-primary-deep));color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)'">
        <Icon :name="task.status === 'done' ? 'checklist' : 'flag'" :size="20" />
      </button>
      <div style="flex:1;min-width:0" @click="task.note ? (showNote = !showNote) : null">
        <div class="row" style="gap:6px">
          <button v-if="children.length" class="ghost-btn fold" :class="{ open }" @click.stop="open = !open" :title="open ? '收起' : '展开'">
            <Icon name="chevron" :size="14" />
          </button>
          <span style="font-weight:600" :style="task.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''">{{ task.title }}</span>
        </div>
        <div class="row wrap" style="gap:6px;margin-top:4px">
          <span class="chip" :class="task.category">{{ catLabel(task.category) }}</span>
          <span class="chip" :class="task.status">{{ statusLabel(task.status) }}</span>
          <span v-if="task.note" class="chip"><Icon name="note" :size="11" /> 备注</span>
          <span v-if="children.length" class="chip"><Icon name="layers" :size="11" /> {{ children.length }} 个子任务</span>
        </div>
        <div v-if="task.status !== 'done' && task.progress > 0" class="bar" style="margin-top:8px"><i :style="{ width: task.progress + '%' }"></i></div>
        <div v-if="showNote && task.note" class="glass card" style="margin-top:10px;padding:12px">
          <MarkdownView :text="task.note" />
        </div>
      </div>
      <button class="ghost-btn" title="添加子任务" @click.stop="addChild"><Icon name="plus" :size="16" /></button>
      <button class="ghost-btn" title="编辑" @click.stop="edit"><Icon name="edit" :size="16" /></button>
      <button class="ghost-btn" title="删除" @click.stop="remove"><Icon name="trash" :size="16" /></button>
    </div>

    <div v-if="open && children.length" class="tnode__children">
      <TaskNode v-for="c in children" :key="c.id" :task="c" :depth="depth + 1" :batch="batch" :selected-ids="selectedIds" @select="emit('select', $event)" />
    </div>
  </div>
</template>

<style scoped>
.tnode { position: relative; }
.tnode__children { position: relative; margin-top: 8px; padding-left: 16px; border-left: 2px dashed var(--eo-primary-soft); margin-left: 24px; }
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.fold { transition: transform .2s cubic-bezier(.22, 1, .36, 1); }
.fold.open { transform: rotate(90deg); color: var(--eo-primary-deep); }
</style>
