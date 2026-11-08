<script setup>
// ===== 独立音乐播放页（homepage 风格）=====
// 入口只从画布音乐卡进入：卡片把曲目队列写入 eo:music_queue 后跳转 /music。
// 复用全局播放器单例（audioPlayer.js）：离开本页不暂停，返回画布时音乐继续播放。
// 布局：模糊封面背景 + 左白边封面 + 右歌词渐进模糊 + 底部控制条。
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { getCanvasPlayer, setActiveAudioKey } from '../lib/audioPlayer.js'
import { loadLyric } from '../lib/meting.js'

const router = useRouter()
const QUEUE_KEY = 'eo:music_queue'
const MODE_KEY = 'eo:music_mode'
const VOL_KEY = 'eo:music_volume'
const MUTE_KEY = 'eo:music_muted'

const tracks = ref([])
const activeIndex = ref(0)
const lyrics = ref([])
const lyricState = ref('idle') // idle / loading / ok / none
const lyricBox = ref(null)
const playing = ref(false)
const cur = ref(0)
const dur = ref(0)
const progress = ref(0)
const playMode = ref(0)
const volume = ref(0.6)
const muted = ref(false)

let player = null
let unsubProgress = null
let unsubState = null
let lyricToken = 0
// 队列来自哪张画布音乐卡：在播放页重新开播时保持音源归属，返回画布后卡片仍能同步进度
let queueActiveKey = ''
// 进入播放页时卡片是否正在播放：用于浏览器/路由时序导致卡片先暂停时恢复播放
let queueWasPlaying = false

const track = computed(() => tracks.value[activeIndex.value] || {})
const title = computed(() => track.value.title || '暂无曲目')
const artist = computed(() => track.value.artist || '')
const cover = computed(() => track.value.cover || '')
const modeTitle = computed(() => ['顺序循环', '单曲循环', '随机播放'][playMode.value])
const coverStyle = computed(() => (cover.value ? { backgroundImage: 'url(' + cover.value + ')' } : {}))
const bgStyle = computed(() => (cover.value ? { backgroundImage: 'url(' + cover.value + ')' } : {}))

function clampIndex(v, len) { return Math.max(0, Math.min(Math.max(0, len - 1), Number(v) || 0)) }
function fmt(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return m + ':' + String(ss).padStart(2, '0')
}

// ---- 队列：优先读画布卡片写入的 eo:music_queue，没有则复用播放器当前队列 ----
function readQueue() {
  try {
    const j = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null')
    if (j && Array.isArray(j.tracks) && j.tracks.length) {
      tracks.value = j.tracks.filter((t) => t && t.src).map((t, i) => ({
        title: t.title || ('曲目 ' + (i + 1)),
        artist: t.artist || '',
        src: t.src,
        format: t.format || 'mp3',
        cover: t.cover || '',
        lrc: t.lrc || '',
        source: t.source || ''
      }))
      activeIndex.value = clampIndex(j.startIndex, tracks.value.length)
      queueActiveKey = String(j.activeKey || '')
      queueWasPlaying = !!j.playing
      return true
    }
  } catch (e) { /* ignore */ }
  return false
}
function readPlayerQueue() {
  if (!player) return
  const st = player.getState()
  if (!st || !Array.isArray(st.queue)) return
  if (!st.queue.length) return
  tracks.value = st.queue.map((q, i) => {
    const t = (q && q.track) || {}
    return {
      title: t.title || ('曲目 ' + (i + 1)),
      artist: t.artist || '',
      src: t.src || '',
      format: t.format || 'mp3',
      cover: t.cover || t.artwork || '',
      lrc: t.lrc || '',
      source: t.source || ''
    }
  }).filter((t) => t.src)
  if (st.currentIndex >= 0) activeIndex.value = clampIndex(st.currentIndex, tracks.value.length)
}
function queueOf() {
  return tracks.value.map((t, i) => ({
    id: 'music-' + i,
    src: t.src,
    title: t.title || ('曲目 ' + (i + 1)),
    artist: t.artist || '',
    format: t.format || 'mp3',
    cover: t.cover || '',
    artwork: t.cover || '',
    lrc: t.lrc || ''
  }))
}

// ---- 播放器：单例复用；已在放同一首时绝不重启 ----
function applyMode() {
  try {
    if (typeof player.setShuffle === 'function') player.setShuffle(playMode.value === 2)
    if (typeof player.setRepeat === 'function') player.setRepeat(playMode.value === 1 ? 'one' : 'all')
  } catch (e) { /* ignore */ }
}
function initPlayer() {
  player = getCanvasPlayer()
  try {
    const v = Number(localStorage.getItem(MODE_KEY))
    playMode.value = v === 1 || v === 2 ? v : 0
    const vol = Number(localStorage.getItem(VOL_KEY))
    volume.value = Number.isFinite(vol) && vol >= 0 && vol <= 1 ? vol : 0.6
    // 静音状态单独存：音量为 0 只代表音量为 0，不能再把「取消静音」卡在没有音量上
    muted.value = localStorage.getItem(MUTE_KEY) === '1' || volume.value === 0
  } catch (e) { /* ignore */ }
  try {
    player.setVolume(volume.value)
    player.setMuted(muted.value)
  } catch (e) { /* ignore */ }
  applyMode()

  unsubProgress = player.progress.subscribe((p) => {
    cur.value = p.currentTime || 0
    dur.value = p.duration || 0
    progress.value = dur.value ? (cur.value / dur.value) * 100 : 0
  })
  unsubState = player.state.subscribe((s) => {
    playing.value = !!s.playing
    if (typeof s.currentIndex === 'number' && s.currentIndex >= 0 && s.currentIndex < tracks.value.length) {
      activeIndex.value = s.currentIndex
    }
  })

  if (!tracks.value.length) readPlayerQueue()
  const st = player.getState()
  const curSrc = st.current && st.current.track ? st.current.track.src : ''
  if (curSrc) {
    // 已经在播放：找到队列里的同一首，保持进度继续听
    const i = tracks.value.findIndex((t) => t.src === curSrc)
    if (i >= 0) {
      activeIndex.value = i
      // 重新认领音源归属：画布卡片返回时仍能同步进度与播放态
      if (queueActiveKey) setActiveAudioKey(queueActiveKey)
      // 卡片离场可能先暂停了一拍：按进入时的播放意图恢复
      if (queueWasPlaying && !st.playing) player.play()
    } else if (!tracks.value.length) {
      tracks.value = [{ title: st.current.track.title || '当前曲目', artist: st.current.track.artist || '', src: curSrc, format: st.current.track.format || 'mp3', cover: st.current.track.cover || st.current.track.artwork || '', lrc: st.current.track.lrc || '' }]
      activeIndex.value = 0
    }
  } else if (tracks.value.length) {
    if (queueActiveKey) setActiveAudioKey(queueActiveKey)
    player.play(queueOf(), { startIndex: activeIndex.value })
  }
  loadLyricFor(track.value)
}

// ---- 歌词：当前行高亮 + 上下渐进模糊 ----
async function loadLyricFor(t) {
  lyrics.value = []
  lyricState.value = 'idle'
  if (!t || !t.lrc) { lyricState.value = 'none'; return }
  lyricState.value = 'loading'
  const token = ++lyricToken
  const lines = await loadLyric(t)
  if (token !== lyricToken) return
  lyrics.value = lines || []
  lyricState.value = lyrics.value.length ? 'ok' : 'none'
}
const lyricIdx = computed(() => {
  const arr = lyrics.value
  if (!arr.length) return -1
  const t = cur.value + 0.12
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].t <= t) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
})
// 距离当前行越远：透明度越低 + 高斯模糊越大（渐进模糊）
function lineStyle(i) {
  const d = Math.abs(i - lyricIdx.value)
  const blur = Math.min(7, Math.max(0, d - 1) * 1.15)
  const op = d === 0 ? 1 : Math.max(0.16, 1 - d * 0.17)
  return {
    opacity: op,
    filter: blur ? 'blur(' + blur + 'px)' : 'none',
    transform: d === 0 ? 'scale(1.06)' : 'none'
  }
}
watch(lyricIdx, async (i) => {
  if (i < 0) return
  await nextTick()
  const box = lyricBox.value
  if (!box) return
  const el = box.querySelector('.mp-lyr__line.on')
  if (!el) return
  // 只滚动歌词容器本身：scrollIntoView 会连带滚动外层 .music-page，
  // 歌词到最后一行时会把顶栏顶出屏幕、底部露出背景色块
  const top = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
})
function seekLyric(item) {
  if (!item || !player || !dur.value) return
  try { player.seek(item.t) } catch (e) { /* ignore */ }
}

// ---- 控制 ----
function toggle() {
  if (!player) return
  if (!tracks.value.length) return
  // 播放页的按钮是唯一允许暂停的地方：点一下切播放/暂停
  if (playing.value) { try { player.pause() } catch (e) { /* ignore */ } return }
  try { player.play() } catch (e) { /* ignore */ }
}
function prev() {
  if (!player || !tracks.value.length) return
  if (dur.value && cur.value > 3) { try { player.seek(0) } catch (e) { /* ignore */ } return }
  player.previous()
}
function next() { if (player && tracks.value.length) player.next() }
function cycleMode() {
  playMode.value = (playMode.value + 1) % 3
  try { localStorage.setItem(MODE_KEY, String(playMode.value)) } catch (e) { /* ignore */ }
  applyMode()
}
function toggleMute() {
  muted.value = !muted.value
  // 静音不再把音量写成 0；取消静音时若音量是 0（历史数据），恢复到 0.6 保证有声音
  if (!muted.value && volume.value === 0) volume.value = 0.6
  try {
    // 顺序不能反：Howler 静音期间不会更新音频节点音量，先解除静音再落音量才有声
    player.setMuted(muted.value)
    if (!muted.value) player.setVolume(volume.value)
  } catch (e) { /* ignore */ }
  try {
    localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0')
    localStorage.setItem(VOL_KEY, String(volume.value))
  } catch (e) { /* ignore */ }
}
function seek(e) {
  if (!player || !dur.value) return
  const r = e.currentTarget.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  try { player.seek(ratio * dur.value) } catch (err) { /* ignore */ }
}
function goBack() {
  if (window.history.state && window.history.state.back != null) router.back()
  else router.push('/')
}

// 切歌后重新拉歌词（同一首不重复请求）
watch(() => track.value.src, (s) => { if (s) loadLyricFor(track.value) })

onMounted(() => {
  readQueue()
  initPlayer()
})
onUnmounted(() => {
  // 只解绑订阅，不暂停：返回画布后音乐继续播放
  if (unsubProgress) { try { unsubProgress() } catch (e) { /* ignore */ } }
  if (unsubState) { try { unsubState() } catch (e) { /* ignore */ } }
  unsubProgress = null
  unsubState = null
})
</script>

<template>
  <div class="music-page">
    <div class="mp-bg" :style="bgStyle" aria-hidden="true"></div>
    <div class="mp-veil" aria-hidden="true"></div>

    <header class="mp-head">
      <button class="mp-back" title="返回画布" aria-label="返回画布" @click="goBack">
        <Icon name="chevron-left" :size="22" />
      </button>
      <span class="mp-head__t">正在播放</span>
      <span class="mp-head__n">{{ tracks.length ? (activeIndex + 1) + ' / ' + tracks.length : '' }}</span>
    </header>

    <main class="mp-body">
      <section class="mp-left">
        <div class="mp-paper">
          <div class="mp-cover" :style="coverStyle">
            <Icon v-if="!cover" name="music" :size="52" />
          </div>
        </div>
        <h1 class="mp-title">{{ title }}</h1>
        <p class="mp-artist">{{ artist || (track.source === 'meting' ? '网易云音乐' : '本地音频') }}</p>
      </section>

      <section class="mp-right">
        <div ref="lyricBox" class="mp-lyr">
          <div v-if="!lyrics.length" class="mp-lyr__empty">
            <template v-if="lyricState === 'loading'">正在加载歌词…</template>
            <template v-else>这首歌暂无歌词，静静听吧</template>
          </div>
          <div v-for="(l, i) in lyrics" :key="i" class="mp-lyr__line" :class="{ on: i === lyricIdx }"
            :style="lineStyle(i)" @click="seekLyric(l)">{{ l.text }}</div>
        </div>
      </section>
    </main>

    <footer class="mp-bar">
      <div class="mp-seek">
        <span class="mp-seek__t">{{ fmt(cur) }}</span>
        <span class="mp-seek__line" @click="seek">
          <span class="mp-seek__rail"><span class="mp-seek__fill" :style="{ width: progress + '%' }"></span></span>
          <span class="mp-seek__knob" :style="{ left: progress + '%' }"></span>
        </span>
        <span class="mp-seek__t">{{ fmt(dur) }}</span>
      </div>
      <div class="mp-ctl">
        <span class="mp-ctl__side">
          <button class="mp-b" :class="{ on: playMode !== 0 }" :title="modeTitle" @click="cycleMode">
            <svg v-if="playMode === 2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l7 10h4" /><path d="M17 4.5l3 2.5-3 2.5" /><path d="M4 17h4l2.4-3.4" /><path d="M13.4 9.4L15 7h5.4" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a4 4 0 0 1 4-4h11" /><path d="M15 1.5l3 3-3 3" /><path d="M21 16a4 4 0 0 1-4 4H6" /><path d="M9 14.5l-3 3 3 3" /><text v-if="playMode === 1" x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none">1</text></svg>
          </button>
          <button class="mp-b" :class="{ on: muted }" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
            <svg v-if="!muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a6 6 0 0 1 0 7" /><path d="M19 6a9.5 9.5 0 0 1 0 12" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9l5 6" /><path d="M21 9l-5 6" /></svg>
          </button>
        </span>
        <span class="mp-ctl__mid">
          <button class="mp-b mp-b--side" title="上一首" @click="prev">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="2.2" height="14" rx="1" /><path d="M18 6.5v11L9 12z" /></svg>
          </button>
          <button class="mp-b mp-b--play" :title="playing ? '暂停' : '播放'" @click="toggle()">
            <svg v-if="!playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l11 7-11 7z" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="5.5" width="3.2" height="13" rx="1" /><rect x="13.4" y="5.5" width="3.2" height="13" rx="1" /></svg>
          </button>
          <button class="mp-b mp-b--side" title="下一首" @click="next">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.8" y="5" width="2.2" height="14" rx="1" /><path d="M6 6.5v11L15 12z" /></svg>
          </button>
        </span>
        <span class="mp-ctl__side mp-ctl__end">
          <button class="mp-b" title="返回画布" @click="goBack">
            <Icon name="music" :size="18" />
          </button>
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.music-page {
  position: fixed; inset: 0; z-index: 66;
  /* clip 彻底禁止页面被程序滚动（hidden 仍允许 scrollTop 变化） */
  overflow: hidden; overflow: clip;
  display: flex; flex-direction: column;
  color: #fff;
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
  background: #191818;
}
/* 模糊封面背景：放大避免边缘漏色 + 模糊 + 底部渐变压暗 */
.mp-bg {
  position: absolute; inset: -12%;
  background: linear-gradient(135deg, #D64747, #7A2320) center / cover no-repeat;
  filter: blur(46px) saturate(130%) brightness(.8);
  transform: scale(1.12);
  transform-origin: center;
}
.mp-veil {
  position: absolute; inset: 0;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(14, 14, 16, .18), rgba(14, 14, 16, .62) 68%),
    linear-gradient(180deg, rgba(14, 14, 16, .16) 0%, rgba(14, 14, 16, .30) 55%, rgba(14, 14, 16, .72) 100%);
}

/* 顶栏 */
.mp-head {
  position: relative; z-index: 2; flex: none;
  display: flex; align-items: center; gap: 10px;
  padding: 14px clamp(16px, 5vw, 48px) 6px;
}
.mp-back {
  flex: none; width: 38px; height: 38px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255, 255, 255, .18);
  background: rgba(255, 255, 255, .10); color: #fff; cursor: pointer;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: background .18s ease, transform .18s ease;
}
.mp-back:hover { background: rgba(255, 255, 255, .2); transform: translateY(-1px); }
.mp-head__t { flex: 1; font-size: 13px; font-weight: 700; letter-spacing: .14em; color: rgba(255, 255, 255, .82); }
.mp-head__n { flex: none; font-size: 12px; color: rgba(255, 255, 255, .55); font-variant-numeric: tabular-nums; }

/* 主体：左封面 / 右歌词 */
.mp-body {
  position: relative; z-index: 2; flex: 1; min-height: 0;
  display: grid; grid-template-columns: minmax(0, 42%) minmax(0, 1fr);
  gap: clamp(18px, 4vw, 56px);
  align-items: center;
  padding: 8px clamp(16px, 5vw, 48px) 4px;
}
.mp-left { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 18px; }
/* 白边相纸封面：白底内边距 + 轻微倾斜，与画布照片卡同一套相纸语言 */
.mp-paper {
  width: min(100%, 340px);
  padding: 10px 10px 12px; border-radius: 14px; background: #fff;
  box-shadow: 0 22px 50px -18px rgba(0, 0, 0, .55);
  transform: rotate(-2deg);
  transition: transform .35s cubic-bezier(.22, 1, .36, 1);
}
.mp-paper:hover { transform: rotate(0deg) translateY(-2px); }
.mp-cover {
  position: relative; width: 100%; aspect-ratio: 1;
  border-radius: 8px; overflow: hidden;
  background: linear-gradient(135deg, #EC4A42, #8E2E29) center / cover no-repeat;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, .8);
}
.mp-title {
  margin: 0; max-width: 100%;
  font-size: clamp(19px, 3.2vw, 30px); line-height: 1.2; font-weight: 800; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-shadow: 0 2px 16px rgba(0, 0, 0, .35);
}
.mp-artist {
  margin: 0; font-size: 13px; color: rgba(255, 255, 255, .62);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 歌词：当前行清晰，上下渐进模糊 */
.mp-right { min-height: 0; height: 100%; display: flex; align-items: center; }
.mp-lyr {
  position: relative; /* offsetTop 基准，歌词滚动只用容器自身 */
  width: 100%; max-height: min(52vh, 480px); overflow: auto; text-align: left;
  padding: 24px 4px;
  overscroll-behavior: contain; scroll-behavior: smooth;
  mask-image: linear-gradient(180deg, transparent 0, #000 12%, #000 88%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 12%, #000 88%, transparent 100%);
}
.mp-lyr::-webkit-scrollbar { width: 0; }
.mp-lyr__line {
  padding: 9px 2px; font-size: clamp(14px, 1.5vw, 18px); line-height: 1.5;
  color: rgba(255, 255, 255, .78); cursor: pointer;
  transition: color .2s ease, opacity .2s ease, filter .2s ease, transform .2s ease;
  transform-origin: left center;
}
.mp-lyr__line.on { color: #fff; font-weight: 700; text-shadow: 0 2px 18px rgba(0, 0, 0, .35); }
.mp-lyr__empty { padding: 28px 2px; color: rgba(255, 255, 255, .5); font-size: 13px; line-height: 1.7; }

/* 底部控制条 */
.mp-bar {
  position: relative; z-index: 2; flex: none;
  padding: 10px clamp(16px, 5vw, 48px) max(18px, env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(18, 18, 20, 0), rgba(18, 18, 20, .42));
}
.mp-seek { display: flex; align-items: center; gap: 10px; font-size: 11px; color: rgba(255, 255, 255, .6); font-variant-numeric: tabular-nums; }
.mp-seek__t { flex: none; width: 42px; text-align: center; }
.mp-seek__line { position: relative; flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; }
.mp-seek__rail { display: block; width: 100%; height: 4px; border-radius: 99px; background: rgba(255, 255, 255, .22); }
.mp-seek__fill { display: block; height: 100%; border-radius: 99px; background: #fff; transition: width .2s linear; }
.mp-seek__knob {
  position: absolute; top: 50%; width: 11px; height: 11px; margin-left: -5.5px; border-radius: 50%;
  background: #fff; transform: translateY(-50%); box-shadow: 0 2px 8px rgba(0, 0, 0, .4);
}
.mp-ctl { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.mp-ctl__side { flex: 1; display: flex; align-items: center; gap: clamp(4px, 1.4vw, 12px); }
.mp-ctl__mid { flex: none; display: flex; align-items: center; gap: clamp(10px, 3vw, 30px); }
.mp-ctl__end { justify-content: flex-end; }
.mp-b {
  flex: none; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: transparent; color: rgba(255, 255, 255, .88);
  transition: background .16s ease, color .16s ease;
}
.mp-b:hover { background: rgba(255, 255, 255, .14); }
.mp-b.on { color: #FFD8A6; }
.mp-b svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.mp-b--side svg { width: 70%; height: 70%; }
.mp-b--play {
  width: 56px; height: 56px;
  background: #fff; color: #201E1C;
  box-shadow: 0 10px 26px -8px rgba(0, 0, 0, .6);
}
.mp-b--play:hover { background: #F6F2EA; }
.mp-b--play svg { width: 42%; height: 42%; stroke: none; }
.mp-b--play svg path, .mp-b--play svg rect { fill: currentColor; }

@media (max-width: 899px) {
  .mp-body {
    grid-template-columns: minmax(0, 1fr);
    align-content: center; gap: 16px;
    padding-top: 4px; padding-bottom: 4px;
  }
  .mp-left { align-items: center; text-align: center; gap: 12px; }
  .mp-paper { width: min(58vw, 220px); }
  .mp-title, .mp-artist { text-align: center; max-width: 100%; }
  .mp-right { flex: 1; min-height: 0; }
  .mp-lyr { max-height: 30vh; text-align: center; }
  .mp-lyr__line { transform-origin: center; }
  .mp-ctl__side { flex: 0.6; }
}
@media (max-height: 620px) {
  .mp-paper { width: min(34vh, 220px); }
  .mp-lyr { max-height: 32vh; }
}
</style>
