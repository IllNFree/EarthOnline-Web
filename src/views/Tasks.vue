<script setup>
import { ref, computed, provide, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { TASK_CATEGORY, TASK_STATUS } from '../lib/model.js'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import TaskNode from '../components/TaskNode.vue'
import Modal from '../components/GlassBottomSheet.vue'
import EntitySearchDialog from '../components/EntitySearchDialog.vue'
import EntityRelationsPanel from '../components/EntityRelationsPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import VirtualList from '../components/VirtualList.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const tab = ref(route.query.tab === 'todo' ? 'todo' : 'daily')
watch(() => route.query.tab, (v) => { if (v) tab.value = v === 'todo' ? 'todo' : 'daily' })
// 主页速览「新任务」直达：自动弹开新建任务框
onMounted(() => {
  if (route.query.add) openEditor(null, null)
  // 右下角全局 FAB：在本页注册「新建任务」
  store.setQuickAdd(() => openEditor(null, null))
})
onUnmounted(() => store.setQuickAdd(null))
const hideDone = ref(false)
const showAdd = ref(false)
const batchMode = ref(false)
const selected = ref(new Set())
const kw = ref('')
// 模块三：关联内容弹窗（双向绑定 + 画布语义连线）
const relShow = ref(false)
const relType = ref('task')
const relId = ref(null)
function openRel(type, id) { relType.value = type; relId.value = id; relShow.value = true }
const relatedForEditor = computed(() => (editor.value.id ? store.relatedEntitiesFor('task', editor.value.id) : []))
const relatedLedgerForEditor = computed(() => relatedForEditor.value.filter((r) => r.type === 'ledger'))
function taskMatch(t) {
  const q = kw.value.trim().toLowerCase()
  if (!q) return true
  return (t.title || '').toLowerCase().includes(q) || (t.tags || []).join(' ').toLowerCase().includes(q)
}

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

const dailyTasks = computed(() => store.live.tasks.filter((t) => t.category !== 'todo' && !t.parentId))
const todoTasks = computed(() => store.live.tasks.filter((t) => t.category === 'todo'))
// 孤儿任务（父已删但自身在）：当根渲染，避免消失
const orphans = computed(() => {
  const ids = new Set(store.live.tasks.map((t) => t.id))
  return store.live.tasks.filter((t) => t.parentId && !ids.has(t.parentId) && t.category !== 'todo')
})
const roots = computed(() => dailyTasks.value.concat(orphans.value))
function visibleRoots() { return (hideDone.value ? roots.value.filter((t) => t.status !== 'done') : roots.value).filter(taskMatch) }
function visibleTodo() { return (hideDone.value ? todoTasks.value.filter((t) => t.status !== 'done') : todoTasks.value).filter(taskMatch) }
function catLabel(c) { return (TASK_CATEGORY[c] || {}).label || c }
function statusLabel(s) { return (TASK_STATUS[s] || {}).label || s }

// 可选父任务：排除自身（防环）
const parentOptions = computed(() => store.live.tasks.filter((t) => t.id !== editor.value.id && t.category !== 'todo'))

// 截止日期时间：原生 datetime-local（鼠标友好），底层仍拆存 dueDate + dueTime
const dueLocal = computed({
  get() { return (editor.value.dueDate || '') + (editor.value.dueTime ? 'T' + editor.value.dueTime : '') },
  set(v) {
    if (!v) { editor.value.dueDate = ''; editor.value.dueTime = ''; return }
    const [d, t] = String(v).split('T')
    editor.value.dueDate = d || ''
    editor.value.dueTime = t ? t.slice(0, 5) : ''
  }
})

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
  const items = store.live.tasks.filter((t) => ids.has(t.id))
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tasks-export.json'; a.click()
  store.showToast('已导出')
}
</script>

<template>
  <div class="page wide">
    <PageHeader title="任务" v-model:query="kw" placeholder="搜索标题 / 标签…"
      :subtitle="`共 ${store.live.tasks.length} 条 · ${store.live.tasks.filter((t) => t.status !== 'done').length} 条待完成`">
      <template #actions>
        <button class="add-btn" @click="openEditor(null, null)"><Icon name="plus" :size="16" /> 新建</button>
      </template>
      <template #filters>
        <div class="seg">
          <button :class="{ 'is-on': tab === 'daily' }" @click="tab = 'daily'">日常</button>
          <button :class="{ 'is-on': tab === 'todo' }" @click="tab = 'todo'">Todo</button>
        </div>
        <button class="chip" :class="{ 'is-on': hideDone }" @click="hideDone = !hideDone">
          <Icon name="checklist" :size="14" /> 隐藏已完成
        </button>
      </template>
      <template #tools>
        <button class="chip" @click="batchMode = !batchMode"><Icon name="layers" :size="14" /> 批量</button>
      </template>
    </PageHeader>

    <!-- 日常：主/支线合并，父子嵌套树 -->
    <div v-if="tab === 'daily'">
      <template v-if="!batchMode">
        <TaskNode v-for="t in visibleRoots()" :key="t.id" :task="t" :depth="0" />
      </template>
      <template v-else>
        <div v-for="t in store.live.tasks.filter((x) => x.category !== 'todo' && taskMatch(x))" :key="t.id" class="glass list-item" @click="toggleSelect(t.id)">
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
      <EmptyState v-if="!store.live.tasks.some((t) => t.category !== 'todo')" icon="sprout" title="还没有日常任务" subtitle="从一个目标开始，人生游戏正式开局。">
        <button class="btn" @click="openEditor(null, null)"><Icon name="plus" :size="16" /> 添加你的第一个任务</button>
      </EmptyState>
    </div>

    <!-- Todo：虚拟滚动长列表（模块一：仅渲染视口内行，行高固定） -->
    <div v-else>
      <div v-if="visibleTodo().length">
        <div class="glass card todo-head">
          <span>标题</span><span>截止</span><span>状态</span><span>操作</span>
        </div>
        <VirtualList :items="visibleTodo()" :item-height="56" :gap="8" :height="560">
          <template #default="{ item: t }">
            <div class="glass card todo-row">
              <span class="todo-title">{{ t.title }}</span>
              <span class="muted">{{ t.dueDate ? t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') : '—' }}</span>
              <span><span class="chip" :class="t.status">{{ statusLabel(t.status) }}</span></span>
              <span class="row" style="gap:4px">
                <button class="ghost-btn" title="编辑" @click="openEditor(t, null)"><Icon name="edit" :size="16" /></button>
                <button class="ghost-btn" title="删除" @click="removeTodo(t.id)"><Icon name="trash" :size="16" /></button>
              </span>
            </div>
          </template>
        </VirtualList>
      </div>
      <EmptyState v-else icon="checklist" title="还没有 Todo" subtitle="轻松搞定琐碎小事，把脑子里的杂事都倒出来吧。">
        <button class="btn" @click="openEditor(null, null)"><Icon name="plus" :size="16" /> 新建 Todo</button>
      </EmptyState>
    </div>

    <div v-if="batchMode" class="row" style="gap:8px;margin-top:14px">
      <button class="btn" @click="batchComplete"><Icon name="checklist" :size="16" /> 完成</button>
      <button class="btn ghost" @click="batchExport"><Icon name="download" :size="16" /> 导出</button>
      <button class="btn danger" @click="batchDelete"><Icon name="trash" :size="16" /> 删除</button>
    </div>

    <Modal :title="editor.id ? '编辑任务' : (editor.parentId ? '添加子任务' : '新建任务')" :show="showAdd" @close="showAdd = false">
      <div v-if="editor.parentId" class="muted" style="font-size:12px;margin-bottom:8px">将添加为「{{ (store.live.tasks.find((t) => t.id === editor.parentId) || {}).title }}」的子任务</div>
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
      <div class="field"><label>截止日期与时间（可选）</label>
        <input type="datetime-local" v-model="dueLocal" />
      </div>
      <!-- 模块三：关联内容（双向绑定 + 画布语义连线） -->
      <div v-if="editor.id" class="rel-block">
        <div class="rel-block-head">
          <span>关联内容（{{ relatedForEditor.length }}）</span>
          <button class="chip" @click="openRel('task', editor.id)"><Icon name="link" :size="14" /> 管理关联</button>
        </div>
        <div v-if="relatedLedgerForEditor.length" class="rel-ledger">
          <span class="muted" style="font-size:12px">关联账目</span>
          <div class="rel-ledger-row" v-for="r in relatedLedgerForEditor" :key="r.type + r.id">
            <Icon name="wallet" :size="14" /> <span>{{ r.title }}</span>
          </div>
        </div>
        <EntityRelationsPanel type="task" :id="editor.id" />
        <div v-if="!relatedForEditor.length" class="muted" style="font-size:12px">尚未关联任何实体，点击「管理关联」建立双向关联。</div>
      </div>
      <button class="btn" style="width:100%" @click="saveEditor"><Icon name="checklist" :size="16" /> {{ editor.id ? '保存修改' : '创建' }}</button>
    </Modal>

    <EntitySearchDialog :source-type="relType" :source-id="relId" :show="relShow" @close="relShow = false" />
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.rel-block { border-top: 1px dashed var(--eo-glass-border); margin-top: 12px; padding-top: 12px; }
.rel-block-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.rel-ledger { background: rgba(44, 44, 44, .10); border: 1px solid var(--eo-glass-border); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
.rel-ledger-row { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--eo-ink); margin-top: 4px; }
.rel-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rel-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--eo-chip); color: var(--eo-ink); }
.rel-chip.dir-in { background: rgba(44, 44, 44, .16); }
.rel-dir { font-size: 10px; opacity: .7; }
/* 模块一：Todo 虚拟滚动长列表布局 */
.todo-head, .todo-row { display: grid; grid-template-columns: 1fr 130px 100px 90px; align-items: center; gap: 8px; padding: 10px 12px; }
.todo-head { font-size: 12px; color: var(--eo-ink-soft); font-weight: 700; margin-top: 8px; }
.todo-row { font-size: 14px; }
.todo-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
</style>
