<script setup>
// ===== 卡片矩阵内容渲染（ArcMind 视觉版）=====
// 2026-11-04：按用户要求下线文字卡 / 链接卡 / 导航卡 / 导航面板 / 隐藏卡 / 热图卡，
// 这里只保留三张默认卡片：便利贴卡片（note）、时钟（clock）、音频（audio）。
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { cardMeta } from '../lib/cardMatrix.js'
import { getCanvasPlayer, getActiveAudioKey, setActiveAudioKey } from '../lib/audioPlayer.js'
import { loadPlaylist } from '../lib/meting.js'
import { useAppStore } from '../stores/app.js'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'
import GlassBottomSheet from './GlassBottomSheet.vue'

const props = defineProps({ node: { type: Object, required: true }, rev: { type: Number, default: 0 } })
const emit = defineEmits(['edit', 'patch'])
const store = useAppStore()
const router = useRouter()
// 文档卡绑定笔记：绑定后 entityOf() 能解析出 memo 实体，从而参与 biLinks 与画布连线
const bindOpen = ref(false)
function bindNote(id) {
  emit('patch', { noteId: String(id) })
  bindOpen.value = false
  store.showToast('已绑定笔记，可参与关联与连线')
}
function createAndBindNote() {
  const r = store.addMemo({ title: props.node.title || '画布文档', markdown: docBody.value || '', tags: [] })
  const id = r && ((r.memo && r.memo.id) || r.id)
  if (id) bindNote(id)
  else store.showToast('新建笔记失败')
}

const d = computed(() => {
  void props.rev // 卡片数据在工作区里是非响应式对象，靠版本号触发重算
  return props.node.cardData || {}
})
const meta = computed(() => cardMeta(props.node.cardKind) || { label: '卡片' })
const kind = computed(() => props.node.cardKind)

// ---- 音频：黑胶播放控制（开源 makenoise 播放器 / 底层 Howler.js） ----
const playing = ref(false)
const progress = ref(0)
const cur = ref(0)
const dur = ref(0)
const audioKey = computed(() => String(props.node.id || ''))
// 2026-11-04 P2：音乐卡升级为多曲目播放器。兼容旧数据（单曲 src/title/source），
// 新数据统一存 cardData.tracks: [{ title, src, source, format, cover, songId, qqUrl }]。
const activeIndex = ref(Number(d.value.activeIndex) || 0)
// ---- 网易云歌单：ID 由用户自己填，公共 Meting 拉取；与卡片内自定义曲目合并 ----
const PLAYLIST_KEY = 'eo:music_playlist'
const meting = reactive({ state: 'idle', tracks: [], err: '' })
const playlistInput = ref('')
const localTracks = computed(() => {
  const arr = Array.isArray(d.value.tracks) ? d.value.tracks.filter((t) => t && t.src) : []
  if (arr.length) return arr
  return d.value.src
    ? [{ title: d.value.title || '音频', src: d.value.src, source: d.value.source, format: d.value.format, cover: d.value.cover, songId: d.value.songId, qqUrl: d.value.qqUrl }]
    : []
})
const trackList = computed(() => localTracks.value.concat(meting.tracks))
const audioSrc = computed(() => (trackList.value[activeIndex.value] || {}).src || '')
// 音源格式：无扩展名（data URI / 网易云外链）时必须显式告诉解码器
function formatOf(track) {
  if (track && track.format) return track.format
  const src = String((track && track.src) || '')
  const m = src.match(/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(\?|#|$)/i)
  if (m) return m[1].toLowerCase()
  return (track && track.source === 'netease') ? 'mp3' : 'mp3'
}
const audioTitle = computed(() => {
  const t = trackList.value[activeIndex.value] || trackList.value[0]
  if (!t) return '音乐'
  return t.title || '未命名音频'
})
const curCover = computed(() => (trackList.value[activeIndex.value] || {}).cover || '')
// 曲目列表 / 收藏选择面板开关
const listOpen = ref(false)
const favOpen = ref(false)
// makenoise 播放器单例
let player = null
let unsubProgress = null
let unsubState = null
let errStreak = 0

function ensurePlayer() {
  if (player) return player
  player = getCanvasPlayer()
  unsubProgress = player.progress.subscribe((p) => {
    // 播放器是全局单例：只有本卡是当前音源时才更新进度，避免多张卡片进度同步
    if (getActiveAudioKey() !== audioKey.value) return
    cur.value = p.currentTime || 0
    dur.value = p.duration || 0
    progress.value = dur.value ? (cur.value / dur.value) * 100 : 0
  })
  unsubState = player.state.subscribe((s) => {
    if (getActiveAudioKey() !== audioKey.value) return
    const st = s.status
    playing.value = !!s.playing || st === 'playing'
    if (typeof s.currentIndex === 'number' && s.currentIndex >= 0 && s.currentIndex < trackList.value.length) {
      activeIndex.value = s.currentIndex
    }
    if (st === 'playing') errStreak = 0
    if (st === 'ended' || st === 'idle') playing.value = false
    if (st === 'error') {
      playing.value = false
      // 坏链自动跳过下一首；连续失败到歌单末尾才提示，避免无限循环
      if (errStreak < trackList.value.length - 1) {
        errStreak++
        setTimeout(() => { if (trackList.value.length) nextTrack() }, 700)
      } else {
        errStreak = 0
        store.showToast('音频加载失败：链接可能已失效或需要版权')
      }
    }
  })
  try {
    player.setVolume(volume.value)
    player.setMuted(muted.value)
    applyPlayMode()
  } catch (e) { /* 引擎版本不支持时忽略 */ }
  return player
}

// 播放模式：0 顺序循环 / 1 单曲循环 / 2 随机
function applyPlayMode() {
  const p = player || getCanvasPlayer()
  try {
    if (typeof p.setShuffle === 'function') p.setShuffle(playMode.value === 2)
    if (typeof p.setRepeat === 'function') p.setRepeat(playMode.value === 1 ? 'one' : 'all')
  } catch (e) { /* ignore */ }
}

// 播放队列：把曲目列表交给 makenoise，一次播放整张歌单
function queueOf() {
  return trackList.value.map((t, i) => ({
    id: audioKey.value + '-' + i,
    src: t.src,
    title: t.title || ('曲目 ' + (i + 1)),
    artist: t.artist || '',
    format: formatOf(t),
    cover: t.cover || '',
    artwork: t.cover || '',
    lrc: t.lrc || ''
  }))
}
function playAt(i) {
  const list = trackList.value
  if (!list.length) { store.showToast('请先上传音频，或从收藏添加曲目'); return }
  const idx = Math.max(0, Math.min(list.length - 1, i))
  const p = ensurePlayer()
  activeIndex.value = idx
  emit('patch', { activeIndex: idx })
  // 先登记当前音源再开播：状态回调只处理本卡事件，顺序反了会丢首帧状态
  setActiveAudioKey(audioKey.value)
  p.play(queueOf(), { startIndex: idx })
  store.bumpMilestone('musicPlay')
}
function toggleAudio() {
  const src = audioSrc.value
  if (!src) { store.showToast('请先上传音频，或从收藏添加曲目'); return }
  const p = ensurePlayer()
  // 只有点击这里的暂停按钮才会停止播放，其它任何操作都不自动暂停
  if (playing.value) {
    p.pause()
    setActiveAudioKey(null)
    return
  }
  const cur0 = p.getState()
  const sameTrack = cur0.current && cur0.current.track && cur0.current.track.src === src
  setActiveAudioKey(audioKey.value)
  if (sameTrack) {
    p.play()
    store.bumpMilestone('musicPlay')
  } else {
    playAt(activeIndex.value)
  }
}
function prevTrack() {
  const n = trackList.value.length
  if (!n) return
  playAt((activeIndex.value - 1 + n) % n)
}
function nextTrack() {
  const n = trackList.value.length
  if (!n) return
  playAt((activeIndex.value + 1) % n)
}

function seekAudio(e) {
  const p = ensurePlayer()
  if (!dur.value) return
  const r = e.currentTarget.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  p.seek(ratio * dur.value)
}
function fmt(s) { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60); const ss = Math.floor(s % 60); return m + ':' + String(ss).padStart(2, '0') }
// 从歌单移除一首；正在播放的曲目被移除也不打断播放。
// 网易云歌单曲目只移出本地列表，不写回卡片数据
function removeTrack(i) {
  const total = trackList.value.length
  if (i < 0 || i >= total) return
  const nLocal = localTracks.value.length
  if (i >= nLocal) {
    // Meting 歌单：只在内存里移除，重新填歌单 ID 还能再拉回来
    meting.tracks.splice(i - nLocal, 1)
    activeIndex.value = Math.max(0, Math.min(trackList.value.length - 1, i === activeIndex.value ? i : activeIndex.value))
  } else {
    // 卡片内自定义曲目：写回 cardData，保持原有能力
    const list = localTracks.value.slice()
    list.splice(i, 1)
    const next = Math.max(0, Math.min(list.length - 1, i < activeIndex.value ? activeIndex.value - 1 : activeIndex.value))
    activeIndex.value = next
    emit('patch', {
      tracks: list,
      activeIndex: next,
      src: (list[next] || {}).src || '',
      title: (list[next] || {}).title || ''
    })
  }
  if (!trackList.value.length) store.showToast('歌单已清空')
}

// ---- 音源接入：本地上传（点击 / 拖拽）+ 网易云音乐（歌曲 ID / 外链解析） ----
const neInput = ref('')
const AUDIO_MAX = 6 * 1024 * 1024

// 解析网易云：支持纯歌曲 ID、music.163.com/song?id=xxx、/song/xxx 等外链形态
function parseNetEase(v) {
  const s = String(v || '').trim()
  if (!s) return null
  if (/^\d{4,}$/.test(s)) return { id: s }
  const m = s.match(/[?&]id=(\d{4,})/) || s.match(/song\/(\d{4,})/)
  return m ? { id: m[1] } : null
}
function connectNetEase() {
  const p = parseNetEase(neInput.value)
  if (!p) { store.showToast('请输入网易云歌曲 ID 或外链'); return }
  // 官方外链直出端点：媒体元素播放不涉及跨域限制
  addTrack({
    src: 'https://music.163.com/song/media/outer/url?id=' + p.id + '.mp3',
    title: '网易云歌曲 ' + p.id,
    source: 'netease', songId: p.id, format: 'mp3'
  })
  neInput.value = ''
  store.showToast('已加入歌单，点击曲目播放')
}
// ---- QQ 音乐：外链 / songmid 直达（QQ 音乐不提供免密音频直链，走跳转播放） ----
function parseQQ(v) {
  const s = String(v || '').trim()
  if (!s) return null
  if (/y\.qq\.com/i.test(s)) return { url: s }
  const m = s.match(/songDetail\/([0-9A-Za-z]{8,})/) || s.match(/songmid[=/]([0-9A-Za-z]{8,})/)
  return m ? { mid: m[1] } : null
}
function connectQQ() {
  const p = parseQQ(neInput.value)
  if (!p) return false
  const url = p.url || ('https://y.qq.com/n/ryqq/songDetail/' + p.mid)
  emit('patch', { source: 'qq', qqUrl: url, title: d.value.title && d.value.title !== '音频标题' ? d.value.title : 'QQ 音乐' })
  neInput.value = ''
  store.showToast('已连接 QQ 音乐，点击卡片跳转播放')
  try { window.open(url, '_blank', 'noopener') } catch (e) { /* 弹窗被拦截时忽略 */ }
  return true
}
// 智能接入：先认 QQ 外链，再走网易云
function connectSmart() { if (!connectQQ()) connectNetEase() }
// 统一追加曲目：保留旧单曲字段（src/title），同时写入 tracks 数组
function addTrack(track) {
  const next = trackList.value.concat([{ ...track }])
  activeIndex.value = next.length - 1
  emit('patch', {
    tracks: next,
    activeIndex: next.length - 1,
    src: track.src,
    title: track.title,
    source: track.source || 'local',
    format: track.format || formatOf(track),
    cover: track.cover || '',
    songId: track.songId || null,
    qqUrl: track.qqUrl || null
  })
}
// 与「收藏」打通：把当前曲目存进收藏库（标题 / 平台链接 / 封面）
function saveToCollection() {
  const t = trackList.value[activeIndex.value] || {}
  const title = (t.title || '').trim() || '未命名音乐'
  const url = t.qqUrl || (t.songId ? 'https://music.163.com/song?id=' + t.songId : (t.src && /^https?:/.test(t.src) ? t.src : ''))
  const platform = t.source === 'qq' ? 'QQ 音乐' : t.source === 'netease' ? '网易云音乐' : '本地音频'
  const r = store.addCollection({ title, content: '来自画布音乐卡片 · ' + platform, category: '音乐', url, cover: t.cover || '' })
  if (r && r.ok === false) { store.showToast(r.error || '收藏失败'); return }
  store.showToast('已收藏到「收藏」')
}
// ---- 收藏联动：把收藏里带音频链接的条目加入歌单 ----
function resolveCollectionAudio(url) {
  const u = String(url || '')
  if (!u) return ''
  const idm = u.match(/(?:id=|song\/)(\d{4,})/)
  if (/music\.163\.com/i.test(u) && idm) return 'https://music.163.com/song/media/outer/url?id=' + idm[1] + '.mp3'
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(u)) return u
  return ''
}
const favTracks = computed(() => (store.live.collections || [])
  .map((c) => ({ ...c, playUrl: resolveCollectionAudio(c.url) }))
  .filter((c) => c.playUrl))
function addFromCollection(c) {
  if (!c || !c.playUrl) { store.showToast('该收藏没有可播放的音频链接'); return }
  addTrack({ title: c.title || '收藏曲目', src: c.playUrl, source: 'collection', format: formatOf({ src: c.playUrl }), cover: c.cover || '' })
  store.showToast('已加入歌单：' + (c.title || '收藏曲目'))
}
function importAudioFile(f) {
  if (!f) return
  if (f.type && !/^audio\//.test(f.type)) { store.showToast('请选择音频文件'); return }
  if (f.size > AUDIO_MAX) { store.showToast('音频过大（上限 6MB），请先压缩'); return }
  const rd = new FileReader()
  rd.onload = () => {
    const ext = (String(f.name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'mp3'
    addTrack({
      src: String(rd.result || ''), title: String(f.name).replace(/\.[^.]+$/, ''),
      source: 'local', format: ext.toLowerCase()
    })
    store.showToast('已加入歌单，点击曲目播放')
  }
  rd.readAsDataURL(f)
}
function onAudioDrop(ev) {
  const dt = ev && ev.dataTransfer
  const f = dt && dt.files && dt.files[0]
  importAudioFile(f)
}
// 多选：逐个追加到歌单
function onAudioFiles(e) {
  const files = e && e.target && e.target.files ? Array.from(e.target.files) : []
  files.forEach((f) => importAudioFile(f))
  if (e && e.target) e.target.value = ''
}

// ---- 文档卡：整篇长文，卡片内滚动阅读；正文在「卡片设置」里编辑 ----
const docBody = computed(() => String(d.value.body || ''))
const docTitle = computed(() => props.node.title || '未命名文档')

// ---- 图片卡：单张图片，支持上传 / 拖入 / 点击查看大图 ----
const imgView = ref(false)
const imgBroken = ref(false)
const IMG_MAX = 20 * 1024 * 1024
// 照片原图存在相册里（落库时由 IndexedDB blobs 仓承载），卡片只存 photoId 引用，
// 避免 base64 挤爆画布节点所在的 localStorage
const photoSrc = computed(() => {
  const pid = d.value.photoId
  if (!pid) return ''
  const p = (store.live.photos || []).find((x) => x.id === pid)
  return (p && p.dataUrl) || ''
})
const ephemeralSrc = ref('')
const imgSrc = computed(() => ephemeralSrc.value || d.value.src || photoSrc.value)
// 仅本次会话显示：不写相册、不写画布存档，刷新即失效（手机端不落库的唯一可行形态）
function tempImageFile(f) {
  if (!f || !f.type || !/^image\//.test(f.type)) return
  if (ephemeralSrc.value) { try { URL.revokeObjectURL(ephemeralSrc.value) } catch (e) { /* ignore */ } }
  ephemeralSrc.value = URL.createObjectURL(f)
  imgBroken.value = false
  store.showToast('仅本次显示，未写入相册或画布存档')
}
const imgMissing = computed(() => !!d.value.photoId && !photoSrc.value && !d.value.src)
function importImageFile(f) {
  if (!f) return
  if (f.type && !/^image\//.test(f.type)) { store.showToast('请选择图片文件'); return }
  if (f.size > IMG_MAX) { store.showToast('图片过大（上限 20MB）'); return }
  const rd = new FileReader()
  rd.onload = () => {
    const dataUrl = String(rd.result || '')
    if (!dataUrl) return
    // 原样存入相册（不压缩画质），卡片改为引用照片 ID
    const baseName = String(f.name || '').replace(/\.[^.]+$/, '')
    const r = store.addPhoto({ name: baseName || '照片', dataUrl, category: '', tags: '' })
    if (!r || !r.ok) { store.showToast('图片保存失败'); return }
    imgBroken.value = false
    emit('patch', { src: '', photoId: r.photo.id, name: f.name })
    store.showToast('图片已更新，并存入相册')
  }
  rd.readAsDataURL(f)
}
function onImageFile(e) {
  const f = e && e.target && e.target.files && e.target.files[0]
  importImageFile(f)
  if (e && e.target) e.target.value = ''
}
function onImageDrop(ev) {
  const dt = ev && ev.dataTransfer
  const f = dt && dt.files && dt.files[0]
  importImageFile(f)
}

// ---- 时钟：实时刷新 ----
// 从播放器单例同步一次状态（组件重建 / 从其它页面返回时用）
function syncFromPlayer() {
  if (!player) return
  try {
    const st = player.getState()
    if (getActiveAudioKey() !== audioKey.value) return
    playing.value = !!st.playing
    if (st.current && st.current.track && typeof st.currentIndex === 'number' && st.currentIndex >= 0 && trackList.value.length) {
      activeIndex.value = Math.min(st.currentIndex, trackList.value.length - 1)
    }
  } catch (e) { /* ignore */ }
}
let stopAfterEach = null

const now = ref(Date.now())
let timer = null
onMounted(() => {
  if (kind.value === 'clock') {
    timer = setInterval(() => { now.value = Date.now() }, 1000)
    loadLunar()
  }
  if (kind.value === 'audio') {
    // 恢复用户自己填过的歌单 ID（只存 ID，曲目仍走 6 小时缓存）
    try {
      const saved = localStorage.getItem(PLAYLIST_KEY)
      if (saved) { playlistInput.value = saved; loadIdPlaylist({ silent: true }) }
    } catch (e) { /* ignore */ }
    const p = ensurePlayer() // 应用已保存的音量与播放模式
    // 从播放页返回 / 组件重建时，播放器可能已在播放：主动同步一次播放态，
    // 避免卡片显示成暂停（订阅只推送后续变化，首次状态不一定补齐）
    syncFromPlayer()
    // 路由切回画布（或是从播放页返回）时再同步，缓存组件不会重建
    if (p && router.afterEach) {
      stopAfterEach = router.afterEach((to) => {
        if (to.name === 'music') return
        setTimeout(syncFromPlayer, 120)
      })
    }
  }
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  // 卡片离场只解绑订阅，绝不自动暂停：播放器是全局单例，卡片滚出视口、
  // 缩放剔除、切换页面时音乐都要继续，重新挂载后由 syncFromPlayer 恢复显示
  if (unsubProgress) { try { unsubProgress() } catch (e) { /* ignore */ } unsubProgress = null }
  if (unsubState) { try { unsubState() } catch (e) { /* ignore */ } unsubState = null }
  if (stopAfterEach) { try { stopAfterEach() } catch (e) { /* ignore */ } stopAfterEach = null }
})
const p2 = (n) => String(n).padStart(2, '0')
// 参考 ClockCard：日期顶部 / 24 小时制 HH:MM:SS（双圆点冒号）/ 农历底部
const clockHms = computed(() => {
  const dt = new Date(now.value)
  return [p2(dt.getHours()), p2(dt.getMinutes()), p2(dt.getSeconds())]
})
const clockDateCn = computed(() => {
  const dt = new Date(now.value)
  return dt.getFullYear() + ' 年 ' + (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日 星期' + ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]
})
// 农历：按天缓存，接口失败或被限流时静默隐藏（不拼 undefined）
const lunarText = ref('')
let lunarLoadedKey = ''
async function loadLunar() {
  const dt = new Date()
  const dayKey = dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate())
  if (lunarLoadedKey === dayKey) return
  lunarLoadedKey = dayKey
  try {
    const hit = localStorage.getItem('eo:lunar:' + dayKey)
    if (hit) { lunarText.value = hit; return }
  } catch (e) { /* localStorage 不可用时跳过缓存 */ }
  try {
    const j = await fetch('https://uapis.cn/api/v1/misc/lunartime').then((r) => r.json())
    const parts = []
    if (j && j.lunar_month_cn && j.lunar_day_cn) parts.push('农历' + j.lunar_month_cn + j.lunar_day_cn)
    if (j && j.ganzhi_year) parts.push(j.ganzhi_year + '年')
    const txt = parts.join(' · ')
    if (!txt) return
    lunarText.value = txt
    try { localStorage.setItem('eo:lunar:' + dayKey, txt) } catch (e) { /* 忽略写入失败 */ }
  } catch (e) { /* 农历获取失败静默隐藏 */ }
}

// ---- 播放模式 / 音量 / 沉浸歌词 ----
const MODE_KEY = 'eo:music_mode'
const VOL_KEY = 'eo:music_volume'
const MUTE_KEY = 'eo:music_muted'
// 0 顺序循环 / 1 单曲循环 / 2 随机（默认顺序循环，符合「放着听」的直觉）
const playMode = ref((() => {
  try { const v = Number(localStorage.getItem(MODE_KEY)); return v === 1 || v === 2 ? v : 0 } catch (e) { return 0 }
})())
const volume = ref((() => {
  try {
    const v = Number(localStorage.getItem(VOL_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6
  } catch (e) { return 0.6 }
})())
const muted = ref((() => {
  try { return localStorage.getItem(MUTE_KEY) === '1' || volume.value === 0 } catch (e) { return volume.value === 0 }
})())
const modeTitle = computed(() => ['顺序循环', '单曲循环', '随机播放'][playMode.value])

function cycleMode() {
  playMode.value = (playMode.value + 1) % 3
  try { localStorage.setItem(MODE_KEY, String(playMode.value)) } catch (e) { /* ignore */ }
  applyPlayMode()
  store.showToast(modeTitle.value)
}
function onVolInput(e) {
  const v = Math.max(0, Math.min(100, Number(e.target.value))) / 100
  volume.value = v
  muted.value = v === 0
  const p = ensurePlayer()
  try {
    // 先在未静音状态下落音量，音频节点才会真正更新
    p.setMuted(muted.value)
    if (!muted.value) p.setVolume(v)
  } catch (err) { /* ignore */ }
  try {
    localStorage.setItem(VOL_KEY, String(v))
    localStorage.setItem(MUTE_KEY, String(muted.value ? 1 : 0))
  } catch (err) { /* ignore */ }
}
function toggleMute() {
  muted.value = !muted.value
  // 静音只切静音标记，不再把音量写成 0；取消静音时保证音量回到可听见的值
  if (!muted.value && volume.value === 0) volume.value = 0.6
  const p = ensurePlayer()
  try {
    // 先解除静音再落音量：Howler 静音时不会更新音频节点音量，反序会静音无声
    p.setMuted(muted.value)
    if (!muted.value) p.setVolume(volume.value)
  } catch (e) { /* ignore */ }
  try {
    localStorage.setItem(VOL_KEY, String(volume.value))
    localStorage.setItem(MUTE_KEY, String(muted.value ? 1 : 0))
  } catch (e) { /* ignore */ }
}

// ---- 独立播放页：把当前歌单与播放位置交给 /music（返回画布时音乐继续播放） ----
const QUEUE_KEY = 'eo:music_queue'
function goPlayer() {
  if (!trackList.value.length) { store.showToast('请先添加曲目'); return }
  const tracks = trackList.value.map((t, i) => ({
    title: t.title || ('曲目 ' + (i + 1)),
    artist: t.artist || '',
    src: t.src,
    format: formatOf(t),
    cover: t.cover || '',
    lrc: t.lrc || '',
    source: t.source || ''
  }))
  const startIndex = Math.max(0, Math.min(tracks.length - 1, activeIndex.value))
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ tracks, startIndex, activeKey: audioKey.value, playing: playing.value }))
  } catch (e) { /* 配额满时忽略 */ }
  router.push('/music')
}

// ---- 网易云歌单 ID：由用户自己填，链接 / 纯数字都能识别 ----
function parsePlaylistId(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  if (/^\d{5,}$/.test(s)) return s
  const m = s.match(/playlist[\/?](?:.*?[?&]id=)?(\d{5,})/) || s.match(/[?&]id=(\d{5,})/)
  return m ? m[1] : ''
}
async function loadIdPlaylist(opts = {}) {
  const silent = Boolean(opts && opts.silent)
  const id = parsePlaylistId(playlistInput.value)
  if (!id) { store.showToast('请输入网易云歌单 ID 或歌单链接'); return }
  meting.state = 'loading'
  meting.err = ''
  playlistInput.value = id
  try { localStorage.setItem(PLAYLIST_KEY, id) } catch (e) { /* ignore */ }
  const list = await loadPlaylist(id)
  meting.tracks = list || []
  if (meting.tracks.length) {
    meting.state = 'ok'
    // 进入画布时自动恢复歌单不弹提示，只有手动“拉取”才提示
    if (!silent) store.showToast('歌单已加载：' + meting.tracks.length + ' 首')
  } else {
    meting.state = 'fail'
    meting.err = '没取到歌曲（歌单可能私密，或公共接口限流）'
  }
}
function clearPlaylist() {
  meting.tracks = []
  meting.state = 'idle'
  meting.err = ''
  activeIndex.value = Math.max(0, Math.min(localTracks.value.length - 1, activeIndex.value))
  try { localStorage.removeItem(PLAYLIST_KEY) } catch (e) { /* ignore */ }
}
function openList() { listOpen.value = true; favOpen.value = false }
function openFav() { favOpen.value = true; listOpen.value = false }
</script>

<template>
  <div class="cb" :class="'cb-' + kind">
    <!-- 便利贴卡片 -->
    <div v-if="kind === 'note'" class="cb-text">
      <div class="cb-md"><MarkdownView :text="d.markdown || d.text || '…'" /></div>
    </div>

    <!-- 时钟：日期顶 / 24h 超大时间（双圆点冒号）/ 农历底（参考 ClockCard） -->
    <div v-else-if="kind === 'clock'" class="cb-clock">
      <span class="cb-clock__date">{{ clockDateCn }}</span>
      <div class="cb-clock__row">
        <span class="cb-clock__t">{{ clockHms[0] }}</span>
        <span class="cb-clock__sep"><i></i><i></i></span>
        <span class="cb-clock__t">{{ clockHms[1] }}</span>
        <span class="cb-clock__sep"><i></i><i></i></span>
        <span class="cb-clock__t">{{ clockHms[2] }}</span>
      </div>
      <span v-if="lunarText" class="cb-clock__lunar">{{ lunarText }}</span>
    </div>

    <!-- 文档卡：整篇长文，卡片内滚动阅读 -->
    <div v-else-if="kind === 'doc'" class="cb-doc">
      <div class="cb-doc__head">
        <span class="cb-doc__t">{{ docTitle }}</span>
        <button class="cb-doc__bind" :title="d.noteId ? '已绑定笔记，点击更换' : '绑定笔记后可参与关联与连线'"
          @pointerdown.stop @click.stop="bindOpen = true">{{ d.noteId ? '已绑笔记' : '绑定笔记' }}</button>
        <span class="cb-doc__n">{{ docBody ? docBody.length + ' 字' : '空' }}</span>
      </div>
      <div v-if="docBody" class="cb-doc__body" @wheel.stop>{{ docBody }}</div>
      <div v-else class="cb-doc__empty">
        <Icon name="file" :size="22" />
        <span>双击卡片 → 卡片设置里编辑正文</span>
      </div>
    </div>

    <!-- 图片卡：单张图片，点击看大图，可拖入替换 -->
    <div v-else-if="kind === 'image'" class="cb-img" @dragover.prevent.stop @drop.prevent.stop="onImageDrop">
      <template v-if="imgSrc && !imgBroken">
        <img class="cb-img__el" :src="imgSrc" :style="{ objectFit: d.fit || 'cover' }" draggable="false"
          @click.stop="imgView = true" @error="imgBroken = true" />
        <label class="cb-img__btn" title="更换图片" @pointerdown.stop @click.stop>
          <Icon name="upload" :size="13" />
          <input type="file" accept="image/*" style="display: none" @change="onImageFile" />
        </label>
        <label class="cb-img__btn" style="right:46px;left:auto" title="仅本次显示（不入库、不占存储）" @pointerdown.stop @click.stop>
          <span style="font-size:10px;font-weight:700">临时</span>
          <input type="file" accept="image/*" style="display: none" @change="e => tempImageFile(e.target.files && e.target.files[0])" />
        </label>
      </template>
      <label v-else class="cb-img__empty" @pointerdown.stop @click.stop>
        <Icon name="image" :size="24" />
        <span>{{ imgMissing ? '图片已删除，点击更换' : (imgBroken ? '图片加载失败，点击更换' : '点击上传，或把图片拖进来') }}</span>
        <input type="file" accept="image/*" style="display: none" @change="onImageFile" />
      </label>
    </div>

    <!-- 音乐卡：红底 + 左上曲目计数 + 大标题 + 细进度条 + 6 图标 + 右侧出血黑胶（参考图 1/3） -->
    <div v-else-if="kind === 'audio'" class="cb-audio" @dragover.prevent.stop @drop.prevent.stop="onAudioDrop">
      <div class="cb-audio__body">
        <div class="cb-audio__count"><span class="cb-audio__note">♪</span>{{ trackList.length ? activeIndex + 1 + '/' + trackList.length : '0/0' }}</div>
        <div class="cb-audio__t">{{ audioTitle }}</div>
        <div class="cb-audio__bar" @pointerdown.stop @click.stop="seekAudio">
          <span class="cb-audio__bar-line"><span class="cb-audio__bar-fill" :style="{ width: progress + '%' }"></span></span>
          <span class="cb-audio__bar-knob" :style="{ left: progress + '%' }"></span>
        </div>
        <div class="cb-audio__time"><span>{{ fmt(cur) }}</span><span>{{ fmt(dur || 0) }}</span></div>
        <div class="cb-audio__ctl">
          <span class="cb-audio__grp">
            <button class="cb-audio__b" :class="{ on: playMode !== 0 }" :title="modeTitle" @pointerdown.stop @click.stop="cycleMode">
              <svg v-if="playMode === 2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l7 10h4" /><path d="M17 4.5l3 2.5-3 2.5" /><path d="M4 17h4l2.4-3.4" /><path d="M13.4 9.4L15 7h5.4" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a4 4 0 0 1 4-4h11" /><path d="M15 1.5l3 3-3 3" /><path d="M21 16a4 4 0 0 1-4 4H6" /><path d="M9 14.5l-3 3 3 3" /><text v-if="playMode === 1" x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none">1</text></svg>
            </button>
            <button class="cb-audio__b" :class="{ on: muted }" title="静音" @pointerdown.stop @click.stop="toggleMute">
              <svg v-if="!muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a6 6 0 0 1 0 7" /><path d="M19 6a9.5 9.5 0 0 1 0 12" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9l5 6" /><path d="M21 9l-5 6" /></svg>
            </button>
          </span>
          <span class="cb-audio__grp cb-audio__grp--mid">
            <button class="cb-audio__b" title="上一首" @pointerdown.stop @click.stop="prevTrack">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="2.2" height="14" rx="1" /><path d="M18 6.5v11L9 12z" /></svg>
            </button>
            <button class="cb-audio__b cb-audio__b--play" :title="playing ? '暂停' : '播放'" @pointerdown.stop @click.stop="toggleAudio">
              <svg v-if="!playing" viewBox="0 0 24 24" aria-hidden="true" class="cb-audio__play"><path d="M9 5l11 7-11 7z" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true" class="cb-audio__play"><rect x="8" y="5.5" width="3.2" height="13" rx="1" /><rect x="13.4" y="5.5" width="3.2" height="13" rx="1" /></svg>
            </button>
            <button class="cb-audio__b" title="下一首" @pointerdown.stop @click.stop="nextTrack">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.8" y="5" width="2.2" height="14" rx="1" /><path d="M6 6.5v11L15 12z" /></svg>
            </button>
          </span>
          <span class="cb-audio__grp cb-audio__grp--end">
            <button class="cb-audio__b" title="播放页" @pointerdown.stop @click.stop="goPlayer">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5l5 2.5-5 2.5z" /></svg>
            </button>
            <button class="cb-audio__b" title="歌单 / 音源" @pointerdown.stop @click.stop="openList">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11" /><path d="M4 11h11" /><path d="M4 16h7" /><circle cx="18" cy="17" r="2.6" /><path d="M20.6 17V10" /></svg>
            </button>
          </span>
        </div>
      </div>

      <div class="cb-audio__disc" :class="{ playing }" @pointerdown.stop @click.stop="toggleAudio">
        <span class="cb-audio__label" :style="curCover ? { backgroundImage: 'url(' + curCover + ')' } : {}"></span>
        <span class="cb-audio__hole"></span>
      </div>
    </div>

    <div v-else class="cb-text">{{ meta.label }}</div>

    <!-- 歌单 / 收藏：居中玻璃弹窗（Teleport 到 body，避开画布卡片的 transform 定位） -->
    <Teleport to="body">
      <GlassBottomSheet :show="listOpen" :title="'歌单 · ' + trackList.length + ' 首'" @close="listOpen = false">
        <div class="cb-panel" @wheel.stop>
          <!-- 网易云歌单：ID 由用户自己填，公共 Meting 接口免 Key 拉取 -->
          <div class="cb-audio__ne">
            <input class="cb-audio__ne-i" v-model="playlistInput" placeholder="网易云歌单 ID / 歌单链接（自己填）" @keydown.enter.prevent="loadIdPlaylist" />
            <button class="cb-audio__pull" title="加载网易云歌单" @click="loadIdPlaylist">拉取</button>
          </div>
          <div class="cb-audio__phint" :class="{ err: meting.state === 'fail' }">
            <template v-if="meting.state === 'loading'">正在拉取歌单…</template>
            <template v-else-if="meting.state === 'fail'">{{ meting.err }}</template>
            <template v-else-if="meting.tracks.length">网易云 {{ meting.tracks.length }} 首 · <button class="cb-audio__inline" @click="clearPlaylist">清除</button></template>
            <template v-else>填歌单 ID 后可播放整张网易云歌单</template>
          </div>
          <div v-if="!trackList.length" class="cb-audio__pempty">还没有曲目，上传本地音频或从收藏添加</div>
          <div v-else class="cb-panel__list">
            <div v-for="(t, i) in trackList" :key="i" class="cb-audio__row" :class="{ on: i === activeIndex }">
              <button class="cb-audio__row-main" @click="playAt(i)">
                <span class="cb-audio__idx">{{ i + 1 }}</span>
                <span class="cb-audio__row-t">{{ t.title || ('曲目 ' + (i + 1)) }}</span>
                <span v-if="i === activeIndex && playing" class="cb-audio__eq"><i></i><i></i><i></i></span>
              </button>
              <button class="cb-audio__row-del" title="移出歌单" @click="removeTrack(i)"><Icon name="trash" :size="11" /></button>
            </div>
          </div>
          <div class="cb-audio__vol">
            <button class="cb-audio__vbtn" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
              <svg v-if="!muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a6 6 0 0 1 0 7" /><path d="M19 6a9.5 9.5 0 0 1 0 12" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9l5 6" /><path d="M21 9l-5 6" /></svg>
            </button>
            <input class="cb-audio__range" type="range" min="0" max="100" step="1"
              :value="Math.round((muted ? 0 : volume) * 100)"
              @input="onVolInput" />
            <span class="cb-audio__vnum">{{ Math.round((muted ? 0 : volume) * 100) }}</span>
          </div>
          <div class="cb-audio__pacts">
            <label class="cb-audio__srcbtn" title="上传本地音频（可多选，也可直接拖入卡片）">
              <Icon name="upload" :size="12" />
              <input type="file" accept="audio/*" multiple style="display: none" @change="onAudioFiles" />
            </label>
            <button class="cb-audio__pact" @click="openFav">收藏夹</button>
            <button class="cb-audio__pact" @click="saveToCollection">存收藏</button>
          </div>
          <div class="cb-audio__ne">
            <input class="cb-audio__ne-i" v-model="neInput" placeholder="网易云 / QQ 音乐 链接或 ID" @keydown.enter.prevent="connectSmart" />
            <button class="cb-audio__srcbtn" title="接入音源（自动识别网易云 / QQ 音乐）" @click="connectSmart"><Icon name="link" :size="12" /></button>
          </div>
        </div>
      </GlassBottomSheet>

      <GlassBottomSheet :show="favOpen" title="从收藏添加" @close="favOpen = false">
        <div class="cb-panel" @wheel.stop>
          <div v-if="!favTracks.length" class="cb-audio__pempty">收藏里没有带音频链接的条目</div>
          <div v-else class="cb-panel__list">
            <button v-for="c in favTracks" :key="c.id" class="cb-audio__fav" @click="addFromCollection(c)">
              <Icon name="star" :size="11" />
              <span>{{ c.title || '未命名收藏' }}</span>
            </button>
          </div>
          <div class="cb-audio__pacts">
            <button class="cb-audio__pact" @click="openList">返回歌单</button>
          </div>
        </div>
      </GlassBottomSheet>
    </Teleport>

    <!-- 文档卡绑定笔记：绑定后这张卡可参与画布连线 ↔ 功能关联 -->
    <Teleport to="body">
      <GlassBottomSheet :show="bindOpen" title="绑定笔记到这张文档卡" @close="bindOpen = false">
        <div class="cb-bind">
          <button class="cb-bind__new" @click="createAndBindNote">用当前正文新建一条笔记并绑定</button>
          <div class="cb-bind__lab">或选择已有笔记</div>
          <div class="cb-bind__list">
            <button v-for="m in store.live.memos" :key="m.id" class="cb-bind__item" @click="bindNote(m.id)">{{ m.title || '未命名笔记' }}</button>
            <div v-if="!store.live.memos.length" class="cb-bind__empty">还没有笔记</div>
          </div>
        </div>
      </GlassBottomSheet>
    </Teleport>

    <!-- 图片大图预览 -->
    <Teleport to="body">
      <div v-if="imgView && imgSrc" class="cb-lightbox" @click="imgView = false" @wheel.stop.prevent>
        <img :src="imgSrc" alt="" />
        <button class="cb-lightbox__x" title="关闭" @click.stop="imgView = false"><Icon name="close" :size="18" /></button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cb { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--ink, #2C2C2C); }
.cb-text { overflow: hidden; }
.cb-md { white-space: pre-wrap; line-height: 1.5; font-size: 12px; color: var(--ink-2, #86868B); }
.cb-md :deep(.md) { font-size: 12px; line-height: 1.5; color: var(--ink-2, #86868B); }
.cb-md :deep(h1), .cb-md :deep(h2), .cb-md :deep(h3) { font-size: 13px; margin: 2px 0 6px; }

/* ---- 时钟：日期顶 / 超大 24h 时间 + 双圆点冒号 / 农历底 ---- */
.cb-clock {
  position: relative; height: 100%; width: 100%; overflow: hidden; container-type: size; container-name: cb;
  border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(6px, 2.6cqh, 14px);
  color: var(--cb-ink, #2A2A2C);
}
.cb-clock__date {
  font-size: clamp(8.5px, 2.9cqw, 13.5px); font-weight: 600;
  color: var(--cb-ink-2, rgba(60, 60, 62, .55)); font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
/* 字号放在整行：冒号的 1em / .26em 圆点间距随数字一起缩放 */
.cb-clock__row {
  display: flex; align-items: center; justify-content: center;
  gap: clamp(1px, .4cqw, 3px); max-width: 100%;
  font-size: clamp(22px, min(11.5cqw, 15cqh), 46px);
}
.cb-clock__t {
  font-weight: 700; line-height: 1; letter-spacing: .02em;
  font-variant-numeric: tabular-nums;
}
/* 主题色双圆点冒号：middle 锚点后补偿数字字形中心 */
.cb-clock__sep {
  display: inline-flex; flex-direction: column; justify-content: center; align-items: center;
  vertical-align: middle; height: 1em; gap: .26em; margin: 0 .1em;
  transform: translateY(-.09em);
  color: var(--cb-ink-2, rgba(60, 60, 62, .45));
}
.cb-clock__sep i {
  display: block; width: .11em; height: .11em; border-radius: 50%;
  background: currentColor; opacity: .55;
}
.cb-clock__lunar {
  font-size: clamp(8px, 2.7cqw, 12px);
  color: var(--cb-ink-2, rgba(60, 60, 62, .55)); font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}

.cb-doc__bind { flex: none; font-size: 10px; font-weight: 700; color: var(--eo-ink-soft); background: var(--eo-chip); border: 1px solid var(--eo-glass-border); border-radius: 999px; padding: 2px 7px; cursor: pointer; }
.cb-doc__bind:hover { color: var(--eo-ink); background: rgba(44,44,44,.1); }
.cb-bind { width: min(76vw, 380px); display: flex; flex-direction: column; gap: 10px; }
.cb-bind__new { font-size: 13px; font-weight: 600; color: var(--eo-ink); background: var(--eo-chip); border: 1px solid var(--eo-glass-border); border-radius: 10px; padding: 10px; cursor: pointer; }
.cb-bind__lab { font-size: 11px; color: var(--eo-ink-soft); }
.cb-bind__list { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 5px; }
.cb-bind__item { text-align: left; font-size: 13px; color: var(--eo-ink); background: transparent; border: 1px solid var(--eo-glass-border); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
.cb-bind__item:hover { background: var(--eo-chip); }
.cb-bind__empty { font-size: 12px; color: var(--eo-ink-soft); }

/* ---- 文档卡 ---- */
.cb-doc { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.cb-doc__head { display: flex; align-items: baseline; gap: 8px; flex: none; }
.cb-doc__t { font-size: 14px; font-weight: 700; color: #2C2C2C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-doc__n { margin-left: auto; flex: none; font-size: 10.5px; color: #8C8880; font-variant-numeric: tabular-nums; }
.cb-doc__body {
  flex: 1; min-height: 0; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font-size: 13px; line-height: 1.72; color: #4A4844; cursor: auto;
  padding-right: 2px; overscroll-behavior: contain;
}
.cb-doc__body::-webkit-scrollbar { width: 5px; }
.cb-doc__body::-webkit-scrollbar-thumb { background: rgba(44, 44, 44, .18); border-radius: 99px; }
.cb-doc__empty {
  flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: #9A958C; font-size: 12px; text-align: center; padding: 0 12px; line-height: 1.6;
}

/* ---- 图片卡：白边相纸（卡片容器已是白底 + 7px 内边距，这里只负责内侧圆角） ---- */
.cb-img { position: relative; height: 100%; min-height: 0; border-radius: 8px; overflow: hidden; background: #fff; }
.cb-img__el { display: block; width: 100%; height: 100%; cursor: zoom-in; }
.cb-img__btn {
  position: absolute; right: 6px; bottom: 6px; width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: rgba(44, 44, 44, .55); color: #fff; opacity: 0; transition: opacity .15s ease;
}
.cb-img:hover .cb-img__btn { opacity: 1; }
.cb-img__empty {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: #9A958C; font-size: 12px; cursor: pointer; text-align: center; padding: 0 14px; line-height: 1.6;
}
@media (hover: none) { .cb-img__btn { opacity: 1; } }

/* ---- 音乐卡（固定红底，参考图 1/3） ---- */
.cb-audio {
  position: relative; height: 100%; margin: -12px -14px -14px; padding: 12px 14px 14px;
  display: flex; align-items: stretch; overflow: hidden;
  container-type: size; container-name: cb;
  color: #fff;
}
.cb-audio__body {
  flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;
  gap: clamp(4px, 2.4cqh, 12px); padding-right: clamp(56px, 30cqw, 150px);
}
.cb-audio__count {
  display: flex; align-items: center; gap: 4px; flex: none;
  font-size: clamp(9px, 2.8cqw, 12px); font-weight: 700; color: rgba(255, 255, 255, .84);
  font-variant-numeric: tabular-nums;
}
.cb-audio__note { font-size: 1.3em; line-height: 1; }
.cb-audio__t {
  flex: none; min-width: 0; font-weight: 800;
  font-size: clamp(14px, 5.4cqw, 27px); line-height: 1.16; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cb-audio__bar { position: relative; flex: none; height: 14px; display: flex; align-items: center; cursor: pointer; }
.cb-audio__bar-line { position: relative; display: block; width: 100%; height: 3px; border-radius: 99px; background: rgba(255, 255, 255, .34); }
.cb-audio__bar-fill { display: block; height: 100%; border-radius: 99px; background: #fff; transition: width .2s linear; }
.cb-audio__bar-knob {
  position: absolute; top: 50%; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%;
  background: #fff; transform: translateY(-50%); box-shadow: 0 1px 4px rgba(0, 0, 0, .26);
}
.cb-audio__time {
  flex: none; display: flex; justify-content: space-between;
  font-size: clamp(8.5px, 2.5cqw, 11px); color: rgba(255, 255, 255, .72); font-variant-numeric: tabular-nums;
}
.cb-audio__ctl { flex: none; display: flex; align-items: center; gap: 4px; }
.cb-audio__grp { flex: 1; display: flex; align-items: center; gap: clamp(2px, 1.6cqw, 10px); min-width: 0; }
.cb-audio__grp--mid { justify-content: center; }
.cb-audio__grp--end { justify-content: flex-end; }
.cb-audio__b {
  flex: none; display: flex; align-items: center; justify-content: center;
  width: clamp(18px, 6.4cqw, 28px); height: clamp(18px, 6.4cqw, 28px);
  padding: 0; border: 0; border-radius: 50%; background: transparent;
  color: rgba(255, 255, 255, .92); cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
}
.cb-audio__b svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.cb-audio__b:hover { background: rgba(255, 255, 255, .16); }
.cb-audio__b.on { color: #FFD8A6; }
.cb-audio__b--play { width: clamp(21px, 7.4cqw, 32px); height: clamp(21px, 7.4cqw, 32px); }
.cb-audio__b--play svg.cb-audio__play { stroke: none; }
.cb-audio__b--play svg.cb-audio__play path,
.cb-audio__b--play svg.cb-audio__play rect { fill: currentColor; }
.cb-audio__disc {
  position: absolute; right: clamp(-42px, -9cqw, -16px); top: 50%; transform: translateY(-50%);
  width: clamp(96px, min(74cqw, 86cqh), 190px); aspect-ratio: 1; flex: none; border-radius: 50%;
  /* 黑胶：红芯 + 同心纹路 + 深色盘面 */
  background:
    repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, .05) 0 1px, rgba(0, 0, 0, .2) 1px 3px),
    radial-gradient(circle at 50% 50%, #EC4A42 0 21%, #171717 21.7% 100%);
  box-shadow: 0 10px 28px rgba(96, 8, 8, .38), inset 0 0 0 1px rgba(255, 255, 255, .08);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  animation: cb-spin 34s linear infinite;
}
.cb-audio__disc::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: linear-gradient(128deg, rgba(255, 255, 255, .14) 0%, rgba(255, 255, 255, 0) 44%, rgba(255, 255, 255, .04) 100%);
}
.cb-audio__disc.playing { animation-duration: 8s; }
.cb-audio__label { position: absolute; inset: 27%; z-index: 1; border-radius: 50%; background-size: cover; background-position: center; }
.cb-audio__hole {
  position: relative; z-index: 2; width: clamp(5px, 1.8cqw, 9px); aspect-ratio: 1;
  border-radius: 50%; background: #141414; box-shadow: 0 0 0 1px rgba(255, 255, 255, .22);
}
@keyframes cb-spin { to { transform: translateY(-50%) rotate(360deg); } }
.cb-audio audio { display: none; }

/* 歌单 / 收藏：居中玻璃弹窗内的排版（原来贴在卡片上的浮层已改为全局弹窗） */
.cb-panel { display: flex; flex-direction: column; gap: 9px; }
.cb-panel__list { display: flex; flex-direction: column; gap: 4px; max-height: 42vh; overflow: auto; overscroll-behavior: contain; }
.cb-panel__list::-webkit-scrollbar { width: 5px; }
.cb-panel__list::-webkit-scrollbar-thumb { background: rgba(44, 44, 44, .18); border-radius: 99px; }
.cb-audio__pempty { display: flex; align-items: center; justify-content: center; color: var(--eo-ink-soft, #86868B); font-size: 12px; text-align: center; line-height: 1.6; padding: 22px 8px; }
/* 弹窗底部：上传 / 收藏入口 + 音源输入 */
.cb-audio__pacts { display: flex; align-items: center; gap: 6px; flex: none; }
.cb-audio__pact {
  flex: none; padding: 5px 11px; border: 0; border-radius: 99px; cursor: pointer;
  background: rgba(44, 44, 44, .08); color: var(--eo-ink, #2C2C2C); font-size: 11px; font-weight: 700;
}
.cb-audio__pact:hover { background: rgba(44, 44, 44, .14); }
.cb-audio__srcbtn {
  width: 26px; height: 26px; border-radius: 50%; flex: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: rgba(44, 44, 44, .08); color: var(--eo-ink, #2C2C2C); border: 0;
}
.cb-audio__srcbtn:hover { background: rgba(44, 44, 44, .14); }
.cb-audio__ne { display: flex; align-items: center; gap: 6px; flex: none; }
.cb-audio__ne-i {
  flex: 1; min-width: 0; padding: 8px 12px; border-radius: 99px; border: 0; outline: none;
  background: rgba(44, 44, 44, .06); color: var(--eo-ink, #2C2C2C); font-size: 12px;
}
.cb-audio__ne-i::placeholder { color: var(--eo-ink-soft, #86868B); }
.cb-audio__ne-i:focus { background: rgba(44, 44, 44, .10); }
.cb-audio__pull {
  flex: none; padding: 7px 13px; border: 0; border-radius: 99px; cursor: pointer;
  background: #EC4A42; color: #fff; font-size: 11px; font-weight: 700;
}
.cb-audio__pull:hover { background: #F05A53; }
.cb-audio__phint { flex: none; font-size: 11px; line-height: 1.5; color: var(--eo-ink-soft, #86868B); padding: 0 2px; }
.cb-audio__phint.err { color: #C4552F; }
.cb-audio__inline {
  border: 0; background: transparent; padding: 0 2px; cursor: pointer;
  color: var(--eo-ink-soft, #86868B); font-size: 11px; text-decoration: underline;
}
/* 音量：歌单弹窗底部一行，不改动用大标题与图标区的既有节奏 */
.cb-audio__vol { display: flex; align-items: center; gap: 8px; flex: none; }
.cb-audio__vbtn {
  width: 20px; height: 20px; flex: none; padding: 0; border: 0; background: transparent;
  color: var(--eo-ink-soft, #86868B); cursor: pointer; display: flex;
}
.cb-audio__vbtn svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.cb-audio__range { flex: 1; min-width: 0; height: 14px; accent-color: #EC4A42; cursor: pointer; }
.cb-audio__vnum { flex: none; width: 26px; text-align: right; font-size: 10.5px; color: var(--eo-ink-soft, #86868B); font-variant-numeric: tabular-nums; }
.cb-audio__row { display: flex; align-items: center; gap: 2px; flex: none; border-radius: 9px; background: rgba(44, 44, 44, .05); }
.cb-audio__row.on { background: rgba(236, 74, 66, .10); }
.cb-audio__row-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 8px 9px; border: 0; background: transparent;
  color: var(--eo-ink, #2C2C2C); font-size: 12px; text-align: left; cursor: pointer;
}
.cb-audio__idx { flex: none; width: 16px; font-size: 10.5px; color: var(--eo-ink-soft, #86868B); font-variant-numeric: tabular-nums; }
.cb-audio__row.on .cb-audio__idx { color: #EC4A42; font-weight: 700; }
.cb-audio__row-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-audio__row-del { flex: none; width: 22px; height: 22px; margin-right: 4px; border: 0; border-radius: 50%; background: transparent; color: var(--eo-ink-soft, #86868B); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.cb-audio__row-del:hover { background: rgba(44, 44, 44, .12); color: var(--eo-ink, #2C2C2C); }
.cb-audio__eq { flex: none; display: flex; align-items: flex-end; gap: 1.5px; height: 9px; }
.cb-audio__eq i { display: block; width: 2px; background: #E8B86D; border-radius: 1px; animation: cb-eq .9s ease-in-out infinite; }
.cb-audio__eq i:nth-child(1) { height: 5px; animation-delay: 0s; }
.cb-audio__eq i:nth-child(2) { height: 9px; animation-delay: .18s; }
.cb-audio__eq i:nth-child(3) { height: 6px; animation-delay: .36s; }
@keyframes cb-eq { 0%, 100% { transform: scaleY(.5); } 50% { transform: scaleY(1); } }
.cb-audio__fav {
  display: flex; align-items: center; gap: 8px; flex: none; padding: 8px 10px; border: 0; border-radius: 9px;
  background: rgba(44, 44, 44, .05); color: var(--eo-ink, #2C2C2C); font-size: 12px; text-align: left; cursor: pointer;
}
.cb-audio__fav:hover { background: rgba(44, 44, 44, .12); }
.cb-audio__fav span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 图片大图预览 */
.cb-lightbox {
  position: fixed; inset: 0; z-index: 9998; display: flex; align-items: center; justify-content: center;
  background: rgba(20, 19, 17, .82); backdrop-filter: blur(3px); cursor: zoom-out;
}
.cb-lightbox img { max-width: 92vw; max-height: 90vh; border-radius: 10px; box-shadow: 0 24px 60px rgba(0, 0, 0, .45); object-fit: contain; }
.cb-lightbox__x {
  position: absolute; right: 18px; top: 18px; width: 36px; height: 36px; border-radius: 50%;
  border: 0; background: rgba(255, 255, 255, .16); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.cb-lightbox__x:hover { background: rgba(255, 255, 255, .28); }
</style>
