<script setup>
// ===== 画布数据面板节点（v2.1.0 模块二）=====
// 把原「数据中心看板」的六块数据面板搬到画布上：背包统计 / 笔记列表 / 相册预览 / 足迹地图 / Steam 游戏库 / 成就展示。
// 2026-11-04：卡片内容随卡片尺寸自动切换（xs/sm/md/lg + short），交互全部收进卡片内：
//   日历 = 迷你月历（大卡带当日议程 + 浮层加任务）、笔记 = 列表 / 分页阅读 + 浮层编辑器、
//   地图 = 锁按钮切换地图模式、相册 = 瀑布流 + 大图、待办 = 分组、记账 = 明细。
import { computed, ref, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useAppStore } from '../stores/app.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { steamGames, steamTotal } from '../services/steamCache.js'
import { todayStr } from '../lib/model.js'
import Icon from './Icon.vue'
import TileMapCanvas from './TileMapCanvas.vue'
import MarkdownView from './MarkdownView.vue'
import GlassBottomSheet from './GlassBottomSheet.vue'
import { buildCatColorMap, colorOf } from '../lib/calColors.js'
import { refreshData } from '../services/globalActions.js'

const props = defineProps({ kind: { type: String, default: 'backpack' } })
const store = useAppStore()

// ---------- 尺寸断点：宽 + 高双维度（resize 时实时切换内容层级） ----------
const rootEl = ref(null)
const sizeClass = ref('sz-md') // sz-xs / sz-sm / sz-md / sz-lg
const isShort = ref(false)
let ro = null
onMounted(() => {
  const upd = () => {
    const el = rootEl.value
    if (!el) return
    const w = el.clientWidth || 240
    const h = el.clientHeight || 200
    sizeClass.value = w < 210 ? 'sz-xs' : (w < 320 ? 'sz-sm' : (w < 460 ? 'sz-md' : 'sz-lg'))
    isShort.value = h < 180
  }
  upd()
  ro = new ResizeObserver(upd)
  if (rootEl.value) ro.observe(rootEl.value)
  // 天气卡才发网络请求：其余面板不触网
  if (props.kind === 'weather') loadWeather()
})
onUnmounted(() => { if (ro) ro.disconnect(); if (themeMO) themeMO.disconnect() })

// ---------- 日期 / 当日数据 ----------
const todayKey = computed(() => todayStr())
const fmtKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const selectedDay = ref(todayStr())
const dayWeek = computed(() => {
  if (!selectedDay.value) return ''
  const p = selectedDay.value.split('-').map(Number)
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(p[0], p[1] - 1, p[2]).getDay()]
})
const dayData = computed(() => {
  if (!selectedDay.value) return { key: '', tasks: [], recs: [] }
  const key = selectedDay.value
  // 全部走安全取值：面板内任何一次抛错都会中断整棵画布子树渲染（连带拖拽 / 连线失效）
  const allTasks = store.data.tasks || []
  const tasks = allTasks
    .filter((t) => !t.deletedAt && (t.dueDate || '').slice(0, 10) === key)
    .sort((a, b) => ((a.dueTime || '99:99') < (b.dueTime || '99:99') ? -1 : 1))
  const recs = ((store.data.ledger && store.data.ledger.records) || [])
    .filter((r) => !r.deletedAt && (r.date || '').slice(0, 10) === key)
  return { key, tasks, recs }
})
// 当日议程按类型分流：任务（category !== 'todo'）与 Todo 用不同标记展示
const dayTasks = computed(() => dayData.value.tasks.filter((t) => t.category !== 'todo'))
const dayTodos = computed(() => dayData.value.tasks.filter((t) => t.category === 'todo'))

// ---------- 卡片内交互（全部 @pointerdown.stop，绝不触发画布拖拽） ----------
const newTodo = ref('')
function addTodo() {
  const title = newTodo.value.trim()
  if (!title) return
  // 状态必须落在 TASK_STATUS 合法集合内（planning/active/paused/done）——
  // 早前误用 'todo' 会被 addTask 静默降级为 'planning'，与 updateTask 的非法状态被丢弃形成死循环。
  store.addTask({ title, status: 'active', category: 'todo', dueDate: todayStr() })
  newTodo.value = ''
}
function toggleTodo(t) {
  // 取消完成 ⇒ 回到 'active'（合法状态）；同时把进度归零，避免残留 100%
  const next = t.status === 'done' ? 'active' : 'done'
  store.updateTask(t.id, { status: next, progress: next === 'done' ? 100 : 0 })
}
function delTodo(t) { store.deleteTask(t.id) }
function delMemo(m) { store.deleteMemo(m.id) }
function delPhoto(p) { store.deletePhoto(p.id) }
function delLedger(r) { store.deleteLedgerRecord(r.id) }

// ---------- 背包统计 ----------
const bag = computed(() => {
  const list = store.live.items
  const cats = {}
  list.forEach((i) => { const c = i.category || '未分类'; cats[c] = (cats[c] || 0) + 1 })
  const top = Object.keys(cats).map((k) => ({ name: k, n: cats[k] })).sort((a, b) => b.n - a.n).slice(0, 5)
  const max = Math.max(1, ...top.map((t) => t.n))
  const recent = list.slice(-1)[0]
  const topOne = top[0]
  return {
    total: list.length, cats: top, max, recent: recent ? recent.name : '',
    topName: topOne ? topOne.name : '—',
    topPct: topOne && list.length ? Math.round(topOne.n / list.length * 100) : 0
  }
})

// ---------- 笔记：小 = 列表 / 中 = 列表 + 摘要 / 大 = 单篇分页阅读 ----------
const notes = computed(() => {
  const list = store.live.memos.slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))
  return { total: list.length, list }
})
const notePage = ref(0)
watch(() => notes.value.total, (n) => { if (notePage.value >= n) notePage.value = Math.max(0, n - 1) })
const currentNote = computed(() => notes.value.list[notePage.value] || null)
// 窄而高的卡片（默认 264×444）纵向空间足够 → 多列几篇；矮卡少列，避免挤压
// P1：字号上调后小卡减少条目，避免靠缩字塞内容
const noteRows = computed(() => notes.value.list.slice(0, sizeClass.value === 'sz-xs' ? 2 : (isShort.value ? 3 : 8)))
function notePrev() { notePage.value = Math.max(0, notePage.value - 1) }
function noteNext() { notePage.value = Math.min(notes.value.total - 1, notePage.value + 1) }
const showReader = computed(() => sizeClass.value === 'sz-lg' && !isShort.value)
function plain(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// 笔记浮层编辑器（画布内浮层，不跳转 /notes）
const memoSheet = reactive({ open: false, id: '', title: '', html: '' })
const memoEditEl = ref(null)
function openMemoEditor(m) {
  memoSheet.id = m ? m.id : ''
  memoSheet.title = m ? (m.title || '') : ''
  memoSheet.html = m ? (m.markdown || '') : ''
  memoSheet.open = true
  nextTick(() => fillMemoEditor())
}
// 浮层挂载有动画延迟，编辑器节点可能下一拍才存在 —— 做短轮询兜底（最多 6 次）
function fillMemoEditor(attempt = 0) {
  if (!memoSheet.open) return
  const el = memoEditEl.value
  if (el) { el.innerHTML = memoSheet.html; return }
  if (attempt < 6) setTimeout(() => fillMemoEditor(attempt + 1), 40)
}
function saveMemoEditor() {
  const html = memoEditEl.value ? memoEditEl.value.innerHTML : memoSheet.html
  const title = memoSheet.title.trim() || '无标题'
  const blank = !plain(html) && !memoSheet.title.trim()
  if (blank) { memoSheet.open = false; return }
  if (memoSheet.id) store.updateMemo(memoSheet.id, { title, markdown: html })
  else store.addMemo({ title, markdown: html })
  memoSheet.open = false
  notePage.value = 0
}
function editCurrentNote() { if (currentNote.value) openMemoEditor(currentNote.value) }

// ---------- 相册：瀑布流 + 大图查看 ----------
const albumAll = computed(() => store.live.photos.slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1)))
const album = computed(() => ({ total: albumAll.value.length, shots: albumAll.value }))
const photoView = reactive({ open: false, index: 0 })
const photoNow = computed(() => albumAll.value[photoView.index] || null)
function openPhoto(p) {
  const i = albumAll.value.findIndex((x) => x.id === p.id)
  photoView.index = i >= 0 ? i : 0
  photoView.open = true
}
function photoPrev() { if (albumAll.value.length) photoView.index = (photoView.index - 1 + albumAll.value.length) % albumAll.value.length }
function photoNext() { if (albumAll.value.length) photoView.index = (photoView.index + 1) % albumAll.value.length }

// ---------- 足迹地图 ----------
const map = computed(() => {
  const list = store.live.locations
  const recent = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  // 瓦片地图点位：真实经纬度（最多 200 个，超出交由空间索引裁剪）
  const ptsFull = list.slice(-200).map((l) => ({ id: l.id, name: l.name, lng: l.lng, lat: l.lat }))
  return { total: list.length, ptsFull, recent: recent ? recent.name + ' · ' + recent.date : '' }
})
// 深色主题（瓦片占位色 / 标注底色跟随）
const isDark = ref(false)
let themeMO = null
// 地图交互：地图区始终可拖动 / 缩放；卡片边框（.pn-map 外侧留边）仍归卡片，用来整卡移动
const mapZoom = ref(1)
function onMapZoom(e) { mapZoom.value = Math.min(2.4, Math.max(1, Number(e.target.value) || 1)) }
function onMapZoomIn() { mapZoom.value = Math.min(2.4, Math.round((mapZoom.value + 0.1) * 10) / 10) }
function onMapZoomOut() { mapZoom.value = Math.max(1, Math.round((mapZoom.value - 0.1) * 10) / 10) }

// ---------- Steam 游戏库 ----------
const steam = computed(() => {
  const list = steamGames.value || []
  const hours = list.reduce((s, g) => s + (g.playtimeHours || 0), 0)
  const top = list.slice().sort((a, b) => (b.playtimeHours || 0) - (a.playtimeHours || 0)).slice(0, 5)
  return { total: steamTotal.value || list.length, hours: Math.round(hours), top }
})

// ---------- 成就展示 ----------
const ach = computed(() => {
  const total = ACHIEVEMENTS.length
  const got = store.data.achievements || []
  const recent = got.slice(-5).reverse().map((a) => {
    const d = ACHIEVEMENTS.find((x) => x.key === a.key)
    return d ? d.title : a.key
  })
  return { got: got.length, total, recent, pct: total ? got.length / total : 0 }
})

// ---------- 天气（Open-Meteo 免 key + 浏览器定位，30 分钟缓存） ----------
// 数据源：https://api.open-meteo.com/v1/forecast ；定位失败回退上次坐标 / 北京；
// 反查城市名走 BigDataCloud 免费接口，失败只显示「当前位置」，不影响天气数据。
const WMO = {
  0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '冻雾',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴伴冰雹'
}
const WEATHER_KEY = 'eo:weather:v2'
const WEATHER_TTL = 30 * 60 * 1000
const DEFAULT_POS = { lat: 39.9042, lon: 116.4074, city: '北京（默认）' }
const wx = reactive({
  state: 'idle', temp: null, code: 0, city: '', days: [], hourly: [], at: 0, err: '', locating: false,
  humidity: null, wind: null, apparent: null, windDir: null, pressure: null, precip: null,
  sunrise: '', sunset: '', lat: null, lon: null, aqi: null
})
const wxSheet = reactive({ open: false })

function readWxCache() {
  try {
    const raw = localStorage.getItem(WEATHER_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    return o && typeof o.at === 'number' ? o : null
  } catch (e) { return null }
}
function applyWx(o) {
  wx.state = 'ok'
  wx.temp = o.temp
  wx.code = o.code
  wx.city = o.city || '当前位置'
  wx.days = o.days || []
  wx.hourly = o.hourly || []
  wx.humidity = typeof o.humidity === 'number' ? o.humidity : null
  wx.wind = typeof o.wind === 'number' ? o.wind : null
  wx.apparent = typeof o.apparent === 'number' ? o.apparent : null
  wx.windDir = typeof o.windDir === 'number' ? o.windDir : null
  wx.pressure = typeof o.pressure === 'number' ? o.pressure : null
  wx.precip = typeof o.precip === 'number' ? o.precip : null
  wx.sunrise = o.sunrise || ''
  wx.sunset = o.sunset || ''
  wx.aqi = typeof o.aqi === 'number' ? o.aqi : null
  wx.at = o.at || Date.now()
  wx.err = ''
}
function wxDesc(code) {
  return WMO[code] || (code >= 95 ? '雷雨' : '多云')
}
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return }
    let done = false
    const fin = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => fin({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => fin(null),
        { timeout: 8000, maximumAge: 10 * 60 * 1000 }
      )
    } catch (e) { fin(null) }
    setTimeout(() => fin(null), 9000)
  })
}
async function reverseCity(lat, lon) {
  try {
    const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=zh')
    if (!r.ok) return ''
    const j = await r.json()
    return j.city || j.locality || j.principalSubdivision || ''
  } catch (e) { return '' }
}
let wxBusy = false
// ---------- 3.0 手动城市：优先级 手动 > 定位 > 上次缓存 > 北京 ----------
const WX_CITY_KEY = 'eo:weather:city:v1'
function readManualCity() {
  try {
    const o = JSON.parse(localStorage.getItem(WX_CITY_KEY) || 'null')
    if (o && o.name && Number.isFinite(o.lat) && Number.isFinite(o.lon)) return o
  } catch (e) {}
  return null
}
const manualCity = ref(readManualCity())
function writeManualCity(v) {
  manualCity.value = v
  try {
    if (v) localStorage.setItem(WX_CITY_KEY, JSON.stringify(v))
    else localStorage.removeItem(WX_CITY_KEY)
  } catch (e) {}
}
const citySearch = reactive({ open: false, q: '', loading: false, results: [], err: '' })
async function searchCity() {
  const q = citySearch.q.trim()
  if (!q) return
  citySearch.loading = true
  citySearch.err = ''
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=zh&format=json')
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    citySearch.results = (j.results || []).map((x) => ({
      name: x.name,
      admin: x.admin1 || '',
      country: x.country || '',
      lat: x.latitude,
      lon: x.longitude
    }))
    if (!citySearch.results.length) citySearch.err = '没有找到「' + q + '」，换个写法试试'
  } catch (e) {
    citySearch.err = '搜索失败（网络不可用）'
  } finally {
    citySearch.loading = false
  }
}
function pickCity(c) {
  writeManualCity({ name: c.name, lat: c.lat, lon: c.lon })
  citySearch.open = false
  citySearch.results = []
  citySearch.q = ''
  loadWeather(true)
}
function useAutoCity() {
  writeManualCity(null)
  citySearch.open = false
  loadWeather(true)
}
async function loadWeather(force = false) {
  const manual = manualCity.value
  // 手动城市优先：缓存命中且城市一致时直接用缓存
  const cached = readWxCache()
  if (!force && cached && Date.now() - cached.at < WEATHER_TTL && (!manual || cached.city === manual.name)) {
    applyWx(cached); return
  }
  if (wxBusy) return
  wxBusy = true
  wx.state = 'loading'
  const pos = manual ? null : await getPosition()
  const spot = manual || pos || (cached ? { lat: cached.lat, lon: cached.lon } : null) || DEFAULT_POS
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum'
      + '&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=7'
    const aqUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + spot.lat + '&longitude=' + spot.lon
      + '&current=us_aqi&timezone=auto'
    // 天气与空气质量并行请求：AQI 失败不影响天气主流程
    const [r, aqRes] = await Promise.all([fetch(url), fetch(aqUrl).catch(() => null)])
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    let aqi = null
    if (aqRes && aqRes.ok) {
      try {
        const aq = await aqRes.json()
        const v = aq && aq.current && aq.current.us_aqi
        if (Number.isFinite(v)) aqi = Math.round(v)
      } catch (e) { /* AQI 解析失败时留空 */ }
    }
    const cur = j.current || {}
    const daily = j.daily || {}
    const WDF = ['日', '一', '二', '三', '四', '五', '六']
    const days = (daily.time || []).slice(0, 7).map((t, i) => ({
      k: i === 0 ? '今天' : (i === 1 ? '明天' : '周' + WDF[new Date(t + 'T00:00:00').getDay()]),
      date: t.slice(5).replace('-', '/'),
      code: (daily.weather_code || [])[i],
      hi: Math.round((daily.temperature_2m_max || [])[i]),
      lo: Math.round((daily.temperature_2m_min || [])[i])
    }))
    // 逐小时：从当前时刻起 12 个点
    const hourly = j.hourly || {}
    const ht = hourly.time || []
    let start = ht.findIndex((t) => String(t) >= String(cur.time || ''))
    if (start < 0) start = 0
    const hourlyList = ht.slice(start, start + 12).map((t, i) => ({
      h: String(t).slice(11, 16),
      code: (hourly.weather_code || [])[start + i],
      temp: Math.round((hourly.temperature_2m || [])[start + i])
    }))
    let city = manual ? manual.name : (pos ? await reverseCity(spot.lat, spot.lon) : (cached && cached.city) || DEFAULT_POS.city)
    if (!city) city = '当前位置'
    const payload = {
      at: Date.now(), temp: Math.round(cur.temperature_2m), code: cur.weather_code,
      humidity: Number.isFinite(cur.relative_humidity_2m) ? Math.round(cur.relative_humidity_2m) : null,
      wind: Number.isFinite(cur.wind_speed_10m) ? Math.round(cur.wind_speed_10m) : null,
      apparent: Number.isFinite(cur.apparent_temperature) ? Math.round(cur.apparent_temperature) : null,
      windDir: Number.isFinite(cur.wind_direction_10m) ? Math.round(cur.wind_direction_10m) : null,
      pressure: Number.isFinite(cur.surface_pressure) ? Math.round(cur.surface_pressure) : null,
      precip: Number.isFinite((daily.precipitation_sum || [])[0]) ? (daily.precipitation_sum || [])[0] : null,
      sunrise: String((daily.sunrise || [])[0] || '').slice(11, 16),
      sunset: String((daily.sunset || [])[0] || '').slice(11, 16),
      city, days, hourly: hourlyList, lat: spot.lat, lon: spot.lon, manual: !!manual, aqi
    }
    applyWx(payload)
    try { localStorage.setItem(WEATHER_KEY, JSON.stringify(payload)) } catch (e) { /* 隐私模式忽略 */ }
  } catch (e) {
    if (cached) applyWx(cached)
    else { wx.state = 'err'; wx.err = '天气获取失败（网络或定位不可用）' }
  } finally {
    wxBusy = false
  }
}
const wxFetched = computed(() => {
  if (!wx.at) return ''
  const m = Math.round((Date.now() - wx.at) / 60000)
  return m < 1 ? '刚刚更新' : (m < 60 ? m + ' 分钟前更新' : '已超过 1 小时')
})
// 天气图形分类（内联 SVG 只画一套，按类别切换）
function wxCat(code) {
  const c = Number(code) || 0
  if (c <= 1) return 'sun'
  if (c === 2) return 'partly'
  if (c === 3) return 'cloud'
  if (c === 45 || c === 48) return 'fog'
  if (c >= 51 && c <= 67) return 'rain'
  if (c >= 71 && c <= 77) return 'snow'
  if (c >= 80 && c <= 82) return 'rain'
  if (c >= 85 && c <= 86) return 'snow'
  return 'thunder'
}
const wxIconId = (code) => 'wx-' + wxCat(code)
const windLevel = computed(() => {
  const v = Number(wx.wind) || 0
  return v < 1 ? 0 : v < 6 ? 1 : v < 12 ? 2 : v < 20 ? 3 : v < 29 ? 4 : v < 39 ? 5 : 6
})
const windDirName = computed(() => {
  const d = Number(wx.windDir)
  if (!Number.isFinite(d)) return '微风'
  return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round((((d % 360) + 360) % 360) / 45) % 8] + '风'
})
const wxTip = computed(() => {
  const c = Number(wx.code) || 0
  if (c >= 61 && c <= 67) return '有降水，出门记得带伞'
  if (c >= 80) return '阵雨概率较高，注意天气变化'
  if (c === 45 || c === 48) return '有雾，出行注意能见度'
  if (c === 3) return '云层较厚，体感偏凉'
  if (c <= 1) return '天气不错，适合出门走走'
  return '今天天气平稳，注意早晚温差'
})
const wxHourLine = computed(() => {
  const list = wx.hourly || []
  const ts = list.map((h) => Number(h.temp) || 0)
  const lo = ts.length ? Math.min(...ts) : 0
  const hi = ts.length ? Math.max(...ts) : 0
  const span = Math.max(1, hi - lo)
  return list.map((h, i) => {
    const x = 4 + (list.length > 1 ? i * 92 / (list.length - 1) : 46)
    const y = 34 - ((Number(h.temp) - lo) / span) * 22
    return x.toFixed(1) + ',' + y.toFixed(1)
  }).join(' ')
})
// ---------- 正面 5 日高低温曲线（沿用卡片现有冷暖色） ----------
const wxTrendDays = computed(() => (wx.days || []).slice(0, 5))
const wxTrend = computed(() => {
  const days = wxTrendDays.value
  const empty = { hi: '', lo: '' }
  if (!days.length) return empty
  const vals = days.flatMap((d) => [d.hi, d.lo]).filter((v) => Number.isFinite(v))
  if (!vals.length) return empty
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = Math.max(1, hi - lo)
  const step = days.length > 1 ? 88 / (days.length - 1) : 0
  const yOf = (v) => 30 - ((v - lo) / span) * 24
  const pts = (key) => days.map((d, i) => (6 + i * step).toFixed(1) + ',' + yOf(d[key]).toFixed(1)).join(' ')
  return { hi: pts('hi'), lo: pts('lo') }
})
const wxAqiLabel = computed(() => {
  if (wx.aqi === null) return '--'
  const v = Number(wx.aqi)
  const lv = v <= 50 ? '优' : v <= 100 ? '良' : v <= 150 ? '轻度' : v <= 200 ? '中度' : v <= 300 ? '重度' : '严重'
  return v + ' · ' + lv
})
const wxStamp = computed(() => {
  if (!wx.at) return ''
  const d = new Date(wx.at)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
})
function openWxSheet() { if (wx.state === 'ok') wxSheet.open = true }

// ---------- 日历：迷你月历 + 当日议程（2026-11-04 重做） ----------
const WD = ['一', '二', '三', '四', '五', '六', '日']
const calCursor = ref(new Date())
const calYear = computed(() => calCursor.value.getFullYear())
const calMonth = computed(() => calCursor.value.getMonth())
const calView = ref('month') // 'month' | 'week'
function calNav(dir) {
  const c = calCursor.value
  if (calView.value === 'week') calCursor.value = new Date(c.getFullYear(), c.getMonth(), c.getDate() + dir * 7)
  else calCursor.value = new Date(c.getFullYear(), c.getMonth() + dir, 1)
}
function setCalView(v) { calView.value = v }
const calTitle = computed(() => {
  if (calView.value === 'week') {
    const c = calCursor.value
    const off = (c.getDay() + 6) % 7
    const mon = new Date(c.getFullYear(), c.getMonth(), c.getDate() - off)
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
    const f = (d) => (d.getMonth() + 1) + '/' + d.getDate()
    return f(mon) + ' – ' + f(sun)
  }
  return calYear.value + ' 年 ' + (calMonth.value + 1) + ' 月'
})
// 参考图：大号「YYYY/M/D 周X」标题
const calHeadText = computed(() => {
  if (calView.value === 'week') return calTitle.value
  const k = selectedDay.value || todayKey.value
  const p = k.split('-').map(Number)
  const dt = new Date(p[0], p[1] - 1, p[2])
  return p[0] + '/' + p[1] + '/' + p[2] + ' 周' + WD[(dt.getDay() + 6) % 7]
})
// 农历日（浏览器 ICU 中文历；不可用时静默隐藏）
let lunarFmt = null
function lunarOf(key) {
  if (!key) return ''
  try {
    if (!lunarFmt) lunarFmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { day: 'numeric' })
    return String(lunarFmt.format(new Date(key + 'T12:00:00'))).replace(/日$/, '')
  } catch (e) { return '' }
}
const showLunar = computed(() => sizeClass.value === 'sz-lg' && !isShort.value)
// 固定节日表（节气不在此列）
const FESTS = [
  { m: 1, d: 1, n: '元旦' }, { m: 2, d: 14, n: '情人节' }, { m: 3, d: 8, n: '妇女节' },
  { m: 3, d: 12, n: '植树节' }, { m: 5, d: 1, n: '劳动节' }, { m: 5, d: 4, n: '青年节' },
  { m: 6, d: 1, n: '儿童节' }, { m: 7, d: 1, n: '建党节' }, { m: 8, d: 1, n: '建军节' },
  { m: 9, d: 10, n: '教师节' }, { m: 10, d: 1, n: '国庆节' }, { m: 12, d: 24, n: '平安夜' },
  { m: 12, d: 25, n: '圣诞节' }
]
const calFests = computed(() => {
  const m = calMonth.value + 1
  return FESTS.filter((f) => f.m === m).sort((a, b) => a.d - b.d).slice(0, 4)
})
// 按日期聚合任务（分类色点 / 周视图任务名）
const calAgg = computed(() => {
  const map = {}
  ;(store.live.tasks || []).forEach((t) => {
    if (!t.dueDate) return
    const k = t.dueDate.slice(0, 10)
    ;(map[k] || (map[k] = [])).push(t)
  })
  return map
})
const calCatMap = computed(() => buildCatColorMap(store.live.tasks))
// 月视图 42 格（周一起始）/ 周视图 7 列
const calCells = computed(() => {
  const y = calCursor.value.getFullYear()
  const m = calCursor.value.getMonth()
  let start
  if (calView.value === 'week') {
    const c = calCursor.value
    const off = (c.getDay() + 6) % 7
    start = new Date(c.getFullYear(), c.getMonth(), c.getDate() - off)
  } else {
    const first = new Date(y, m, 1)
    const off = (first.getDay() + 6) % 7
    start = new Date(y, m, 1 - off)
  }
  const count = calView.value === 'week' ? 7 : 42
  const out = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = fmtKey(d)
    const items = calAgg.value[key] || []
    const cats = []
    items.forEach((t) => { const c = t.category || 'task'; if (!cats.includes(c)) cats.push(c) })
    out.push({
      key,
      dom: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: key === todayKey.value,
      isSel: key === selectedDay.value,
      cats: cats.slice(0, 3),
      items: items.slice(0, calView.value === 'week' ? 3 : 0).map((t) => ({ id: t.id, title: t.title || '(无标题)', category: t.category || 'task', done: t.status === 'done' }))
    })
  }
  return out
})
function onPickDay(key) {
  if (!key) return
  selectedDay.value = key
  // 点到非本月格：顺手跳到对应月份（周视图不跳）
  if (calView.value === 'month') {
    const p = key.split('-').map(Number)
    if (p[0] !== calYear.value || p[1] - 1 !== calMonth.value) calCursor.value = new Date(p[0], p[1] - 1, 1)
  }
}
// ---------- 3.0 任务拖拽改期（拖到日历某天即改 dueDate） ----------
// 用 pointer 实现而非 HTML5 DnD：移动端 PWA 触屏同样可用，且不会与画布拖拽/长按冲突。
const dayDrag = reactive({ active: false, title: '', x: 0, y: 0, over: '' })
let dayPress = null
function startTaskDrag(e, t) {
  if (!t || !t.id) return
  if (e.button !== undefined && e.button > 0) return
  dayPress = { id: t.id, title: t.title || '(无标题)', x: e.clientX, y: e.clientY }
  dayDrag.title = dayPress.title
  window.addEventListener('pointermove', onTaskDragMove)
  window.addEventListener('pointerup', onTaskDragEnd, { once: true })
  window.addEventListener('pointercancel', onTaskDragEnd, { once: true })
}
function onTaskDragMove(e) {
  if (!dayPress) return
  if (!dayDrag.active && Math.abs(e.clientX - dayPress.x) + Math.abs(e.clientY - dayPress.y) < 8) return
  dayDrag.active = true
  dayDrag.x = e.clientX
  dayDrag.y = e.clientY
  let el = null
  try { el = document.elementFromPoint(e.clientX, e.clientY) } catch (err) {}
  const cell = el && el.closest ? el.closest('[data-day]') : null
  dayDrag.over = cell ? cell.getAttribute('data-day') : ''
}
function onTaskDragEnd() {
  window.removeEventListener('pointermove', onTaskDragMove)
  const target = dayDrag.over
  const id = dayPress && dayPress.id
  const moved = dayDrag.active
  Object.assign(dayDrag, { active: false, title: '', x: 0, y: 0, over: '' })
  dayPress = null
  if (!moved || !id) return
  if (!target) return
  const t = (store.data.tasks || []).find((x) => x.id === id)
  if (!t) return
  if ((t.dueDate || '').slice(0, 10) === target) return
  const r = store.updateTask(id, { dueDate: target })
  if (r && r.ok === false) { store.showToast(r.error || '改期失败'); return }
  selectedDay.value = target
  store.showToast('已改期到 ' + target)
}
function gotoToday() {
  calCursor.value = new Date()
  selectedDay.value = todayStr()
}
const showAgenda = computed(() => sizeClass.value === 'sz-lg' && !isShort.value)

// 加任务浮层（浮层、不跳转）
const taskSheet = reactive({ open: false, title: '', date: '', time: '' })
function openTaskSheet() {
  taskSheet.title = ''
  taskSheet.date = selectedDay.value || todayStr()
  taskSheet.time = ''
  taskSheet.open = true
}
function saveTask() {
  const title = taskSheet.title.trim()
  if (!title) return
  const date = /^\d{4}-\d{2}-\d{2}$/.test(taskSheet.date) ? taskSheet.date : todayStr()
  store.addTask({ title, status: 'active', category: 'todo', dueDate: date, dueTime: taskSheet.time })
  const p = date.split('-').map(Number)
  calCursor.value = new Date(p[0], p[1] - 1, p[2])
  selectedDay.value = date
  taskSheet.open = false
}

// ---------- 待办：按时间分组 ----------
const todo = computed(() => {
  const list = store.live.tasks.filter((t) => t.category === 'todo')
  const today = todayStr()
  const g = { today: [], week: [], later: [], none: [], done: [] }
  list.forEach((t) => {
    if (t.status === 'done') { g.done.push(t); return }
    const d = (t.dueDate || '').slice(0, 10)
    if (!d) { g.none.push(t); return }
    const diff = Math.round((new Date(d + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
    if (diff <= 0) g.today.push(t)
    else if (diff <= 7) g.week.push(t)
    else g.later.push(t)
  })
  ;['today', 'week', 'later', 'none', 'done'].forEach((k) => {
    g[k].sort((a, b) => ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1))
  })
  const groups = [
    { key: 'today', label: '今天 / 逾期', items: g.today },
    { key: 'week', label: '近 7 天', items: g.week },
    { key: 'later', label: '以后', items: g.later },
    { key: 'none', label: '无日期', items: g.none },
    { key: 'done', label: '已完成', items: g.done }
  ].filter((x) => x.items.length)
  const open = g.today.length + g.week.length + g.later.length + g.none.length
  const done = g.done.length
  return {
    total: open, groups,
    done,
    all: open + done,
    pct: (open + done) ? Math.round(done / (open + done) * 100) : 0
  }
})

// ---------- 任务面板（日常任务 / 支线，category !== 'todo'） ----------
const newTask = ref('')
const taskPanel = computed(() => {
  const all = store.live.tasks.filter((t) => t.category !== 'todo')
  const open = all.filter((t) => t.status !== 'done')
    .sort((a, b) => ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1))
  const done = all.filter((t) => t.status === 'done')
  const max = sizeClass.value === 'sz-xs' ? 3 : (isShort.value ? 4 : (sizeClass.value === 'sz-lg' ? 10 : 7))
  return { total: all.length, openCount: open.length, items: open.concat(done).slice(0, max), more: Math.max(0, all.length - max) }
})
function addTaskQuick() {
  const title = newTask.value.trim()
  if (!title) return
  store.addTask({ title, status: 'active', category: 'side' })
  newTask.value = ''
}
function taskDue(t) {
  if (!t.dueDate) return ''
  return t.dueDate.slice(5) + (t.dueTime ? ' ' + t.dueTime : '')
}
const taskStatusLabel = (s) => ({ planning: '规划', active: '进行', paused: '搁置', done: '完成' })[s] || s

// ---------- 记账 ----------
// 参考图：消费记录 + 周/月/年 tab（卡内仅外观）+ 本月/今日金额 + 分类胶囊 + 7 日折线 + 明细浮层
const LED_COLORS = ['#B4796C', '#C4A468', '#8DA383', '#7C90A9', '#9285AC', '#BC939A', '#9C8E7A']
const LED_TABS = [{ k: 'week', label: '周' }, { k: 'month', label: '月' }, { k: 'year', label: '年' }]
const ledTab = ref('week')
const ledCat = ref('')
const ledSheet = reactive({ open: false })
const money = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2)
const ledTick = (v) => (Number(v) >= 10 ? Math.round(Number(v)) : Math.round(Number(v) * 10) / 10)
const ledColor = (name) => {
  let h = 0
  for (let i = 0; i < String(name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return LED_COLORS[h % LED_COLORS.length]
}
const ledger = computed(() => {
  const list = ((store.data.ledger && store.data.ledger.records) || []).slice().sort((a, b) => ((b.date || '') < (a.date || '') ? -1 : 1))
  const todayKey = todayStr()
  const monthKey = todayKey.slice(0, 7)
  const monthRecs = list.filter((r) => (r.date || '').slice(0, 7) === monthKey)
  const sumBy = (arr, type) => arr.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0)
  const monthExpense = Math.round(sumBy(monthRecs, 'expense') * 100) / 100
  const monthIncome = Math.round(sumBy(monthRecs, 'income') * 100) / 100
  const todayExpense = Math.round(sumBy(list.filter((r) => r.type === 'expense' && (r.date || '').slice(0, 10) === todayKey), 'expense') * 100) / 100
  // 分类占比（本月支出）
  const byCat = {}
  monthRecs.filter((r) => r.type === 'expense').forEach((r) => {
    const k = r.category || '其他'
    byCat[k] = (byCat[k] || 0) + r.amount
  })
  const catAll = Object.keys(byCat).map((k) => ({ name: k, v: byCat[k], color: ledColor(k) })).sort((a, b) => b.v - a.v)
  const catTotal = catAll.reduce((s, c) => s + c.v, 0) || 1
  // 环形图分段（最多 5 段，其余归入「其他」）
  const top = catAll.slice(0, 5)
  const rest = catAll.slice(5).reduce((s, c) => s + c.v, 0)
  if (rest > 0) top.push({ name: '其他', v: rest, color: '#B9B5AE' })
  let acc = 0
  const C = 2 * Math.PI * 15
  const segs = top.map((c) => {
    const frac = c.v / catTotal
    const seg = { name: c.name, color: c.color, pct: Math.round(frac * 100), dasharray: (frac * C) + ' ' + C, dashoffset: -acc * C }
    acc += frac
    return seg
  })
  // 近 7 天支出趋势
  const days = []
  const WD = ['日', '一', '二', '三', '四', '五', '六']
  for (let i = 6; i >= 0; i--) {
    const dt = new Date()
    dt.setDate(dt.getDate() - i)
    const key = fmtKey(dt)
    const v = list.filter((r) => r.type === 'expense' && (r.date || '').slice(0, 10) === key).reduce((s, r) => s + r.amount, 0)
    days.push({ key, label: (dt.getMonth() + 1) + '/' + dt.getDate(), today: i === 0, v })
  }
  const weekMax = Math.max(1, ...days.map((d) => d.v))
  const max = sizeClass.value === 'sz-xs' ? 2 : (isShort.value ? 3 : (sizeClass.value === 'sz-sm' ? 4 : 6))
  // 折线坐标（viewBox 100×40，左右留 4）
  const pts = days.map((d, i) => ({ x: 4 + i * (92 / 6), y: 34 - (d.v / weekMax) * 28 }))
  const linePts = pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
  // 明细浮层：周/月/年 + 分类过滤，按日期分组
  const nowD = new Date()
  const weekStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - ((nowD.getDay() + 6) % 7))
  const inPeriod = (r) => {
    const d = String(r.date || '').slice(0, 10)
    if (ledTab.value === 'week') return d >= fmtKey(weekStart)
    if (ledTab.value === 'month') return d.slice(0, 7) === todayKey.slice(0, 7)
    return d.slice(0, 4) === todayKey.slice(0, 4)
  }
  const alive = list.filter((r) => !r.deletedAt)
  const sheetList = alive.filter((r) => inPeriod(r) && (!ledCat.value || (r.category || '其他') === ledCat.value))
  const groups = []
  let sheetExpense = 0
  let sheetIncome = 0
  sheetList.forEach((r) => {
    const k = String(r.date || '').slice(0, 10)
    let g = groups.find((x) => x.k === k)
    if (!g) { g = { k, items: [], expense: 0, income: 0 }; groups.push(g) }
    g.items.push(r)
    if (r.type === 'income') { g.income += r.amount; sheetIncome += r.amount }
    else { g.expense += r.amount; sheetExpense += r.amount }
  })
  const filteredRecent = alive.filter((r) => (!ledCat.value || (r.category || '其他') === ledCat.value)).slice(0, max)
  const yTicks = [weekMax, weekMax / 2, 0]
  return {
    recent: list.slice(0, max), filteredRecent, monthExpense, monthIncome, todayExpense,
    balance: Math.round((monthIncome - monthExpense) * 100) / 100,
    cats: catAll, catTotal, segs, days, weekMax, yTicks, linePts, dots: pts,
    sheetGroups: groups, sheetTotal: sheetList.length, sheetExpense, sheetIncome, sheetTab: ledTab.value, sheetCat: ledCat.value,
    total: list.length,
    max
  }
})
const newLedger = ref({ amount: '', category: '' })
const ledgerType = ref('expense')
function toggleLedgerType() { ledgerType.value = ledgerType.value === 'expense' ? 'income' : 'expense'; newLedger.value.category = '' }
const ledgerCats = computed(() => {
  const lg = store.data.ledger || {}
  return ledgerType.value === 'income' ? (lg.incomeCategories || []) : (lg.expenseCategories || [])
})
function addLedger() {
  const amount = Number(newLedger.value.amount)
  if (!isFinite(amount) || amount <= 0) return
  store.addLedgerRecord({ type: ledgerType.value, amount, category: newLedger.value.category || '其他', note: '', date: todayStr() })
  newLedger.value.amount = ''
}

// ---------- 3.0 记账 ↔ 任务：明细里可关联已有任务或就地新建任务 ----------
const linkPick = reactive({ open: false, recId: '', q: '' })
const linkTaskList = computed(() => {
  const q = linkPick.q.trim()
  const list = (store.data.tasks || []).filter((t) => !t.deletedAt && t.status !== 'done')
  return (q ? list.filter((t) => (t.title || '').indexOf(q) >= 0) : list).slice(0, 8)
})
function taskOf(id) { return id ? (store.data.tasks || []).find((x) => x.id === id) : null }
function openLinkPick(r) { linkPick.open = true; linkPick.recId = r.id; linkPick.q = '' }
function closeLinkPick() { linkPick.open = false; linkPick.recId = ''; linkPick.q = '' }
function linkRecToTask(r, t) {
  store.updateLedgerRecord(r.id, { taskId: t.id })
  store.addBiLink({ sourceType: 'ledger', sourceId: r.id, targetType: 'task', targetId: t.id })
  closeLinkPick()
  store.showToast('已关联任务「' + (t.title || '') + '」')
}
function unlinkRec(r) {
  store.updateLedgerRecord(r.id, { taskId: '' })
  const b = (store.data.biLinks || []).find((x) => !x.deletedAt && x.sourceType === 'ledger' && x.sourceId === r.id && x.targetType === 'task')
  if (b) store.deleteBiLink(b.id)
  store.showToast('已解除任务关联')
}
function newTaskForRec(r) {
  const title = (r.note || r.category || '消费') + ' ¥' + money(r.amount)
  const res = store.addTask({ title, status: 'active', category: 'todo', dueDate: r.date || todayStr() })
  if (res && res.task) linkRecToTask(r, res.task)
  else store.showToast('新建任务失败')
}
function toggleRecTask(r) {
  const t = taskOf(r.taskId)
  if (!t) return
  const done = t.status === 'done'
  store.updateTask(t.id, { status: done ? 'active' : 'done', progress: done ? 0 : 100 })
}

// ---------- 收藏面板（可在面板内直接新建收藏） ----------
const collectionPanel = computed(() => {
  const list = store.live.collections.slice().sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))
  const max = sizeClass.value === 'sz-xs' ? 2 : (isShort.value ? 3 : (sizeClass.value === 'sz-lg' ? 9 : 6))
  return { total: list.length, items: list.slice(0, max), more: Math.max(0, list.length - max) }
})
const newCollection = reactive({ title: '', url: '' })
function addCollectionQuick() {
  const title = newCollection.title.trim()
  if (!title) return
  const url = newCollection.url.trim()
  if (url && !/^https?:\/\//i.test(url)) { store.showToast('链接需以 http(s):// 开头'); return }
  const r = store.addCollection({ title, content: '', category: '收藏', url })
  if (r && r.ok === false) { store.showToast(r.error || '收藏失败'); return }
  newCollection.title = ''
  newCollection.url = ''
  store.showToast('已添加到收藏')
}
function openCollection(c) {
  if (!c || !c.url) return
  try { window.open(c.url, '_blank', 'noopener') } catch (e) { /* 弹窗被拦截时忽略 */ }
}

// ---------- 数据可视化面板：六宫格指标 + 近 7 天活跃 ----------
const statTiles = computed(() => {
  const tasks = store.live.tasks
  const done = tasks.filter((t) => t.status === 'done').length
  return [
    { key: 'task', label: '任务', value: tasks.length, sub: done + ' 已完成' },
    { key: 'memo', label: '笔记', value: store.live.memos.length, sub: '条记录' },
    { key: 'item', label: '物品/收藏', value: store.live.items.length + store.live.collections.length, sub: store.live.collections.length + ' 收藏' },
    { key: 'photo', label: '照片', value: store.live.photos.length, sub: '张回忆' },
    { key: 'loc', label: '足迹', value: store.live.locations.length, sub: '个地点' },
    { key: 'ach', label: '成就', value: (store.data.achievements || []).length, sub: '项已解锁' }
  ]
})
const statDays = computed(() => {
  const recs = (store.data.ledger && store.data.ledger.records) || []
  const out = []
  const WD2 = ['日', '一', '二', '三', '四', '五', '六']
  for (let i = 6; i >= 0; i--) {
    const dt = new Date()
    dt.setDate(dt.getDate() - i)
    const key = fmtKey(dt)
    let n = 0
    store.live.tasks.forEach((t) => { if (t.status === 'done' && (t.doneAt || '').slice(0, 10) === key) n++ })
    store.live.memos.forEach((m) => { if ((m.createdAt || '').slice(0, 10) === key) n++ })
    store.live.photos.forEach((p) => { if ((p.createdAt || '').slice(0, 10) === key) n++ })
    store.live.locations.forEach((l) => { if ((l.date || '').slice(0, 10) === key) n++ })
    recs.forEach((r) => { if (!r.deletedAt && (r.date || '').slice(0, 10) === key) n++ })
    out.push({ key, label: i === 0 ? '今天' : '周' + WD2[dt.getDay()], v: n })
  }
  const max = Math.max(1, ...out.map((x) => x.v))
  return { days: out, max, total: out.reduce((s, x) => s + x.v, 0) }
})
// 完成率环 + 分类占比 + 空状态判定（只读派生，不改原指标）
const statRing = computed(() => {
  const list = store.live.tasks || []
  const done = list.filter((t) => t.status === 'done').length
  return { total: list.length, done, pct: list.length ? Math.round(done / list.length * 100) : 0 }
})
const statCats = computed(() => {
  const arr = [
    { key: 'task', label: '任务', n: (store.live.tasks || []).length, color: '#7C90A9' },
    { key: 'memo', label: '笔记', n: (store.live.memos || []).length, color: '#9285AC' },
    { key: 'photo', label: '照片', n: (store.live.photos || []).length, color: '#BC939A' },
    { key: 'item', label: '物品', n: (store.live.items || []).length, color: '#8DA383' },
    { key: 'loc', label: '足迹', n: (store.live.locations || []).length, color: '#C4A468' }
  ]
  const sum = arr.reduce((s, x) => s + x.n, 0)
  return arr.map((x) => ({ ...x, pct: sum ? Math.round(x.n / sum * 100) : 0 }))
})
const statEmpty = computed(() => statCats.value.every((c) => c.n === 0))
const statTotal = computed(() => statCats.value.reduce((s, c) => s + c.n, 0))
// 参考图图表卡：环形图 + 引线标签 + 底部图例 + 全部/周/月/年 tab
const STAT_TABS = [{ k: 'all', label: '全部' }, { k: 'week', label: '周' }, { k: 'month', label: '月' }, { k: 'year', label: '年' }]
const statTab = ref('all')
const statDonut = computed(() => {
  const cats = statCats.value.filter((c) => c.n > 0)
  const sum = Math.max(1, cats.reduce((s, x) => s + x.n, 0))
  const R = 36
  const CX = 110
  const CY = 65
  const C = 2 * Math.PI * R
  let acc = 0
  const segs = []
  const leaders = []
  let a0 = -90
  cats.forEach((c) => {
    const frac = c.n / sum
    const len = Math.max(0.5, frac * C - 2)
    segs.push({ key: c.key, color: c.color, dasharray: len + ' ' + C, dashoffset: -acc * C })
    const mid = a0 + frac * 360 / 2
    const rad = mid * Math.PI / 180
    const right = Math.cos(rad) >= 0
    const x1 = CX + R * Math.cos(rad)
    const y1 = CY + R * Math.sin(rad)
    const x2 = CX + (R + 10) * Math.cos(rad)
    const y2 = CY + (R + 10) * Math.sin(rad)
    const x3 = right ? Math.min(170, x2 + 10) : Math.max(50, x2 - 10)
    leaders.push({
      key: c.key, x1, y1, x2, y2, x3, y3: y2, right,
      color: c.color, label: c.label + ' ' + Math.round(frac * 100) + '%', tx: right ? x3 + 4 : x3 - 4
    })
    acc += frac
    a0 += frac * 360
  })
  return { C, segs, leaders }
})

const PANEL_META = {
  backpack: { label: '背包统计', icon: 'backpack' },
  notes: { label: '笔记列表', icon: 'note' },
  album: { label: '相册预览', icon: 'album' },
  map: { label: '足迹地图', icon: 'map-pin' },
  steam: { label: 'Steam 游戏库', icon: 'game' },
  achievements: { label: '成就展示', icon: 'trophy' },
  calendar: { label: '日历聚合', icon: 'calendar' },
  todo: { label: '待办清单', icon: 'checklist' },
  ledger: { label: '近期记账', icon: 'wallet' },
  task: { label: '任务清单', icon: 'tasks' },
  collections: { label: '收藏清单', icon: 'star' },
  stats: { label: '数据可视化', icon: 'chart' },
  weather: { label: '天气', icon: 'cloud' }
}
const meta = computed(() => PANEL_META[props.kind] || PANEL_META.backpack)
</script>

<template>
  <div class="pn" ref="rootEl" :class="[sizeClass, { short: isShort, 'pn-full': kind === 'weather' }]">
    <div v-if="kind !== 'weather'" class="pn-head">
      <Icon :name="meta.icon" :size="sizeClass === 'sz-xs' ? 14 : 16" />
      <span class="pn-title">{{ meta.label }}</span>
      <!-- 笔记：新建入口直接开浮层编辑器 -->
      <button v-if="kind === 'notes'" class="pn-refresh" title="新建笔记" @pointerdown.stop @click.stop="openMemoEditor(null)"><Icon name="plus" :size="16" /></button>
      <button class="pn-refresh" title="刷新数据" @pointerdown.stop @click.stop="refreshData()"><Icon name="reset" :size="16" /></button>
    </div>

    <!-- 背包统计：总数环 + 彩色分类条 + 最近物品徽章 -->
    <div v-if="kind === 'backpack'" class="pn-body" data-scroll>
      <div class="bag-hero">
        <div class="bag-ring">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle class="bag-ring-bg" cx="20" cy="20" r="16" />
            <circle class="bag-ring-fg" cx="20" cy="20" r="16" :style="{ strokeDashoffset: 100.5 - 100.5 * bag.topPct / 100 }" />
          </svg>
          <span class="bag-ring-n">{{ bag.total }}</span>
        </div>
        <div class="bag-hero-m">
          <div class="bag-hero-l">件物品</div>
          <div class="bag-hero-s">主类 {{ bag.topName }} · {{ bag.topPct }}%</div>
          <div v-if="bag.recent" class="bag-badge"><i>{{ (bag.recent || '?').slice(0, 1) }}</i><span>{{ bag.recent }}</span></div>
        </div>
      </div>
      <div class="pn-bars bag-bars">
        <div v-for="c in bag.cats" :key="c.name" class="pn-bar-row">
          <span class="pn-bar-name">{{ c.name }}</span>
          <span class="pn-bar-track"><i :style="{ width: (c.n / bag.max * 100) + '%' }"></i></span>
          <span class="pn-bar-num">{{ c.n }}</span>
        </div>
      </div>
      <div v-if="bag.recent" class="pn-foot">最近：{{ bag.recent }}</div>
      <div v-else class="pn-foot">背包还空着，去「背包」装点东西</div>
    </div>

    <!-- 笔记：大卡 = 单篇分页阅读；中小卡 = 列表（中卡带摘要） -->
    <div v-else-if="kind === 'notes'" class="pn-body pn-notes" data-scroll>
      <template v-if="showReader">
        <div v-if="currentNote" class="pn-reader">
          <div class="pn-reader-head">
            <div class="pn-reader-title">{{ currentNote.title || '无标题' }}</div>
            <div class="pn-reader-meta">{{ currentNote.createdAt || '' }}<span v-if="(currentNote.tags || []).length"> · {{ (currentNote.tags || []).join(' · ') }}</span></div>
          </div>
          <div class="pn-reader-body" data-scroll>
            <MarkdownView :text="currentNote.markdown || ''" is-html />
            <div v-if="!plain(currentNote.markdown)" class="pn-foot">这篇笔记还是空的，点「编辑」写点什么</div>
          </div>
          <div class="pn-reader-foot">
            <button class="pn-mini-btn" title="上一篇" @pointerdown.stop @click.stop="notePrev"><Icon name="chevron-left" :size="13" /></button>
            <span class="pn-reader-page">{{ notes.total ? notePage + 1 : 0 }} / {{ notes.total }}</span>
            <button class="pn-mini-btn" title="下一篇" @pointerdown.stop @click.stop="noteNext"><Icon name="chevron-right" :size="13" /></button>
            <span class="pn-grow"></span>
            <button class="pn-mini-btn" title="编辑当前笔记" @pointerdown.stop @click.stop="editCurrentNote"><Icon name="pen" :size="12" /></button>
            <button class="pn-mini-btn" title="新建笔记" @pointerdown.stop @click.stop="openMemoEditor(null)"><Icon name="plus" :size="12" /></button>
          </div>
        </div>
        <div v-else class="pn-empty">
          <Icon name="note" :size="22" />
          <div>还没有笔记</div>
          <button class="pn-chip-btn" @pointerdown.stop @click.stop="openMemoEditor(null)">写第一篇</button>
        </div>
      </template>
      <template v-else>
        <div class="pn-big">{{ notes.total }}<span class="pn-unit">篇笔记</span></div>
        <div class="pn-note-list">
          <button v-for="m in noteRows" :key="m.id" class="pn-note-row" :title="m.title"
            @pointerdown.stop @click.stop="openMemoEditor(m)">
            <span class="pn-note-ava" aria-hidden="true">{{ (m.title || '无').slice(0, 1) }}</span>
            <span class="pn-note-main">
              <span class="pn-note-t">{{ m.title || '无标题' }}</span>
              <span v-if="sizeClass !== 'sz-xs'" class="pn-note-x">{{ plain(m.markdown) || '空白笔记' }}</span>
            </span>
            <span class="pn-note-del" title="删除笔记" @pointerdown.stop @click.stop="delMemo(m)"><Icon name="x" :size="11" /></span>
          </button>
          <div v-if="!notes.total" class="pn-foot">还没有笔记，点右上角 + 开写</div>
        </div>
      </template>
    </div>

    <!-- 相册：瀑布流 + 大图（全部照片，面板内可滚动；wheel 阻止冒泡到画布缩放） -->
    <div v-else-if="kind === 'album'" class="pn-body" data-scroll @wheel.stop>
      <div v-if="album.total" class="pn-big">{{ album.total }}<span class="pn-unit">张回忆</span></div>
      <div v-if="album.total" class="pn-photo-flow">
        <button v-for="p in album.shots" :key="p.id" class="pn-photo" :title="p.name" @pointerdown.stop @click.stop="openPhoto(p)">
          <img :src="p.dataUrl" :alt="p.name" loading="lazy" />
          <span class="pn-photo-cap">{{ p.name }}</span>
          <span class="pn-photo-del" title="删除" @pointerdown.stop @click.stop="delPhoto(p)"><Icon name="x" :size="11" /></span>
        </button>
      </div>
      <div v-else class="pn-empty-art">
        <svg viewBox="0 0 72 56" aria-hidden="true">
          <rect x="8" y="12" width="56" height="38" rx="8" class="ea-line" />
          <path d="M8 40l14-13 10 8 9-9 17 15" class="ea-line ea-path" />
          <circle cx="24" cy="24" r="4" class="ea-dot" />
          <path d="M18 6h20M14 6l-4 6M54 6h-8" class="ea-line ea-spark" />
        </svg>
        <div>相册还空着，去「相册」存几张</div>
      </div>
    </div>

    <!-- 足迹地图：地图区拖动/缩放地图；卡片边框（地图四周留边）拖动整卡 -->
    <div v-else-if="kind === 'map'" class="pn-body pn-body-map" data-scroll>
      <div class="pn-big">{{ map.total }}<span class="pn-unit">个足迹</span></div>
      <div class="pn-map">
        <!-- 瓦片地图：视口裁剪 + LRU 缓存 + 进入视口才初始化（拖拽平移，滑块缩放） -->
        <TileMapCanvas :points="map.ptsFull" :zoom="mapZoom" :dark="isDark" :interactive="true" @zoom="mapZoom = $event" />
        <div class="pn-map-zoom">
          <button class="pn-map-zbtn" title="放大" @pointerdown.stop @click.stop="onMapZoomIn">+</button>
          <input type="range" min="1" max="2.4" step="0.1" :value="mapZoom" @pointerdown.stop @input="onMapZoom" />
          <button class="pn-map-zbtn" title="缩小" @pointerdown.stop @click.stop="onMapZoomOut">−</button>
        </div>
      </div>
      <div v-if="map.recent" class="pn-foot">最近：{{ map.recent }}</div>
      <div v-else class="pn-foot">还没去过任何地方</div>
    </div>

    <!-- 天气：深色磨砂卡（参考图 5）+ 点击展开详情浮层（参考图 6） -->
    <div v-else-if="kind === 'weather'" class="pn-body pn-wx" data-scroll>
      <template v-if="wx.state === 'ok'">
        <div class="wx-card" @pointerdown.stop @click.stop="openWxSheet">
          <!-- 复用图标定义：一处定义，卡内与浮层共用 -->
          <svg class="wx-defs" width="0" height="0" aria-hidden="true">
            <defs>
              <symbol id="wx-sun" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4.4" fill="#F2C46F" />
                <g stroke="#F2C46F" stroke-width="1.5" stroke-linecap="round"><path d="M12 2.5v2" /><path d="M12 19.5v2" /><path d="M2.5 12h2" /><path d="M19.5 12h2" /><path d="M5.2 5.2l1.4 1.4" /><path d="M17.4 17.4l1.4 1.4" /><path d="M18.8 5.2l-1.4 1.4" /><path d="M6.6 17.4l-1.4 1.4" /></g>
              </symbol>
              <symbol id="wx-partly" viewBox="0 0 24 24">
                <circle cx="9" cy="9" r="3.6" fill="#F2C46F" />
                <path d="M8 18h9.5a3.4 3.4 0 0 0 .4-6.8A5 5 0 0 0 8 12.6 3 3 0 0 0 8 18z" fill="#A9B4C2" />
              </symbol>
              <symbol id="wx-cloud" viewBox="0 0 24 24"><path d="M7 17h10a4 4 0 0 0 .5-8A6 6 0 0 0 6.5 10A3.6 3.6 0 0 0 7 17z" fill="#A9B4C2" /></symbol>
              <symbol id="wx-rain" viewBox="0 0 24 24">
                <path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6.5 8A3.6 3.6 0 0 0 7 15z" fill="#A9B4C2" />
                <g stroke="#7FB0D8" stroke-width="1.6" stroke-linecap="round"><path d="M9 18l-1 3" /><path d="M13 18l-1 3" /><path d="M17 18l-1 3" /></g>
              </symbol>
              <symbol id="wx-snow" viewBox="0 0 24 24">
                <path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6.5 8A3.6 3.6 0 0 0 7 15z" fill="#A9B4C2" />
                <g fill="#BFD6E4"><circle cx="9" cy="19" r="1.2" /><circle cx="13" cy="21" r="1.2" /><circle cx="17" cy="19" r="1.2" /></g>
              </symbol>
              <symbol id="wx-thunder" viewBox="0 0 24 24">
                <path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6.5 7A3.6 3.6 0 0 0 7 14z" fill="#A9B4C2" />
                <path d="M13 14l-3 6h3l-1 4 5-7h-3l2-3z" fill="#F2C46F" />
              </symbol>
              <symbol id="wx-fog" viewBox="0 0 24 24"><g stroke="#A9B4C2" stroke-width="2" stroke-linecap="round"><path d="M6 9h12" /><path d="M4 13h15" /><path d="M8 17h12" /></g></symbol>
            </defs>
          </svg>

          <div class="wx-card-top">
            <span class="wx-city">
              <svg viewBox="0 0 12 12" class="wx-pin"><path d="M6 1.5a3.4 3.4 0 0 0-3.4 3.4C2.6 7.4 6 10.8 6 10.8s3.4-3.4 3.4-5.9A3.4 3.4 0 0 0 6 1.5z" fill="none" stroke="currentColor" stroke-width="1.2" /><circle cx="6" cy="4.9" r="1.2" fill="currentColor" /></svg>
              <span>{{ wx.city }}</span>
            </span>
            <span class="wx-hint">详情<Icon name="chevron-right" :size="11" /></span>
            <button class="wx-refresh" title="刷新天气" @pointerdown.stop @click.stop="loadWeather(true)"><Icon name="reset" :size="12" /></button>
          </div>

          <div class="wx-card-main">
            <span class="wx-big">{{ wx.temp === null ? '--' : wx.temp }}<i>°</i></span>
            <span class="wx-card-side">
              <span class="wx-cond"><svg class="wx-ico" aria-hidden="true"><use :href="wxIconId(wx.code)" /></svg>{{ wxDesc(wx.code) }}</span>
              <span class="wx-hl">最低 {{ wx.days[0] ? wx.days[0].lo : '--' }}° 最高 {{ wx.days[0] ? wx.days[0].hi : '--' }}°</span>
            </span>
          </div>

          <!-- 体感 / 湿度 / 空气质量 / 风：正面即可读，点击仍可展开完整详情 -->
          <div class="wx-metrics">
            <span><i>体感</i><b>{{ wx.apparent === null ? '--' : wx.apparent + '°' }}</b></span>
            <span><i>湿度</i><b>{{ wx.humidity === null ? '--' : wx.humidity + '%' }}</b></span>
            <span><i>AQI</i><b>{{ wxAqiLabel }}</b></span>
            <span><i>{{ windDirName }}</i><b>{{ windLevel }} 级</b></span>
          </div>
          <div class="wx-trend">
            <svg class="wx-trend-line" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
              <polyline class="hi" :points="wxTrend.hi" />
              <polyline class="lo" :points="wxTrend.lo" />
            </svg>
            <div class="wx-trend-x">
              <span v-for="d in wxTrendDays" :key="d.k">
                <i>{{ d.k }}</i>
                <b>{{ d.hi }}°</b>
                <em>{{ d.lo }}°</em>
              </span>
            </div>
          </div>
          <div class="wx-foot">{{ wxFetched }}</div>
        </div>
      </template>
      <template v-else-if="wx.state === 'loading'">
        <div class="wx-loading wx-state">
          <svg viewBox="0 0 64 40" aria-hidden="true" class="wx-loading-art">
            <path class="wx-cloud" d="M16 34h30a9 9 0 0 0 1-18A13 13 0 0 0 18 18 8.5 8.5 0 0 0 16 34z" />
          </svg>
          <div>正在获取天气…</div>
        </div>
      </template>
      <template v-else>
        <div class="wx-loading wx-state">
          <Icon name="cloud" :size="24" />
          <div>{{ wx.err || '天气不可用，点右上角刷新' }}</div>
        </div>
      </template>
    </div>

    <!-- Steam 游戏库：大卡封面网格 / 中小卡列表 -->
    <div v-else-if="kind === 'steam'" class="pn-body" data-scroll>
      <div v-if="steam.total" class="pn-big">{{ steam.total }}<span class="pn-unit">款游戏</span></div>
      <div v-if="steam.total" class="pn-sub">总时长 {{ steam.hours.toLocaleString('zh-CN') }} 小时</div>
      <div v-if="sizeClass === 'sz-lg' && steam.total" class="pn-steam">
        <div v-for="(g, i) in steam.top" :key="g.appid || i" class="pn-game">
          <div class="pn-game__cover" :class="{ ph: !g.coverUrl }"
            :style="g.coverUrl ? { backgroundImage: 'url(' + g.coverUrl + ')' } : {}">
            <b v-if="!g.coverUrl">{{ (g.name || '?').slice(0, 1) }}</b>
          </div>
          <div class="pn-game__meta">
            <div class="pn-game__name">{{ g.name }}</div>
            <div class="pn-game__h">总 {{ Math.round(g.playtimeHours || 0) }}h · 近 {{ Math.round(g.recentHours || 0) }}h</div>
          </div>
        </div>
      </div>
      <div v-else-if="steam.total" class="pn-mini">
        <div v-for="(g, i) in steam.top.slice(0, sizeClass === 'sz-xs' ? 2 : 3)" :key="g.appid || i" class="pn-line">
          <span class="pn-line-thumb" :class="{ ph: !g.coverUrl }"
            :style="g.coverUrl ? { backgroundImage: 'url(' + g.coverUrl + ')' } : {}">
            <b v-if="!g.coverUrl">{{ (g.name || '?').slice(0, 1) }}</b>
          </span>
          <span class="pn-line-name">{{ g.name }}</span>
          <span class="pn-line-right">{{ Math.round(g.playtimeHours || 0) }}h</span>
        </div>
      </div>
      <div v-if="!steam.total" class="pn-empty-art">
        <svg viewBox="0 0 72 56" aria-hidden="true">
          <rect x="10" y="10" width="52" height="34" rx="8" class="ea-line" />
          <path d="M28 22l16 8-16 8z" class="ea-dot" />
          <path d="M22 50h28M30 44v6M42 44v6" class="ea-line ea-spark" />
        </svg>
        <div>去「Steam 游戏库」页拉取一次即可同步</div>
      </div>
    </div>

    <!-- 日历：迷你月历；大卡右侧带当日议程；加任务走浮层 -->
    <div v-else-if="kind === 'calendar'" class="pn-body pn-cal" data-scroll>
      <div class="cal">
        <div class="cal-head">
          <button class="pn-cal-nav" :title="calView === 'week' ? '上一周' : '上个月'" @pointerdown.stop @click.stop="calNav(-1)"><Icon name="chevron-left" :size="13" /></button>
          <span class="pn-cal-title">{{ calHeadText }}</span>
          <button class="pn-cal-nav" :title="calView === 'week' ? '下一周' : '下个月'" @pointerdown.stop @click.stop="calNav(1)"><Icon name="chevron-right" :size="13" /></button>
          <span class="cal-grow"></span>
          <button v-if="sizeClass !== 'sz-xs'" class="cal-today-b" title="回到今天" @pointerdown.stop @click.stop="gotoToday">今天</button>
          <div class="pn-cal-view">
            <button class="pn-cal-view__b" :class="{ on: calView === 'month' }" @pointerdown.stop @click.stop="setCalView('month')">月</button>
            <button class="pn-cal-view__b" :class="{ on: calView === 'week' }" @pointerdown.stop @click.stop="setCalView('week')">周</button>
          </div>
          <button class="cal-add-b" title="加任务" @pointerdown.stop @click.stop="openTaskSheet"><Icon name="plus" :size="12" /></button>
        </div>
        <div class="cal-body" :class="{ split: showAgenda }">
          <div class="cal-month">
            <div class="cal-wd">
              <span v-for="w in WD" :key="w">{{ w }}</span>
            </div>
            <div class="cal-grid" :class="{ week: calView === 'week', lunar: showLunar }">
              <button v-for="c in calCells" :key="c.key" class="cal-cell"
                :class="{ out: !c.inMonth, today: c.isToday, sel: c.isSel && !c.isToday, week: calView === 'week', 'drop-target': dayDrag.active && dayDrag.over === c.key }"
                :data-day="c.key"
                :title="c.key + (c.items.length ? ' · ' + c.items.map(i => i.title).join(' / ') : '')"
                @pointerdown.stop @click.stop="onPickDay(c.key)">
                <span class="cal-dom">{{ c.dom }}</span>
                <span v-if="showLunar && calView === 'month'" class="cal-lunar">{{ lunarOf(c.key) }}</span>
                <span v-if="calView === 'week' && c.items.length" class="cal-items">
                  <i v-for="it in c.items" :key="it.id" :class="{ done: it.done }"
                    @pointerdown.stop="startTaskDrag($event, it)"
                    :style="{ boxShadow: 'inset 2px 0 0 ' + colorOf(calCatMap, it.category) }">{{ it.title }}</i>
                </span>
                <span v-else-if="c.cats.length" class="cal-dots">
                  <i v-for="cat in c.cats" :key="cat" :style="{ background: colorOf(calCatMap, cat) }"></i>
                </span>
              </button>
            </div>
            <div v-if="calFests.length && !isShort && calView === 'month'" class="cal-fest">
              <span v-for="f in calFests" :key="f.m + '-' + f.d" class="cal-fest-i"><b>{{ f.m }}/{{ f.d }}</b>{{ f.n }}</span>
            </div>
          </div>
          <!-- 大卡：右侧当日议程（点日期联动） -->
          <div v-if="showAgenda" class="cal-agenda">
            <div class="ca-head">
              <span class="ca-day">{{ selectedDay.slice(8) }}</span>
              <span class="ca-week">{{ dayWeek }}</span>
              <span class="ca-month-l">{{ Number(selectedDay.slice(5, 7)) }} 月</span>
              <button class="ca-add" @pointerdown.stop @click.stop="openTaskSheet"><Icon name="plus" :size="11" /> 加任务</button>
            </div>
            <div class="ca-list" data-scroll>
              <!-- 任务：实心标记 -->
              <div v-if="dayTasks.length" class="ca-sec">
                <div class="ca-sec-l">任务<b>{{ dayTasks.length }}</b></div>
                <div v-for="t in dayTasks" :key="t.id" class="ca-row is-task" :class="{ done: t.status === 'done' }" title="拖到日历某天可改期"
                  @pointerdown.stop="startTaskDrag($event, t)">
                  <button class="pn-check" :class="{ on: t.status === 'done' }" title="完成 / 取消" @pointerdown.stop @click.stop="toggleTodo(t)"><Icon v-if="t.status === 'done'" name="check" :size="11" /></button>
                  <span class="ca-time">{{ t.dueTime || '全天' }}</span>
                  <span class="ca-title">{{ t.title }}</span>
                </div>
              </div>
              <!-- Todo：空心标记 -->
              <div v-if="dayTodos.length" class="ca-sec">
                <div class="ca-sec-l">Todo<b>{{ dayTodos.length }}</b></div>
                <div v-for="t in dayTodos" :key="t.id" class="ca-row is-todo" :class="{ done: t.status === 'done' }" title="拖到日历某天可改期"
                  @pointerdown.stop="startTaskDrag($event, t)">
                  <button class="pn-check" :class="{ on: t.status === 'done' }" title="完成 / 取消" @pointerdown.stop @click.stop="toggleTodo(t)"><Icon v-if="t.status === 'done'" name="check" :size="11" /></button>
                  <span class="ca-time">{{ t.dueTime || '全天' }}</span>
                  <span class="ca-title">{{ t.title }}</span>
                </div>
              </div>
              <div v-if="!dayData.tasks.length" class="ca-empty">这一天还没有安排</div>
              <div v-if="dayData.recs.length" class="ca-sec">
                <div class="ca-sec-l">记账</div>
                <div v-for="r in dayData.recs" :key="r.id" class="ca-row">
                  <span class="ca-amt" :class="r.type">{{ r.type === 'income' ? '+' : '-' }}{{ r.amount }}</span>
                  <span class="ca-title">{{ r.category }}<i v-if="r.note"> · {{ r.note }}</i></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 任务清单：日常任务 / 支线（与 Todo 分开），支持截止日期 -->
    <div v-else-if="kind === 'task'" class="pn-body pn-taskpanel" data-scroll>
      <div class="pn-big sm">{{ taskPanel.openCount }}<span class="pn-unit">/ {{ taskPanel.total }} 待完成</span></div>
      <div class="pn-tasks">
        <div v-for="t in taskPanel.items" :key="t.id" class="pn-task" :class="{ done: t.status === 'done' }">
          <button class="pn-check" :class="{ on: t.status === 'done' }" title="完成 / 取消" @pointerdown.stop @click.stop="toggleTodo(t)"><Icon v-if="t.status === 'done'" name="check" :size="12" /></button>
          <span class="pn-task__title" @pointerdown.stop @click.stop="toggleTodo(t)">{{ t.title }}</span>
          <span v-if="t.status !== 'done' && sizeClass !== 'sz-xs'" class="pn-task__status">{{ taskStatusLabel(t.status) }}</span>
          <span v-if="taskDue(t) && sizeClass !== 'sz-xs'" class="pn-task__date" :class="{ overdue: t.dueDate < todayKey && t.status !== 'done' }">{{ taskDue(t) }}</span>
          <button class="pn-del" title="删除" @pointerdown.stop @click.stop="delTodo(t)"><Icon name="x" :size="11" /></button>
        </div>
        <div v-if="!taskPanel.items.length" class="pn-foot">还没有任务，在下方快速添加</div>
      </div>
      <div v-if="taskPanel.more" class="pn-foot">还有 {{ taskPanel.more }} 条，去「任务」查看全部</div>
      <div class="pn-todo-add">
        <input v-model="newTask" placeholder="添加任务，回车确认" @pointerdown.stop @keydown.stop.enter="addTaskQuick" />
        <button class="pn-add-btn" title="添加任务" @pointerdown.stop @click.stop="addTaskQuick"><Icon name="plus" :size="13" /></button>
      </div>
    </div>

    <!-- 收藏清单：星标徽章 + 封面色块 + 面板内直接新建 -->
    <div v-else-if="kind === 'collections'" class="pn-body pn-collections" data-scroll>
      <div class="col-hero">
        <span class="col-hero-n">{{ collectionPanel.total }}<i>条收藏</i></span>
        <span v-if="collectionPanel.items.length" class="col-hero-s">最近 {{ collectionPanel.items[0].category || '收藏' }}</span>
      </div>
      <div class="pn-col-list">
        <button v-for="c in collectionPanel.items" :key="c.id" class="pn-col-row"
          :title="c.title + (c.url ? ' · ' + c.url : '')" @pointerdown.stop @click.stop="openCollection(c)">
          <span class="pn-col-cover">
            <b>{{ (c.title || '?').slice(0, 1) }}</b>
            <svg viewBox="0 0 12 12" class="pn-col-star" aria-hidden="true"><path d="M6 .8l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 8.9 2.8 10.7l.6-3.6L.8 4.6l3.6-.5z" /></svg>
          </span>
          <span class="pn-col-main">
            <span class="pn-col-t">{{ c.title }}</span>
            <span v-if="sizeClass !== 'sz-xs'" class="pn-col-x">{{ c.category || '收藏' }}<i v-if="c.url"> · 可打开</i></span>
          </span>
        </button>
        <div v-if="!collectionPanel.items.length" class="pn-foot">还没有收藏，在下方添加</div>
      </div>
      <div v-if="collectionPanel.more" class="pn-foot">还有 {{ collectionPanel.more }} 条未显示</div>
      <div class="pn-col-add">
        <input class="pn-col-title" v-model="newCollection.title" placeholder="收藏标题" @pointerdown.stop @keydown.stop.enter="addCollectionQuick" />
        <input v-if="sizeClass !== 'sz-xs'" class="pn-col-url" v-model="newCollection.url" placeholder="链接（可选）" @pointerdown.stop @keydown.stop.enter="addCollectionQuick" />
        <button class="pn-add-btn" title="添加收藏" @pointerdown.stop @click.stop="addCollectionQuick"><Icon name="plus" :size="13" /></button>
      </div>
    </div>

    <!-- 图表卡：环形图 + 引线标签 + 图例 + tab（参考图 639d027b 左） -->
    <div v-else-if="kind === 'stats'" class="pn-body pn-stats" data-scroll>
      <div class="st-top">
        <span class="st-name"><Icon name="chart" :size="12" /><span>图表卡片</span></span>
        <span class="st-tabs">
          <button v-for="t in STAT_TABS" :key="t.k" :class="{ on: statTab === t.k }" @pointerdown.stop @click.stop="statTab = t.k">{{ t.label }}</button>
        </span>
      </div>
      <template v-if="!statEmpty && !isShort">
        <div class="st-donut">
          <svg viewBox="0 0 220 130" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <circle cx="110" cy="65" r="36" class="st-d-bg" />
            <circle v-for="s in statDonut.segs" :key="s.key" cx="110" cy="65" r="36"
              :stroke="s.color" :stroke-dasharray="s.dasharray" :stroke-dashoffset="s.dashoffset"
              transform="rotate(-90 110 65)" class="st-d-seg" />
            <g v-for="l in statDonut.leaders" :key="'l' + l.key">
              <polyline :points="l.x1 + ',' + l.y1 + ' ' + l.x2 + ',' + l.y2 + ' ' + l.x3 + ',' + l.y3" :stroke="l.color" class="st-lead" />
              <text :x="l.tx" :y="l.y3 + 3" :text-anchor="l.right ? 'start' : 'end'" :fill="l.color" class="st-lbl">{{ l.label }}</text>
            </g>
            <text x="110" y="68" text-anchor="middle" class="st-center">{{ statTotal }}</text>
          </svg>
        </div>
        <div class="st-legend">
          <span v-for="c in statCats" :key="c.key" class="st-lg-i"><i :style="{ background: c.color }" />{{ c.label }} {{ c.pct }}%</span>
        </div>
      </template>
      <template v-else-if="!statEmpty">
        <div class="st-mini">
          <span class="st-mini-n">{{ statRing.pct }}<i>%</i></span>
          <div class="st-legend">
            <span v-for="c in statCats.slice(0, 4)" :key="c.key" class="st-lg-i"><i :style="{ background: c.color }" />{{ c.label }}</span>
          </div>
        </div>
      </template>
      <div v-else class="pn-empty-art">
        <svg viewBox="0 0 80 56" aria-hidden="true">
          <path d="M10 48h60" class="ea-line" />
          <path d="M18 48v-12M32 48v-20M46 48v-8M60 48v-26" class="ea-line ea-bar" />
          <circle cx="18" cy="30" r="2.4" class="ea-dot" /><circle cx="46" cy="34" r="2.4" class="ea-dot" />
          <path d="M18 30l14-10 14 14 14-18" class="ea-line ea-path" />
          <path d="M60 16l3 0 0 3" class="ea-line ea-spark" />
        </svg>
        <div>还没有数据 · 记一笔或写篇笔记就会长出来</div>
      </div>
    </div>

    <!-- 待办清单：完成率环 + 分组色条 -->
    <div v-else-if="kind === 'todo'" class="pn-body" data-scroll>
      <div class="td-hero">
        <div class="td-ring">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle class="td-ring-bg" cx="20" cy="20" r="16" />
            <circle class="td-ring-fg" cx="20" cy="20" r="16"
              :style="{ strokeDashoffset: 100.5 - 100.5 * todo.pct / 100 }" />
          </svg>
          <span class="td-ring-n">{{ todo.pct }}%</span>
        </div>
        <div class="td-hero-m">
          <div class="td-hero-n">{{ todo.total }}<span>条未完成</span></div>
          <div class="td-hero-s">已完成 {{ todo.done }} · 共 {{ todo.all }} 条</div>
        </div>
      </div>
      <div v-for="g in todo.groups" :key="g.key" class="pn-group" :class="'g-' + g.key">
        <div class="pn-group-l">{{ g.label }}<b>{{ g.items.length }}</b></div>
        <div class="pn-tasks">
          <div v-for="t in g.items" :key="t.id" class="pn-task" :class="{ done: t.status === 'done' }">
            <button class="pn-check" :class="{ on: t.status === 'done' }" title="完成 / 取消" @pointerdown.stop @click.stop="toggleTodo(t)"><Icon v-if="t.status === 'done'" name="check" :size="12" /></button>
            <span class="pn-task__title" @pointerdown.stop @click.stop="toggleTodo(t)">{{ t.title }}</span>
            <span v-if="t.dueDate && sizeClass !== 'sz-xs'" class="pn-task__date">{{ t.dueDate.slice(5) }}</span>
            <button class="pn-del" title="删除" @pointerdown.stop @click.stop="delTodo(t)"><Icon name="x" :size="11" /></button>
          </div>
        </div>
      </div>
      <div v-if="!todo.groups.length" class="pn-foot">暂无待办，享受清闲时光</div>
      <div class="pn-todo-add">
        <input v-model="newTodo" placeholder="添加待办，回车确认" @pointerdown.stop @keydown.stop.enter="addTodo" />
        <button class="pn-add-btn" title="添加待办" @pointerdown.stop @click.stop="addTodo"><Icon name="plus" :size="13" /></button>
      </div>
    </div>

    <!-- 记账：消费记录 + 本月/今日 + 分类胶囊 + 7 日折线 + 明细浮层（参考图 639d027b 右） -->
    <div v-else-if="kind === 'ledger'" class="pn-body pn-ledger-panel" data-scroll>
      <div class="led-top">
        <span class="led-name"><Icon name="wallet" :size="12" /><span>消费记录</span></span>
        <span class="led-tabs">
          <button v-for="t in LED_TABS" :key="t.k" :class="{ on: ledTab === t.k }" @pointerdown.stop @click.stop="ledTab = t.k">{{ t.label }}</button>
        </span>
      </div>
      <div class="led-sums">
        <span class="led-sum"><i>本月</i><b>¥{{ money(ledger.monthExpense) }}</b></span>
        <span class="led-sum"><i>今日</i><b>¥{{ money(ledger.todayExpense) }}</b></span>
        <button class="led-more" @pointerdown.stop @click.stop="ledSheet.open = true">明细<Icon name="chevron-right" :size="10" /></button>
      </div>
      <div class="led-cats">
        <button class="led-pill" :class="{ on: !ledCat }" @pointerdown.stop @click.stop="ledCat = ''">总计</button>
        <button v-for="c in ledger.cats.slice(0, 5)" :key="c.name" class="led-pill" :class="{ on: ledCat === c.name }" @pointerdown.stop @click.stop="ledCat = (ledCat === c.name ? '' : c.name)">
          <i class="led-pill-dot" :style="{ background: c.color }" />{{ c.name }}
        </button>
      </div>
      <div class="led-chart" @pointerdown.stop @click.stop="ledSheet.open = true" title="点击查看全部明细">
        <span class="led-y">
          <i>¥{{ ledTick(ledger.yTicks[0]) }}</i><i>¥{{ ledTick(ledger.yTicks[1]) }}</i><i>¥0</i>
        </span>
        <div class="led-plot">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <line x1="4" y1="6" x2="96" y2="6" class="led-grid" />
            <line x1="4" y1="20" x2="96" y2="20" class="led-grid" />
            <line x1="4" y1="34" x2="96" y2="34" class="led-grid" />
            <polyline :points="ledger.linePts" class="led-line" />
            <circle v-for="(p, i) in ledger.dots" :key="i" :cx="p.x" :cy="p.y" r="1.3" class="led-pt" :class="{ on: ledger.days[i].today }" />
          </svg>
          <span class="led-x"><i v-for="d in ledger.days" :key="d.key">{{ d.label }}</i></span>
        </div>
      </div>
      <div class="pn-ledger">
        <div v-for="r in ledger.filteredRecent" :key="r.id" class="pn-led">
          <span class="pn-led__date">{{ (r.date || '').slice(5) }}</span>
          <span class="pn-led__cat">{{ r.category }}<i v-if="r.note"> · {{ r.note }}</i></span>
          <span class="pn-led__amt" :class="r.type">{{ r.type === 'income' ? '+' : '-' }}{{ r.amount }}</span>
          <button class="pn-del" title="删除" @pointerdown.stop @click.stop="delLedger(r)"><Icon name="x" :size="11" /></button>
        </div>
        <div v-if="!ledger.filteredRecent.length" class="pn-foot">还没有记账，去「记账」记一笔</div>
      </div>
      <div class="pn-ledger-add">
        <button class="pn-type" :class="ledgerType" title="切换支出 / 收入" @pointerdown.stop @click.stop="toggleLedgerType">{{ ledgerType === 'expense' ? '支出' : '收入' }}</button>
        <select v-if="sizeClass !== 'sz-xs'" class="pn-ledger-cat pn-ledger-sel" v-model="newLedger.category" title="选择分类" @pointerdown.stop @change.stop>
          <option value="">分类</option>
          <option v-for="c in ledgerCats" :key="c.name" :value="c.name">{{ c.name }}</option>
        </select>
        <input class="pn-ledger-amt" v-model="newLedger.amount" type="number" placeholder="金额" @pointerdown.stop @keydown.stop.enter="addLedger" />
        <button class="pn-add-btn" title="记一笔" @pointerdown.stop @click.stop="addLedger"><Icon name="plus" :size="13" /></button>
      </div>
    </div>

    <!-- 成就展示：奖杯徽章 + 进度条 -->
    <div v-else-if="kind === 'achievements'" class="pn-body" data-scroll>
      <div class="ach-hero">
        <span class="ach-cup" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 3h10v5a5 5 0 0 1-4 4.9V17h3v3H8v-3h3v-4.1A5 5 0 0 1 7 8z" class="ach-cup-fill" />
            <path d="M7 4H4v3a4 4 0 0 0 4 4M17 4h3v3a4 4 0 0 1-4 4" class="ach-cup-line" />
          </svg>
        </span>
        <span class="ach-hero-n">{{ ach.got }}<i>/ {{ ach.total }}</i></span>
        <span class="ach-hero-l">成就</span>
      </div>
      <div class="ach-bar"><i :style="{ width: (ach.pct * 100) + '%' }"></i></div>
      <div class="ach-badges">
        <span v-for="(t, i) in ach.recent.slice(0, sizeClass === 'sz-xs' ? 2 : 5)" :key="i" class="ach-badge">
          <Icon name="trophy" :size="10" />{{ t }}
        </span>
        <span v-if="!ach.recent.length" class="ach-empty">还没有解锁任何成就</span>
      </div>
    </div>
    <div v-else class="pn-body" data-scroll>
      <div class="pn-foot">该数据面板暂未实现</div>
    </div>

    <!-- ===== 画布内浮层（Teleport 到 body，避免被画布 transform 缩放） ===== -->
    <Teleport to="body">
      <!-- 笔记编辑器 -->
      <GlassBottomSheet :show="memoSheet.open" :title="memoSheet.id ? '编辑笔记' : '新建笔记'" @close="memoSheet.open = false">
        <div class="field">
          <label>标题</label>
          <input v-model="memoSheet.title" maxlength="80" placeholder="给这篇笔记起个名字" />
        </div>
        <div class="field">
          <label>正文</label>
          <div ref="memoEditEl" class="memo-ed" contenteditable="true" data-placeholder="写点什么…"
            @keydown.ctrl.enter.prevent="saveMemoEditor" @keydown.meta.enter.prevent="saveMemoEditor"></div>
        </div>
        <div class="sheet-actions">
          <button class="btn ghost" @click="memoSheet.open = false">取消</button>
          <button class="btn" @click="saveMemoEditor">保存</button>
        </div>
        <div class="sheet-hint">Ctrl / ⌘ + Enter 保存 · Esc 关闭</div>
      </GlassBottomSheet>

      <!-- 加任务（日历卡专用） -->
      <GlassBottomSheet :show="taskSheet.open" title="添加任务" @close="taskSheet.open = false">
        <div class="field">
          <label>任务标题</label>
          <input v-model="taskSheet.title" placeholder="例如：整理周报" @keydown.enter.prevent="saveTask" />
        </div>
        <div class="sheet-row">
          <div class="field">
            <label>日期</label>
            <input type="date" v-model="taskSheet.date" />
          </div>
          <div class="field">
            <label>时间（可选）</label>
            <input type="time" v-model="taskSheet.time" />
          </div>
        </div>
        <div class="sheet-actions">
          <button class="btn ghost" @click="taskSheet.open = false">取消</button>
          <button class="btn" @click="saveTask">添加</button>
        </div>
      </GlassBottomSheet>

      <!-- 相册大图 -->
      <GlassBottomSheet :show="photoView.open" :title="photoNow ? photoNow.name : '照片'" @close="photoView.open = false">
        <div v-if="photoNow" class="photo-view">
          <img :src="photoNow.dataUrl" :alt="photoNow.name" />
          <div class="photo-bar">
            <button class="btn ghost" @click="photoPrev">上一张</button>
            <span>{{ photoView.index + 1 }} / {{ albumAll.length }}</span>
            <button class="btn ghost" @click="photoNext">下一张</button>
          </div>
        </div>
      </GlassBottomSheet>
      <!-- 记账明细（点击卡片「明细 / 折线」打开） -->
      <GlassBottomSheet :show="ledSheet.open" title="消费明细" @close="ledSheet.open = false">
        <div class="lsheet">
          <div class="lsheet-tabs">
            <button v-for="t in LED_TABS" :key="t.k" :class="{ on: ledTab === t.k }" @click="ledTab = t.k">{{ t.label }}</button>
          </div>
          <div class="lsheet-cats">
            <button :class="{ on: !ledCat }" @click="ledCat = ''">全部</button>
            <button v-for="c in ledger.cats" :key="c.name" :class="{ on: ledCat === c.name }" @click="ledCat = (ledCat === c.name ? '' : c.name)">
              <i :style="{ background: c.color }" />{{ c.name }}
            </button>
          </div>
          <div class="lsheet-sum">
            <span>支出 <b>¥{{ money(ledger.sheetExpense) }}</b></span>
            <span>收入 <b>¥{{ money(ledger.sheetIncome) }}</b></span>
            <span>共 {{ ledger.sheetTotal }} 笔</span>
          </div>
          <div v-for="g in ledger.sheetGroups" :key="g.k" class="lsheet-g">
            <div class="lsheet-g-h"><span>{{ g.k }}</span><span>支出 ¥{{ money(g.expense) }} · 收入 ¥{{ money(g.income) }}</span></div>
            <div v-for="r in g.items" :key="r.id" class="lsheet-item">
              <div class="lsheet-row">
                <span class="lsheet-cat">{{ r.category }}<i v-if="r.note"> · {{ r.note }}</i></span>
                <span class="lsheet-amt" :class="r.type">{{ r.type === 'income' ? '+' : '-' }}¥{{ money(r.amount) }}</span>
                <button class="pn-del" title="删除" @click="delLedger(r)"><Icon name="x" :size="11" /></button>
              </div>
              <!-- 任务关联：已关联显示任务名可勾选完成；未关联可挑一条或在就地新建 -->
              <div class="lsheet-link">
                <template v-if="r.taskId && taskOf(r.taskId)">
                  <button class="lsheet-task" :class="{ done: taskOf(r.taskId).status === 'done' }" @click="toggleRecTask(r)">
                    <Icon :name="taskOf(r.taskId).status === 'done' ? 'check' : 'target'" :size="11" />
                    <span>{{ taskOf(r.taskId).title }}</span>
                  </button>
                  <button class="lsheet-unlink" title="解除关联" @click="unlinkRec(r)">解除</button>
                </template>
                <template v-else>
                  <button class="lsheet-linkbtn" @click="openLinkPick(r)"><Icon name="plus" :size="11" /> 关联任务</button>
                </template>
              </div>
              <div v-if="linkPick.open && linkPick.recId === r.id" class="lsheet-pick">
                <input v-model="linkPick.q" placeholder="搜索未完成任务…" />
                <button v-for="t in linkTaskList" :key="t.id" class="lsheet-pick-row" @click="linkRecToTask(r, t)">
                  <span>{{ t.title }}</span><i>#{{ t.category }}</i>
                </button>
                <button v-if="!linkTaskList.length" class="lsheet-pick-row is-empty" disabled>没有匹配的未完成任务</button>
                <div class="lsheet-pick-foot">
                  <button class="lsheet-linkbtn" @click="newTaskForRec(r)">按这笔消费新建任务</button>
                  <button class="lsheet-linkbtn ghost" @click="closeLinkPick">取消</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!ledger.sheetGroups.length" class="pn-foot">该时间段没有记录</div>
        </div>
      </GlassBottomSheet>

      <!-- 天气详情（点击天气卡打开） -->
      <GlassBottomSheet :show="wxSheet.open" title="天气详情" drawer @close="wxSheet.open = false">
        <div v-if="wx.state === 'ok'" class="wxsheet">
          <div class="wxs-top">
            <div class="wxs-city">{{ wx.city }}<span class="wxs-mode">{{ manualCity ? '手动' : '自动定位' }}</span></div>
            <button class="wxs-city-btn" @click="citySearch.open = !citySearch.open; citySearch.err = ''">
              {{ citySearch.open ? '收起' : '切换城市' }}
            </button>
          </div>
          <!-- 3.0 手动城市：Open-Meteo geocoding 搜索，选中后持久化（优先级 手动 > 定位 > 缓存 > 北京） -->
          <div v-if="citySearch.open" class="wxs-city-panel">
            <div class="wxs-city-input">
              <input v-model="citySearch.q" placeholder="搜索城市，如 杭州 / Tokyo" @keydown.enter.prevent="searchCity" />
              <button class="mini-btn" :disabled="citySearch.loading" @click="searchCity">{{ citySearch.loading ? '搜索中…' : '搜索' }}</button>
            </div>
            <div v-if="citySearch.err" class="wxs-city-err">{{ citySearch.err }}</div>
            <button v-for="c in citySearch.results" :key="c.name + c.lat" class="wxs-city-row" @click="pickCity(c)">
              <b>{{ c.name }}</b><span>{{ [c.admin, c.country].filter(Boolean).join(' · ') }}</span>
            </button>
            <button v-if="manualCity" class="wxs-city-row is-auto" @click="useAutoCity"><b>改回自动定位</b><span>使用当前位置的天气</span></button>
          </div>
          <div class="wxs-sub">{{ wxDesc(wx.code) }} · 数据时间 {{ wxStamp }}（{{ wxFetched }}）</div>
          <div class="wxs-hero">
            <span class="wxs-temp">{{ wx.temp === null ? '--' : wx.temp }}<i>°</i></span>
            <div class="wxs-meta">
              <span>体感 {{ wx.apparent === null ? '--' : wx.apparent }}°</span>
              <span>{{ windDirName }} {{ windLevel }} 级</span>
            </div>
          </div>
          <div class="wxs-tip">{{ wxTip }}</div>
          <div class="wxs-metrics">
            <span><i>温度</i><b>{{ wx.days[0] ? wx.days[0].lo : '--' }}°~{{ wx.days[0] ? wx.days[0].hi : '--' }}°</b></span>
            <span><i>湿度</i><b>{{ wx.humidity === null ? '--' : wx.humidity }}%</b></span>
            <span><i>空气质量</i><b>{{ wxAqiLabel }}</b></span>
            <span><i>气压</i><b>{{ wx.pressure === null ? '--' : wx.pressure }} hPa</b></span>
            <span><i>降水</i><b>{{ wx.precip === null ? '--' : wx.precip }} mm</b></span>
            <span><i>日出</i><b>{{ wx.sunrise || '--' }}</b></span>
            <span><i>日落</i><b>{{ wx.sunset || '--' }}</b></span>
          </div>
          <div class="wxs-sec">
            <div class="wxs-sec-l">天气状况</div>
            <div class="wxs-hours">
              <div v-for="(h, i) in wx.hourly" :key="i" class="wxs-h">
                <span>{{ h.h }}</span>
                <svg class="wxs-h-ico" aria-hidden="true"><use :href="wxIconId(h.code)" /></svg>
                <b>{{ h.temp }}°</b>
              </div>
            </div>
            <svg class="wxs-line" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline :points="wxHourLine" /></svg>
          </div>
          <div class="wxs-sec">
            <div class="wxs-sec-l">7 日天气预报</div>
            <div v-for="d in wx.days" :key="d.k" class="wxs-day">
              <span class="wxs-day-k">{{ d.k }} <i>{{ d.date }}</i></span>
              <svg class="wxs-day-ico" aria-hidden="true"><use :href="wxIconId(d.code)" /></svg>
              <span class="wxs-day-d">{{ wxDesc(d.code) }}</span>
              <span class="wxs-day-t">{{ d.hi }}° <i>/ {{ d.lo }}°</i></span>
            </div>
          </div>
        </div>
      </GlassBottomSheet>
    </Teleport>
    <!-- 拖拽改期：跟随指针的轻量幽灵标签（teleport 到 body，避免受画布缩放变换影响） -->
    <Teleport to="body">
      <div v-if="dayDrag.active" class="drag-ghost" :style="{ left: dayDrag.x + 'px', top: dayDrag.y + 'px' }">{{ dayDrag.title }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.pn {
  height: 100%; display: flex; flex-direction: column; min-height: 0;
  /* v2.1.0：以卡片自身为容器，内部字号 / 间距用 cqw·cqh 连续缩放 */
  container-type: size;
  container-name: pn;
  /* 画布卡片底色由 SpaceCanvas 按主题淡混，因此正文色走主题变量 */
  --surface: rgba(255, 255, 255, .5);
  --surface-2: rgba(255, 255, 255, .42);
  --hair: rgba(255, 255, 255, .5);
  --pn-ink: #2C2C2C;
  --pn-ink-2: #86868B;
  --pn-fill: rgba(44, 44, 44, .06);
  --pn-line-strong: rgba(44, 44, 44, .45);
  color: var(--pn-ink);
}
/* 深色主题：面板卡片（日历/任务/相册/游戏等）改用暗玻璃表面与亮墨色 */
:global([data-theme='dark'] .pn) {
  --surface: rgba(255, 255, 255, .10);
  --surface-2: rgba(255, 255, 255, .08);
  --hair: rgba(255, 255, 255, .14);
  --line: rgba(255, 255, 255, .12);
  --pn-ink: var(--sp-ink, #EDEBE7);
  --pn-ink-2: var(--sp-ink-2, #A6A29A);
  --pn-fill: rgba(255, 255, 255, .08);
  --pn-line-strong: rgba(255, 255, 255, .4);
  color: var(--pn-ink);
}
:global([data-theme='dark'] .pn-big .neg) { color: #D99A8C; }
.pn-head {
  display: flex; align-items: center; gap: clamp(3px, 1cqw, 6px); flex: none;
  font-size: clamp(10px, min(3.4cqw, 4.2cqh), 14px); font-weight: 800; color: var(--pn-ink-2, #86868B); opacity: .9;
}
.pn-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
/* 右侧快捷按钮（Mac 小组件风圆形玻璃键） */
.pn-refresh {
  flex: none; width: 20px; height: 20px; border-radius: 50%; margin-left: auto;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--eo-glass-border); background: var(--surface); color: var(--eo-primary-deep);
  cursor: pointer; transition: background .14s ease, transform .2s cubic-bezier(.22, 1, .36, 1);
}
.pn-refresh + .pn-refresh { margin-left: 0; }
.pn.sz-xs .pn-refresh { width: 17px; height: 17px; }
.pn-refresh:hover { transform: translateY(-3px); box-shadow: var(--eo-shadow-lift); }
.pn-refresh:active { opacity: .6; }
.pn-mapbtn.on { background: var(--accent, #E2A94F); border-color: transparent; color: #fff; }
.pn.is-mmap { box-shadow: inset 0 0 0 2px var(--accent, #E2A94F); border-radius: 12px; }
.pn-body { flex: 1; min-height: 0; margin-top: 4px; overflow-y: auto; overscroll-behavior: contain; }
/* 天气整卡：隐藏外层标题栏后，深色卡直接铺满节点，不留玻璃内边距 */
.pn-full { padding: 0; }
.pn.sz-xs .pn-body { margin-top: 2px; }
.pn.pn-full .pn-body { margin-top: 0; }
.pn-big { font-size: clamp(15px, min(6.2cqw, 7.4cqh), 28px); font-weight: 800; line-height: 1.05; color: var(--pn-ink, #2C2C2C); display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
.pn-big.sm { font-size: clamp(13px, min(5cqw, 6cqh), 22px); }
.pn-big .pos { color: var(--pn-ink-2, #9E9C97); }
.pn-big .neg { color: #A97C72; }
.pn-unit { font-size: clamp(8px, min(2.4cqw, 3.2cqh), 11px); font-weight: 600; opacity: .65; margin-left: 4px; }
.pn-sub { font-size: clamp(8.5px, min(2.6cqw, 3.4cqh), 12px); opacity: .7; margin-top: 2px; }
.pn-foot { font-size: clamp(8.5px, min(2.6cqw, 3.4cqh), 12px); opacity: .6; margin-top: clamp(3px, 1.2cqh, 8px); line-height: 1.4; }
.pn-grow { flex: 1; }
.pn-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: clamp(10px, min(3cqw, 4cqh), 13px); opacity: .6; }
.pn-chip-btn {
  padding: 3px 10px; border-radius: 99px; border: 1px solid var(--eo-glass-border);
  background: var(--surface); color: var(--eo-primary-deep); font-size: clamp(9.5px, min(2.8cqw, 3.8cqh), 12.5px); cursor: pointer;
}

/* ---- 背包 / 成就进度条 ---- */
.pn-bars { margin-top: 6px; }
.pn-bar-row { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
.pn-bar-name { font-size: clamp(8.5px, min(2.5cqw, 3.3cqh), 11.5px); width: clamp(38px, 12cqw, 56px); flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-bar-track { flex: 1; height: 5px; border-radius: 999px; background: var(--pn-fill, rgba(44, 44, 44, .06)); overflow: hidden; }
.pn-bar-track.wide { width: 100%; display: block; margin-top: 6px; }
.pn-bar-track i { display: block; height: 100%; border-radius: 999px; background: var(--eo-primary); }
.pn-bar-num { font-size: clamp(8.5px, min(2.5cqw, 3.3cqh), 11.5px); width: clamp(16px, 5cqw, 24px); text-align: right; flex: none; opacity: .7; }
.pn-line {
  display: flex; align-items: center; gap: 5px; font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); color: var(--pn-ink, #2C2C2C);
  padding: clamp(2px, .7cqh, 4px) 0; border-top: 1px solid var(--line, rgba(44, 44, 44, .06));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pn-line-right { margin-left: auto; font-size: clamp(8.5px, min(2.4cqw, 3.1cqh), 11px); opacity: .6; flex: none; }

/* ---- 笔记 ---- */
.pn-notes { display: flex; flex-direction: column; }
.pn-note-list { display: flex; flex-direction: column; margin-top: 5px; min-height: 0; }
.pn-note-row {
  display: flex; align-items: flex-start; gap: 6px; width: 100%; text-align: left;
  padding: 5px 2px; border: 0; border-top: 1px solid var(--line, rgba(44, 44, 44, .06));
  background: transparent; color: var(--pn-ink, #2C2C2C); font-family: inherit; cursor: pointer;
}
.pn-note-row:first-child { border-top: 0; }
.pn.sz-xs .pn-note-row { padding: 4px 2px; }
/* 首字方形色块，按行序轮换低饱和配色 */
.pn-note-ava {
  flex: none; width: clamp(20px, 7.2cqw, 28px); height: clamp(20px, 7.2cqw, 28px);
  border-radius: clamp(6px, 2.2cqw, 9px); display: flex; align-items: center; justify-content: center;
  font-size: clamp(11px, 3.2cqw, 14px); font-weight: 800; color: #fff;
  background: linear-gradient(150deg, #9CAFC4, #6F8399);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .26);
}
.pn-note-list .pn-note-row:nth-child(5n+2) .pn-note-ava { background: linear-gradient(150deg, #BCA9BF, #94809E); }
.pn-note-list .pn-note-row:nth-child(5n+3) .pn-note-ava { background: linear-gradient(150deg, #C7B49E, #A38B72); }
.pn-note-list .pn-note-row:nth-child(5n+4) .pn-note-ava { background: linear-gradient(150deg, #A8BFAA, #7F9A84); }
.pn-note-list .pn-note-row:nth-child(5n+5) .pn-note-ava { background: linear-gradient(150deg, #C6A3A3, #A07C7C); }
.pn-note-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pn-note-t { font-size: clamp(10.5px, min(3.1cqw, 3.9cqh), 13.5px); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 两行摘要 */
.pn-note-x {
  font-size: clamp(8.5px, min(2.4cqw, 3.1cqh), 11px); opacity: .58;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  white-space: normal; line-height: 1.35; overflow: hidden;
}
.pn-note-del {
  flex: none; width: 16px; height: 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .14s ease; color: var(--pn-ink-2, rgba(44, 44, 44, .7));
}
.pn-note-row:hover .pn-note-del { opacity: 1; }
.pn-reader { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pn-reader-head { flex: none; }
/* 阅读态：更大的标题与行距 */
.pn-reader-title {
  font-size: clamp(15px, min(4.8cqw, 5.8cqh), 24px); font-weight: 800; color: var(--pn-ink, #2C2C2C);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  white-space: normal; line-height: 1.28; letter-spacing: -.01em;
}
.pn-reader-meta { font-size: clamp(8.5px, min(2.4cqw, 3.1cqh), 11px); opacity: .58; margin-top: 2px; }
.pn-reader-body { flex: 1; min-height: 0; overflow-y: auto; margin-top: 6px; padding-right: 2px; line-height: 1.78; font-size: clamp(12px, 3.1cqw, 14px); }
.pn-reader-foot { flex: none; display: flex; align-items: center; gap: 4px; margin-top: 5px; padding-top: 4px; border-top: 1px solid var(--line, rgba(44, 44, 44, .06)); }
.pn-reader-page { font-size: clamp(9px, min(2.6cqw, 3.4cqh), 12px); opacity: .66; font-variant-numeric: tabular-nums; }
.pn-mini-btn {
  flex: none; width: 22px; height: 22px; border-radius: 7px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--eo-glass-border); background: var(--surface); color: var(--eo-primary-deep);
}

/* ---- 相册 ---- */
.pn-photo-flow { margin-top: 6px; column-count: 2; column-gap: 4px; }
.pn.sz-lg .pn-photo-flow { column-count: 3; }
.pn-photo {
  position: relative; display: block; width: 100%; margin: 0 0 4px; padding: 0; border: 0;
  border-radius: clamp(6px, 2.4cqw, 10px); overflow: hidden; background: var(--pn-fill, rgba(44, 44, 44, .06));
  break-inside: avoid; cursor: zoom-in; line-height: 0;
  box-shadow: 0 3px 12px -8px rgba(44, 44, 44, .55);
}
.pn-photo img { width: 100%; height: auto; display: block; object-fit: cover; transition: transform .38s cubic-bezier(.2, .8, .2, 1); }
.pn-photo:hover img { transform: scale(1.06); }
/* 底部渐变遮罩 + 标题 */
.pn-photo-cap {
  position: absolute; left: 0; right: 0; bottom: 0; padding: clamp(8px, 3cqw, 14px) 5px 3px;
  background: linear-gradient(0deg, rgba(24, 24, 24, .72), rgba(24, 24, 24, 0));
  color: #fff; font-size: clamp(9px, 2.4cqw, 11px); line-height: 1.25; text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  opacity: 0; transition: opacity .2s ease;
}
.pn-photo:hover .pn-photo-cap { opacity: 1; }
@media (hover: none) { .pn-photo-cap { opacity: .92; } }
.pn-photo-del {
  position: absolute; right: 2px; top: 2px; width: 16px; height: 16px; border: none; border-radius: 5px;
  background: rgba(44, 44, 44, .45); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .14s ease;
}
.pn-photo:hover .pn-photo-del { opacity: 1; }

/* ---- 地图 ---- */
/* 地图四周留 8px 边框区：鼠标落在这里时事件冒泡到卡片 → 整卡移动；落在地图内则平移地图 */
.pn-map {
  position: relative; flex: 1; min-height: 40px; margin: 6px 8px 4px; border-radius: 8px; overflow: hidden;
  background: rgba(44, 44, 44, .04);
}
.pn-body-map { display: flex; flex-direction: column; }
.pn-body-map > .pn-big, .pn-body-map > .pn-foot { flex: none; }

.pn-map-flag {
  font-size: clamp(8px, min(2.3cqw, 3cqh), 10.5px); font-weight: 800; color: var(--pn-ink, #2C2C2C);
  background: color-mix(in srgb, var(--accent, #E2A94F) 22%, transparent);
  border-radius: 99px; padding: 1px 6px; display: inline-flex; align-items: center; gap: 3px;
}
.pn-map-zoom {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%); z-index: 4;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  background: var(--surface); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid var(--hair); border-radius: 999px; padding: 4px 3px;
  box-shadow: 0 2px 8px -3px rgba(44, 44, 44, .35);
}
.pn-map-zoom input[type=range] { width: 10px; height: 54px; accent-color: var(--eo-primary); cursor: pointer; writing-mode: vertical-lr; direction: rtl; }
.pn-map-zbtn {
  width: 16px; height: 16px; flex: none; border: none; border-radius: 50%; cursor: pointer;
  background: rgba(28, 28, 30, .85); color: #fff; font-size: 12px; line-height: 1;
  display: flex; align-items: center; justify-content: center; font-weight: 700;
  transition: background .14s ease, transform .14s ease;
}
.pn-map-zbtn:hover { transform: translateY(-3px); box-shadow: var(--eo-shadow-lift); }

/* ---- 天气 ---- */
.pn-wx { display: flex; flex-direction: column; gap: clamp(4px, 1.4cqh, 9px); }
/* 天空渐变随天气类别切换；夜间整体转深，文字转亮 */
.wx-hero {
  position: relative; flex: 1 1 auto; min-height: clamp(64px, 38cqh, 150px); overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end; gap: clamp(2px, .7cqh, 5px);
  padding: clamp(7px, 2.6cqw, 16px) clamp(8px, 3cqw, 18px);
  border-radius: clamp(10px, 3.6cqw, 18px);
  background: linear-gradient(158deg, #FCF6E8 0%, #F1E7D3 55%, #E7DCC6 100%);
  color: #2C2C2C;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .6), 0 4px 14px -10px rgba(44, 44, 44, .5);
}
.wx-hero.partly { background: linear-gradient(158deg, #FBF6EC 0%, #EDEFE9 55%, #DFE2DB 100%); }
.wx-hero.cloud { background: linear-gradient(158deg, #F4F2EC 0%, #E4E1D8 60%, #D6D2C7 100%); }
.wx-hero.rain { background: linear-gradient(158deg, #EEF2F4 0%, #D6E0E4 58%, #C3CFD4 100%); }
.wx-hero.snow { background: linear-gradient(158deg, #F7F9FA 0%, #E3EAEC 58%, #D5DDE0 100%); }
.wx-hero.thunder { background: linear-gradient(158deg, #EEECF2 0%, #D5D1DC 58%, #C2BEC9 100%); }
.wx-hero.fog { background: linear-gradient(158deg, #F3F1EC 0%, #E2DFD7 58%, #D2CEC5 100%); }
.wx-hero.night {
  background: linear-gradient(165deg, #30343A 0%, #262930 55%, #1D2024 100%);
  color: #EDEBE7;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .12), 0 6px 18px -12px rgba(0, 0, 0, .7);
}
:global([data-theme='dark'] .wx-hero) { filter: brightness(.92) saturate(.92); }
.wx-art {
  position: absolute; right: clamp(6px, 2.6cqw, 16px); top: clamp(4px, 1.8cqh, 12px);
  width: clamp(46px, 30cqw, 92px); aspect-ratio: 1; pointer-events: none;
}
.wx-art svg { width: 100%; height: 100%; display: block; }
.wx-cloud { fill: #FDFBF6; stroke: rgba(44, 44, 44, .05); stroke-width: 1; }
.wx-hero.night .wx-cloud { fill: rgba(240, 242, 246, .24); stroke: rgba(255, 255, 255, .06); }
.wx-hero.cloud .wx-cloud.soft { opacity: .62; }
.wx-star { fill: rgba(255, 255, 255, .55); }
.wx-bolt { fill: #DFAE55; }
.wx-fog { opacity: .75; }
.wx-snow { opacity: .9; }
.wx-main { display: flex; flex-direction: column; gap: 1px; max-width: 68%; }
.wx-temp {
  font-size: clamp(22px, 9.4cqw, 40px); font-weight: 800; line-height: .98; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums; text-shadow: 0 1px 0 rgba(255, 255, 255, .28);
}
.wx-temp i { font-style: normal; font-size: .38em; font-weight: 700; opacity: .58; margin-left: 3px; }
.wx-desc { font-size: clamp(10px, 2.9cqw, 13px); font-weight: 700; opacity: .72; }
.wx-meta { display: flex; flex-wrap: wrap; gap: clamp(3px, 1.4cqw, 7px); margin-top: clamp(2px, .8cqh, 5px); }
.wx-chip {
  display: inline-flex; align-items: baseline; gap: 2px; padding: 1px clamp(4px, 1.6cqw, 8px);
  border-radius: 999px; background: rgba(255, 255, 255, .5); border: 1px solid rgba(255, 255, 255, .7);
  font-size: clamp(9px, 2.3cqw, 10.5px); opacity: .9; white-space: nowrap;
}
.wx-chip b { font-size: 1.12em; font-weight: 800; }
.wx-hero.night .wx-chip { background: rgba(255, 255, 255, .13); border-color: rgba(255, 255, 255, .16); }
.wx-city { display: flex; align-items: center; gap: 3px; min-width: 0; font-size: clamp(9.5px, 2.5cqw, 11.5px); opacity: .7; }
.wx-city span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-pin { width: clamp(9px, 3cqw, 12px); height: auto; flex: none; }
.wx-days { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(4px, 1.8cqw, 10px); flex: none; }
.wx-day {
  display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0;
  padding: clamp(2px, 1cqh, 6px) 2px; border-radius: clamp(7px, 2.6cqw, 12px);
  background: var(--surface-2, rgba(255, 255, 255, .42));
}
.wx-day.today { background: color-mix(in srgb, var(--accent, #E2A94F) 16%, transparent); }
.wx-col {
  flex: none; height: clamp(20px, 8cqh, 34px); width: clamp(6px, 2.4cqw, 10px);
  display: flex; align-items: flex-end; border-radius: 99px; background: var(--pn-fill, rgba(44, 44, 44, .06)); overflow: hidden;
}
.wx-col i { display: block; width: 100%; border-radius: 99px; background: linear-gradient(180deg, rgba(226, 169, 79, .92), rgba(112, 135, 161, .55)); }
.wx-day.today .wx-col i { background: linear-gradient(180deg, #E2A94F, #CE8B34); }
.wx-day-k { font-size: clamp(9px, 2.3cqw, 10.5px); opacity: .62; }
.wx-day-t { font-size: clamp(9.5px, 2.6cqw, 12px); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.wx-day-t b { font-weight: 700; opacity: .52; margin-left: 2px; }
.wx-loading { flex: 1; min-height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; opacity: .68; font-size: clamp(10px, 2.8cqw, 12px); text-align: center; }
.wx-loading-art { width: clamp(48px, 30cqw, 88px); height: auto; animation: wx-float 3.2s ease-in-out infinite; }
@keyframes wx-float { 0%, 100% { transform: translateY(0); opacity: .8; } 50% { transform: translateY(-3px); opacity: 1; } }
@container pn (max-height: 160px) {
  .wx-art { width: clamp(38px, 24cqw, 58px); }
  .wx-temp { font-size: clamp(19px, 8.6cqw, 30px); }
}

/* ---- Steam ---- */
.pn-steam { margin-top: 6px; display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(88px, 30cqw, 130px), 1fr)); gap: clamp(4px, 1.6cqw, 10px); overflow: hidden; }
.pn-game { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pn-game__cover {
  position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: clamp(5px, 1.8cqw, 9px); overflow: hidden;
  background-size: cover; background-position: center; background-color: rgba(44, 44, 44, .08);
  box-shadow: 0 3px 10px -6px rgba(44, 44, 44, .5);
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(12px, 4cqw, 18px); font-weight: 800; color: #fff;
}
.pn-game__cover.ph { background-image: linear-gradient(150deg, #96A9BE, #66798F 58%, #4E6076); }
.pn-game__meta { min-width: 0; flex: 1; }
.pn-game__name { font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); font-weight: 700; color: var(--pn-ink, #2C2C2C); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-game__h { font-size: clamp(8px, min(2.3cqw, 3cqh), 10.5px); opacity: .66; }
.pn-mini { margin-top: 4px; }
.pn-line-thumb {
  flex: none; width: clamp(18px, 6.6cqw, 26px); aspect-ratio: 16 / 10; border-radius: 5px; overflow: hidden;
  background-size: cover; background-position: center; background-color: var(--pn-fill, rgba(44, 44, 44, .06));
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(9px, 2.6cqw, 11px); font-weight: 800; color: #fff;
}
.pn-line-thumb.ph { background-image: linear-gradient(150deg, #96A9BE, #66798F); }
.pn-line-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- 日历（迷你月历 + 当日议程） ---- */
.pn-cal { display: flex; flex-direction: column; overflow: hidden; }
.cal { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cal-head {
  display: flex; align-items: center; gap: 3px; flex: none; margin: 0 -2px 4px; min-width: 0;
  padding: 2px 4px; border-radius: 10px;
  background: linear-gradient(96deg, rgba(226, 169, 79, .22), rgba(112, 135, 161, .10) 58%, rgba(112, 135, 161, 0) 100%);
}
.cal-grow { flex: 1; min-width: 2px; }
.pn-cal-title { font-size: clamp(11.5px, min(3.6cqw, 4.6cqh), 19px); font-weight: 900; color: var(--pn-ink, #2C2C2C); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; letter-spacing: .01em; }
.pn-cal-nav {
  width: 22px; height: 22px; border-radius: 8px; flex: none;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--eo-glass-border); background: var(--surface-2);
  color: var(--eo-primary-deep); cursor: pointer;
}
.pn.sz-lg .pn-cal-nav { width: 26px; height: 26px; }
.cal-today-b {
  flex: none; height: 22px; padding: 0 8px; border-radius: 99px; cursor: pointer;
  border: 1px solid var(--eo-glass-border); background: var(--surface-2);
  font-size: clamp(9px, min(2.6cqw, 3.4cqh), 12px); font-weight: 800; color: var(--eo-primary-deep);
}
.pn-cal-view { display: inline-flex; flex: none; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: var(--surface-2); overflow: hidden; }
.pn-cal-view__b {
  border: none; background: transparent; cursor: pointer;
  font-size: clamp(9px, min(2.6cqw, 3.4cqh), 12px); font-weight: 800; color: var(--pn-ink-2, #86868B);
  padding: 2px 8px; transition: background .16s ease, color .16s ease;
}
.pn-cal-view__b.on { background: var(--eo-primary); color: #fff; }
.cal-add-b {
  flex: none; width: 22px; height: 22px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--eo-glass-border); background: var(--surface);
  color: var(--eo-primary-deep); display: flex; align-items: center; justify-content: center;
}
.pn.sz-lg .cal-add-b { width: 26px; height: 26px; }
.cal-body { flex: 1; min-height: 0; display: flex; gap: 8px; }
.cal-month { flex: 1; min-width: 0; display: flex; flex-direction: column; container-type: inline-size; }
.cal-body.split .cal-month { flex: 0 0 56%; }
.cal-wd { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; flex: none; margin-bottom: 1px; }
.cal-wd span { text-align: center; font-size: 9.5px; font-weight: 800; opacity: .5; letter-spacing: .04em; }
.cal-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(6, minmax(0, 1fr)); gap: 1px; }
.cal-grid.week { grid-template-rows: minmax(0, 1fr); }
.cal-cell {
  position: relative; min-width: 0; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  padding: 0; border: 0; border-radius: 7px; background: transparent;
  color: var(--pn-ink, #2C2C2C); font-family: inherit; cursor: pointer;
}
.cal-cell.out { opacity: .32; }
.cal-dom {
  display: flex; align-items: center; justify-content: center; flex: none;
  /* 以「一格 ≈ 14.28cqw」为基准：日期圆 ≈ 10cqw（40~48px 的 Material 网格手感） */
  width: clamp(20px, 9.6cqw, 34px); height: clamp(20px, 9.6cqw, 34px);
  border-radius: 50%; font-size: clamp(11px, 4.2cqw, 17px); font-weight: 800; line-height: 1;
  font-variant-numeric: tabular-nums;
}
.cal-cell.today .cal-dom { background: var(--accent, #E2A94F); color: #fff; box-shadow: 0 2px 7px -3px rgba(44, 44, 44, .45); }
.cal-cell.sel .cal-dom { box-shadow: inset 0 0 0 2px var(--accent, #E2A94F); }
.cal-grid .cal-cell:nth-child(7n+6) .cal-dom,
.cal-grid .cal-cell:nth-child(7n+7) .cal-dom { color: #B4796C; }
.cal-grid .cal-cell.today .cal-dom { color: #fff; }
.cal-grid .cal-cell .cal-dots i { background: rgba(112, 135, 161, .55); }
.cal-dots { display: flex; align-items: center; justify-content: center; gap: 2px; height: 4px; flex: none; }
.cal-dots i { width: clamp(3px, 1.3cqw, 5px); height: clamp(3px, 1.3cqw, 5px); border-radius: 50%; }
.cal-items { width: 100%; padding: 0 2px 1px; display: flex; flex-direction: column; gap: 0; min-height: 0; overflow: hidden; }
.cal-items i {
  font-style: normal; font-size: clamp(8px, 2.2cqw, 11px); line-height: 1.3;
  width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: .82; text-align: left; padding-left: 3px;
}
.cal-items i.done { opacity: .4; text-decoration: line-through; }
.cal-agenda { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line, rgba(44, 44, 44, .08)); padding-left: 8px; }
.ca-head { display: flex; align-items: center; gap: 4px; flex: none; }
.ca-day { font-size: clamp(13px, min(5cqw, 6.2cqh), 20px); font-weight: 900; color: var(--pn-ink, #2C2C2C); line-height: 1.1; }
.ca-week { font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); opacity: .65; }
.ca-month-l { font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); opacity: .55; }
.ca-add {
  margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 8px; border-radius: 99px; border: 1px solid var(--eo-glass-border);
  background: var(--surface-2); color: var(--eo-primary-deep); font-size: clamp(9px, min(2.5cqw, 3.2cqh), 12px); font-weight: 800; cursor: pointer;
}
.ca-list { flex: 1; min-height: 0; overflow-y: auto; margin-top: 4px; overscroll-behavior: contain; }
.ca-row { display: flex; align-items: center; gap: 5px; padding: clamp(2px, .7cqh, 4px) 0; border-top: 1px solid var(--line, rgba(44, 44, 44, .06)); font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); color: var(--pn-ink, #2C2C2C); }
.ca-row:first-child { border-top: 0; }
.ca-time { flex: none; width: clamp(28px, 8cqw, 40px); font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); opacity: .6; font-variant-numeric: tabular-nums; }
.ca-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-row.done .ca-title { text-decoration: line-through; opacity: .5; }
.ca-empty { font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); opacity: .55; padding: 6px 0; }
.ca-sec { margin-top: clamp(3px, 1.2cqh, 8px); }
.ca-sec-l { font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); font-weight: 800; opacity: .6; margin-bottom: 2px; }
.ca-amt { flex: none; font-weight: 800; font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); font-variant-numeric: tabular-nums; }
.ca-amt.income { color: var(--pn-ink-2, #9E9C97); }
.ca-amt.expense { color: #A97C72; }

/* ---- 待办 / 记账 ---- */
.pn-tasks { display: flex; flex-direction: column; gap: 2px; }
.pn-task { position: relative; display: flex; align-items: center; gap: 6px; font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); color: var(--pn-ink, #2C2C2C); padding: clamp(1px, .6cqh, 3px) 18px clamp(1px, .6cqh, 3px) 0; border-top: 1px solid var(--line, rgba(44, 44, 44, .06)); }
.pn-task:first-child { border-top: none; }
.pn-group { margin-top: 5px; }
.pn-group:first-of-type { margin-top: 3px; }
.pn-group-l { display: flex; align-items: center; gap: 4px; font-size: clamp(8px, min(2.3cqw, 3cqh), 11px); font-weight: 800; opacity: .55; letter-spacing: .04em; margin-bottom: 1px; }
.pn-group-l b { font-size: clamp(7.5px, min(2.1cqw, 2.8cqh), 10px); opacity: .8; }
.pn-task__date { font-size: clamp(8px, min(2.2cqw, 2.9cqh), 10.5px); opacity: .55; flex: none; font-variant-numeric: tabular-nums; }
.pn-task__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-check {
  flex: none; width: 16px; height: 16px; border-radius: 6px; border: 1.5px solid var(--pn-line-strong, rgba(44, 44, 44, .45));
  background: var(--surface); color: var(--pn-ink-2, #9E9C97); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: background .14s ease, border-color .14s ease;
}
.pn-check.on { background: var(--pn-ink-2, #9E9C97); border-color: var(--pn-ink-2, #9E9C97); color: #fff; }
.pn-task.done .pn-task__title { text-decoration: line-through; opacity: .55; }
.pn-del {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 16px; height: 16px;
  border: none; border-radius: 6px; background: transparent; color: var(--pn-ink-2, rgba(44, 44, 44, .7)); cursor: pointer;
  display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .14s ease, background .14s ease;
}
.pn-task:hover .pn-del, .pn-line:hover .pn-del, .pn-led:hover .pn-del { opacity: 1; }
.pn-del:hover { transform: translateY(-3px); box-shadow: var(--eo-shadow-lift); }
.pn-todo-add { display: flex; gap: 4px; margin-top: 6px; flex: none; }
.pn-todo-add input {
  flex: 1; min-width: 0; height: 24px; border-radius: 8px; border: 1px solid var(--eo-glass-border);
  background: var(--surface); padding: 0 8px; font-size: 11px; color: var(--pn-ink, #2C2C2C); box-sizing: border-box;
}
.pn-add-btn {
  flex: none; width: 26px; height: 24px; border-radius: 8px; border: 1px solid var(--eo-glass-border);
  background: var(--eo-glass-strong); color: var(--eo-primary-deep); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .14s ease, transform .14s ease;
}
.pn-add-btn:hover { transform: translateY(-3px); box-shadow: var(--eo-shadow-lift); }
.pn-ledger { display: flex; flex-direction: column; gap: 2px; }
.pn-led { display: flex; align-items: center; gap: 5px; font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px); color: var(--pn-ink, #2C2C2C); padding: clamp(1px, .6cqh, 3px) 18px clamp(1px, .6cqh, 3px) 0; border-top: 1px solid var(--line, rgba(44, 44, 44, .06)); position: relative; }
.pn-led:first-child { border-top: none; }
.pn-led__date { flex: none; width: clamp(24px, 7cqw, 36px); font-size: clamp(8px, min(2.2cqw, 2.9cqh), 10.5px); opacity: .5; font-variant-numeric: tabular-nums; }
.pn-led__cat { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .85; }
.pn-led__cat i { font-style: normal; opacity: .55; }
.pn-led__amt { flex: none; font-variant-numeric: tabular-nums; font-weight: 700; }
.pn-led__amt.income { color: var(--pn-ink-2, #9E9C97); }
.pn-led__amt.expense { color: #A97C72; }
.pn-ledger-add { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex: none; }
.pn-type {
  flex: none; height: 24px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--eo-glass-border); font-size: 10px; font-weight: 800;
  transition: background .14s ease, color .14s ease;
}
.pn-type.expense { background: rgba(169, 124, 114, .14); color: #A97C72; }
.pn-type.income { background: rgba(158, 156, 151, .16); color: var(--pn-ink-2, #9E9C97); }
.pn-ledger-amt, .pn-ledger-cat {
  min-width: 0; height: 24px; border-radius: 8px; border: 1px solid var(--eo-glass-border);
  background: var(--surface); padding: 0 7px; font-size: 11px; color: var(--pn-ink, #2C2C2C); box-sizing: border-box;
}
.pn-ledger-amt { width: 64px; flex: none; -moz-appearance: textfield; }
.pn-ledger-amt::-webkit-outer-spin-button, .pn-ledger-amt::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pn-ledger-cat { flex: 1; }
.pn-ledger-sel { flex: none; width: 72px; padding: 0 4px; }
.pn-ledger-sel:invalid { color: var(--pn-ink-2, #9E9C97); }

/* ---- 浮层内容 ---- */
.memo-ed {
  min-height: 180px; max-height: 46vh; overflow-y: auto; outline: none;
  border: 1px solid var(--eo-glass-border); border-radius: 14px; padding: 12px 14px;
  font-size: 14px; line-height: 1.65; color: var(--eo-ink); background: var(--eo-glass);
  word-break: break-word;
}
.memo-ed:empty::before { content: attr(data-placeholder); opacity: .45; }
.memo-ed :deep(p) { margin: 0 0 8px; }
.sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.sheet-row { display: flex; gap: 10px; }
.sheet-row .field { flex: 1; min-width: 0; }
.sheet-hint { font-size: 11px; opacity: .5; margin-top: 8px; text-align: right; }
.photo-view { display: flex; flex-direction: column; gap: 10px; }
.photo-view img { width: 100%; max-height: 56vh; object-fit: contain; border-radius: 16px; background: rgba(44, 44, 44, .05); }
.photo-bar { display: flex; align-items: center; justify-content: space-between; font-size: 12px; opacity: .8; }

/* ---- 小尺寸压缩 ---- */
.pn.short .pn-sub, .pn.short .pn-foot { display: none; }
.pn.sz-xs .pn-sub { display: none; }
.pn.sz-xs .pn-line { padding: 2px 0; font-size: 10.5px; }
.pn.sz-xs .pn-bar-row { margin-bottom: 2px; }
.pn.sz-xs .pn-todo-add input, .pn.sz-xs .pn-ledger-amt { font-size: 10px; }
.pn.sz-xs .cal-today-b, .pn.sz-xs .pn-cal-view { display: none; }

/* v2.1.0：容器查询兜底 —— 卡片被压到很矮 / 很窄时自动收起次要信息，只留标题与主内容 */
@container pn (max-height: 150px) {
  .pn-sub, .pn-foot, .pn-note-x, .pn-col-x, .pn-group-l { display: none; }
  .pn-body { margin-top: 2px; }
  .pn-bars, .pn-week { margin-top: 2px; }
}
@container pn (max-width: 230px) {
  .pn-task__status, .pn-game__h { display: none; }
}

/* ---- 任务面板（与 Todo 分开的日常任务） ---- */
.pn-taskpanel .pn-tasks { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.pn-task__status {
  flex: none; font-size: clamp(7.5px, min(2.1cqw, 2.8cqh), 10px); font-weight: 700; padding: 1px 5px; border-radius: 99px;
  background: var(--surface, rgba(255, 255, 255, .45)); opacity: .75;
}
.pn-task__date.overdue { color: #B4796C; font-weight: 800; }

/* ---- 收藏面板 ---- */
.pn-col-list { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.pn-col-row {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 2px;
  border: none; border-top: 1px solid var(--line, rgba(44, 44, 44, .06)); background: transparent;
  text-align: left; cursor: pointer; color: var(--pn-ink, #2C2C2C); font-size: clamp(9.5px, min(2.9cqw, 3.6cqh), 12.5px);
}
.pn-col-row:first-child { border-top: 0; }
.pn-col-ico {
  flex: none; width: 16px; height: 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  background: var(--surface, rgba(255, 255, 255, .5)); color: #7E6FA6;
}
.pn-col-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pn-col-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pn-col-x { font-size: clamp(8px, min(2.2cqw, 2.9cqh), 10.5px); opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn .pn-col-row:hover { transform: none; box-shadow: none; opacity: .82; }
.pn-col-add { display: flex; gap: 4px; margin-top: 6px; flex: none; }
.pn-col-title, .pn-col-url {
  min-width: 0; height: 24px; border-radius: 8px; border: 1px solid var(--eo-glass-border);
  background: var(--surface); padding: 0 7px; font-size: 11px; color: var(--pn-ink, #2C2C2C); box-sizing: border-box;
}
.pn-col-title { width: 88px; flex: none; }
.pn-col-url { flex: 1; }
.pn.sz-xs .pn-col-title { width: auto; flex: 1; }

/* ---- 数据可视化面板 ---- */
.pn-stats { display: flex; flex-direction: column; gap: clamp(4px, 1.4cqh, 9px); }
/* 完成率环 */
.st-hero { display: flex; align-items: center; gap: clamp(6px, 2.4cqw, 12px); flex: none; }
.st-ring {
  position: relative; flex: none; width: clamp(40px, 16cqw, 68px); aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
}
.st-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.st-ring-bg { fill: none; stroke: var(--pn-fill, rgba(44, 44, 44, .07)); stroke-width: 5; }
.st-ring-fg {
  fill: none; stroke: #7C90A9; stroke-width: 5; stroke-linecap: round; stroke-dasharray: 113.1;
  transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .4s ease;
}
.st-ring-n { font-size: clamp(12px, 4.2cqw, 22px); font-weight: 800; font-variant-numeric: tabular-nums; }
.st-ring-n i { font-style: normal; font-size: .56em; opacity: .55; margin-left: 1px; }
.st-hero-m { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.st-hero-l { font-size: clamp(9px, 2.5cqw, 11px); font-weight: 800; opacity: .58; letter-spacing: .02em; }
.st-hero-s { font-size: clamp(11px, 3.2cqw, 14px); font-weight: 700; font-variant-numeric: tabular-nums; }
.st-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; min-width: 0; }
.st-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 1px clamp(4px, 1.5cqw, 7px);
  border-radius: 99px; background: var(--surface-2, rgba(255, 255, 255, .42));
  font-size: clamp(9px, 2.3cqw, 10.5px); opacity: .82; white-space: nowrap;
}
.st-chip i { width: 5px; height: 5px; border-radius: 50%; flex: none; }
/* 分类占比横条 */
.st-cats { display: flex; flex-direction: column; gap: clamp(2px, 1cqh, 5px); flex: none; }
.st-cat { display: flex; align-items: center; gap: 5px; font-size: clamp(9.5px, 2.5cqw, 11px); }
.st-cat-l { flex: none; width: clamp(24px, 8.5cqw, 34px); opacity: .68; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-cat-track { flex: 1; min-width: 0; height: clamp(4px, 1.2cqh, 7px); border-radius: 99px; background: var(--pn-fill, rgba(44, 44, 44, .07)); overflow: hidden; }
.st-cat-track i { display: block; height: 100%; border-radius: 99px; opacity: .9; transition: width .3s ease; }
.st-cat-n { flex: none; width: clamp(26px, 8.5cqw, 34px); text-align: right; opacity: .55; font-variant-numeric: tabular-nums; }
/* 近 7 天柱状图：基线 + 今日高亮 + 最小可见高度 */
.st-week { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; }
.st-week-head { display: flex; justify-content: space-between; align-items: baseline; font-size: clamp(9px, 2.4cqw, 11px); font-weight: 800; opacity: .58; }
.st-week-head b { font-variant-numeric: tabular-nums; }
.st-bars7 {
  flex: 1; min-height: clamp(28px, 9cqh, 58px); display: flex; align-items: flex-end;
  gap: clamp(2px, 1.2cqw, 6px); padding-top: 4px;
  border-bottom: 1px solid var(--line, rgba(44, 44, 44, .10));
}
.st-bar7 { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.st-bar7 i {
  display: block; width: 62%; max-width: 22px; min-height: 3px; border-radius: 5px 5px 2px 2px;
  background: linear-gradient(180deg, rgba(112, 135, 161, .95), rgba(112, 135, 161, .32));
  transition: height .3s ease;
}
.st-bar7.today i {
  background: linear-gradient(180deg, #E2A94F, rgba(226, 169, 79, .42));
  box-shadow: 0 0 0 1px rgba(226, 169, 79, .22);
}
.st-bar7 span { flex: none; font-size: clamp(9px, 2.1cqw, 9.5px); opacity: .5; white-space: nowrap; }

/* ---- 日历议程：任务（实线）/ Todo（虚线）不同标记 ---- */
.ca-sec-l { display: flex; align-items: center; gap: 4px; }
.ca-sec-l b { font-size: 9px; opacity: .8; }
.ca-row.is-task { border-left: 2px solid #D9A257; padding-left: 5px; }
.ca-row.is-todo { border-left: 2px dotted #7E9A7E; padding-left: 5px; }

/* ===== 2026-11-04 P1：字号整体上调 + 悬停操作按钮 =====
   目标：正文不低于 11px，字号随卡片尺寸连续放大；小卡靠减少条目而不是缩字。
   操作按钮：默认隐藏，悬停整卡时出现，尺寸 30px。 */
.pn-refresh {
  width: 30px; height: 30px;
  opacity: 0; pointer-events: none;
  transition: opacity .16s ease, background .14s ease, transform .2s cubic-bezier(.22, 1, .36, 1);
}
.pn:hover .pn-refresh, .pn:focus-within .pn-refresh { opacity: 1; pointer-events: auto; }
.pn.sz-xs .pn-refresh { width: 28px; height: 28px; }
@media (hover: none) { .pn-refresh { opacity: 1; pointer-events: auto; } }
.pn-add-btn { width: 30px; height: 28px; }
.pn-head { font-size: clamp(12.5px, min(3.9cqw, 4.8cqh), 16px); }
.pn-big { font-size: clamp(17px, min(6.4cqw, 7.6cqh), 30px); }
.pn-big.sm { font-size: clamp(15px, min(5.2cqw, 6.2cqh), 24px); }
.pn-unit { font-size: clamp(11px, min(2.7cqw, 3.4cqh), 13px); }
.pn-sub { font-size: clamp(11px, min(2.9cqw, 3.6cqh), 13px); }
.pn-foot { font-size: clamp(11px, min(2.9cqw, 3.6cqh), 13px); }
.pn-empty { font-size: clamp(11.5px, min(3.2cqw, 4.2cqh), 14px); }
.pn-chip-btn { font-size: clamp(11.5px, min(3.1cqw, 4cqh), 13.5px); }
.pn-bar-name { font-size: clamp(11px, min(2.8cqw, 3.6cqh), 13px); }
.pn-bar-num { font-size: clamp(11px, min(2.8cqw, 3.6cqh), 13px); width: clamp(20px, 6cqw, 28px); }
.pn-line { font-size: clamp(12px, min(3.3cqw, 4.2cqh), 14.5px); }
.pn-line-right { font-size: clamp(11px, min(2.8cqw, 3.5cqh), 12.5px); }
.pn-note-t { font-size: clamp(12.5px, min(3.5cqw, 4.4cqh), 15px); }
.pn-note-x { font-size: clamp(11px, min(2.8cqw, 3.5cqh), 12.5px); }
.pn-reader-title { font-size: clamp(15px, min(4.4cqw, 5.4cqh), 20px); }
.pn-reader-meta { font-size: clamp(11px, min(2.8cqw, 3.5cqh), 12.5px); }
.pn-reader-page { font-size: clamp(11px, min(3cqw, 3.8cqh), 13px); }
.pn-game__name { font-size: clamp(11.5px, min(3.2cqw, 4cqh), 13.5px); }
.pn-game__h { font-size: clamp(11px, min(2.8cqw, 3.5cqh), 12.5px); }
.pn-cal-title { font-size: clamp(13px, min(4cqw, 5cqh), 20px); }
.cal-today-b, .pn-cal-view__b { font-size: clamp(11px, min(2.8cqw, 3.6cqh), 13px); }
.cal-wd span { font-size: 11px; }
.cal-cell em { font-size: clamp(11px, 2.4cqw, 12px); }
.ca-day { font-size: clamp(15px, min(5.2cqw, 6.4cqh), 22px); }
.ca-week, .ca-month-l { font-size: clamp(11px, min(2.5cqw, 3.2cqh), 12.5px); }
.ca-row { font-size: clamp(12px, min(3.3cqw, 4.2cqh), 14px); }
.ca-time { font-size: clamp(11px, min(2.5cqw, 3.2cqh), 12.5px); }
.ca-empty, .ca-sec-l { font-size: 11px; }
.ca-sec-l b { font-size: 11px; }
.ca-amt { font-size: clamp(12px, min(3.2cqw, 4cqh), 14px); }
.pn-task, .pn-led { font-size: clamp(12px, min(3.3cqw, 4.2cqh), 14px); }
.pn-task__status { font-size: 11px; }
.pn-task__date, .pn-led__date { font-size: clamp(11px, min(2.5cqw, 3.2cqh), 12px); }
.pn-group-l, .pn-group-l b { font-size: 11px; }
.pn-todo-add input, .pn-ledger-amt, .pn-col-title, .pn-col-url { font-size: 12px; }
.pn-col-row { font-size: clamp(12px, min(3.3cqw, 4.2cqh), 14px); }
.pn-col-x { font-size: 11px; }
.pn-col-ico { width: 18px; height: 18px; }
.pn-stat-v { font-size: clamp(15px, min(4.8cqw, 6.2cqh), 24px); }
.pn-stat-l, .pn-stat-s, .pn-week-head, .pn-bar7 span { font-size: 11px; }
.pn.sz-xs .pn-line { font-size: 12px; }
.pn.sz-xs .pn-todo-add input, .pn.sz-xs .pn-ledger-amt { font-size: 12px; }

/* ===== 2026-11-06 画布卡片视觉重绘 ===== */
/* 空状态插图（纯内联 SVG） */
.pn-empty-art {
  height: 100%; min-height: 56px; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(3px, 1.4cqh, 8px); padding: 2px 4px; text-align: center;
  font-size: clamp(10px, min(2.6cqw, 3.4cqh), 12px); line-height: 1.4;
  opacity: .62;
}
.pn-empty-art svg { width: clamp(52px, 26cqw, 96px); height: auto; max-height: 54%; flex: none; }
.ea-line { fill: none; stroke: var(--pn-ink-2, rgba(44, 44, 44, .55)); stroke-width: 1.6; stroke-linecap: round; }
.ea-bar { stroke: rgba(226, 169, 79, .7); stroke-width: 3; }
.ea-path { stroke: #7C90A9; stroke-width: 2; }
.ea-dot { fill: #7C90A9; }
.ea-spark { opacity: .5; }

/* 待办：完成率环 + 分组色条 */
.td-hero { display: flex; align-items: center; gap: clamp(6px, 2.4cqw, 12px); flex: none; }
.td-ring { position: relative; flex: none; width: clamp(34px, 13cqw, 52px); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
.td-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.td-ring-bg { fill: none; stroke: var(--pn-fill, rgba(44, 44, 44, .07)); stroke-width: 4.5; }
.td-ring-fg { fill: none; stroke: #7E9A7E; stroke-width: 4.5; stroke-linecap: round; stroke-dasharray: 100.5; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .4s ease; }
.td-ring-n { font-size: clamp(10px, 3.2cqw, 14px); font-weight: 800; font-variant-numeric: tabular-nums; }
.td-hero-m { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.td-hero-n { font-size: clamp(14px, 4.8cqw, 22px); font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.td-hero-n span { font-size: .46em; font-weight: 600; opacity: .55; margin-left: 3px; }
.td-hero-s { font-size: clamp(9px, 2.5cqw, 11px); opacity: .6; }
.pn-group { position: relative; padding-left: 6px; }
.pn-group::before {
  content: ''; position: absolute; left: 0; top: 1px; bottom: 1px; width: 2px;
  border-radius: 2px; background: var(--gc, #9AA6B3); opacity: .72;
}
.pn-group.g-today { --gc: #D08E39; }
.pn-group.g-week { --gc: #7C90A9; }
.pn-group.g-later { --gc: #9285AC; }
.pn-group.g-none { --gc: #9AA6B3; }
.pn-group.g-done { --gc: #7E9A7E; }
.pn-group.g-done .pn-group-l { opacity: .42; }

/* 记账：本月支出大字 + 分类环形占比 + 近 7 天趋势 */
.led-hero { display: flex; flex-direction: column; gap: clamp(3px, 1.2cqh, 7px); flex: none; }
.led-today { display: flex; align-items: baseline; gap: clamp(5px, 2cqw, 10px); min-width: 0; }
.led-today-l { flex: none; font-size: clamp(9px, 2.5cqw, 11px); font-weight: 800; opacity: .58; }
.led-today-n { font-size: clamp(17px, 6.2cqw, 30px); font-weight: 800; line-height: 1; color: #A97C72; font-variant-numeric: tabular-nums; }
.led-today-n i { font-style: normal; font-size: .4em; font-weight: 700; opacity: .6; margin-left: 2px; }
.led-bal { margin-left: auto; flex: none; font-size: clamp(9px, 2.3cqw, 10.5px); opacity: .62; white-space: nowrap; font-variant-numeric: tabular-nums; }
.led-bal.pos { color: #6F8868; }
.led-bal.neg { color: #A97C72; }
.led-mid { display: flex; align-items: center; gap: clamp(6px, 2.2cqw, 10px); min-width: 0; }
.led-donut { flex: none; width: clamp(34px, 12cqw, 46px); aspect-ratio: 1; }
.led-donut-bg { stroke: var(--pn-fill, rgba(44, 44, 44, .07)); }
.led-legend { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.led-legend-i { display: flex; align-items: center; gap: 4px; font-size: clamp(9px, 2.4cqw, 10.5px); opacity: .74; min-width: 0; }
.led-legend-i i { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.led-legend-i b { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.led-legend-empty { font-size: clamp(9px, 2.4cqw, 10.5px); opacity: .45; }
/* 近 7 天迷你柱（高度百分比，父容器定高） */
.led-week { display: flex; align-items: flex-end; gap: clamp(2px, .8cqw, 4px); height: clamp(30px, 10cqh, 46px); flex: none; }
.led-week-i { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; height: 100%; width: clamp(5px, 2cqw, 8px); }
.led-week-i i { width: 100%; border-radius: 2px; background: var(--pn-fill, rgba(44, 44, 44, .12)); min-height: 2px; }
.led-week-i i.on { background: linear-gradient(180deg, #C98E80, #A97C72); }
.led-week-i em { font-style: normal; font-size: 8px; opacity: .5; white-space: nowrap; }
.led-hero + .pn-ledger { margin-top: clamp(3px, 1.2cqh, 7px); }
.pn.sz-xs .led-bal { display: none; }

/* 背包：总数环 + 彩色分类条 + 最近徽章 */
.bag-hero { display: flex; align-items: center; gap: clamp(6px, 2.4cqw, 12px); }
.bag-ring { position: relative; flex: none; width: clamp(34px, 13cqw, 52px); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
.bag-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.bag-ring-bg { fill: none; stroke: var(--pn-fill, rgba(44, 44, 44, .07)); stroke-width: 4.5; }
.bag-ring-fg { fill: none; stroke: #9285AC; stroke-width: 4.5; stroke-linecap: round; stroke-dasharray: 100.5; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .4s ease; }
.bag-ring-n { font-size: clamp(11px, 3.6cqw, 17px); font-weight: 800; font-variant-numeric: tabular-nums; }
.bag-hero-m { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.bag-hero-l { font-size: clamp(10px, 2.8cqw, 12px); font-weight: 800; }
.bag-hero-s { font-size: clamp(9px, 2.4cqw, 10.5px); opacity: .58; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bag-badge { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; max-width: 100%; }
.bag-badge i {
  flex: none; width: clamp(15px, 5cqw, 20px); height: clamp(15px, 5cqw, 20px); border-radius: 5px;
  display: flex; align-items: center; justify-content: center; font-style: normal;
  font-size: clamp(9px, 2.6cqw, 11px); font-weight: 800; color: #fff;
  background: linear-gradient(150deg, #BCA9BF, #8C7BA0);
}
.bag-badge span { font-size: clamp(9px, 2.4cqw, 10.5px); opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bag-bars { display: flex; flex-direction: column; gap: clamp(2px, 1cqh, 5px); margin-top: clamp(4px, 1.6cqh, 8px); }
.bag-bars .pn-bar-row { margin-bottom: 0; }
.bag-bars .pn-bar-track { height: clamp(4px, 1.2cqh, 6px); }
.bag-bars .pn-bar-track i { border-radius: 99px; }
.bag-bars .pn-bar-row:nth-child(1) .pn-bar-track i { background: linear-gradient(90deg, #93A98B, #7C9174); }
.bag-bars .pn-bar-row:nth-child(2) .pn-bar-track i { background: linear-gradient(90deg, #93A9C0, #7288A1); }
.bag-bars .pn-bar-row:nth-child(3) .pn-bar-track i { background: linear-gradient(90deg, #BBA9BE, #94809E); }
.bag-bars .pn-bar-row:nth-child(4) .pn-bar-track i { background: linear-gradient(90deg, #C7B49E, #A38B72); }
.bag-bars .pn-bar-row:nth-child(5) .pn-bar-track i { background: linear-gradient(90deg, #C6A3A3, #A07C7C); }

/* 收藏：星标徽章 + 封面色块 */
.col-hero { display: flex; align-items: baseline; gap: 8px; flex: none; min-width: 0; }
.col-hero-n { flex: none; font-size: clamp(15px, 5.2cqw, 24px); font-weight: 800; font-variant-numeric: tabular-nums; }
.col-hero-n i { font-style: normal; font-size: .44em; font-weight: 600; opacity: .55; margin-left: 3px; }
.col-hero-s { min-width: 0; font-size: clamp(9px, 2.4cqw, 10.5px); opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-col-cover {
  position: relative; flex: none; width: clamp(22px, 7.6cqw, 32px); height: clamp(22px, 7.6cqw, 32px);
  border-radius: clamp(6px, 2cqw, 9px); display: flex; align-items: center; justify-content: center;
  font-size: clamp(10px, 3cqw, 13px); font-weight: 800; color: #fff;
  background: linear-gradient(150deg, #9AB0C6, #6C809A);
  box-shadow: 0 2px 8px -5px rgba(44, 44, 44, .6);
}
.pn-col-list .pn-col-row:nth-child(even) .pn-col-cover { background: linear-gradient(150deg, #C7B49F, #9E876F); }
.pn-col-list .pn-col-row:nth-child(3n) .pn-col-cover { background: linear-gradient(150deg, #B7A7BE, #8B7A99); }
.pn-col-star { position: absolute; right: -2px; top: -3px; width: clamp(9px, 3cqw, 12px); height: auto; fill: #E8B25F; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .22)); }

/* 成就：奖杯 + 渐变进度条 + 徽章 */
.ach-hero { display: flex; align-items: center; gap: clamp(6px, 2.2cqw, 10px); flex: none; }
.ach-cup {
  flex: none; width: clamp(26px, 9.6cqw, 40px); aspect-ratio: 1; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 32% 26%, rgba(226, 169, 79, .32), rgba(226, 169, 79, .08));
}
.ach-cup svg { width: 64%; height: 64%; }
.ach-cup-fill { fill: #D8A455; }
.ach-cup-line { fill: none; stroke: #C89B4F; stroke-width: 1.6; stroke-linecap: round; }
.ach-hero-n { font-size: clamp(15px, 5cqw, 24px); font-weight: 800; font-variant-numeric: tabular-nums; }
.ach-hero-n i { font-style: normal; font-size: .46em; opacity: .55; margin-left: 2px; }
.ach-hero-l { font-size: clamp(9px, 2.4cqw, 11px); opacity: .55; }
.ach-bar { flex: none; height: clamp(5px, 1.4cqh, 8px); border-radius: 99px; background: var(--pn-fill, rgba(44, 44, 44, .07)); overflow: hidden; margin-top: clamp(4px, 1.4cqh, 8px); }
.ach-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #E2A94F, #C98B35); transition: width .3s ease; }
.ach-badges { display: flex; flex-wrap: wrap; gap: 3px; margin-top: clamp(4px, 1.4cqh, 8px); }
.ach-badge {
  display: inline-flex; align-items: center; gap: 3px; max-width: 100%; padding: 1px clamp(4px, 1.5cqw, 7px);
  border-radius: 99px; background: var(--surface-2, rgba(255, 255, 255, .42));
  font-size: clamp(9px, 2.3cqw, 10.5px); opacity: .85; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.ach-badge :deep(svg) { flex: none; }
.ach-empty { font-size: clamp(9px, 2.4cqw, 11px); opacity: .5; }

/* ================= 参考图重绘（日历 / 图表 / 记账 / 天气） ================= */

/* ---- 日历：大号日期头 + 农历小字 + 节日列表 ---- */
.pn-cal .pn-cal-title { font-size: clamp(12.5px, min(4.4cqw, 5.6cqh), 24px); font-weight: 900; letter-spacing: -.01em; }
.cal-lunar {
  font-size: clamp(7px, 1.9cqw, 9px); line-height: 1.12; opacity: .45;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.cal-grid .cal-cell:nth-child(7n+6) .cal-lunar,
.cal-grid .cal-cell:nth-child(7n+7) .cal-lunar { color: #C08A80; opacity: .72; }
.cal-cell { position: relative; }
.cal-dom { position: relative; }
.cal-cell.today .cal-dom { background: #9B8FD6 !important; color: #fff; }
.cal-cell.today .cal-dom::after {
  content: ''; position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%);
  width: 3px; height: 3px; border-radius: 50%; background: #9B8FD6;
}
.cal-fest {
  flex: none; display: flex; align-items: baseline; flex-wrap: nowrap;
  gap: clamp(6px, 3cqw, 16px); margin-top: 2px; padding: clamp(4px, 1.4cqh, 8px) 2px 0;
  border-top: 1px solid var(--line, rgba(44, 44, 44, .07)); overflow: hidden;
}
.cal-fest-i {
  display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap;
  font-size: clamp(9px, min(2.4cqw, 2.9cqh), 11.5px); opacity: .82;
}
.cal-fest-i b { font-weight: 800; color: #B4796C; }

/* ---- 图表卡：环形图 + 引线标签 + 图例 ---- */
.st-top { display: flex; align-items: center; gap: 6px; flex: none; }
.st-name {
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
  font-size: clamp(10px, 2.9cqw, 12.5px); font-weight: 800; color: var(--pn-ink, #2C2C2C);
}
.st-tabs {
  margin-left: auto; display: inline-flex; align-items: center; gap: 2px; padding: 2px;
  border-radius: 999px; background: var(--pn-fill, rgba(44, 44, 44, .06)); overflow: hidden;
}
.st-tabs button {
  border: 0; background: transparent; cursor: pointer; padding: 1px clamp(4px, 1.4cqw, 7px);
  border-radius: 999px; font-size: clamp(8.5px, 2.2cqw, 10px); font-weight: 700;
  color: var(--pn-ink-2, #86868B); white-space: nowrap;
}
.st-tabs button.on { background: #E8734A; color: #fff; }
.st-donut { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.st-donut svg { width: 100%; height: 100%; max-height: clamp(88px, 32cqh, 180px); overflow: visible; }
.st-d-bg { fill: none; stroke: rgba(44, 44, 44, .07); stroke-width: 14; }
.st-d-seg { fill: none; stroke-width: 14; }
.st-lead { fill: none; stroke-width: .8; opacity: .8; }
.st-lbl { font-size: 8px; font-weight: 700; }
.st-center { font-size: 15px; font-weight: 800; fill: var(--pn-ink, #2C2C2C); }
.st-legend {
  flex: none; display: flex; flex-wrap: wrap; justify-content: center;
  gap: clamp(3px, 1.4cqw, 8px) clamp(6px, 2.4cqw, 12px); padding-top: 2px;
}
.st-lg-i { display: inline-flex; align-items: center; gap: 3px; font-size: clamp(8px, 2.2cqw, 9.5px); opacity: .72; }
.st-lg-i i { flex: none; width: 6px; height: 6px; border-radius: 1.5px; }
.st-mini { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.st-mini-n { font-size: clamp(20px, 9cqw, 34px); font-weight: 800; font-variant-numeric: tabular-nums; }
.st-mini-n i { font-style: normal; font-size: .45em; opacity: .55; }

/* ---- 记账卡：标题 + tab + 金额 + 分类胶囊 + 折线 ---- */
.pn-ledger-panel { gap: clamp(3px, 1.4cqh, 9px); }
.led-top { display: flex; align-items: center; gap: 5px; flex: none; }
.led-name { display: inline-flex; align-items: center; gap: 4px; font-size: clamp(10px, 2.9cqw, 13px); font-weight: 800; color: var(--pn-ink, #2C2C2C); }
.led-tabs { margin-left: auto; display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--pn-fill, rgba(44, 44, 44, .06)); }
.led-tabs button {
  border: 0; background: transparent; cursor: pointer; padding: 1px clamp(5px, 1.6cqw, 8px);
  border-radius: 999px; font-size: clamp(8.5px, 2.2cqw, 10px); font-weight: 700; color: var(--pn-ink-2, #86868B);
}
.led-tabs button.on { background: #4A78D0; color: #fff; }
.led-sums { display: flex; align-items: baseline; gap: clamp(6px, 2.6cqw, 14px); flex: none; }
.led-sum { display: inline-flex; align-items: baseline; gap: 3px; min-width: 0; }
.led-sum i { font-style: normal; font-size: clamp(8.5px, 2.2cqw, 10px); opacity: .55; }
.led-sum b { font-size: clamp(11px, 3.6cqw, 16px); font-weight: 800; font-variant-numeric: tabular-nums; }
.led-more {
  margin-left: auto; flex: none; border: 0; background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; color: var(--pn-ink-2, #86868B);
  font-size: clamp(8.5px, 2.2cqw, 10px); font-weight: 700; padding: 0;
}
.led-cats { display: flex; gap: 3px; flex: none; overflow: hidden; }
.led-pill {
  display: inline-flex; align-items: center; gap: 3px; flex: none; cursor: pointer;
  border: 0; padding: 2px clamp(5px, 1.8cqw, 9px); border-radius: 999px;
  background: var(--surface-2, rgba(255, 255, 255, .42)); color: var(--pn-ink, #2C2C2C);
  font-size: clamp(8px, 2.1cqw, 9.5px); opacity: .78; white-space: nowrap;
}
.led-pill.on { background: #4A78D0; color: #fff; opacity: 1; }
.led-pill-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.led-chart { flex: none; display: flex; gap: 4px; height: clamp(62px, 28cqh, 112px); min-height: 52px; cursor: pointer; }
.led-y {
  flex: none; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
  font-size: clamp(7px, 1.9cqw, 8.5px); opacity: .45; font-variant-numeric: tabular-nums; padding-bottom: 12px;
}
.led-y i { font-style: normal; }
.led-plot { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.led-plot svg { width: 100%; flex: 1; min-height: 0; overflow: visible; }
.led-grid { stroke: rgba(44, 44, 44, .08); stroke-width: .6; vector-effect: non-scaling-stroke; }
.led-line { fill: none; stroke: #4A78D0; stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.led-pt { fill: #fff; stroke: #4A78D0; stroke-width: 1; vector-effect: non-scaling-stroke; }
.led-pt.on { fill: #4A78D0; }
.led-x { display: flex; justify-content: space-between; padding: 1px 0 0; font-size: clamp(7px, 1.9cqw, 8.5px); opacity: .45; }
.led-x i { font-style: normal; }
.pn-ledger-panel .pn-ledger { flex: 1; min-height: 0; overflow: hidden; }

/* ---- 天气卡：深色磨砂 + 大温度 + 6 日预报 ---- */
.pn-wx { display: block; height: 100%; }
.wx-card {
  position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
  padding: clamp(10px, 3.4cqw, 18px) clamp(11px, 3.6cqw, 20px); border-radius: 16px; color: #EDEDF0;
  background: rgba(38, 38, 42, .74); border: 1px solid rgba(255, 255, 255, .08);
  backdrop-filter: blur(14px) saturate(1.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 10px 24px -18px rgba(0, 0, 0, .9);
  cursor: pointer;
}
/* 无外层玻璃时的深色表面：加载 / 失败态与整卡同底色 */
.wx-state {
  border-radius: 16px; background: rgba(38, 38, 42, .74);
  border: 1px solid rgba(255, 255, 255, .08);
  backdrop-filter: blur(14px) saturate(1.08);
}
.wx-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.wx-card-top { flex: none; display: flex; align-items: center; gap: 6px; }
.wx-card .wx-city { opacity: .84; font-size: clamp(9px, 2.5cqw, 12px); }
.wx-hint { margin-left: auto; display: inline-flex; align-items: center; gap: 1px; font-size: clamp(8px, 2cqw, 10px); opacity: .5; }
.wx-refresh {
  flex: none; width: clamp(16px, 5cqw, 22px); height: clamp(16px, 5cqw, 22px);
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%; background: rgba(255, 255, 255, .08); color: #EDEDF0;
  opacity: .62; cursor: pointer; transition: opacity .14s ease, background .14s ease;
}
.wx-refresh:hover { opacity: .95; background: rgba(255, 255, 255, .16); }
.wx-card-main { flex: none; display: flex; align-items: flex-start; gap: 8px; margin-top: clamp(2px, 1cqh, 6px); }
.wx-big {
  font-size: clamp(26px, 18cqw, 62px); font-weight: 700; line-height: 1.02;
  letter-spacing: -.03em; font-variant-numeric: tabular-nums;
}
.wx-big i { font-style: normal; font-size: .5em; opacity: .62; margin-left: 1px; vertical-align: super; }
.wx-card-side { margin-left: auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; padding-top: clamp(4px, 2cqh, 10px); }
.wx-cond { display: inline-flex; align-items: center; gap: 4px; font-size: clamp(9.5px, 2.7cqw, 12px); font-weight: 700; }
.wx-ico { flex: none; width: clamp(16px, 5.4cqw, 22px); height: clamp(16px, 5.4cqw, 22px); }
.wx-hl { font-size: clamp(8px, 2.2cqw, 10px); opacity: .6; white-space: nowrap; }
/* 正面指标：体感 / 湿度 / AQI / 风 */
.wx-metrics {
  flex: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(2px, 1cqw, 6px); margin-top: clamp(3px, 1.4cqh, 8px);
}
.wx-metrics > span {
  display: flex; flex-direction: column; gap: 1px; min-width: 0;
  padding: clamp(2px, 1cqh, 5px) clamp(3px, 1.2cqw, 7px); border-radius: 8px;
  background: rgba(255, 255, 255, .05);
}
.wx-metrics i {
  font-style: normal; font-size: clamp(7px, 2cqw, 9px); opacity: .5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wx-metrics b {
  font-size: clamp(8px, 2.3cqw, 10.5px); font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
/* 5 日高低温曲线（暖色高线 / 冷色低线，匹配天气图标配色） */
.wx-trend { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: clamp(3px, 1.4cqh, 8px); }
.wx-trend-line { flex: 1; width: 100%; min-height: 0; }
.wx-trend-line polyline { fill: none; stroke-width: 1.4; vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
.wx-trend-line .hi { stroke: #F0B45E; }
.wx-trend-line .lo { stroke: #7FB0D8; }
.wx-trend-x { flex: none; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding-top: 1px; }
.wx-trend-x span { display: flex; flex-direction: column; align-items: center; min-width: 0; line-height: 1.15; }
.wx-trend-x i { font-style: normal; font-size: clamp(7px, 1.9cqw, 9px); opacity: .5; white-space: nowrap; }
.wx-trend-x b { font-size: clamp(7.5px, 2.1cqw, 9.5px); font-weight: 800; color: #F0C58B; font-variant-numeric: tabular-nums; }
.wx-trend-x em { font-style: normal; font-size: clamp(7px, 1.9cqw, 9px); color: #9FC4DD; font-variant-numeric: tabular-nums; }
.wx-foot { flex: none; margin-top: 3px; text-align: right; font-size: clamp(7px, 1.9cqw, 9px); opacity: .36; }
.pn-wx .wx-loading { height: 100%; color: #D9D9DC; }

/* ---- 记账明细浮层 ---- */
.lsheet { display: flex; flex-direction: column; gap: 10px; }
.lsheet-tabs, .lsheet-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.lsheet-tabs button, .lsheet-cats button {
  border: 0; cursor: pointer; border-radius: 999px; padding: 5px 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #555;
  background: rgba(44, 44, 44, .06);
}
.lsheet-tabs button.on, .lsheet-cats button.on { background: #4A78D0; color: #fff; }
.lsheet-cats i { width: 6px; height: 6px; border-radius: 50%; }
.lsheet-sum { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; opacity: .7; }
.lsheet-sum b { font-size: 14px; color: #2C2C2C; }
.lsheet-g { border-top: 1px solid rgba(44, 44, 44, .08); padding-top: 6px; }
.lsheet-g-h { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; opacity: .5; }
.lsheet-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; position: relative; }
.lsheet-cat { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsheet-cat i { font-style: normal; opacity: .55; }
.lsheet-amt { font-weight: 800; font-variant-numeric: tabular-nums; }
.lsheet-amt.income { color: #3E9A6E; }
.lsheet-amt.expense { color: #C05B5B; }
/* 3.0 记账 ↔ 任务 */
.lsheet-item { display: flex; flex-direction: column; }
.lsheet-link { display: flex; align-items: center; gap: 6px; padding: 0 0 4px 2px; }
.lsheet-task {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 3px 8px; border-radius: 99px; border: 1px solid rgba(74, 120, 208, .35);
  background: rgba(74, 120, 208, .08); color: #3C5C96; font-size: 11px; cursor: pointer;
}
.lsheet-task span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsheet-task.done { opacity: .55; text-decoration: line-through; border-color: rgba(44,44,44,.18); color: #2C2C2C; background: rgba(44,44,44,.05); }
.lsheet-unlink { border: 0; background: transparent; color: #C05B5B; font-size: 11px; cursor: pointer; opacity: .75; }
.lsheet-linkbtn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 99px; border: 1px dashed rgba(44, 44, 44, .22);
  background: transparent; color: #2C2C2C; font-size: 11px; cursor: pointer; opacity: .8;
}
.lsheet-linkbtn.ghost { border-style: solid; }
.lsheet-pick { display: flex; flex-direction: column; gap: 4px; padding: 8px; margin: 2px 0 6px; border-radius: 12px; background: rgba(255,255,255,.7); border: 1px solid rgba(44,44,44,.08); }
.lsheet-pick input { height: 30px; padding: 0 10px; border-radius: 9px; border: 1px solid rgba(44,44,44,.14); background: #fff; font-size: 12px; }
.lsheet-pick-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 12px; color: #2C2C2C; cursor: pointer; }
.lsheet-pick-row:hover { background: rgba(44,44,44,.06); }
.lsheet-pick-row i { font-style: normal; font-size: 10px; opacity: .45; }
.lsheet-pick-row.is-empty { opacity: .45; cursor: default; }
.lsheet-pick-foot { display: flex; gap: 6px; padding-top: 4px; border-top: 1px solid rgba(44,44,44,.08); }

/* ---- 天气详情浮层 ---- */
.wxsheet { display: flex; flex-direction: column; gap: 12px; color: #2C2C2C; }
.wxs-top { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 2px; }
.wxs-city { font-size: 17px; font-weight: 800; }
.wxs-mode { font-size: 10px; font-weight: 600; opacity: .6; margin-left: 6px; padding: 1px 6px; border-radius: 99px; border: 1px solid rgba(44,44,44,.18); vertical-align: 2px; }
.wxs-city-btn { flex: none; font-size: 12px; padding: 4px 10px; border-radius: 9px; border: 1px solid rgba(44,44,44,.16); background: rgba(255,255,255,.7); color: #2C2C2C; cursor: pointer; }
.wxs-city-panel { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 12px; background: rgba(255,255,255,.66); border: 1px solid rgba(44,44,44,.08); }
.wxs-city-input { display: flex; gap: 6px; }
.wxs-city-input input { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 9px; border: 1px solid rgba(44,44,44,.14); background: #fff; font-size: 12px; color: #2C2C2C; }
.wxs-city-input .mini-btn { flex: none; height: 30px; padding: 0 10px; border-radius: 9px; border: 0; background: #2C2C2C; color: #fff; font-size: 12px; cursor: pointer; }
.wxs-city-input .mini-btn:disabled { opacity: .55; }
.wxs-city-err { font-size: 11px; color: #C4553B; }
.wxs-city-row { display: flex; align-items: baseline; gap: 8px; padding: 7px 8px; border-radius: 9px; border: 0; background: transparent; text-align: left; cursor: pointer; }
.wxs-city-row:hover { background: rgba(44,44,44,.06); }
.wxs-city-row b { font-size: 13px; font-weight: 700; color: #2C2C2C; }
.wxs-city-row span { font-size: 11px; opacity: .55; }
.wxs-city-row.is-auto { border-top: 1px solid rgba(44,44,44,.08); border-radius: 0 0 9px 9px; }
.wxs-sub { font-size: 12px; opacity: .55; }
.wxs-hero { display: flex; align-items: flex-end; gap: 12px; }
.wxs-temp { font-size: 58px; font-weight: 700; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.wxs-temp i { font-style: normal; font-size: .45em; opacity: .55; }
.wxs-meta { display: flex; flex-direction: column; gap: 3px; padding-bottom: 6px; font-size: 12px; opacity: .6; }
.wxs-tip { font-size: 12px; opacity: .62; }
.wxs-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.wxs-metrics span { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; background: rgba(44, 44, 44, .05); }
.wxs-metrics i { font-style: normal; font-size: 11px; opacity: .5; }
.wxs-metrics b { font-size: 13px; }
.wxs-sec { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(44, 44, 44, .08); }
.wxs-sec-l { font-size: 12px; font-weight: 800; opacity: .7; }
.wxs-hours { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 2px; }
.wxs-h { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 10px; opacity: .82; min-width: 0; }
.wxs-h-ico { width: 20px; height: 20px; }
.wxs-h b { font-size: 11px; }
.wxs-line { width: 100%; height: 34px; }
.wxs-line polyline { fill: none; stroke: #6E8FB0; stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.wxs-day { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid rgba(44, 44, 44, .06); font-size: 13px; }
.wxs-day-k { flex: none; width: 92px; }
.wxs-day-k i { font-style: normal; margin-left: 4px; font-size: 11px; opacity: .5; }
.wxs-day-ico { flex: none; width: 22px; height: 22px; }
.wxs-day-d { flex: 1; min-width: 0; font-size: 12px; opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wxs-day-t { font-weight: 800; white-space: nowrap; }
.wxs-day-t i { font-style: normal; font-weight: 600; opacity: .5; }

/* 3.0 拖拽改期：幽灵标签 + 日历落点高亮 */
.drag-ghost {
  position: fixed; z-index: 12000; pointer-events: none;
  transform: translate(-50%, -140%);
  padding: 5px 10px; border-radius: 9px;
  background: rgba(44, 44, 44, .88); color: #fff;
  font-size: 12px; font-weight: 600; white-space: nowrap;
  box-shadow: 0 8px 20px -8px rgba(0, 0, 0, .5);
}
.cal-cell.drop-target {
  background: color-mix(in srgb, var(--eo-accent, #E2A94F) 26%, transparent);
  box-shadow: inset 0 0 0 2px var(--eo-accent, #E2A94F);
}
.cal-items i { cursor: grab; }
.ca-row { cursor: grab; }
</style>
