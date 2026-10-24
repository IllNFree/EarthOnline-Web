<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import GlassUploader from '../components/GlassUploader.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const tagFilter = ref('')
const batchMode = ref(false)
const selected = ref(new Set())
const lightbox = ref(null)
const showAdd = ref(false)
const form = ref({ name: '', tags: '', dataUrl: '' })
// 主页速览「传照片」直达：自动弹开上传窗口
onMounted(() => { if (route.query.add) showAdd.value = true })

// 「分类」已废弃，统一走标签过滤（数据层 category 保留兼容旧数据）
const tags = computed(() => Array.from(new Set(store.data.photos.flatMap((p) => p.tags || []))))
const photos = computed(() => {
  if (!tagFilter.value) return store.data.photos
  return store.data.photos.filter((p) => (p.tags || []).includes(tagFilter.value))
})

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
async function delLightbox() {
  const ok = await dialog.confirm({ title: '删除照片', message: '该照片将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deletePhoto(lightbox.value.id); store.showToast('已移入回收站'); lightbox.value = null
}
</script>

<template>
  <div class="page wide" @dragover="onDragOver" @drop="onDrop">
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap" style="gap:6px;flex:1">
        <button class="chip" :style="!tagFilter ? 'background:var(--eo-primary);color:#fff' : ''" @click="tagFilter = ''">全部</button>
        <button v-for="t in tags" :key="t" class="chip" :style="tagFilter === t ? 'background:var(--eo-primary);color:#fff' : ''" @click="tagFilter = tagFilter === t ? '' : t">
          <Icon name="tag" :size="12" /> {{ t }}
        </button>
      </div>
      <button class="chip" @click="batchMode = !batchMode"><Icon name="layers" :size="14" /> 批量</button>
    </div>
    <div class="muted" style="font-size:12px;margin:-4px 4px 10px">桌面端可将图片文件直接拖入本页上传（存入当前相册）。</div>

    <div class="grid3">
      <div v-for="p in photos" :key="p.id" class="glass" style="border-radius:16px;overflow:hidden;position:relative"
           @click="batchMode ? toggleSelect(p.id) : lightbox = p">
        <img :src="p.dataUrl" style="width:100%;height:110px;object-fit:cover;display:block" />
        <div v-if="batchMode" style="position:absolute;top:6px;left:6px">
          <span class="chip" :style="selected.has(p.id) ? 'background:var(--eo-primary);color:#fff' : ''">{{ selected.has(p.id) ? '✓' : '' }}</span>
        </div>
        <div v-if="p.name" style="font-size:11px;padding:4px 6px;color:var(--eo-ink-soft)">{{ p.name }}</div>
      </div>
    </div>
    <div v-if="!photos.length" class="muted" style="text-align:center;padding:30px">还没有照片，点下方添加</div>

    <div v-if="batchMode" class="row" style="gap:8px;margin-top:14px">
      <button class="btn danger" @click="batchDelete"><Icon name="trash" :size="16" /> 删除</button>
    </div>

    <button v-if="!batchMode" class="btn" style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:58" @click="showAdd = true">
      <Icon name="plus" :size="18" /> 添加照片
    </button>

    <!-- 全览大图：操作按钮在图片下方，绝不遮挡图片（需求 #14） -->
    <Modal title="全览" :show="!!lightbox" @close="lightbox = null">
      <img v-if="lightbox" :src="lightbox.dataUrl" style="width:100%;border-radius:14px;display:block" />
      <div class="row between" style="margin-top:12px">
        <span class="muted" style="min-width:0;overflow:hidden;text-overflow:ellipsis">{{ lightbox && lightbox.name }}</span>
        <button class="btn danger" style="flex:none" @click="delLightbox"><Icon name="trash" :size="16" /> 删除</button>
      </div>
    </Modal>

    <Modal title="添加照片" :show="showAdd" @close="showAdd = false">
      <div class="field"><label>选择图片</label><GlassUploader @file="pick" /></div>
      <div v-if="form.dataUrl" style="height:120px;border-radius:12px;background-size:cover;background-position:center;margin-bottom:10px" :style="{ backgroundImage: 'url(' + form.dataUrl + ')' }"></div>
      <div class="field"><label>名称</label><input v-model="form.name" /></div>
      <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="form.tags" placeholder="如：旅行 美食" /></div>
      <button class="btn" style="width:100%" @click="add"><Icon name="plus" :size="16" /> 存入</button>
    </Modal>
  </div>
</template>
