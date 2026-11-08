<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { searchPlaces, mountMap, loadAMap } from '../lib/map.js'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import Modal from '../components/GlassBottomSheet.vue'
import EntitySearchDialog from '../components/EntitySearchDialog.vue'
import EntityRelationsPanel from '../components/EntityRelationsPanel.vue'
import EmptyState from '../components/EmptyState.vue'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import { parseTagsInput } from '../lib/model.js'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const mapEl = ref(null)
const pgHead = ref(null)
let mapCtl = null
const query = ref('')
const results = ref([])
const searching = ref(false)
const showAdd = ref(false)
const editId = ref(null) // 非空 = 编辑已保存足迹；空 = 新增
const pick = ref(null) // {lng,lat}
const form = ref({ name: '', note: '', date: '', tags: '' })
const loadErr = ref('')
const searchMode = ref('place') // 'place' 地点搜索 / 'footprint' 本地足迹搜索
// 懒加载：地图容器进入视口后才拉取 SDK 并初始化，避免首屏被第三方脚本阻塞
const mapLoading = ref(false)
const mapReady = ref(false)
const pendingFocus = ref(null)
let initializing = false
let io = null

function idle(fn) {
  if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 900 })
  else setTimeout(fn, 32)
}

async function initMap() {
  if (mapCtl || initializing || !mapEl.value) return
  initializing = true
  mapLoading.value = true
  try {
    // 先让首帧渲染完成，再在空闲时拉 SDK（不阻塞主线程）
    await new Promise((r) => idle(r))
    await loadAMap()
    mapCtl = await mountMap(mapEl.value)
    mapReady.value = true
    mapCtl.onPick((ll) => {
      // 搜索状态下点击地图空白处 = 直接退出搜索状态（需求：无需点 X）
      if (results.value.length || searching.value) {
        results.value = []
        searching.value = false
        return
      }
      pick.value = ll
      form.value.name = form.value.name || '我的足迹'
    })
    // 双击地图任意位置 → 直接弹出「创建足迹」
    mapCtl.onDblClick((ll) => {
      editId.value = null
      pick.value = ll
      form.value.name = form.value.name || '我的足迹'
      showAdd.value = true
    })
    if (pendingFocus.value) { focusLocation(pendingFocus.value); pendingFocus.value = null }
    // 足迹常驻：地图就绪即把全部已保存足迹铺到地图上，缩放/拖动不消失
    renderFootprints()
    mapZoom.value = Math.round(mapCtl.getZoom() || 12)
    mapCtl.onZoom((z) => { mapZoom.value = Math.round(z) })
  } catch (e) {
    loadErr.value = e.message || '地图加载失败'
  } finally {
    mapLoading.value = false
    initializing = false
  }
}

// ---- 足迹常驻标记：全量渲染已保存足迹，增删自动同步 ----
function renderFootprints() {
  if (!mapCtl) return
  mapCtl.clearFootprints()
  store.live.locations.forEach((l) => {
    if (typeof l.lng !== 'number' || typeof l.lat !== 'number') return
    mapCtl.addFootprint(l.lng, l.lat, l.name, () => focusLocation(l))
  })
}
// 名称 / 坐标变化也要重绘标记（编辑足迹后立即同步）
watch(() => store.live.locations.map((l) => [l.id, l.name, l.lat, l.lng].join(':')).join('|'), () => renderFootprints())

// ---- 缩放条（与画布/主页地图卡缩放完全独立）----
const mapZoom = ref(12)
function zoomStep(d) { if (mapCtl) mapCtl.setZoom(Math.min(18, Math.max(3, Math.round(mapZoom.value) + d))) }
function onZoomInput(e) { const z = Number(e.target.value); if (mapCtl && z) mapCtl.setZoom(z) }

onMounted(() => {
  // 视口懒加载（rootMargin 提前 200px 预热，进入即秒开）
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { if (io) io.disconnect(); io = null; initMap() }
  }, { root: null, rootMargin: '200px', threshold: 0.01 })
  if (mapEl.value) io.observe(mapEl.value)
  // 主页速览「留足迹」直达：自动聚焦搜索框
  if (route.query.add) nextTick(() => pgHead.value && pgHead.value.focus())
})
onUnmounted(() => {
  if (io) io.disconnect()
  if (mapCtl) mapCtl.destroy()
  if (searchTimer) clearTimeout(searchTimer)
})

// 点击地图/结果以外的页面空白处，同样退出搜索状态
function onBlankClick(e) {
  if (!results.value.length && !searching.value) return
  if (e.target && e.target.closest && (e.target.closest('.capsule') || e.target.closest('.map-results'))) return
  results.value = []
  searching.value = false
}
// 全局 Esc：有搜索结果时消费事件（阻止页面返回），仅退出搜索
function onEsc(e) {
  if (results.value.length || searching.value) {
    results.value = []
    searching.value = false
    e.preventDefault()
  }
}
onMounted(() => document.addEventListener('eo-esc', onEsc))
onUnmounted(() => document.removeEventListener('eo-esc', onEsc))

async function doSearch() {
  if (!query.value.trim()) return
  if (searchMode.value === 'footprint') {
    // 本地足迹搜索：按名称 / 标签 / 备注过滤
    const q = query.value.trim().toLowerCase()
    results.value = store.live.locations
      .filter((l) => (l.name || '').toLowerCase().includes(q) || (l.tags || []).join(' ').toLowerCase().includes(q) || (l.note || '').toLowerCase().includes(q))
      .map((l) => ({ id: l.id, name: l.name, address: (l.tags || []).join(' / ') || l.note || '', location: { lng: l.lng, lat: l.lat } }))
    searching.value = false
    return
  }
  searching.value = true
  try { results.value = await searchPlaces(query.value) }
  catch (e) { store.showToast('搜索失败：' + e.message) }
  finally { searching.value = false }
}
// 实时搜索：输入即触发（280ms 防抖），无需按回车；清空立即收起结果
let searchTimer = null
watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const t = String(q || '').trim()
  if (!t) { results.value = []; searching.value = false; return }
  searchTimer = setTimeout(() => { doSearch() }, 280)
})

function focusResult(r) {
  if (!r.location) return
  if (mapCtl) { mapCtl.clearMarkers(); mapCtl.setCenter(r.location.lng, r.location.lat); mapCtl.addMarker(r.location.lng, r.location.lat, r.name) }
  editId.value = null
  pick.value = r.location
  form.value = { name: r.name, note: '', date: '', tags: '' }
  showAdd.value = true
}
// 点击已保存足迹 → 回填表单进入编辑；定位按钮单独走 focusLocation
function openEdit(l) {
  editId.value = l.id
  pick.value = { lng: l.lng, lat: l.lat }
  const tags = Array.isArray(l.tags) ? l.tags.join(', ') : (l.tags || '')
  form.value = { name: l.name || '', note: l.note || '', date: l.date || '', tags }
  showAdd.value = true
  if (mapCtl) mapCtl.setCenter(l.lng, l.lat, 15)
}
function closeAdd() {
  showAdd.value = false
  editId.value = null
  form.value = { name: '', note: '', date: '', tags: '' }
  pick.value = null
}
// 点击侧栏 / 列表足迹 / 地图足迹标记 → 地图自动居中定位（不清除常驻足迹）
function focusLocation(l) {
  pick.value = { lng: l.lng, lat: l.lat }
  // 地图还没初始化（懒加载中）→ 先记下目标，就绪后自动定位
  if (!mapCtl) { pendingFocus.value = l; return }
  mapCtl.setCenter(l.lng, l.lat, 15)
}
function save() {
  const p = pick.value
  if (!p) return store.showToast('请先在地图上点选位置')
  const name = String(form.value.name || '').trim()
  if (!name) return store.showToast('名称不能为空')
  if (editId.value) {
    const patch = {
      name, lat: p.lat, lng: p.lng,
      note: form.value.note, tags: parseTagsInput(form.value.tags)
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(form.value.date)) patch.date = form.value.date
    const r = store.updateLocation(editId.value, patch)
    if (!r) return store.showToast('足迹不存在或已被删除')
    store.showToast('足迹已更新')
  } else {
    const r = store.addLocation({ name: form.value.name, lat: p.lat, lng: p.lng, note: form.value.note, date: form.value.date, tags: form.value.tags })
    if (!r.ok) return store.showToast(r.error)
    store.showToast('已添加足迹')
  }
  closeAdd()
}
async function removeLoc(id) {
  const ok = await dialog.confirm({ title: '删除足迹', message: '该足迹将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deleteLocation(id)
  store.showToast('已移入回收站')
}
// 模块三：足迹详情 + 关联内容（双向绑定 + 画布语义连线）
const showDetail = ref(false)
const detailLoc = ref(null)
function openDetail(l) { detailLoc.value = l; showDetail.value = true }
const relShow = ref(false)
const relType = ref('location')
const relId = ref(null)
function openRel(type, id) { relType.value = type; relId.value = id; relShow.value = true }
const relatedForDetail = computed(() => (detailLoc.value ? store.relatedEntitiesFor('location', detailLoc.value.id) : []))
</script>

<template>
  <div class="page wide" style="padding:0" @click="onBlankClick">
    <!-- 统一页头：标题 + 搜索 + 模式切换（与其他基础页完全同一套网格与间距） -->
    <div class="map-head-wrap">
      <PageHeader ref="pgHead" title="足迹" v-model:query="query"
        :placeholder="searchMode === 'place' ? '搜索地点（如：西湖）' : '搜索我的足迹（名称 / 标签）'"
        :subtitle="`已记录 ${store.live.locations.length} 枚足迹`"
        @enter="doSearch" @clear="results = []">
        <template #actions>
          <div class="seg">
            <button :class="{ 'is-on': searchMode === 'place' }" @click="searchMode = 'place'">地点</button>
            <button :class="{ 'is-on': searchMode === 'footprint' }" @click="searchMode = 'footprint'">足迹</button>
          </div>
        </template>
      </PageHeader>
    </div>
    <div class="map-stage">
      <div ref="mapEl" style="width:100%;height:100%;border-radius:18px;overflow:hidden"></div>
      <!-- 骨架屏：SDK 懒加载 / 首帧渲染期间占位，避免空白闪烁 -->
      <div v-if="!mapReady && !loadErr" class="map-skeleton">
        <span class="map-skeleton__ring"></span>
        <span class="map-skeleton__t">{{ mapLoading ? '地图加载中…' : '地图即将就绪' }}</span>
      </div>
      <div v-if="loadErr" class="glass card" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0">{{ loadErr }}</div>
      <!-- 缩放条：+ / 滑杆 / −，控制高德地图缩放（独立于足迹数据） -->
      <div v-if="mapReady" class="map-zoom glass">
        <button class="map-zoom__btn" title="放大" @click="zoomStep(1)">+</button>
        <input class="map-zoom__range" type="range" min="3" max="18" step="1" :value="mapZoom" @input="onZoomInput" />
        <button class="map-zoom__btn" title="缩小" @click="zoomStep(-1)">−</button>
      </div>
      <!-- 搜索结果：落在地图内顶部，不遮挡搜索框 -->
      <div v-if="searching || results.length" class="map-results">
        <div class="row between" style="padding:8px 8px 0 14px" v-if="!searching && results.length">
          <span class="muted" style="font-size:12px">搜索结果（{{ results.length }}）</span>
          <button class="ghost-btn" title="关闭" @click="results = []"><Icon name="x" :size="16" /></button>
        </div>
        <div v-if="searching" class="muted" style="padding:10px 14px">搜索中…</div>
        <div v-for="r in results" :key="r.id" class="map-result" @click="focusResult(r)">
          <Icon name="map-pin" :size="16" />
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px">{{ r.name }}</div>
            <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.address }}</div>
          </div>
        </div>
      </div>
    </div>

    <div style="padding:12px 16px 28px">
      <div class="section-title" style="margin-top:0">我的足迹（{{ store.live.locations.length }}）</div>
      <EmptyState v-if="!store.live.locations.length" icon="globe" title="还没有足迹" subtitle="在上方搜索一个地点并点击结果，或直接在地图上点选位置，即可留下第一枚足迹。">
        <button class="btn" @click="pgHead && pgHead.focus()"><Icon name="search" :size="16" /> 搜索一个地点</button>
      </EmptyState>
      <!-- 紧凑卡片流：左侧地点标识与名称，右侧时间/坐标，双列自适应铺满一屏 -->
      <div class="loc-grid">
        <div v-for="l in store.live.locations" :key="l.id" class="glass loc-card" @click="openEdit(l)">
          <div class="loc-card__top">
            <span class="loc-card__ico"><Icon name="location" :size="15" /></span>
            <span class="loc-card__name">{{ l.name }}</span>
            <span class="loc-card__date">{{ l.date }}</span>
          </div>
          <div class="loc-card__meta">
            <span class="loc-card__coord">{{ l.lat.toFixed(3) }}, {{ l.lng.toFixed(3) }}</span>
            <span class="loc-card__acts">
              <button class="ghost-btn" title="定位" @click.stop="focusLocation(l)"><Icon name="map-pin" :size="14" /></button>
              <button class="ghost-btn" title="关联内容" @click.stop="openRel('location', l.id)"><Icon name="link" :size="14" /></button>
              <button class="ghost-btn" title="详情" @click.stop="openDetail(l)"><Icon name="info" :size="14" /></button>
              <button class="ghost-btn" title="删除" @click.stop="removeLoc(l.id)"><Icon name="trash" :size="14" /></button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <Modal :title="editId ? '编辑足迹' : '添加足迹'" :show="showAdd" @close="closeAdd">
      <div v-if="pick" class="muted" style="margin-bottom:8px">坐标：{{ pick.lat.toFixed(5) }}, {{ pick.lng.toFixed(5) }}</div>
      <div class="field"><label>名称</label><input v-model="form.name" /></div>
      <div class="field"><label>日期</label><input type="date" v-model="form.date" /></div>
      <div class="field"><label>备注</label><textarea v-model="form.note"></textarea></div>
      <div class="field"><label>标签</label><input v-model="form.tags" /></div>
      <button class="btn" style="width:100%" @click="save"><Icon name="map-pin" :size="16" /> {{ editId ? '保存修改' : '保存足迹' }}</button>
    </Modal>

    <!-- 模块三：足迹详情 + 关联内容（双向绑定 + 画布语义连线） -->
    <Modal title="足迹详情" :show="showDetail" @close="showDetail = false">
      <div v-if="detailLoc" class="loc-detail">
        <div style="font-weight:700">{{ detailLoc.name }}</div>
        <div class="muted" style="font-size:12px;margin:4px 0">{{ detailLoc.date }} · {{ detailLoc.lat.toFixed(5) }}, {{ detailLoc.lng.toFixed(5) }}</div>
        <div v-if="detailLoc.note" style="font-size:13px;white-space:pre-wrap">{{ detailLoc.note }}</div>
      </div>
      <div v-if="detailLoc" class="rel-block">
        <div class="rel-block-head">
          <span>关联内容（{{ relatedForDetail.length }}）</span>
          <button class="chip" @click="openRel('location', detailLoc.id)"><Icon name="link" :size="14" /> 管理关联</button>
        </div>
        <EntityRelationsPanel type="location" :id="detailLoc.id" />
        <div v-if="!relatedForDetail.length" class="muted" style="font-size:12px">尚未关联任何实体，点击「管理关联」建立双向关联。</div>
      </div>
    </Modal>

    <EntitySearchDialog :source-type="relType" :source-id="relId" :show="relShow" @close="relShow = false" />
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.map-top { padding: 12px 16px 10px; }
.map-results {
  position: absolute; left: 0; right: 0; top: 12px; z-index: 6;
  max-height: 38vh; overflow-y: auto; border-radius: 18px;
  background: var(--eo-glass-strong); backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid var(--eo-glass-border); box-shadow: var(--eo-shadow);
}
.map-result { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; color: var(--eo-ink); }
.map-result + .map-result { border-top: 1px solid var(--eo-glass-border); }
.map-result:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.loc-detail { background: var(--eo-chip); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }
.rel-block { border-top: 1px dashed var(--eo-glass-border); margin-top: 12px; padding-top: 12px; }
.rel-block-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.rel-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rel-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--eo-chip); color: var(--eo-ink); }
.rel-chip.dir-in { background: rgba(44, 44, 44, .16); }
.rel-dir { font-size: 10px; opacity: .7; }
/* 地图懒加载骨架屏 */
.map-skeleton {
  position: absolute; inset: 0; border-radius: 18px; z-index: 5;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: linear-gradient(120deg, var(--eo-bg-2), var(--eo-glass), var(--eo-bg-2));
  background-size: 220% 100%;
  animation: mapSkeleton 1.6s ease-in-out infinite;
  border: 1px solid var(--eo-glass-border);
  pointer-events: none;
}
.map-skeleton__ring {
  width: 26px; height: 26px; border-radius: 50%;
  border: 2.5px solid var(--eo-glass-border); border-top-color: var(--eo-primary);
  animation: mapSpin .8s linear infinite;
}
.map-skeleton__t { font-size: 12px; font-weight: 600; color: var(--eo-ink-soft); }
@keyframes mapSkeleton { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes mapSpin { to { transform: rotate(360deg); } }
/* 统一页头与地图舞台的内边距，与其他基础页完全一致 */
.map-head-wrap { padding: 22px 28px 0; }
.map-stage { position: relative; height: 46vh; margin: 0 28px; }
/* 缩放条（地图右下角，竖排） */
.map-zoom {
  position: absolute; right: 14px; bottom: 16px; z-index: 6;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 6px; border-radius: 12px; border: 1px solid var(--eo-glass-border);
}
.map-zoom__btn {
  width: 24px; height: 24px; border-radius: 8px; border: none; cursor: pointer;
  background: transparent; color: var(--eo-ink); font-size: 15px; font-weight: 700; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.map-zoom__btn:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.map-zoom__range {
  writing-mode: vertical-lr; direction: rtl; /* 竖排滑杆：上大下小 */
  width: 4px; height: 84px; accent-color: var(--eo-primary); cursor: pointer; margin: 0;
}
@media (max-width: 899px) { .map-zoom { right: 10px; bottom: 12px; } .map-zoom__range { height: 64px; } }
@media (max-width: 899px) {
  .map-head-wrap { padding: 16px 16px 0; }
  .map-stage { margin: 0 16px; }
  /* 地点 / 足迹 切换并入搜索栏同一行，取消单独占一行的臃肿布局 */
  .map-head-wrap :deep(.pg-head__id) { flex: 1 1 100%; }
  .map-head-wrap :deep(.pg-head__search) { flex: 1 1 auto; width: auto; min-width: 0; }
  .map-head-wrap :deep(.pg-head__actions) { flex: none; }
  .map-head-wrap :deep(.seg) { padding: 3px; }
  .map-head-wrap :deep(.seg button) { padding: 6px 11px; font-size: 12.5px; }
}

/* 足迹紧凑卡片流：双列自适应，一屏可见更多足迹 */
.loc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(272px, 1fr)); gap: 10px; padding: 0 28px 28px; }
@media (max-width: 899px) { .loc-grid { padding: 0 16px 24px; } }
.loc-card { padding: 10px 12px; border-radius: 14px; cursor: pointer; }
.loc-card__top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.loc-card__ico {
  width: 28px; height: 28px; border-radius: 9px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
.loc-card__name { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; color: var(--eo-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loc-card__date { flex: none; font-size: 11px; font-weight: 600; color: var(--eo-ink-faint); font-variant-numeric: tabular-nums; }
.loc-card__meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.loc-card__coord { font-size: 11px; color: var(--eo-ink-faint); font-variant-numeric: tabular-nums; }
.loc-card__acts { display: flex; align-items: center; gap: 0; opacity: .55; transition: opacity .15s ease; }
.loc-card:hover .loc-card__acts { opacity: 1; }
</style>
