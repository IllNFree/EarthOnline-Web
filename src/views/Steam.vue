<script setup>
// ===== Steam 游戏库（模块三 · 小黑盒风格深度展示） =====
// 数据走自建 SWR 缓存层（steamQuery.js）：请求去重 + 30 分钟 TTL + IndexedDB 持久化，
// 切页返回秒开、刷新页面先读本地缓存再后台静默更新，绝不重复拉取（模块一）。
// 展示字段仅取 Steam Web API 能稳定获取的（头像 / 昵称 / 自定义网址 / 等级 / 账号年龄 /
// 总游戏数 / 总时长 / 近两周时长 / 最近游玩 / 成就）；bio 与展柜官方接口不返回，直接不展示。
import { ref, computed, onMounted, onActivated, defineOptions } from 'vue'
import { useAppStore } from '../stores/app.js'
import { ensureSteam, steamState, ensureAchievements, clearSteamCache } from '../services/steamQuery.js'
import { steamCoverHD, steamCoverHDAlt } from '../lib/steam.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'
import EmptyState from '../components/EmptyState.vue'

defineOptions({ name: 'Steam' })

const store = useAppStore()
const cfg = ref({ ...store.data.steam })
const showBind = ref(false)

const games = computed(() => steamState.games)
const profile = computed(() => steamState.profile)
const loading = computed(() => steamState.loading)
const revalidating = computed(() => steamState.revalidating)
const error = computed(() => steamState.error)
const count = computed(() => steamState.count)
const at = computed(() => steamState.at)

const displayName = computed(() => (profile.value && profile.value.personaName) || '我的 Steam 档案')
const level = computed(() => (profile.value && profile.value.level) || 0)
const accountAge = computed(() => (profile.value && profile.value.accountAgeYears) || 0)
const profileUrl = computed(() => (profile.value && profile.value.profileUrl) || '')
const customUrl = computed(() => {
  const u = profileUrl.value
  if (!u) return ''
  const m = u.match(/steamcommunity\.com\/(id|profiles)\/([^/]+)/)
  return m ? 'steamcommunity.com/' + m[1] + '/' + m[2] : u
})

// 游戏库网格默认收起（首次进入），用户展开/收起后记住状态
const LIB_KEY = 'eo_steam_lib_open'
const libOpen = ref(false)
try { libOpen.value = localStorage.getItem(LIB_KEY) === '1' } catch (e) { /* 隐私模式忽略 */ }
function toggleLib() {
  libOpen.value = !libOpen.value
  try { localStorage.setItem(LIB_KEY, libOpen.value ? '1' : '0') } catch (e) { /* ignore */ }
}

const query = ref('')
const sortKey = ref('recent')
const SORTS = [
  { key: 'recent', label: '近期在玩' },
  { key: 'total', label: '总时长' },
  { key: 'name', label: '名称' }
]
const filteredGames = computed(() => {
  const q = query.value.trim().toLowerCase()
  let arr = games.value.slice()
  if (q) arr = arr.filter((g) => (g.name || '').toLowerCase().includes(q))
  if (sortKey.value === 'recent') arr.sort((a, b) => (b.recentHours - a.recentHours) || (b.playtimeHours - a.playtimeHours))
  else if (sortKey.value === 'total') arr.sort((a, b) => b.playtimeHours - a.playtimeHours)
  else if (sortKey.value === 'name') arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
  return arr
})
const totalTime = computed(() => games.value.reduce((s, g) => s + (g.playtimeHours || 0), 0))
const totalRecent = computed(() => games.value.reduce((s, g) => s + (g.recentHours || 0), 0))
const recentGames = computed(() => games.value.filter((g) => (g.recentHours || 0) > 0).sort((a, b) => (b.recentHours - a.recentHours) || (b.playtimeHours - a.playtimeHours)))

const fmtHours = (h) => Number(h || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
function fmtTime(ts) {
  if (!ts) return '暂无记录'
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return '暂无记录'
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const details = ref({})
function detailOf(appid) { return details.value[appid] || null }
function achPct(g) {
  const d = detailOf(g.appid)
  if (!d || !d.fetched || !d.total) return -1
  return Math.round((d.unlocked / d.total) * 100)
}
function toggleDetail(g) {
  const cur = details.value[g.appid]
  if (cur && cur.open) { cur.open = false; details.value = { ...details.value }; return }
  const entry = cur || { open: true, loading: false, error: '', achievements: [], unlocked: 0, total: 0, fetched: false }
  entry.open = true; details.value = { ...details.value, [g.appid]: entry }
  if (entry.fetched || entry.loading) return
  entry.loading = true
  ensureAchievements(cfg.value, g.appid).then((r) => {
    entry.loading = false
    if (r && r.ok) { entry.achievements = r.achievements || []; entry.unlocked = r.unlocked || 0; entry.total = r.total || 0; entry.error = '' }
    else entry.error = (r && r.error) || '成就数据不可用'
    entry.fetched = true; details.value = { ...details.value }
  })
}

// 高清封面：fastly → akamai → header 三级兜底（红线 3：404 不白图）
function coverTiers(g) {
  const id = g.appid
  return [
    steamCoverHD(id),
    steamCoverHDAlt(id),
    'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg'
  ]
}
function coverSrc(g) { const t = coverTiers(g); return t[Number(g.__tier || 0)] || t[0] }
function onCoverError(g, e) {
  const t = coverTiers(g)
  const next = Number(g.__tier || 0) + 1
  if (next < t.length) { g.__tier = next; e.target.src = t[next] }
  else { e.target.style.visibility = 'hidden' }
}

async function load() {
  cfg.value.apiKey = (cfg.value.apiKey || '').trim()
  cfg.value.steamId = (cfg.value.steamId || '').trim()
  store.setSteamConfig({ ...cfg.value })
  await ensureSteam(cfg.value, { force: true })
}
async function refresh() { await ensureSteam(cfg.value, { force: true }) }
async function clearAll() {
  await clearSteamCache()
  store.setSteamConfig({ ...cfg.value })
  store.showToast('已清空本地缓存')
}

onMounted(async () => { await ensureSteam(cfg.value) })
// 页面级状态保持（KeepAlive）：缓存未过期 → 零网络请求秒开；过期 → 后台静默刷新。
onActivated(async () => { await ensureSteam(cfg.value) })

const cacheHint = computed(() => {
  if (!at.value) return ''
  const ms = Date.now() - at.value
  if (ms < 60000) return '刚刚更新'
  const m = Math.floor(ms / 60000)
  if (m < 60) return m + ' 分钟前更新'
  return Math.floor(m / 60) + ' 小时前更新'
})
</script>

<template>
  <div class="page wide st-page st-xhh">
    <!-- 顶部个人档案卡（头像 + 等级 + 自定义网址 + 账号年龄） -->
    <div class="st-profile glass" :class="{ empty: !profile }">
      <div class="st-profile__top">
        <div class="st-profile__avatar">
          <img v-if="profile && profile.avatarFull" :src="profile.avatarFull" alt="头像" @error="e => e.target.style.visibility='hidden'" />
          <span v-else class="st-profile__avatar-ph"><Icon name="user" :size="30" /></span>
          <span v-if="level" class="st-profile__lvl" title="Steam 社区等级">{{ level }}</span>
        </div>
        <div class="st-profile__id">
          <div class="st-profile__name">{{ displayName }}</div>
          <a v-if="customUrl" class="st-profile__url" :href="profileUrl" target="_blank" rel="noopener">{{ customUrl }}</a>
          <div v-if="accountAge" class="st-profile__age">Steam 账号年龄：{{ accountAge }} 年</div>
          <div v-else class="st-profile__age muted">尚未获取账号年龄</div>
        </div>
        <button class="btn" @click="showBind = true"><Icon name="cloud" :size="16" /> {{ profile ? '编辑绑定' : '绑定 Steam' }}</button>
      </div>
    </div>

    <!-- 顶部统计条 -->
    <div class="st-top glass">
      <div class="st-top__stat"><span class="muted">游戏</span><b>{{ games.length }}</b></div>
      <div class="st-top__stat"><span class="muted">总时长</span><b>{{ fmtHours(totalTime) }}<i>h</i></b></div>
      <div class="st-top__stat"><span class="muted">近两周</span><b>{{ fmtHours(totalRecent) }}<i>h</i></b></div>
    </div>

    <div v-if="error" class="st-error glass">
      <Icon name="bolt" :size="16" />
      <span>{{ error }}</span>
      <button class="btn ghost" style="margin-left:auto;flex:none" @click="showBind = true">去配置</button>
    </div>

    <!-- 最近游玩：横向滑动卡片 -->
    <section v-if="recentGames.length" class="st-sec">
      <div class="st-sec__title"><Icon name="sparkles" :size="14" /> 最近游玩</div>
      <div class="st-recent">
        <article v-for="g in recentGames" :key="g.appid" class="st-rec" :class="{ open: detailOf(g.appid) && detailOf(g.appid).open }">
          <button class="st-rec__cover" @click="toggleDetail(g)">
            <img class="st-rec__img" :src="coverSrc(g)" :alt="g.name" loading="lazy" @error="onCoverError(g, $event)" />
            <span class="st-rec__veil"></span>
            <span class="st-rec__name">{{ g.name }}</span>
          </button>
          <div class="st-rec__meta">
            <span class="st-chip hot"><Icon name="clock" :size="11" /> 近 {{ fmtHours(g.recentHours) }} h</span>
            <span class="st-chip"><Icon name="clock" :size="11" /> 总 {{ fmtHours(g.playtimeHours) }} h</span>
          </div>
          <div v-if="detailOf(g.appid) && detailOf(g.appid).open" class="st-rec__detail">
            <div class="st-ach">
              <span class="st-ach__pct"><Icon name="trophy" :size="12" />
                <template v-if="achPct(g) >= 0">{{ detailOf(g.appid).unlocked }} / {{ detailOf(g.appid).total }}（{{ achPct(g) }}%）</template>
                <template v-else>成就未获取</template>
              </span>
              <span class="st-ach__track"><i :style="achPct(g) >= 0 ? { width: achPct(g) + '%' } : null"></i></span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 全部游戏：默认收起，展开后显示搜索/排序与网格卡片墙 -->
    <section v-if="games.length" class="st-library">
      <button class="st-lib-head glass" :aria-expanded="libOpen" @click="toggleLib">
        <span class="st-lib-title"><Icon name="album" :size="14" /> 游戏库 <em>{{ filteredGames.length }}</em></span>
        <span class="st-lib-hint muted">{{ libOpen ? '收起' : '展开全部游戏' }}</span>
        <Icon name="chevron" :size="16" :style="{ transform: libOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }" />
      </button>

      <template v-if="libOpen">
        <!-- 工具条：搜索 + 排序 + 刷新缓存 -->
        <div class="st-toolbar glass">
          <div class="st-search">
            <Icon name="search" :size="14" />
            <input v-model="query" placeholder="搜索游戏名" />
          </div>
          <div class="st-sorts">
            <button v-for="s in SORTS" :key="s.key" class="st-sort" :class="{ on: sortKey === s.key }" @click="sortKey = s.key">{{ s.label }}</button>
          </div>
          <button class="st-refresh" :disabled="loading || revalidating" @click="refresh" :title="cacheHint || '刷新缓存'">
            <Icon name="reset" :size="14" /> <span v-if="revalidating">更新中</span><span v-else-if="cacheHint">{{ cacheHint }}</span><span v-else>刷新</span>
          </button>
        </div>

        <div class="st-games">
      <article v-for="g in filteredGames" :key="g.appid" class="st-card glass" :class="{ open: detailOf(g.appid) && detailOf(g.appid).open }">
        <button class="st-card__cover" @click="toggleDetail(g)">
          <img class="st-card__img" :src="coverSrc(g)" :alt="g.name" loading="lazy" @error="onCoverError(g, $event)" />
          <span class="st-card__veil"></span>
          <span class="st-card__name">{{ g.name }}</span>
          <span class="st-card__stats">
            <span class="st-chip"><Icon name="clock" :size="12" /> 总 {{ fmtHours(g.playtimeHours) }} h</span>
            <span class="st-chip" :class="{ hot: g.recentHours > 0 }"><Icon name="sparkles" :size="12" /> 近两周 {{ fmtHours(g.recentHours) }} h</span>
          </span>
        </button>
        <div class="st-card__bar">
          <div class="st-card__row">
            <span class="st-card__title" :title="g.name">{{ g.name }}</span>
            <span class="st-card__last muted">{{ g.lastPlayedTime ? '上次 ' + fmtTime(g.lastPlayedTime) : '未运行' }}</span>
          </div>
          <div class="st-ach">
            <span class="st-ach__pct">
              <Icon name="trophy" :size="12" />
              <template v-if="achPct(g) >= 0">{{ detailOf(g.appid).unlocked }} / {{ detailOf(g.appid).total }}（{{ achPct(g) }}%）</template>
              <template v-else>成就未获取</template>
            </span>
            <span class="st-ach__track"><i v-if="achPct(g) >= 0" :style="{ width: achPct(g) + '%' }"></i></span>
          </div>
        </div>
        <div v-if="detailOf(g.appid) && detailOf(g.appid).open" class="st-detail">
          <div class="st-detail__grid">
            <div><span>总时长</span><b>{{ fmtHours(g.playtimeHours) }} 小时</b></div>
            <div><span>近两周</span><b>{{ fmtHours(g.recentHours) }} 小时</b></div>
            <div><span>上次运行</span><b>{{ g.lastPlayedTime ? fmtTime(g.lastPlayedTime) : '未运行' }}</b></div>
            <div><span>平台</span><b>Steam · PC</b></div>
          </div>
          <div class="st-detail__ach">
            <div class="row between" style="margin-bottom:6px">
              <span style="font-weight:700;font-size:12px">成就</span>
              <span v-if="detailOf(g.appid).fetched" class="muted" style="font-size:11px">{{ detailOf(g.appid).unlocked }} / {{ detailOf(g.appid).total }} 已解锁</span>
            </div>
            <div v-if="detailOf(g.appid).loading" class="muted" style="font-size:12px;padding:8px 0">正在拉取成就…</div>
            <div v-else-if="detailOf(g.appid).error" class="muted" style="font-size:12px;padding:8px 0">{{ detailOf(g.appid).error }}</div>
            <div v-else-if="!detailOf(g.appid).achievements.length" class="muted" style="font-size:12px;padding:8px 0">该游戏没有公开成就</div>
            <div v-else class="st-ach-list">
              <div v-for="a in detailOf(g.appid).achievements" :key="a.key" class="st-ach-item" :class="{ on: a.unlocked }">
                <span class="st-ach-item__ico"><Icon :name="a.unlocked ? 'trophy' : 'shield'" :size="13" /></span>
                <span class="st-ach-item__body"><b>{{ a.name || a.key }}</b><i v-if="a.desc">{{ a.desc }}</i></span>
              </div>
            </div>
          </div>
        </div>
      </article>
        </div>
      </template>
    </section>

    <EmptyState
      v-else-if="!loading"
      icon="gamepad"
      :title="at ? '这里还没有游戏' : '游戏库将展示在这里'"
      :subtitle="at ? '该账号暂无公开游戏库，或 Steam 资料设为私密。' : '点击右上角「绑定 Steam」，填入 API Key 与 Steam ID 即可同步你的游戏库。'"
    >
      <button class="btn" @click="showBind = true"><Icon name="cloud" :size="16" /> 绑定 Steam</button>
    </EmptyState>

    <!-- 绑定模态框（仅 API Key / Steam ID / 代理；无手动录入兜底） -->
    <Modal title="绑定 Steam" :show="showBind" @close="showBind = false">
      <div class="st-hint">
        <Icon name="shield" :size="14" />
        <span>应用已内置 Steam 代理，通常可直接拉取；如自建部署缺少代理，可填写自定义代理前缀。密钥仅存本机，不会上传任何服务器。</span>
      </div>
      <div class="st-form">
        <div class="st-field">
          <label class="st-label" for="st-key">Steam API Key</label>
          <input id="st-key" v-model="cfg.apiKey" type="password" placeholder="从 steamcommunity.com/dev/apikey 申请" autocomplete="off" />
          <div class="st-sub">密钥仅存本机，不会上传到任何服务器</div>
        </div>
        <div class="st-field">
          <label class="st-label" for="st-id">Steam ID（17 位数字）</label>
          <input id="st-id" v-model="cfg.steamId" inputmode="numeric" placeholder="如 7656119xxxxxxxxxx" autocomplete="off" />
          <div class="st-sub">可在 Steam 个人资料页的网址中找到</div>
        </div>
        <div class="st-field">
          <label class="st-label" for="st-proxy">CORS 代理前缀（可选）</label>
          <input id="st-proxy" v-model="cfg.proxy" placeholder="留空直连；跨域失败时填写" autocomplete="off" />
          <div class="st-sub">示例：https://corsproxy.io/?url=</div>
        </div>
      </div>
      <div class="st-bind-actions">
        <button class="btn ghost" @click="clearAll">清空本地缓存</button>
        <button class="btn" style="flex:1" :disabled="loading" @click="load">
          <Icon name="cloud" :size="16" /> {{ loading ? '拉取中…' : '拉取并保存' }}
        </button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.st-page { padding-bottom: 40px; }
.muted { color: var(--eo-ink-soft); }
.row.between { display: flex; justify-content: space-between; align-items: center; }

/* ---- 顶部个人档案卡 ---- */
.st-profile {
  padding: 16px 18px; border-radius: var(--eo-radius, 22px); margin-bottom: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.st-profile.empty { border-style: dashed; }
.st-profile__top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.st-profile__avatar { position: relative; width: 64px; height: 64px; flex: none; border-radius: 18px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.18) inset, 0 10px 22px -12px rgba(44, 44, 44, .18); background: var(--eo-chip); display: flex; align-items: center; justify-content: center; }
.st-profile__avatar img { width: 100%; height: 100%; object-fit: cover; }
.st-profile__avatar-ph { color: var(--eo-ink-soft); display: flex; }
.st-profile__lvl {
  position: absolute; right: -6px; bottom: -6px; min-width: 24px; height: 24px; padding: 0 6px;
  border-radius: 999px; background: var(--eo-primary);
  color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px -4px rgba(44, 44, 44, .18), 0 0 0 2px rgba(255,255,255,.85);
}
.st-profile__id { flex: 1; min-width: 0; }
.st-profile__name { font-size: 18px; font-weight: 800; color: var(--eo-ink); letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-profile__url { display: block; font-size: 12px; color: var(--eo-primary-deep); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-profile__url:hover { text-decoration: underline; }
.st-profile__age { font-size: 12px; margin-top: 2px; color: var(--eo-ink); font-weight: 700; }
.st-profile__age.muted { font-weight: 500; }

/* ---- 顶部统计条 ---- */
.st-top { display: flex; gap: 10px; padding: 12px 16px; border-radius: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.st-top__stat { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; flex: 1; min-width: 64px; }
.st-top__stat span { font-size: 11px; }
.st-top__stat b { font-size: 18px; font-weight: 800; color: var(--eo-primary-deep); }
.st-top__stat b i { font-size: 12px; font-style: normal; color: var(--eo-ink-soft); font-weight: 600; }

.st-error { margin-bottom: 14px; padding: 12px 14px; color: var(--eo-ink); display: flex; align-items: center; gap: 8px; font-size: 13px; border-radius: 16px; overflow-wrap: anywhere; word-break: break-word; line-height: 1.6; }
.st-error svg { flex: none; margin-top: 2px; color: var(--eo-ink); }

/* ---- 最近游玩横滑 ---- */
.st-sec { margin-bottom: 14px; }
.st-sec__title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: var(--eo-ink); margin: 0 2px 8px; }
.st-recent { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
.st-recent::-webkit-scrollbar { height: 6px; }
.st-recent::-webkit-scrollbar-thumb { background: var(--eo-glass-border); border-radius: 99px; }
.st-rec { flex: 0 0 200px; scroll-snap-align: start; border-radius: var(--eo-radius-sm); overflow: hidden; background: var(--eo-glass-strong); box-shadow: var(--eo-shadow-rest); transition: transform var(--eo-lift-dur) var(--eo-lift-ease), box-shadow var(--eo-lift-dur) var(--eo-lift-ease); }
.st-rec:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.st-rec.open { flex-basis: 280px; }
.st-rec__cover { position: relative; display: block; width: 100%; aspect-ratio: 16/9; overflow: hidden; border: none; padding: 0; cursor: pointer; text-align: left; background: var(--eo-chip); }
.st-rec__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scale(1.06); filter: saturate(115%); }
.st-rec__veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(32, 32, 31, .10) 0%, rgba(32, 32, 31, .34) 46%, rgba(32, 32, 31, .68) 100%), radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,.22), transparent 60%); backdrop-filter: blur(3px) saturate(140%); -webkit-backdrop-filter: blur(3px) saturate(140%); }
.st-rec__name { position: absolute; left: 10px; right: 10px; bottom: 10px; color: #fff; font-weight: 800; font-size: 13px; line-height: 1.3; text-shadow: 0 1px 6px rgba(44, 44, 44, .55); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.st-rec__meta { display: flex; gap: 6px; padding: 8px 10px; flex-wrap: wrap; }
.st-rec__detail { border-top: 1px solid var(--eo-glass-border); padding: 10px 12px; background: var(--eo-chip); }

/* ---- 工具条 ---- */
.st-library { margin-bottom: 14px; }
.st-lib-head {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 16px; cursor: pointer;
  border: 1px solid var(--eo-line); font: inherit; text-align: left;
  transition: transform .15s ease, box-shadow .15s ease;
}
.st-lib-head:hover { transform: translateY(-1px); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.st-lib-title { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 13px; color: var(--eo-ink); }
.st-lib-title em { font-style: normal; font-weight: 600; font-size: 11px; color: var(--eo-ink-soft); }
.st-lib-hint { margin-left: auto; font-size: 11px; }
.st-library .st-toolbar { margin-top: 12px; }

.st-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.st-search { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 140px; padding: 7px 12px; border-radius: 999px; background: var(--eo-glass-strong); border: 1px solid var(--eo-glass-border); color: var(--eo-ink-soft); }
.st-search input { flex: 1; min-width: 0; border: none; background: transparent; outline: none; font-size: 12.5px; color: var(--eo-ink); }
.st-sorts { display: flex; gap: 6px; }
.st-sort { padding: 7px 14px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: transparent; color: var(--eo-ink-soft); font-size: 12.5px; font-weight: 700; cursor: pointer; transition: transform var(--eo-lift-dur) var(--eo-lift-ease), box-shadow var(--eo-lift-dur) var(--eo-lift-ease); }
.st-sort:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.st-sort.on { background: var(--eo-primary); color: #fff; border-color: transparent; }
.st-refresh { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: var(--eo-chip); color: var(--eo-primary-deep); font-size: 12px; font-weight: 700; cursor: pointer; flex: none; transition: transform var(--eo-lift-dur) var(--eo-lift-ease), box-shadow var(--eo-lift-dur) var(--eo-lift-ease); }
.st-refresh:hover:not(:disabled) { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.st-refresh:disabled { opacity: .6; cursor: default; }

.st-hint { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.75; color: var(--eo-ink-soft); padding: 11px 14px; margin-bottom: 16px; border-radius: 12px; background: var(--eo-chip); overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
.st-hint svg { flex: none; margin-top: 3px; }
.st-form { display: flex; flex-direction: column; gap: 15px; }
.st-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.st-label { font-size: 13px; font-weight: 700; color: var(--eo-ink); line-height: 1.5; }
.st-field input { width: 100%; min-width: 0; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--eo-glass-border); background: var(--eo-glass-strong); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%); box-shadow: inset 0 1px 0 var(--eo-glass-hi), 0 0 0 1px rgba(255,255,255,0.04); transition: border-color .2s ease, box-shadow .2s ease; font-family: inherit; color: var(--eo-ink); }
.st-field input:focus { outline: none; border-color: var(--eo-primary); box-shadow: inset 0 1px 0 var(--eo-glass-hi), 0 0 0 3px rgba(44, 44, 44, 0.22); }
.st-sub { font-size: 11.5px; color: var(--eo-ink-soft); line-height: 1.65; overflow-wrap: anywhere; word-break: break-word; }
.st-bind-actions { display: flex; gap: 10px; margin-top: 16px; }

/* ---- 小黑盒风格游戏卡 ---- */
.st-games { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.st-card { padding: 0; overflow: hidden; border-radius: var(--eo-radius-sm); display: flex; flex-direction: column; box-shadow: var(--eo-shadow-rest); transition: transform var(--eo-lift-dur) var(--eo-lift-ease), box-shadow var(--eo-lift-dur) var(--eo-lift-ease); }
.st-card:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.st-card.open { grid-column: 1 / -1; }
.st-card__cover { position: relative; display: block; width: 100%; aspect-ratio: 16/9; overflow: hidden; border: none; padding: 0; cursor: pointer; text-align: left; background: var(--eo-chip); }
.st-card__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scale(1.06); filter: saturate(115%); }
.st-card__veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(32, 32, 31, .10) 0%, rgba(32, 32, 31, .34) 46%, rgba(32, 32, 31, .68) 100%), radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,.22), transparent 60%); backdrop-filter: blur(3px) saturate(140%); -webkit-backdrop-filter: blur(3px) saturate(140%); }
.st-card__name { position: absolute; left: 12px; right: 12px; bottom: 42px; color: #fff; font-weight: 800; font-size: 14px; line-height: 1.35; text-shadow: 0 1px 6px rgba(44, 44, 44, .55); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.st-card__stats { position: absolute; left: 12px; right: 12px; bottom: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
.st-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.st-chip.hot { background: rgba(44, 44, 44, .26); border-color: rgba(44, 44, 44, .42); }
.st-card__bar { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px 11px; min-width: 0; }
.st-card__row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.st-card__title { font-weight: 700; font-size: 13px; color: var(--eo-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-card__last { font-size: 11px; white-space: nowrap; flex: none; }

.st-ach { display: flex; flex-direction: column; gap: 5px; }
.st-ach__pct { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: var(--eo-primary-deep); }
.st-ach__track { display: block; width: 100%; height: 4px; border-radius: 99px; background: var(--eo-glass-border); overflow: hidden; }
.st-ach__track i { display: block; height: 100%; border-radius: 99px; background: var(--eo-primary); transition: width .4s ease; }

.st-detail { border-top: 1px solid var(--eo-glass-border); padding: 12px 14px 14px; background: var(--eo-chip); }
.st-detail__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.st-detail__grid > div { display: flex; flex-direction: column; gap: 2px; }
.st-detail__grid span { font-size: 11px; color: var(--eo-ink-soft); }
.st-detail__grid b { font-size: 13px; color: var(--eo-ink); font-weight: 700; }
@media (max-width: 640px) { .st-detail__grid { grid-template-columns: repeat(2, 1fr); } }
.st-detail__ach { margin-top: 12px; }
.st-ach-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; }
.st-ach-item { display: flex; gap: 8px; align-items: flex-start; padding: 7px 8px; border-radius: 10px; opacity: .55; }
.st-ach-item.on { opacity: 1; background: rgba(44, 44, 44, .12); }
.st-ach-item__ico { width: 22px; height: 22px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex: none; background: var(--eo-glass-strong); color: var(--eo-ink-soft); }
.st-ach-item.on .st-ach-item__ico { background: var(--eo-primary); color: #fff; }
.st-ach-item__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.st-ach-item__body b { font-size: 12px; color: var(--eo-ink); font-weight: 700; }
.st-ach-item__body i { font-size: 11px; font-style: normal; color: var(--eo-ink-soft); line-height: 1.5; }
/* v3.0.2 小黑盒风格：深紫底 + 三列封面网格；隐藏所有依赖真实在线数据的区块 */
.st-page.st-xhh { background: #2B1B3D; color: #F2E9F7; border-radius: 18px; }
.st-page.st-xhh .glass { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.14); }
.st-page.st-xhh .muted, .st-page.st-xhh .st-profile__age { color: #C9B8D8; }
.st-page.st-xhh .st-profile__name, .st-page.st-xhh .st-top__stat b,
.st-page.st-xhh .st-sec__title, .st-page.st-xhh .st-card__title { color: #F7F0FB; }
.st-page.st-xhh .st-top__stat { border-color: rgba(255,255,255,.12); }
.st-page.st-xhh .st-error, .st-page.st-xhh .st-hint,
.st-page.st-xhh .st-rec__detail, .st-page.st-xhh .st-detail,
.st-page.st-xhh .st-ach, .st-page.st-xhh .st-refresh { display: none !important; }
.st-page.st-xhh .st-recent { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; overflow: visible; }
.st-page.st-xhh .st-rec__cover, .st-page.st-xhh .st-card__cover { aspect-ratio: 3 / 4; }
.st-page.st-xhh .st-chip { background: rgba(255,255,255,.14); color: #F7F0FB; }
.st-page.st-xhh .btn { color: #F7F0FB; border-color: rgba(255,255,255,.22); }
@media (max-width: 520px) {
  .st-page.st-xhh .st-recent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
