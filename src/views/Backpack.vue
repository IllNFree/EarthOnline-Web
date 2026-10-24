<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import GlassCard from '../components/GlassCard.vue'
import GlassUploader from '../components/GlassUploader.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const sub = ref(route.query.sub === 'collection' ? 'collection' : 'item')
const view = ref('grid')
const showAdd = ref(false)
// 「分类」已废弃：统一走标签过滤（数据层 category 保留兼容旧数据，仅展示不再录入）
const form = ref({ name: '', count: 1, description: '', cover: '', tags: '', url: '', fileMeta: null })
const tagFilter = ref('')
const kw = ref('')
const coverBusy = ref(false)

const items = computed(() => {
  let list = store.data.items
  const q = kw.value.trim().toLowerCase()
  if (q) list = list.filter((x) => (x.name || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q) || (x.tags || []).join(' ').toLowerCase().includes(q))
  if (tagFilter.value) list = list.filter((x) => (x.tags || []).includes(tagFilter.value))
  return list
})
const collections = computed(() => {
  let list = store.data.collections
  const q = kw.value.trim().toLowerCase()
  if (q) list = list.filter((x) => (x.title || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q) || (x.url || '').toLowerCase().includes(q) || (x.tags || []).join(' ').toLowerCase().includes(q))
  if (tagFilter.value) list = list.filter((x) => (x.tags || []).includes(tagFilter.value))
  return list
})
// 二次编辑（点击已有卡片打开编辑，支持替换封面 / 信息）
const showEdit = ref(false)
const editKind = ref('item')
const editData = ref(null)
function openEditItem(it) {
  editKind.value = 'item'
  editData.value = { id: it.id, name: it.name, count: it.count, description: it.description || '', cover: it.cover || '', tags: (it.tags || []).join(' ') }
  showEdit.value = true
}
function openEditCollection(c) {
  editKind.value = 'collection'
  editData.value = { id: c.id, name: c.title, url: c.url || '', description: c.description || '', cover: c.cover || '', tags: (c.tags || []).join(' '), fileMeta: c.fileMeta || null }
  showEdit.value = true
}
function pickEditCover(f) {
  if (!f || !f.type.startsWith('image/')) { store.showToast('封面请选择图片文件'); return }
  const r = new FileReader()
  r.onload = () => { editData.value.cover = r.result }
  r.readAsDataURL(f)
}
function saveEdit() {
  if (!editData.value) return
  let r
  if (editKind.value === 'item') {
    r = store.updateItem(editData.value.id, { name: editData.value.name, count: Number(editData.value.count) || 1, description: editData.value.description, cover: editData.value.cover, tags: editData.value.tags })
  } else {
    r = store.updateCollection(editData.value.id, { title: editData.value.name, url: editData.value.url, description: editData.value.description, cover: editData.value.cover, tags: editData.value.tags, fileMeta: editData.value.fileMeta })
  }
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已更新'); showEdit.value = false
}
// 全部条目的标签并集（供过滤 chips）
const allTags = computed(() => {
  const s = new Set()
  store.data.items.forEach((x) => (x.tags || []).forEach((t) => s.add(t)))
  store.data.collections.forEach((x) => (x.tags || []).forEach((t) => s.add(t)))
  return Array.from(s)
})

function mimeIcon(mime) {
  if (!mime) return 'star'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'music'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'file'
  return 'file'
}
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

function onCoverFile(f) {
  if (!f) return
  if (!f.type.startsWith('image/')) { store.showToast('封面请选择图片文件'); return }
  const r = new FileReader()
  r.onload = () => { form.value.cover = r.result }
  r.readAsDataURL(f)
}
// 收藏：上传任意文件 → 自动封面（图片本身 / 视频抽帧 / PDF 首页），失败可手动补
async function onCollectionFile(f) {
  if (!f) return
  if (f.size > 6 * 1048576) { store.showToast('文件过大（上限 6MB）'); return }
  coverBusy.value = true
  form.value.fileMeta = null; form.value.cover = ''; form.value.url = ''
  if (!form.value.name) form.value.name = f.name.replace(/\.[^.]+$/, '')
  const meta = { name: f.name, mime: f.type || 'application/octet-stream', size: f.size, dataUrl: '' }
  const finish = () => { form.value.fileMeta = meta; coverBusy.value = false }
  if (f.type.startsWith('image/')) {
    const r = new FileReader()
    r.onload = () => { meta.dataUrl = r.result; form.value.cover = r.result; finish() }
    r.onerror = finish
    r.readAsDataURL(f)
  } else if (f.type.startsWith('video/')) {
    const r = new FileReader()
    r.onload = () => {
      meta.dataUrl = r.result
      const v = document.createElement('video')
      v.muted = true; v.src = r.result
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3) }
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas')
          c.width = 320; c.height = Math.round(320 * (v.videoHeight / v.videoWidth) || 180)
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
          form.value.cover = c.toDataURL('image/jpeg', 0.8)
        } catch (e) { /* 跨域/解码失败则回退默认封面 */ }
        finish()
      }
      v.onerror = finish
    }
    r.onerror = finish
    r.readAsDataURL(f)
  } else if (f.type === 'application/pdf') {
    const r = new FileReader()
    r.onload = async () => {
      meta.dataUrl = r.result
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const doc = await pdfjs.getDocument({ data: r.result }).promise
        const page = await doc.getPage(1)
        const vp = page.getViewport({ scale: 0.5 })
        const c = document.createElement('canvas')
        c.width = vp.width; c.height = vp.height
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
        form.value.cover = c.toDataURL('image/jpeg', 0.8)
      } catch (e) { store.showToast('PDF 首页封面提取失败，可手动上传封面') }
      finish()
    }
    r.onerror = finish
    r.readAsDataURL(f)
  } else {
    // 音频/文档等：存文件本体，封面交给用户手动上传
    const r = new FileReader()
    r.onload = () => { meta.dataUrl = r.result; finish() }
    r.onerror = finish
    r.readAsDataURL(f)
  }
}
function submit() {
  if (sub.value === 'item') {
    const r = store.addItem({ ...form.value, tags: form.value.tags })
    if (!r.ok) return store.showToast(r.error)
    store.showToast('已收入物品')
  } else {
    const r = store.addCollection({ ...form.value, title: form.value.name, tags: form.value.tags })
    if (!r.ok) return store.showToast(r.error)
    store.showToast('已添加收藏')
  }
  showAdd.value = false
  form.value = { name: '', count: 1, description: '', cover: '', tags: '', url: '', fileMeta: null }
}
async function del(kind, id) {
  const ok = await dialog.confirm({ title: '确认删除', message: '该条目将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  if (kind === 'item') store.deleteItem(id)
  else store.deleteCollection(id)
  store.showToast('已移入回收站')
}
</script>

<template>
  <div class="page wide">
    <div class="page-head" style="flex-wrap:wrap;gap:10px">
      <div class="search-bar" style="flex:1;min-width:140px;max-width:280px">
        <Icon name="search" :size="16" />
        <input v-model="kw" placeholder="搜索名称 / 标签…" />
      </div>
      <button class="add-btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加{{ sub === 'item' ? '物品' : '收藏' }}</button>
    </div>
    <div class="row between" style="margin-bottom:12px">
      <div class="capsule" style="padding:4px;gap:4px">
        <button class="btn ghost" :style="sub === 'item' ? 'background:var(--eo-primary);color:#fff' : ''" @click="sub = 'item'">物品</button>
        <button class="btn ghost" :style="sub === 'collection' ? 'background:var(--eo-primary);color:#fff' : ''" @click="sub = 'collection'">收藏</button>
      </div>
      <button class="chip" @click="view = view === 'grid' ? 'list' : 'grid'">
        <Icon :name="view === 'grid' ? 'checklist' : 'grid'" :size="14" /> {{ view === 'grid' ? '列表' : '网格' }}
      </button>
    </div>

    <!-- 标签过滤（「分类」已废弃，统一走标签） -->
    <div v-if="allTags.length" class="row wrap" style="gap:8px;margin-bottom:12px">
      <button class="chip" :style="!tagFilter ? '' : 'background:var(--eo-primary);color:#fff'" @click="tagFilter = ''">全部</button>
      <button class="chip" v-for="t in allTags" :key="t" :style="tagFilter === t ? 'background:var(--eo-primary);color:#fff' : ''" @click="tagFilter = tagFilter === t ? '' : t">
        <Icon name="tag" :size="12" /> {{ t }}
      </button>
    </div>

    <!-- Steam 入口（收藏页，点击跳转独立页） -->
    <GlassCard v-if="sub === 'collection'" padding="14" hover glow style="margin-bottom:14px;cursor:pointer" @click="$router.push('/steam')">
      <div class="row" style="gap:12px">
        <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="cloud" :size="22" /></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">Steam 游戏库</div>
          <div class="muted" style="font-size:12px">配置 API Key 后拉取云端游戏数据 · 点击进入</div>
        </div>
        <Icon name="chevron" :size="18" />
      </div>
    </GlassCard>

    <!-- 物品（已取消类型字段） -->
    <template v-if="sub === 'item'">
      <div v-if="view === 'grid'" class="grid2">
        <GlassCard v-for="it in items" :key="it.id" padding="10" glow @click="openEditItem(it)">
          <div style="position:relative">
            <div v-if="it.cover" style="height:96px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + it.cover + ')' }"></div>
            <div v-else class="avatar" style="height:96px;border-radius:12px;width:100%;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="backpack" :size="30" /></div>
            <div style="font-weight:600;margin-top:8px">{{ it.name }}</div>
            <div class="muted" style="font-size:12px">×{{ it.count }}<span v-if="(it.tags || []).length"> · {{ it.tags.join(' / ') }}</span></div>
            <button class="ghost-btn" style="position:absolute;right:0;top:0" @click.stop="del('item', it.id)"><Icon name="trash" :size="16" /></button>
          </div>
        </GlassCard>
      </div>
      <div v-else>
        <GlassCard v-for="it in items" :key="it.id" style="margin:0 0 10px" @click="openEditItem(it)">
          <div class="row" style="gap:10px;width:100%">
            <div v-if="it.cover" style="width:46px;height:46px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + it.cover + ')' }"></div>
            <span v-else class="avatar"><Icon name="backpack" :size="22" /></span>
            <div style="flex:1"><div style="font-weight:600">{{ it.name }}</div><div class="muted" style="font-size:12px">×{{ it.count }}<span v-if="(it.tags || []).length"> · {{ it.tags.join(' / ') }}</span></div></div>
            <button class="ghost-btn" @click.stop="del('item', it.id)"><Icon name="trash" :size="16" /></button>
          </div>
        </GlassCard>
      </div>
      <div v-if="!items.length" class="muted" style="text-align:center;padding:30px">还没有物品</div>
    </template>

    <!-- 收藏（支持图片/音频/视频/PDF/文档文件与链接） -->
    <template v-else>
      <div v-if="view === 'grid'" class="grid2">
        <GlassCard v-for="c in collections" :key="c.id" padding="10" glow @click="openEditCollection(c)">
          <div style="position:relative">
            <div v-if="c.cover" style="height:96px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + c.cover + ')' }"></div>
            <div v-else class="avatar" style="height:96px;border-radius:12px;width:100%;background:var(--eo-chip);color:var(--eo-primary-deep)">
              <Icon :name="c.fileMeta ? mimeIcon(c.fileMeta.mime) : 'star'" :size="30" />
            </div>
            <div style="font-weight:600;margin-top:8px">{{ c.title }}</div>
            <div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <Icon v-if="c.fileMeta" :name="mimeIcon(c.fileMeta.mime)" :size="11" /> {{ c.fileMeta ? c.fileMeta.name + ' · ' + fmtSize(c.fileMeta.size) : (c.url || (c.content || '').slice(0, 30) || '—') }}
            </div>
            <button class="ghost-btn" style="position:absolute;right:0;top:0" @click.stop="del('collection', c.id)"><Icon name="trash" :size="16" /></button>
          </div>
        </GlassCard>
      </div>
      <div v-else>
        <GlassCard v-for="c in collections" :key="c.id" style="margin:0 0 10px" @click="openEditCollection(c)">
          <div class="row" style="gap:10px;width:100%">
            <div v-if="c.cover" style="width:46px;height:46px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + c.cover + ')' }"></div>
            <span v-else class="avatar"><Icon :name="c.fileMeta ? mimeIcon(c.fileMeta.mime) : 'star'" :size="22" /></span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">{{ c.title }}</div>
              <div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.fileMeta ? c.fileMeta.name + ' · ' + fmtSize(c.fileMeta.size) : (c.url || (c.content || '').slice(0, 30) || '—') }}</div>
            </div>
            <a v-if="c.url" class="ghost-btn" :href="c.url" target="_blank" rel="noopener" @click.stop><Icon name="link" :size="16" /></a>
            <button class="ghost-btn" @click.stop="del('collection', c.id)"><Icon name="trash" :size="16" /></button>
          </div>
        </GlassCard>
      </div>
      <div v-if="!collections.length" class="muted" style="text-align:center;padding:30px">还没有收藏</div>
    </template>

    <Modal :title="sub === 'item' ? '添加物品' : '添加收藏'" :show="showAdd" @close="showAdd = false">
      <template v-if="sub === 'item'">
        <div class="field"><label>名称</label><input v-model="form.name" placeholder="物品名" /></div>
        <div class="field"><label>数量</label><input type="number" v-model.number="form.count" /></div>
        <div class="field"><label>描述</label><textarea v-model="form.description" placeholder="备注"></textarea></div>
        <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="form.tags" placeholder="如：纪念 礼物" /></div>
        <div class="field">
          <label>封面</label>
          <GlassUploader label="点击或拖拽设置封面（支持图片）" @file="onCoverFile" />
          <div v-if="form.cover" style="margin-top:8px;height:80px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + form.cover + ')' }"></div>
        </div>
      </template>
      <template v-else>
        <div class="field"><label>标题</label><input v-model="form.name" placeholder="收藏标题" /></div>
        <div class="field"><label>上传文件（图片 / 音频 / 视频 / PDF / 文档，≤6MB，自动提取封面）</label>
          <GlassUploader label="点击或拖拽上传文件" @file="onCollectionFile" />
          <div v-if="coverBusy" class="muted" style="font-size:12px;margin-top:6px">封面提取中…</div>
          <div v-if="form.fileMeta" class="muted" style="font-size:12px;margin-top:6px"><Icon :name="mimeIcon(form.fileMeta.mime)" :size="12" /> {{ form.fileMeta.name }} · {{ fmtSize(form.fileMeta.size) }}</div>
        </div>
        <div class="field"><label>或填写链接</label><input v-model="form.url" placeholder="https://…" /></div>
        <div class="field"><label>描述</label><textarea v-model="form.description" placeholder="备注"></textarea></div>
        <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="form.tags" placeholder="如：纪念 灵感" /></div>
        <div class="field">
          <label>封面（无法自动提取时可手动上传）</label>
          <GlassUploader label="点击或拖拽设置封面（支持图片）" @file="onCoverFile" />
          <div v-if="form.cover" style="margin-top:8px;height:80px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + form.cover + ')' }"></div>
        </div>
      </template>
      <button class="btn" style="width:100%" @click="submit"><Icon name="plus" :size="16" /> 保存</button>
    </Modal>

    <!-- 二次编辑 -->
    <Modal :title="editKind === 'item' ? '编辑物品' : '编辑收藏'" :show="showEdit" @close="showEdit = false">
      <div class="field"><label>名称</label><input v-model="editData.name" /></div>
      <div v-if="editKind === 'item'" class="field"><label>数量</label><input type="number" v-model.number="editData.count" /></div>
      <div v-else class="field"><label>链接（可选）</label><input v-model="editData.url" placeholder="https://…" /></div>
      <div class="field"><label>描述</label><textarea v-model="editData.description" placeholder="备注" style="min-height:50px"></textarea></div>
      <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="editData.tags" placeholder="如：纪念 礼物" /></div>
      <div class="field">
        <label>封面（点击替换）</label>
        <GlassUploader label="点击或拖拽设置封面（支持图片）" @file="pickEditCover" />
        <div v-if="editData.cover" style="margin-top:8px;height:80px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + editData.cover + ')' }"></div>
      </div>
      <button class="btn" style="width:100%" @click="saveEdit"><Icon name="edit" :size="16" /> 保存修改</button>
    </Modal>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
</style>
