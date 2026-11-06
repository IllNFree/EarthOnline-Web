<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import GlassCard from '../components/GlassCard.vue'
import GlassUploader from '../components/GlassUploader.vue'
import Modal from '../components/GlassBottomSheet.vue'
import EntitySearchDialog from '../components/EntitySearchDialog.vue'
import EntityRelationsPanel from '../components/EntityRelationsPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import { fetchLinkCover, faviconFor, coverFallback } from '../lib/cover.js'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
// 右下角全局 FAB：在本页注册「添加物品 / 收藏」（跟随当前子页）
onMounted(() => store.setQuickAdd(() => { showAdd.value = true }))
onUnmounted(() => store.setQuickAdd(null))
const sub = ref(route.query.sub === 'collection' ? 'collection' : 'item')
const view = ref('grid')
const showAdd = ref(false)
// 「分类」已废弃：统一走标签过滤（数据层 category 保留兼容旧数据，仅展示不再录入）
const form = ref({ name: '', count: 1, description: '', cover: '', tags: '', url: '', fileMeta: null })
const tagFilter = ref('')
const kw = ref('')
const coverBusy = ref(false)
// 链接封面：失焦 / 粘贴后自动抓取，仅填空封面；失败回退 favicon，不阻塞保存
const linkBusyTarget = ref(null)
// 同一表单同一链接只发一次请求（粘贴后紧跟失焦时不重复抓取）
const linkPending = new WeakMap()
let linkSeq = 0

async function autoCoverFromUrl(target, url) {
  if (!target) return
  const link = String(url || '').trim()
  if (!/^https?:\/\//i.test(link)) return
  if (String(target.cover || '').trim()) return
  if (linkPending.get(target) === link) return
  linkPending.set(target, link)
  const seq = ++linkSeq
  linkBusyTarget.value = target
  let image = null
  try {
    image = await fetchLinkCover(link)
  } finally {
    if (linkPending.get(target) === link) linkPending.delete(target)
  }
  if (linkBusyTarget.value === target) linkBusyTarget.value = null
  if (seq !== linkSeq) return
  // 抓取期间用户可能已手动填写 / 上传封面，此时绝不覆盖
  if (!String(target.cover || '').trim()) {
    const fallback = faviconFor(link)
    if (image) target.cover = image
    else if (fallback) target.cover = fallback
  }
}
function onUrlBlur(target) {
  autoCoverFromUrl(target, target && target.url)
}
function onUrlPaste(target, e) {
  const text = e && e.clipboardData ? e.clipboardData.getData('text') : ''
  if (!/^https?:\/\//i.test(String(text || '').trim())) return
  // v-model 在 paste 之后才写入，延后一拍再读取
  setTimeout(() => autoCoverFromUrl(target, target && target.url), 0)
}

const items = computed(() => {
  let list = store.live.items
  const q = kw.value.trim().toLowerCase()
  if (q) list = list.filter((x) => (x.name || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q) || (x.tags || []).join(' ').toLowerCase().includes(q))
  if (tagFilter.value) list = list.filter((x) => (x.tags || []).includes(tagFilter.value))
  return list
})
const collections = computed(() => {
  let list = store.live.collections
  const q = kw.value.trim().toLowerCase()
  if (q) list = list.filter((x) => (x.title || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q) || (x.url || '').toLowerCase().includes(q) || (x.tags || []).join(' ').toLowerCase().includes(q))
  if (tagFilter.value) list = list.filter((x) => (x.tags || []).includes(tagFilter.value))
  return list
})
// 二次编辑（点击已有卡片打开编辑，支持替换封面 / 信息）
const showEdit = ref(false)
const editKind = ref('item')
const editData = ref(null)
// 模块三：关联内容弹窗（双向绑定 + 画布语义连线）
const relShow = ref(false)
const relType = ref('item')
const relId = ref(null)
function openRel(type, id) { relType.value = type; relId.value = id; relShow.value = true }
const relatedForEdit = computed(() => (editData.value && editData.value.id ? store.relatedEntitiesFor(editKind.value === 'item' ? 'item' : 'collection', editData.value.id) : []))
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
  store.live.items.forEach((x) => (x.tags || []).forEach((t) => s.add(t)))
  store.live.collections.forEach((x) => (x.tags || []).forEach((t) => s.add(t)))
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
    <PageHeader title="背包" v-model:query="kw" placeholder="搜索名称 / 标签…"
      :subtitle="`共 ${store.live.items.length} 件物品 · ${store.live.collections.length} 份收藏`">
      <template #actions>
        <button class="add-btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加{{ sub === 'item' ? '物品' : '收藏' }}</button>
      </template>
      <template #filters>
        <div class="seg">
          <button :class="{ 'is-on': sub === 'item' }" @click="sub = 'item'">物品</button>
          <button :class="{ 'is-on': sub === 'collection' }" @click="sub = 'collection'">收藏</button>
        </div>
        <button class="chip" :class="{ 'is-on': !tagFilter }" @click="tagFilter = ''">全部</button>
        <button v-for="t in allTags" :key="t" class="chip" :class="{ 'is-on': tagFilter === t }" @click="tagFilter = tagFilter === t ? '' : t">
          <Icon name="tag" :size="12" /> {{ t }}
        </button>
      </template>
      <template #tools>
        <button class="chip" @click="view = view === 'grid' ? 'list' : 'grid'">
          <Icon :name="view === 'grid' ? 'checklist' : 'grid'" :size="14" /> {{ view === 'grid' ? '列表' : '网格' }}
        </button>
      </template>
    </PageHeader>

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
      <EmptyState v-if="!items.length" icon="backpack" title="背包还空着" subtitle="把值得收藏的物件都收进来吧">
        <button class="btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加你的第一件物品</button>
      </EmptyState>
    </template>

    <!-- 收藏（支持图片/音频/视频/PDF/文档文件与链接） -->
    <template v-else>
      <div v-if="view === 'grid'" class="grid2">
        <GlassCard v-for="c in collections" :key="c.id" padding="10" glow @click="openEditCollection(c)">
          <div style="position:relative">
            <div v-if="c.cover" style="height:96px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + c.cover + ')' }"></div>
            <div v-else-if="c.url" class="cover-fallback" :style="{ height: '96px', borderRadius: '12px', width: '100%', background: coverFallback(c.url).gradient }">{{ coverFallback(c.url).initial }}</div>
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
            <span v-else-if="c.url" class="avatar cover-fallback" :style="{ background: coverFallback(c.url).gradient }">{{ coverFallback(c.url).initial }}</span>
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
      <EmptyState v-if="!collections.length" icon="star" title="还没有收藏" subtitle="链接、文件或灵感，都先收在这里">
        <button class="btn" @click="showAdd = true"><Icon name="plus" :size="16" /> 添加你的第一份收藏</button>
      </EmptyState>
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
        <div class="field">
          <label>或填写链接</label>
          <input v-model="form.url" placeholder="https://…" @blur="onUrlBlur(form)" @paste="onUrlPaste(form, $event)" />
          <div v-if="linkBusyTarget === form" class="muted" style="font-size:12px;margin-top:6px">封面获取中…</div>
        </div>
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
      <div v-else class="field">
        <label>链接（可选）</label>
        <input v-model="editData.url" placeholder="https://…" @blur="onUrlBlur(editData)" @paste="onUrlPaste(editData, $event)" />
        <div v-if="linkBusyTarget === editData" class="muted" style="font-size:12px;margin-top:6px">封面获取中…</div>
      </div>
      <div class="field"><label>描述</label><textarea v-model="editData.description" placeholder="备注" style="min-height:50px"></textarea></div>
      <div class="field"><label>标签（空格或逗号分隔）</label><input v-model="editData.tags" placeholder="如：纪念 礼物" /></div>
      <div class="field">
        <label>封面（点击替换）</label>
        <GlassUploader label="点击或拖拽设置封面（支持图片）" @file="pickEditCover" />
        <div v-if="editData.cover" style="margin-top:8px;height:80px;border-radius:12px;background-size:cover;background-position:center" :style="{ backgroundImage: 'url(' + editData.cover + ')' }"></div>
      </div>
      <div v-if="editData && editData.id" class="rel-block">
        <div class="rel-block-head">
          <span>关联内容（{{ relatedForEdit.length }}）</span>
          <button class="chip" @click="openRel(editKind === 'item' ? 'item' : 'collection', editData.id)"><Icon name="link" :size="14" /> 管理关联</button>
        </div>
        <EntityRelationsPanel :type="editKind === 'item' ? 'item' : 'collection'" :id="editData.id" />
        <div v-if="!relatedForEdit.length" class="muted" style="font-size:12px">尚未关联任何实体，点击「管理关联」建立双向关联。</div>
      </div>
      <button class="btn" style="width:100%" @click="saveEdit"><Icon name="edit" :size="16" /> 保存修改</button>
    </Modal>

    <EntitySearchDialog :source-type="relType" :source-id="relId" :show="relShow" @close="relShow = false" />
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.cover-fallback { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 26px; }
.rel-block { border-top: 1px dashed var(--eo-glass-border); margin-top: 12px; padding-top: 12px; }
.rel-block-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.rel-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rel-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--eo-chip); color: var(--eo-ink); }
.rel-chip.dir-in { background: rgba(44, 44, 44, .16); }
.rel-dir { font-size: 10px; opacity: .7; }
</style>
