<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { searchPlaces, mountMap, loadAMap } from '../lib/map.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const mapEl = ref(null)
const searchInput = ref(null)
let mapCtl = null
const query = ref('')
const results = ref([])
const searching = ref(false)
const showAdd = ref(false)
const pick = ref(null) // {lng,lat}
const form = ref({ name: '', note: '', date: '', tags: '' })
const loadErr = ref('')

onMounted(async () => {
  try {
    await loadAMap()
    mapCtl = await mountMap(mapEl.value)
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
  } catch (e) { loadErr.value = e.message || '地图加载失败' }
  // 主页速览「留足迹」直达：自动聚焦搜索框
  if (route.query.add) nextTick(() => searchInput.value && searchInput.value.focus())
})
onUnmounted(() => { if (mapCtl) mapCtl.destroy() })

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
  searching.value = true
  try { results.value = await searchPlaces(query.value) }
  catch (e) { store.showToast('搜索失败：' + e.message) }
  finally { searching.value = false }
}
function focusResult(r) {
  if (!r.location) return
  if (mapCtl) { mapCtl.setCenter(r.location.lng, r.location.lat); mapCtl.addMarker(r.location.lng, r.location.lat, r.name) }
  pick.value = r.location
  form.value.name = r.name
  showAdd.value = true
}
function save() {
  const p = pick.value
  if (!p) return store.showToast('请先在地图上点选位置')
  const r = store.addLocation({ name: form.value.name, lat: p.lat, lng: p.lng, note: form.value.note, date: form.value.date, tags: form.value.tags })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已添加足迹')
  showAdd.value = false
  form.value = { name: '', note: '', date: '', tags: '' }
  pick.value = null
}
async function removeLoc(id) {
  const ok = await dialog.confirm({ title: '删除足迹', message: '该足迹将移入回收站（30 天内可恢复）。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deleteLocation(id)
  store.showToast('已移入回收站')
}
</script>

<template>
  <div class="page wide" style="padding:0" @click="onBlankClick">
    <!-- 搜索区：独立于地图上方，互不重叠 -->
    <div class="map-top">
      <div class="capsule" style="background:var(--eo-glass-strong)">
        <Icon name="search" :size="18" />
        <input ref="searchInput" v-model="query" placeholder="搜索地点（如：西湖）" @keyup.enter="doSearch" />
        <button v-if="query" class="ghost-btn" style="padding:4px" title="清空" @click.stop="query = ''; results = []"><Icon name="x" :size="16" /></button>
      </div>
    </div>
    <div style="position:relative;height:46vh;margin:0 14px">
      <div ref="mapEl" style="width:100%;height:100%;border-radius:18px;overflow:hidden"></div>
      <div v-if="loadErr" class="glass card" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0">{{ loadErr }}</div>
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
      <div class="section-title" style="margin-top:0">我的足迹（{{ store.data.locations.length }}）</div>
      <div v-if="!store.data.locations.length" class="glass card" style="text-align:center;padding:28px 16px">
        <div style="font-size:30px">🗺️</div>
        <div style="font-weight:700;margin-top:6px">还没有足迹</div>
        <div class="muted" style="font-size:13px;margin-top:2px;line-height:1.7">在上方搜索一个地点并点击结果，<br />或直接在地图上点选位置，即可留下第一枚足迹。</div>
        <button class="btn" style="margin:12px auto 0" @click="searchInput && searchInput.focus()"><Icon name="search" :size="16" /> 搜索一个地点</button>
      </div>
      <div v-for="l in store.data.locations" :key="l.id" class="glass list-item">
        <span class="avatar"><Icon name="location" :size="20" /></span>
        <div style="flex:1"><div style="font-weight:600">{{ l.name }}</div><div class="muted" style="font-size:12px">{{ l.date }} · {{ l.lat.toFixed(3) }},{{ l.lng.toFixed(3) }}</div></div>
        <button class="ghost-btn" @click="removeLoc(l.id)"><Icon name="trash" :size="16" /></button>
      </div>
    </div>

    <Modal title="添加足迹" :show="showAdd" @close="showAdd = false">
      <div v-if="pick" class="muted" style="margin-bottom:8px">坐标：{{ pick.lat.toFixed(5) }}, {{ pick.lng.toFixed(5) }}</div>
      <div class="field"><label>名称</label><input v-model="form.name" /></div>
      <div class="field"><label>日期</label><input type="date" v-model="form.date" /></div>
      <div class="field"><label>备注</label><textarea v-model="form.note"></textarea></div>
      <div class="field"><label>标签</label><input v-model="form.tags" /></div>
      <button class="btn" style="width:100%" @click="save"><Icon name="map-pin" :size="16" /> 保存足迹</button>
    </Modal>
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
.map-result:hover { background: var(--eo-chip); }
</style>
