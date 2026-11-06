<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import GlassUploader from '../components/GlassUploader.vue'
import Modal from '../components/GlassBottomSheet.vue'
import EntitySearchDialog from '../components/EntitySearchDialog.vue'
import EntityRelationsPanel from '../components/EntityRelationsPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import { BI_LINK_TYPES } from '../lib/bilink.js'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const tagFilter = ref('')
const batchMode = ref(false)
const selected = ref(new Set())
const kw = ref('')
const editPhoto = ref(null)
const editForm = ref({ name: '', tags: '', dataUrl: '' })
const showEditPhoto = ref(false)
// 模块三：关联内容弹窗（双向绑定 + 画布语义连线）
const relShow = ref(false)
const relType = ref('photo')
const relId = ref(null)
function openRel(type, id) { relType.value = type; relId.value = id; relShow.value = true }
const relatedForEdit = computed(() => (editPhoto.value && editPhoto.value.id ? store.relatedEntitiesFor('photo', editPhoto.value.id) : []))
const showAdd = ref(false)
const form = ref({ name: '', tags: '', dataUrl: '' })
// 主页速览「传照片」直达：自动弹开上传窗口
onMounted(() => {
  if (route.query.add) showAdd.value = true
  // 右下角全局 FAB：在本页注册「添加照片」
  store.setQuickAdd(() => { showAdd.value = true })
})
onUnmounted(() => store.setQuickAdd(null))

// 「分类」已废弃，统一走标签过滤（数据层 category 保留兼容旧数据）
const tags = computed(() => Array.from(new Set(store.live.photos.flatMap((p) => p.tags || []))))
const photos = computed(() => {
  let list = store.live.photos
  const q = kw.value.trim().toLowerCase()
  if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.tags || []).join(' ').toLowerCase().includes(q))
  if (tagFilter.value) list = list.filter((p) => (p.tags || []).includes(tagFilter.value))
  return list
})
// 二次编辑 / 替换：点击已有照片（非批量）打开编辑弹窗
function openEdit(p) {
  editPhoto.value = p
  editForm.value = { name: p.name, tags: (p.tags || []).join(' '), dataUrl: p.dataUrl }
  showEditPhoto.value = true
}
function pickEditCover(f) {
  if (!f) return
  const r = new FileReader()
  r.onload = () => { editForm.value.dataUrl = r.result }
  r.readAsDataURL(f)
}
function saveEdit() {
  if (!editPhoto.value) return
  const r = store.updatePhoto(editPhoto.value.id, { name: editForm.value.name, tags: editForm.value.tags, dataUrl: editForm.value.dataUrl })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已更新照片'); showEditPhoto.value = false
}
async function delEdit() {
  if (!editPhoto.value) return
  const ok = await dialog.confirm({ title: '删除照片', message: '该照片将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deletePhoto(editPhoto.value.id); store.showToast('已移入回收站'); showEditPhoto.value = false
}

function pick(f) {
  if (!f) return
  const r = new FileReader()
  r.onload = () => { form.value.dataUrl = r.result }
  r.readAsDataURL(f)
}
function add() {
  const r = store.addPhoto({ ...form.value, category: '' })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已存入相册')
  showAdd.value = false
  form.value = { name: '', tags: '', dataUrl: '' }
}
// 桌面端：拖拽本地图片到网页任意位置直接上传（需求 #14）
function onDrop(e) {
  if (batchMode.value) return
  const files = Array.from(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : []).filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  files.forEach((f) => {
    const r = new FileReader()
    r.onload = () => {
      store.addPhoto({ name: f.name.replace(/\.[^.]+$/, ''), category: '', tags: '', dataUrl: r.result })
      store.showToast('已存入相册：' + f.name)
    }
    r.readAsDataURL(f)
  })
}
function onDragOver(e) { e.preventDefault() }
function toggleSelect(id) {
  if (selected.value.has(id)) selected.value.delete(id); else selected.value.add(id)
  selected.value = new Set(selected.value)
}
function batchDelete() {
  dialog.confirm({ title: '批量删除', message: '所选照片将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
    .then((ok) => {
      if (!ok) return
      selected.value.forEach((id) => store.deletePhoto(id))
      store.showToast('已移入回收站')
      selected.value = new Set(); batchMode.value = false
    })
}
</script>

<template>
  <div class="page wide" @dragover="onDragOver" @drop="onDrop">
    <PageHeader title="相册" v-model:query="kw" placeholder="搜索照片名 / 标签…"
      subtitle="桌面端可将图片文件直接拖入本页上传（存入当前相册）">
      <template #actions>
        <button class="add-btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加照片</button>
      </template>
      <template #filters>
        <button class="chip" :class="{ 'is-on': !tagFilter }" @click="tagFilter = ''">全部</button>
        <button v-for="t in tags" :key="t" class="chip" :class="{ 'is-on': tagFilter === t }" @click="tagFilter = tagFilter === t ? '' : t">
          <Icon name="tag" :size="12" /> {{ t }}
        </button>
      </template>
      <template #tools>
        <button class="chip" @click="batchMode = !batchMode"><Icon name="layers" :size="14" /> 批量</button>
      </template>
    </PageHeader>

    <div class="grid3">
      <div v-for="p in photos" :key="p.id" class="glass thumb-round" style="position:relative;cursor:pointer"
           @click="batchMode ? toggleSelect(p.id) : openEdit(p)">
        <img :src="p.dataUrl" class="cover-img" style="height:110px" />
        <div v-if="batchMode" style="position:absolute;top:6px;left:6px">
          <span class="chip" :style="selected.has(p.id) ? 'background:var(--eo-primary);color:#fff' : 'background:transparent;border:1px solid var(--eo-glass-border)'">
            <Icon v-if="selected.has(p.id)" name="check" :size="14" />
          </span>
        </div>
        <div v-if="p.name" style="font-size:11px;padding:4px 6px;color:var(--eo-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.name }}</div>
      </div>
    </div>
    <EmptyState v-if="!photos.length" icon="album" title="还没有照片" subtitle="上传一张照片，把值得记住的瞬间存进相册。">
      <button class="btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加照片</button>
    </EmptyState>

    <div v-if="batchMode" class="row" style="gap:8px;margin-top:14px">
      <button class="btn danger" @click="batchDelete"><Icon name="trash" :size="16" /> 删除</button>
    </div>

    <!-- 二次编辑 / 替换照片 -->
    <Modal title="编辑照片" :show="showEditPhoto" @close="showEditPhoto = false">
      <img v-if="editForm.dataUrl" :src="editForm.dataUrl" style="width:100%;border-radius:14px;display:block;margin-bottom:10px" />
      <div class="field"><label>名称</label><input v-model="editForm.name" /></div>
      <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="editForm.tags" placeholder="如：旅行 美食" /></div>
      <div class="field">
        <label>替换图片</label>
        <GlassUploader @file="pickEditCover" />
      </div>
      <div v-if="editPhoto && editPhoto.id" class="rel-block">
        <div class="rel-block-head">
          <span>关联内容（{{ relatedForEdit.length }}）</span>
          <button class="chip" @click="openRel('photo', editPhoto.id)"><Icon name="link" :size="14" /> 管理关联</button>
        </div>
        <EntityRelationsPanel type="photo" :id="editPhoto.id" />
        <div v-if="!relatedForEdit.length" class="muted" style="font-size:12px">尚未关联任何实体，点击「管理关联」建立双向关联。</div>
      </div>
      <div class="row" style="gap:8px;margin-top:6px">
        <button class="btn danger" style="flex:1" @click="delEdit"><Icon name="trash" :size="16" /> 删除</button>
        <button class="btn" style="flex:2" @click="saveEdit"><Icon name="edit" :size="16" /> 保存修改</button>
      </div>
    </Modal>

    <EntitySearchDialog :source-type="relType" :source-id="relId" :show="relShow" @close="relShow = false" />

    <Modal title="添加照片" :show="showAdd" @close="showAdd = false">
      <div class="field"><label>选择图片</label><GlassUploader @file="pick" /></div>
      <div v-if="form.dataUrl" style="height:120px;border-radius:12px;background-size:cover;background-position:center;margin-bottom:10px" :style="{ backgroundImage: 'url(' + form.dataUrl + ')' }"></div>
      <div class="field"><label>名称</label><input v-model="form.name" /></div>
      <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="form.tags" placeholder="如：旅行 美食" /></div>
      <button class="btn" style="width:100%" @click="add"><Icon name="plus" :size="16" /> 存入</button>
    </Modal>
  </div>
</template>

<style scoped>
.rel-block { border-top: 1px dashed var(--eo-glass-border); margin-top: 12px; padding-top: 12px; }
.rel-block-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.rel-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rel-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--eo-chip); color: var(--eo-ink); }
.rel-chip.dir-in { background: rgba(44, 44, 44, .16); }
.rel-dir { font-size: 10px; opacity: .7; }
</style>
