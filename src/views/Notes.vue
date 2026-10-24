<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import MarkdownView from '../components/MarkdownView.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
// 主页速览「写笔记」直达：自动弹开新建笔记窗口
onMounted(() => { if (route.query.add) openNew() })
const showEdit = ref(false)
const editing = ref(null)
// 取消默认分类：类型与标签合并为纯用户自定义标签（需求 #15）
const form = ref({ id: null, title: '', tags: '', html: '' })
const editorRef = ref(null)

const notes = computed(() => store.data.memos)
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
</script>

<template>
  <div class="page wide">
    <div class="page-head" style="flex-wrap:wrap;gap:10px">
      <div class="search-bar" style="flex:1;min-width:160px;max-width:320px">
        <Icon name="search" :size="16" />
        <input v-model="kw" placeholder="搜索笔记标题 / 标签 / 内容…" />
      </div>
      <button class="add-btn" @click="openNew"><Icon name="plus" :size="16" /> 写笔记</button>
    </div>
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
    <div v-if="!shownNotes.length" class="glass card empty-state">
      <span class="empty-illu"><Icon name="note" :size="32" /></span>
      <div class="es-title">还没有笔记</div>
      <div class="es-sub">把灵感、复盘、摘抄记下来，人生会更有迹可循。</div>
      <button class="btn" @click="openNew"><Icon name="plus" :size="16" /> 写第一篇笔记</button>
    </div>

    <Modal title="笔记编辑" :show="showEdit" @close="showEdit = false">
      <div class="field"><label>标题</label><input v-model="form.title" placeholder="标题" /></div>
      <div class="field"><label>标签（纯标签，空格/逗号分隔）</label><input v-model="form.tags" placeholder="如：复盘 灵感" /></div>
      <div class="row" style="gap:8px;margin:8px 0;position:sticky;top:0">
        <button class="chip" @click="exec('bold')"><b>B</b></button>
        <button class="chip" @click="exec('italic')"><i>I</i></button>
        <button class="chip" @click="exec('insertUnorderedList')"><Icon name="checklist" :size="14" /> 列表</button>
        <button class="chip" @click="toggleTodo"><Icon name="checklist" :size="14" /> 待办</button>
      </div>
      <div ref="editorRef" class="eo-editor" contenteditable="true"></div>
      <button class="btn" style="width:100%;margin-top:14px" @click="save"><Icon name="edit" :size="16" /> 保存</button>
    </Modal>
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
.eo-todo label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.eo-todo input[type='checkbox'] { width: 17px; height: 17px; accent-color: #D4A373; cursor: pointer; }
.eo-editor { min-height: 160px; border: 1px solid var(--eo-glass-border); border-radius: 14px; padding: 12px; background: var(--eo-glass); font-size: 15px; outline: none; }
</style>
