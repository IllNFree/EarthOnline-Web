<script setup>
// ===== 卡片矩阵内容渲染（ArcMind 视觉版）=====
// 2026-11-04：按用户要求下线文字卡 / 链接卡 / 导航卡 / 导航面板 / 隐藏卡 / 热图卡，
// 这里只保留三张默认卡片：便利贴卡片（note）、时钟（clock）、音频（audio）。
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { cardMeta } from '../lib/cardMatrix.js'
import { getCanvasPlayer, getActiveAudioKey, setActiveAudioKey } from '../lib/audioPlayer.js'
import { useAppStore } from '../stores/app.js'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'

const props = defineProps({ node: { type: Object, required: true }, rev: { type: Number, default: 0 } })
const emit = defineEmits(['edit', 'patch'])
const store = useAppStore()

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
const trackList = computed(() => {
  const arr = Array.isArray(d.value.tracks) ? d.value.tracks.filter((t) => t && t.src) : []
  if (arr.length) return arr
  return d.value.src
    ? [{ title: d.value.title || '音频', src: d.value.src, source: d.value.source, format: d.value.format, cover: d.value.cover, songId: d.value.songId, qqUrl: d.value.qqUrl }]
    : []
})
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

function ensurePlayer() {
  if (player) return player
  player = getCanvasPlayer()
  unsubProgress = player.progress.subscribe((p) => {
    cur.value = p.currentTime || 0
    dur.value = p.duration || 0
    progress.value = dur.value ? (cur.value / dur.value) * 100 : 0
  })
  unsubState = player.state.subscribe((s) => {
    const st = s.status
    playing.value = st === 'playing'
    if (st === 'ended') {
      // 单曲循环：播完自动从头再来；否则停在末尾
      if (loopOne.value) { playAt(activeIndex.value); return }
      playing.value = false
    }
    if (st === 'idle') playing.value = false
    if (st === 'error') { store.showToast('音频加载失败：链接可能已失效或需要版权'); playing.value = false }
  })
  return player
}

// 播放队列：把曲目列表交给 makenoise，一次播放整张歌单
function queueOf() {
  return trackList.value.map((t, i) => ({
    id: audioKey.value + '-' + i,
    src: t.src,
    title: t.title || ('曲目 ' + (i + 1)),
    format: formatOf(t),
    cover: t.cover || ''
  }))
}
function playAt(i) {
  const list = trackList.value
  if (!list.length) { store.showToast('请先上传音频，或从收藏添加曲目'); return }
  const idx = Math.max(0, Math.min(list.length - 1, i))
  const p = ensurePlayer()
  if (getActiveAudioKey() && getActiveAudioKey() !== audioKey.value) {
    try { getCanvasPlayer().pause() } catch (e) { /* ignore */ }
  }
  activeIndex.value = idx
  emit('patch', { activeIndex: idx })
  p.play(queueOf(), { startIndex: idx })
  setActiveAudioKey(audioKey.value)
  store.bumpMilestone('musicPlay')
}
function toggleAudio() {
  const src = audioSrc.value
  if (!src) { store.showToast('请先上传音频，或从收藏添加曲目'); return }
  const p = ensurePlayer()
  // 同一时刻只允许一张唱片播放：切换卡片时先暂停另一张
  if (getActiveAudioKey() && getActiveAudioKey() !== audioKey.value) {
    const other = getCanvasPlayer()
    other.pause()
  }
  if (playing.value) {
    p.pause()
    setActiveAudioKey(null)
    return
  }
  const cur0 = p.getState()
  const sameTrack = cur0.current && cur0.current.track && cur0.current.track.src === src
  if (sameTrack) {
    p.play()
    store.bumpMilestone('musicPlay')
  } else {
    playAt(activeIndex.value)
  }
  setActiveAudioKey(audioKey.value)
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
// 从歌单移除一首；若正在播放则先停
function removeTrack(i) {
  const list = trackList.value.slice()
  if (i < 0 || i >= list.length) return
  if (playing.value) { try { getCanvasPlayer().pause() } catch (e) { /* ignore */ } setActiveAudioKey(null) }
  list.splice(i, 1)
  const next = Math.max(0, Math.min(list.length - 1, i >= activeIndex.value ? activeIndex.value : activeIndex.value - 1))
  activeIndex.value = next
  emit('patch', {
    tracks: list,
    activeIndex: next,
    src: (list[next] || {}).src || '',
    title: (list[next] || {}).title || ''
  })
  if (!list.length) store.showToast('歌单已清空')
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
  if (getActiveAudioKey() === audioKey.value) { try { getCanvasPlayer().pause() } catch (e) { /* ignore */ } setActiveAudioKey(null) }
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
    if (getActiveAudioKey() === audioKey.value) { try { getCanvasPlayer().pause() } catch (e) { /* ignore */ } setActiveAudioKey(null) }
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
const IMG_MAX = 8 * 1024 * 1024
function importImageFile(f) {
  if (!f) return
  if (f.type && !/^image\//.test(f.type)) { store.showToast('请选择图片文件'); return }
  if (f.size > IMG_MAX) { store.showToast('图片过大（上限 8MB）'); return }
  const rd = new FileReader()
  rd.onload = () => {
    imgBroken.value = false
    emit('patch', { src: String(rd.result || ''), name: f.name })
    store.showToast('图片已更新')
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
const now = ref(Date.now())
let timer = null
onMounted(() => { if (kind.value === 'clock') timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => {
  if (timer) clearInterval(timer)
  // 卡片离场：若正由本卡播放则停掉；订阅解绑（播放器单例保留供其它卡复用）
  if (getActiveAudioKey() === audioKey.value) {
    try { getCanvasPlayer().pause() } catch (e) { /* ignore */ }
    setActiveAudioKey(null)
  }
  if (unsubProgress) { try { unsubProgress() } catch (e) { /* ignore */ } unsubProgress = null }
  if (unsubState) { try { unsubState() } catch (e) { /* ignore */ } unsubState = null }
})
const p2 = (n) => String(n).padStart(2, '0')
// 参考图：PM + 6 个独立数字块（HH : MM : SS）+ 底部中文日期
const clockDigits = computed(() => {
  const dt = new Date(now.value)
  const h24 = dt.getHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return [p2(h12)[0], p2(h12)[1], p2(dt.getMinutes())[0], p2(dt.getMinutes())[1], p2(dt.getSeconds())[0], p2(dt.getSeconds())[1]]
})
const meridiem = computed(() => (new Date(now.value).getHours() < 12 ? 'AM' : 'PM'))
const clockDateCn = computed(() => {
  const dt = new Date(now.value)
  return dt.getFullYear() + '年' + (dt.getMonth() + 1) + '月' + dt.getDate() + '日星期' + ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]
})

// ---- 音频控制：循环 / 静音（参考图底部 6 个细线图标） ----
const loopOne = ref(false)
const muted = ref(false)
function toggleLoop() { loopOne.value = !loopOne.value }
function toggleMute() {
  const p = ensurePlayer()
  muted.value = !muted.value
  try {
    if (typeof p.setVolume === 'function') p.setVolume(muted.value ? 0 : 0.6)
    else if (p.volume && typeof p.volume.set === 'function') p.volume.set(muted.value ? 0 : 0.6)
  } catch (e) { /* 播放器不支持音量控制时只保留 UI 状态 */ }
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

    <!-- 时钟：AM/PM + 6 个数字块 HH:MM:SS + 中文日期（参考图 7/8） -->
    <div v-else-if="kind === 'clock'" class="cb-clock">
      <span class="cb-clock__mer">{{ meridiem }}</span>
      <div class="cb-clock__row">
        <span class="cb-clock__d">{{ clockDigits[0] }}</span>
        <span class="cb-clock__d">{{ clockDigits[1] }}</span>
        <span class="cb-clock__sep">:</span>
        <span class="cb-clock__d">{{ clockDigits[2] }}</span>
        <span class="cb-clock__d">{{ clockDigits[3] }}</span>
        <span class="cb-clock__sep">:</span>
        <span class="cb-clock__d">{{ clockDigits[4] }}</span>
        <span class="cb-clock__d">{{ clockDigits[5] }}</span>
      </div>
      <span class="cb-clock__date">{{ clockDateCn }}</span>
    </div>

    <!-- 文档卡：整篇长文，卡片内滚动阅读 -->
    <div v-else-if="kind === 'doc'" class="cb-doc">
      <div class="cb-doc__head">
        <span class="cb-doc__t">{{ docTitle }}</span>
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
      <template v-if="d.src && !imgBroken">
        <img class="cb-img__el" :src="d.src" :style="{ objectFit: d.fit || 'cover' }" draggable="false"
          @click.stop="imgView = true" @error="imgBroken = true" />
        <label class="cb-img__btn" title="更换图片" @pointerdown.stop @click.stop>
          <Icon name="upload" :size="13" />
          <input type="file" accept="image/*" style="display: none" @change="onImageFile" />
        </label>
      </template>
      <label v-else class="cb-img__empty" @pointerdown.stop @click.stop>
        <Icon name="image" :size="24" />
        <span>{{ imgBroken ? '图片加载失败，点击更换' : '点击上传，或把图片拖进来' }}</span>
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
            <button class="cb-audio__b" :class="{ on: loopOne }" title="单曲循环" @pointerdown.stop @click.stop="toggleLoop">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a4 4 0 0 1 4-4h11" /><path d="M15 1.5l3 3-3 3" /><path d="M21 16a4 4 0 0 1-4 4H6" /><path d="M9 14.5l-3 3 3 3" /></svg>
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

      <!-- 歌单浮层：曲目 + 上传 / 收藏 / 音源接入（原有能力全部保留） -->
      <div v-if="listOpen" class="cb-audio__panel" @pointerdown.stop @wheel.stop>
        <div class="cb-audio__phead">
          <span>歌单 · {{ trackList.length }} 首</span>
          <button @click.stop="listOpen = false"><Icon name="close" :size="12" /></button>
        </div>
        <div v-if="!trackList.length" class="cb-audio__pempty">还没有曲目，上传本地音频或从收藏添加</div>
        <div v-for="(t, i) in trackList" :key="i" class="cb-audio__row" :class="{ on: i === activeIndex }">
          <button class="cb-audio__row-main" @click.stop="playAt(i)">
            <span class="cb-audio__idx">{{ i + 1 }}</span>
            <span class="cb-audio__row-t">{{ t.title || ('曲目 ' + (i + 1)) }}</span>
            <span v-if="i === activeIndex && playing" class="cb-audio__eq"><i></i><i></i><i></i></span>
          </button>
          <button class="cb-audio__row-del" title="移出歌单" @click.stop="removeTrack(i)"><Icon name="trash" :size="11" /></button>
        </div>
        <div class="cb-audio__pacts">
          <label class="cb-audio__srcbtn" title="上传本地音频（可多选，也可直接拖入卡片）">
            <Icon name="upload" :size="12" />
            <input type="file" accept="audio/*" multiple style="display: none" @change="onAudioFiles" />
          </label>
          <button class="cb-audio__pact" @click.stop="openFav">收藏夹</button>
          <button class="cb-audio__pact" @click.stop="saveToCollection">存收藏</button>
        </div>
        <div class="cb-audio__ne">
          <input class="cb-audio__ne-i" v-model="neInput" placeholder="网易云 / QQ 音乐 链接或 ID" @pointerdown.stop @keydown.enter.stop.prevent="connectSmart" />
          <button class="cb-audio__srcbtn" title="接入音源（自动识别网易云 / QQ 音乐）" @pointerdown.stop @click.stop="connectSmart"><Icon name="link" :size="12" /></button>
        </div>
      </div>

      <!-- 收藏联动浮层 -->
      <div v-if="favOpen" class="cb-audio__panel" @pointerdown.stop @wheel.stop>
        <div class="cb-audio__phead">
          <span>从收藏添加</span>
          <button @click.stop="favOpen = false"><Icon name="close" :size="12" /></button>
        </div>
        <div v-if="!favTracks.length" class="cb-audio__pempty">收藏里没有带音频链接的条目</div>
        <button v-for="c in favTracks" :key="c.id" class="cb-audio__fav" @click.stop="addFromCollection(c)">
          <Icon name="star" :size="11" />
          <span>{{ c.title || '未命名收藏' }}</span>
        </button>
        <div class="cb-audio__pacts">
          <button class="cb-audio__pact" @click.stop="openList">返回歌单</button>
        </div>
      </div>
    </div>

    <div v-else class="cb-text">{{ meta.label }}</div>

    <!-- 图片大图预览 -->
    <Teleport to="body">
      <div v-if="imgView && d.src" class="cb-lightbox" @click="imgView = false" @wheel.stop.prevent>
        <img :src="d.src" alt="" />
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

/* ---- 时钟：AM/PM + 6 个数字块 + 中文日期 ---- */
.cb-clock {
  position: relative; height: 100%; width: 100%; overflow: hidden; container-type: size; container-name: cb;
  border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(6px, 2.8cqh, 16px);
  color: var(--cb-ink, #2A2A2C);
}
.cb-clock__mer {
  font-size: clamp(8px, 2.6cqw, 13px); font-weight: 700; letter-spacing: .18em;
  color: var(--cb-ink-2, rgba(60, 60, 62, .55));
}
.cb-clock__row { display: flex; align-items: center; gap: clamp(2px, .8cqw, 5px); }
.cb-clock__d {
  display: flex; align-items: center; justify-content: center;
  min-width: clamp(17px, 8.6cqw, 40px);
  height: clamp(26px, 16cqh, 58px);
  border-radius: clamp(4px, 1.6cqw, 9px);
  background: #1F2A3B; color: #F2F4F8;
  font-size: clamp(15px, min(8.4cqw, 12cqh), 34px); font-weight: 700; line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .1), 0 2px 7px rgba(0, 0, 0, .18);
}
.cb-clock__sep {
  font-size: clamp(12px, 5.4cqw, 24px); font-weight: 700; line-height: 1;
  color: var(--cb-ink-2, rgba(60, 60, 62, .45)); padding: 0 clamp(1px, .5cqw, 3px);
}
.cb-clock__date {
  font-size: clamp(8.5px, 2.9cqw, 13.5px); font-weight: 600;
  color: var(--cb-ink-2, rgba(60, 60, 62, .55)); font-variant-numeric: tabular-nums;
}
@container cb (max-height: 110px) { .cb-clock__mer { display: none; } }

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

/* ---- 图片卡 ---- */
.cb-img { position: relative; height: 100%; min-height: 0; border-radius: 10px; overflow: hidden; background: rgba(44, 44, 44, .06); }
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

/* 歌单 / 收藏浮层 */
.cb-audio__panel {
  position: absolute; inset: 2px; z-index: 5; display: flex; flex-direction: column; gap: 3px;
  padding: 8px 9px 10px; border-radius: 12px; overflow: auto;
  background: rgba(32, 18, 18, .94); backdrop-filter: blur(6px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .09);
}
.cb-audio__phead { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, .92); margin-bottom: 3px; flex: none; }
.cb-audio__phead button { border: 0; background: transparent; color: rgba(255, 255, 255, .7); cursor: pointer; display: flex; padding: 2px; }
.cb-audio__pempty { flex: 1; display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, .5); font-size: 11px; text-align: center; line-height: 1.6; padding: 6px 8px; }
/* 浮层底部：上传 / 收藏入口 + 音源输入 */
.cb-audio__pacts { display: flex; align-items: center; gap: 5px; flex: none; margin-top: 2px; }
.cb-audio__pact {
  flex: none; padding: 3px 8px; border: 0; border-radius: 99px; cursor: pointer;
  background: rgba(255, 255, 255, .16); color: rgba(255, 255, 255, .92); font-size: 10px; font-weight: 700;
}
.cb-audio__pact:hover { background: rgba(255, 255, 255, .3); }
.cb-audio__srcbtn {
  width: 22px; height: 22px; border-radius: 50%; flex: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .2); color: rgba(255, 255, 255, .92); border: 0;
}
.cb-audio__srcbtn:hover { background: rgba(255, 255, 255, .34); }
.cb-audio__ne { display: flex; align-items: center; gap: 4px; flex: none; }
.cb-audio__ne-i {
  flex: 1; min-width: 0; padding: 4px 8px; border-radius: 99px; border: 0; outline: none;
  background: rgba(255, 255, 255, .14); color: #fff; font-size: 10px;
}
.cb-audio__ne-i::placeholder { color: rgba(255, 255, 255, .55); }
.cb-audio__ne-i:focus { background: rgba(255, 255, 255, .22); }
.cb-audio__row { display: flex; align-items: center; gap: 2px; flex: none; border-radius: 7px; background: rgba(255, 255, 255, .05); }
.cb-audio__row.on { background: rgba(255, 255, 255, .16); }
.cb-audio__row-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 6px; border: 0; background: transparent;
  color: rgba(255, 255, 255, .88); font-size: 11px; text-align: left; cursor: pointer;
}
.cb-audio__idx { flex: none; width: 14px; font-size: 9.5px; color: rgba(255, 255, 255, .45); font-variant-numeric: tabular-nums; }
.cb-audio__row.on .cb-audio__idx { color: rgba(255, 255, 255, .8); }
.cb-audio__row-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-audio__row-del { flex: none; width: 20px; height: 20px; border: 0; border-radius: 50%; background: transparent; color: rgba(255, 255, 255, .45); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.cb-audio__row-del:hover { background: rgba(255, 255, 255, .14); color: #fff; }
.cb-audio__eq { flex: none; display: flex; align-items: flex-end; gap: 1.5px; height: 9px; }
.cb-audio__eq i { display: block; width: 2px; background: #E8B86D; border-radius: 1px; animation: cb-eq .9s ease-in-out infinite; }
.cb-audio__eq i:nth-child(1) { height: 5px; animation-delay: 0s; }
.cb-audio__eq i:nth-child(2) { height: 9px; animation-delay: .18s; }
.cb-audio__eq i:nth-child(3) { height: 6px; animation-delay: .36s; }
@keyframes cb-eq { 0%, 100% { transform: scaleY(.5); } 50% { transform: scaleY(1); } }
.cb-audio__fav {
  display: flex; align-items: center; gap: 6px; flex: none; padding: 6px 7px; border: 0; border-radius: 7px;
  background: rgba(255, 255, 255, .06); color: rgba(255, 255, 255, .88); font-size: 11px; text-align: left; cursor: pointer;
}
.cb-audio__fav:hover { background: rgba(255, 255, 255, .16); }
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
