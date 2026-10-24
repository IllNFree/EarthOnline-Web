<script setup>
import { ref, computed, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { TASK_CATEGORY, TASK_STATUS } from '../lib/model.js'
import Icon from '../components/Icon.vue'
import TaskNode from '../components/TaskNode.vue'
import ClockPicker from '../components/ClockPicker.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const tab = ref(route.query.tab === 'todo' ? 'todo' : 'daily')
watch(() => route.query.tab, (v) => { if (v) tab.value = v === 'todo' ? 'todo' : 'daily' })
const hideDone = ref(false)
const showAdd = ref(false)
const batchMode = ref(false)
const selected = ref(new Set())

// 编辑器：id=null 新建；携带 parentId 表示"给某任务添加子任务"
// 新建时取消「类型」「进度」设置：分类随当前 Tab 自动决定，进度从 0 开始（需求 #17）
const editor = ref({ id: null, parentId: null, title: '', category: 'side', status: 'active', progress: 0, note: '', dueDate: '', dueTime: '', tags: '' })
provide('taskEditor', openEditor)
function openEditor(task, parentId) {
  if (task) {
    editor.value = { id: task.id, parentId: task.parentId, title: task.title, category: task.category, status: task.status, progress: task.progress, note: task.note, dueDate: task.dueDate || '', dueTime: task.dueTime || '', tags: (task.tags || []).join(' ') }
  } else {
    editor.value = { id: null, parentId: parentId || null, title: '', category: (parentId ? 'side' : (tab.value === 'todo' ? 'todo' : 'side')), status: 'active', progress: 0, note: '', dueDate: '', dueTime: '', tags: '' }
  }
  showAdd.value = true
}

const dailyTasks = computed(() => store.data.tasks.filter((t) => t.category !== 'todo' && !t.parentId))
const todoTasks = computed(() => store.data.tasks.filter((t) => t.category === 'todo'))
// 孤儿任务（父已删但自身在）：当根渲染，避免消失
const orphans = computed(() => {
  const ids = new Set(store.data.tasks.map((t) => t.id))
  return store.data.tasks.filter((t) => t.parentId && !ids.has(t.parentId) && t.category !== 'todo')
})
const roots = computed(() => dailyTasks.value.concat(orphans.value))
function visibleRoots() { return hideDone.value ? roots.value.filter((t) => t.status !== 'done') : roots.value }
function visibleTodo() { return hideDone.value ? todoTasks.value.filter((t) => t.status !== 'done') : todoTasks.value }
function catLabel(c) { return (TASK_CATEGORY[c] || {}).label || c }
function statusLabel(s) { return (TASK_STATUS[s] || {}).label || s }

// 可选父任务：排除自身（防环）
const parentOptions = computed(() => store.data.tasks.filter((t) => t.id !== editor.value.id && t.category !== 'todo'))

function saveEditor() {
  const f = editor.value
  if (!String(f.title || '').trim()) { store.showToast('标题不能为空'); return }
  if (f.id) {
    store.updateTask(f.id, { title: f.title, status: f.status, note: f.note, dueDate: f.dueDate || null, dueTime: f.dueTime || null, parentId: f.parentId || null, tags: f.tags })
    store.showToast('已保存修改')
  } else {
    const r = store.addTask({ title: f.title, category: f.category, status: f.status, note: f.note, dueDate: f.dueDate, dueTime: f.dueTime, parentId: f.parentId || null, tags: f.tags })
    if (!r.ok) { store.showToast(r.error); return }
    store.showToast(f.parentId ? '已添加子任务' : '已创建任务')
  }
  showAdd.value = false
}
function toggleSelect(id) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
  selected.value = new Set(selected.value)
}
async function removeTodo(id) {
  const ok = await dialog.confirm({ title: '删除任务', message: '该任务将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deleteTask(id)
  store.showToast('已移入回收站')
}
function batchComplete() {
  selected.value.forEach((id) => store.updateTask(id, { status: 'done' }))
  store.showToast('已批量完成')
  selected.value = new Set(); batchMode.value = false
}
function batchDelete() {
  selected.value.forEach((id) => store.deleteTask(id))
  store.showToast('已移入回收站')
  selected.value = new Set(); batchMode.value = false
}
function batchExport() {
  const ids = selected.value
  const items = store.data.tasks.filter((t) => ids.has(t.id))
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tasks-export.json'; a.click()
  store.showToast('已导出')
}
</script>

<template>
  <div class="page wide">
    <div class="row between" style="margin-bottom:12px">
      <div class="capsule" style="padding:4px;gap:4px">
        <button class="btn ghost" :style="tab === 'daily' ? 'background:var(--eo-primary);color:#fff' : ''" @click="tab = 'daily'">日常</button>
        <button class="btn ghost" :style="tab === 'todo' ? 'background:var(--eo-primary);color:#fff' : ''" @click="tab = 'todo'">Todo</button>
      </div>
      <div class="row" style="gap:8px">
        <button class="chip" :style="hideDone ? 'background:var(--eo-primary);color:#fff' : ''" @click="hideDone = !hideDone">
          <Icon name="checklist" :size="14" /> 隐藏已完成
        </button>
        <button class="chip" @click="batchMode = !batchMode"><Icon name="layers" :size="14" /> 批量</button>
      </div>
    </div>

    <!-- 日常：主/支线合并，父子嵌套树 -->
    <div v-if="tab === 'daily'">
      <template v-if="!batchMode">
        <TaskNode v-for="t in visibleRoots()" :key="t.id" :task="t" :depth="0" />
      </template>
      <template v-else>
        <div v-for="t in store.data.tasks.filter((x) => x.category !== 'todo')" :key="t.id" class="glass list-item" @click="toggleSelect(t.id)">
          <input type="checkbox" :checked="selected.has(t.id)" @click.stop="toggleSelect(t.id)" />
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">{{ t.title }}</div>
            <div class="row" style="gap:6px;margin-top:4px">
              <span class="chip" :class="t.category">{{ catLabel(t.category) }}</span>
              <span class="chip" :class="t.status">{{ statusLabel(t.status) }}</span>
            </div>
          </div>
        </div>
      </template>
      <div v-if="!store.data.tasks.some((t) => t.category !== 'todo')" class="muted" style="text-align:center;padding:30px">还没有日常任务</div>
    </div>

    <!-- Todo：强制表格视图 -->
    <div v-else>
      <div class="glass card" style="padding:6px 4px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr class="muted" style="font-size:12px;text-align:left">
              <th style="padding:8px">标题</th><th style="padding:8px">截止</th><th style="padding:8px">状态</th><th style="padding:8px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in visibleTodo()" :key="t.id" style="border-top:1px solid var(--eo-glass-border)">
              <td style="padding:10px">{{ t.title }}</td>
              <td style="padding:10px" class="muted">{{ t.dueDate ? t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') : '—' }}</td>
              <td style="padding:10px"><span class="chip" :class="t.status">{{ statusLabel(t.status) }}</span></td>
              <td style="padding:10px">
                <div class="row" style="gap:4px">
                  <button class="ghost-btn" title="编辑" @click="openEditor(t, null)"><Icon name="edit" :size="16" /></button>
                  <button class="ghost-btn" title="删除" @click="removeTodo(t.id)"><Icon name="trash" :size="16" /></button>
                </div>
              </td>
            </tr>
            <tr v-if="!todoTasks.length"><td colspan="4" class="muted" style="padding:20px;text-align:center">暂无 Todo</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="batchMode" class="row" style="gap:8px;margin-top:14px">
      <button class="btn" @click="batchComplete"><Icon name="checklist" :size="16" /> 完成</button>
      <button class="btn ghost" @click="batchExport"><Icon name="download" :size="16" /> 导出</button>
      <button class="btn danger" @click="batchDelete"><Icon name="trash" :size="16" /> 删除</button>
    </div>

    <button v-if="!batchMode" class="btn" style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:58" @click="openEditor(null, null)">
      <Icon name="plus" :size="18" /> 新建任务
    </button>

    <Modal :title="editor.id ? '编辑任务' : (editor.parentId ? '添加子任务' : '新建任务')" :show="showAdd" @close="showAdd = false">
      <div v-if="editor.parentId" class="muted" style="font-size:12px;margin-bottom:8px">将添加为「{{ (store.data.tasks.find((t) => t.id === editor.parentId) || {}).title }}」的子任务</div>
      <div class="field"><label>标题</label><input v-model="editor.title" placeholder="要做点什么？" /></div>
      <div class="field" v-if="editor.id"><label>状态</label>
        <select v-model="editor.status">
          <option value="planning">规划中</option><option value="active">进行中</option><option value="paused">搁置</option><option value="done">已完成</option>
        </select>
      </div>
      <div class="field" v-if="editor.id"><label>父任务（可选，支持多级嵌套）</label>
        <select v-model="editor.parentId">
          <option :value="null">无（顶层任务）</option>
          <option v-for="t in parentOptions" :key="t.id" :value="t.id">{{ t.title }}</option>
        </select>
      </div>
      <div class="field"><label>备注（支持 Markdown 语法）</label>
        <textarea v-model="editor.note" placeholder="补充说明，支持 Markdown"></textarea>
      </div>
      <div class="field"><label>标签（空格或逗号分隔）</label>
        <input v-model="editor.tags" placeholder="如：工作 重要" />
      </div>
      <div class="field" v-if="editor.category === 'todo'"><label>截止日期与时间</label>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <input type="date" v-model="editor.dueDate" style="flex:1;min-width:130px" />
          <ClockPicker v-model="editor.dueTime" />
        </div>
      </div>
      <button class="btn" style="width:100%" @click="saveEditor"><Icon name="checklist" :size="16" /> {{ editor.id ? '保存修改' : '创建' }}</button>
    </Modal>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
</style>
