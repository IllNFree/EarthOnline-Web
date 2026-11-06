<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import MarkdownView from '../components/MarkdownView.vue'
import EntityPicker from '../components/EntityPicker.vue'
import EntitySearchDialog from '../components/EntitySearchDialog.vue'
import EntityRelationsPanel from '../components/EntityRelationsPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
// 主页速览「写笔记」直达：自动弹开新建笔记窗口
onMounted(() => {
  if (route.query.add) openNew()
  // 右下角全局 FAB：在本页注册「写笔记」（对齐 Android NotesScreen FAB）
  store.setQuickAdd(() => openNew())
})
onUnmounted(() => store.setQuickAdd(null))
const showEdit = ref(false)
const editing = ref(null)
const relShow = ref(false)
// 取消默认分类：类型与标签合并为纯用户自定义标签（需求 #15）
const form = ref({ id: null, title: '', tags: '', html: '' })
const editorRef = ref(null)

const notes = computed(() => store.live.memos)
const kw = ref('')
const shownNotes = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return notes.value
  return notes.value.filter((m) => (m.title || '').toLowerCase().includes(q) || (m.tags || []).join(' ').toLowerCase().includes(q) || (m.markdown || '').toLowerCase().includes(q))
})

function exec(cmd) { document.execCommand(cmd, false, null); editorRef.value && editorRef.value.focus() }
// 真·复选框：插入标准 input[type=checkbox]，点击打勾/取消；无选区时只插空复选框，不插占位文字
function toggleTodo() {
  const sel = window.getSelection()
  const text = sel && sel.toString() ? sel.toString() : ''
  document.execCommand('insertHTML', false,
    '<div class="eo-todo"><label><input type="checkbox" /><span>' + text.replace(/</g, '&lt;') + '</span></label></div>')
}
function openNew() {
  editing.value = null
  form.value = { id: null, title: '', tags: '', html: '' }
  showEdit.value = true
  nextTick(() => editorRef.value && (editorRef.value.innerHTML = ''))
}
function openEdit(m) {
  editing.value = m
  form.value = { id: m.id, title: m.title, tags: (m.tags || []).join(' '), html: m.markdown || '' }
  showEdit.value = true
  nextTick(() => { if (editorRef.value) editorRef.value.innerHTML = m.markdown || '' })
}
function save() {
  const payload = { title: form.value.title, tags: form.value.tags, markdown: editorRef.value ? editorRef.value.innerHTML : form.value.html }
  if (editing.value) { store.updateMemo(editing.value.id, payload); store.showToast('已保存') }
  else { const r = store.addMemo(payload); if (!r.ok) return store.showToast(r.error); store.showToast('已保存笔记') }
  showEdit.value = false
}
function del(id) {
  dialog.confirm({ title: '删除笔记', message: '该笔记将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
    .then((ok) => { if (ok) { store.deleteMemo(id); store.showToast('已移入回收站') } })
}

// 需求 4：双向链接编辑层 —— @ 触发全局级联选择器，插入 @[Type:ID] 语法
const showPicker = ref(false)
let caretRange = null
function openPicker() {
  const el = editorRef.value
  if (el) {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) caretRange = sel.getRangeAt(0).cloneRange()
  }
  showPicker.value = true
}
function onPick(entity) {
  const token = '@[' + entity.type + ':' + entity.id + ']'
  const el = editorRef.value
  if (el && document.createRange && window.getSelection) {
    el.focus()
    const sel = window.getSelection()
    if (caretRange) { sel.removeAllRanges(); sel.addRange(caretRange) }
    const r = sel.getRangeAt(0)
    const before = r.startContainer.textContent ? r.startContainer.textContent.slice(0, r.startOffset) : ''
    if (before.endsWith('@')) {
      const tr = document.createRange()
      tr.setStart(r.startContainer, Math.max(0, r.startOffset - 1))
      tr.setEnd(r.startContainer, r.startOffset)
      tr.deleteContents()
    }
    document.execCommand('insertText', false, token + ' ')
  } else if (el) {
    el.innerHTML += token
  }
  caretRange = null
  showPicker.value = false
}
function onEditorInput() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const r = sel.getRangeAt(0)
  const before = r.startContainer.textContent ? r.startContainer.textContent.slice(0, r.startOffset) : ''
  if (before.endsWith('@')) openPicker()
}
</script>

<template>
  <div class="page wide">
    <PageHeader title="笔记" v-model:query="kw" placeholder="搜索笔记标题 / 标签 / 内容…"
      :subtitle="`共 ${store.live.memos.length} 篇`">
      <template #actions>
        <button class="add-btn" @click="openNew"><Icon name="plus" :size="16" /> 写笔记</button>
      </template>
    </PageHeader>
    <div class="cols-2">
    <div v-for="m in shownNotes" :key="m.id" class="glass list-item" @click="openEdit(m)">
      <span class="avatar"><Icon name="note" :size="22" /></span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">{{ m.title }}</div>
        <div class="row wrap" style="gap:6px;margin-top:4px" v-if="(m.tags || []).length">
          <span v-for="t in (m.tags || [])" :key="t" class="chip"><Icon name="tag" :size="11" />{{ t }}</span>
        </div>
        <div v-if="m.markdown" class="md-preview"><MarkdownView :text="m.markdown" is-html /></div>
      </div>
      <button class="ghost-btn" @click.stop="del(m.id)"><Icon name="trash" :size="16" /></button>
    </div>
    </div>
    <EmptyState v-if="!shownNotes.length" icon="note" title="还没有笔记" subtitle="把灵感、复盘、摘抄记下来，人生会更有迹可循。">
      <button class="btn" @click="openNew"><Icon name="plus" :size="16" /> 写第一篇笔记</button>
    </EmptyState>

    <Modal title="笔记编辑" :show="showEdit" @close="showEdit = false">
      <div class="field"><label>标题</label><input v-model="form.title" placeholder="标题" /></div>
      <div class="field"><label>标签（纯标签，空格/逗号分隔）</label><input v-model="form.tags" placeholder="如：复盘 灵感" /></div>
      <div class="row" style="gap:8px;margin:8px 0;position:sticky;top:0">
        <button class="chip" @click="exec('bold')"><b>B</b></button>
        <button class="chip" @click="exec('italic')"><i>I</i></button>
        <button class="chip" @click="exec('insertUnorderedList')"><Icon name="checklist" :size="14" /> 列表</button>
        <button class="chip" @click="toggleTodo"><Icon name="checklist" :size="14" /> 待办</button>
        <button class="chip" @click="openPicker"><Icon name="link" :size="14" /> 关联</button>
      </div>
      <div ref="editorRef" class="eo-editor" contenteditable="true" @input="onEditorInput"></div>
      <!-- v2.1.0 模块四：统一关联实体（与画布连线同源双向同步） -->
      <div v-if="form.id" class="rel-block">
        <div class="rel-block-head">
          <span>关联实体</span>
          <button class="chip" @click="relShow = true"><Icon name="link" :size="14" /> 管理关联</button>
        </div>
        <EntityRelationsPanel type="memo" :id="form.id" />
      </div>
      <button class="btn" style="width:100%;margin-top:14px" @click="save"><Icon name="edit" :size="16" /> 保存</button>
    </Modal>

    <EntitySearchDialog source-type="memo" :source-id="form.id || ''" :show="relShow" @close="relShow = false" />

    <teleport to="body">
      <div v-if="showPicker" class="ep-overlay" @click.self="showPicker = false" style="position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;background:rgba(28, 28, 27, .3);backdrop-filter:blur(4px)">
        <EntityPicker @select="onPick" @close="showPicker = false" />
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.md-preview { margin-top: 8px; max-height: 96px; overflow: hidden; opacity: .82; mask-image: linear-gradient(to bottom, #000 60%, transparent); }
.notes-fab { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 96px); z-index: 58; }
@media (min-width: 900px) {
  .notes-fab { left: auto; right: 28px; transform: none; bottom: 28px; }
}
</style>
<style>
/* 复选框待办行 / 编辑器（非 scoped：内容由动态 HTML 插入） */
.eo-todo { margin: 4px 0; }
.rel-block { border-top: 1px dashed var(--eo-glass-border); margin-top: 12px; padding-top: 12px; }
.rel-block-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.eo-todo label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.eo-todo input[type='checkbox'] { width: 17px; height: 17px; accent-color: #2C2C2C; cursor: pointer; }
.eo-editor { min-height: 160px; border: 1px solid var(--eo-glass-border); border-radius: 14px; padding: 12px; background: var(--eo-glass); font-size: 15px; outline: none; }
</style>
