<script setup>
// ===== Steam 游戏库（模块三 · 小黑盒风格重构） =====
// 展示要素：封面图（Haze 毛玻璃背景）、游戏名称、总时长、近期两周时长、已解锁成就 / 总成就数。
// 交互：点击卡片展开详情（成就列表、上次运行时间、平台信息等）。
// 数据：GetOwnedGames（总时长/封面）+ GetRecentPlayedGames（近两周时长/上次运行）+ 按需 GetPlayerAchievements（成就）。
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { fetchSteamGames, fetchRecentPlaytime, fetchGameAchievements } from '../lib/steam.js'
import Icon from '../components/Icon.vue'
import GlassCard from '../components/GlassCard.vue'

const store = useAppStore()
const cfg = ref({ ...store.data.steam })
const games = ref([])
const loading = ref(false)
const error = ref('')
const count = ref(0)
const pulled = ref(false)

// 展开详情：appid → { open, loading, error, achievements, unlocked, total, fetched }
const details = ref({})

async function load() {
  loading.value = true; error.value = ''
  store.setSteamConfig({ ...cfg.value })
  const r = await fetchSteamGames(cfg.value)
  if (!r.ok) {
    loading.value = false
    pulled.value = true
    error.value = r.error
    return
  }
  // 近两周数据：失败不阻断主流程，仅保持 0 值（如实降级展示）
  let recent = {}
  try {
    const rr = await fetchRecentPlaytime(cfg.value)
    if (rr.ok) recent = rr.recent || {}
  } catch (e) { recent = {} }
  games.value = (r.games || []).map((g) => {
    const rec = recent[g.appid] || {}
    return {
      ...g,
      recentHours: rec.recentHours || 0,
      lastPlayedTime: rec.lastPlayedTime || 0
    }
  })
  count.value = r.count
  loading.value = false
  pulled.value = true
  details.value = {}
  if (!count.value) error.value = '该账号暂无公开游戏库，或 Steam 资料设为私密。'
  else store.showToast('已拉取 ' + count.value + ' 款游戏')
}

const fmtHours = (h) => Number(h || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const totalTime = computed(() => games.value.reduce((s, g) => s + (g.playtimeHours || 0), 0))
const totalRecent = computed(() => games.value.reduce((s, g) => s + (g.recentHours || 0), 0))
const totalAch = computed(() => {
  let u = 0, t = 0
  Object.values(details.value).forEach((d) => { u += d.unlocked || 0; t += d.total || 0 })
  return { unlocked: u, total: t }
})

function fmtTime(ts) {
  if (!ts) return '暂无记录'
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return '暂无记录'
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function detailOf(appid) { return details.value[appid] || null }

// 展开 / 收起详情；首次展开时按需拉取该游戏成就
async function toggleDetail(g) {
  const cur = details.value[g.appid]
  if (cur && cur.open) {
    cur.open = false
    details.value = { ...details.value }
    return
  }
  const entry = cur || { open: true, loading: false, error: '', achievements: [], unlocked: 0, total: 0, fetched: false }
  entry.open = true
  details.value = { ...details.value, [g.appid]: entry }
  if (entry.fetched || entry.loading) return
  entry.loading = true
  const r = await fetchGameAchievements(cfg.value, g.appid)
  entry.loading = false
  if (r.ok) {
    entry.achievements = r.achievements || []
    entry.unlocked = r.unlocked || 0
    entry.total = r.total || 0
    entry.error = ''
  } else {
    entry.error = r.error || '成就数据拉取失败'
  }
  entry.fetched = true
  details.value = { ...details.value }
}
</script>

<template>
  <div class="page wide">
    <div class="st-layout">
      <!-- 左：配置表单 -->
      <GlassCard padding="16" glow class="st-left">
        <div class="row" style="gap:8px;margin-bottom:10px">
          <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="cloud" :size="18" /></span>
          <div style="font-weight:800">Steam 绑定</div>
        </div>
        <div class="st-hint">
          <Icon name="shield" :size="14" />
          <span>Web 端仅支持云端数据。应用已内置 Steam 代理，通常可直接拉取；如自建部署缺少代理，可在下方填写自定义代理前缀。</span>
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
        <button class="btn" style="width:100%;margin-top:14px" :disabled="loading" @click="load">
          <Icon name="cloud" :size="16" /> {{ loading ? '拉取中…' : '拉取游戏库' }}
        </button>

        <!-- 汇总条 -->
        <div v-if="games.length" class="st-sum">
          <div class="st-sum__row"><span>游戏数</span><b>{{ count }} 款</b></div>
          <div class="st-sum__row"><span>总时长</span><b>{{ fmtHours(totalTime) }} 小时</b></div>
          <div class="st-sum__row"><span>近两周时长</span><b>{{ fmtHours(totalRecent) }} 小时</b></div>
          <div class="st-sum__row"><span>已解锁成就</span><b>{{ totalAch.unlocked }} / {{ totalAch.total }}</b></div>
        </div>
      </GlassCard>

      <!-- 右：游戏库（小黑盒风格卡片） -->
      <GlassCard padding="16" class="st-right">
        <div class="row between" style="margin-bottom:10px">
          <div class="row" style="gap:8px">
            <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="trophy" :size="18" /></span>
            <div style="font-weight:800">我的游戏库</div>
          </div>
          <span v-if="games.length" class="muted" style="font-size:12px">共 {{ count }} 款 · 总时长 {{ fmtHours(totalTime) }} 小时</span>
        </div>

        <div v-if="error" class="st-error">
          <Icon name="bolt" :size="16" />
          <span>{{ error }}</span>
        </div>

        <div v-if="games.length" class="st-games">
          <article v-for="g in games" :key="g.appid" class="st-card glass" :class="{ open: detailOf(g.appid) && detailOf(g.appid).open }">
            <!-- 封面 + 毛玻璃信息层 -->
            <button class="st-card__cover" @click="toggleDetail(g)">
              <span class="st-card__bg" :style="g.coverUrl ? { backgroundImage: 'url(' + g.coverUrl + ')' } : {}"></span>
              <span class="st-card__veil"></span>
              <span class="st-card__title">{{ g.name }}</span>
              <span class="st-card__stats">
                <span class="st-chip"><Icon name="clock" :size="12" /> {{ fmtHours(g.playtimeHours) }} h</span>
                <span class="st-chip" :class="{ hot: g.recentHours > 0 }"><Icon name="sparkles" :size="12" /> 近两周 {{ fmtHours(g.recentHours) }} h</span>
              </span>
            </button>

            <!-- 卡片底部信息条 -->
            <div class="st-card__bar">
              <div class="st-card__name" :title="g.name">{{ g.name }}</div>
              <div class="st-card__ach" v-if="detailOf(g.appid) && detailOf(g.appid).fetched">
                <Icon name="trophy" :size="12" />
                {{ detailOf(g.appid).unlocked }} / {{ detailOf(g.appid).total }}
              </div>
              <div class="st-card__ach muted" v-else>
                <Icon name="trophy" :size="12" /> 点击查看成就
              </div>
            </div>

            <!-- 展开详情 -->
            <div v-if="detailOf(g.appid) && detailOf(g.appid).open" class="st-detail">
              <div class="st-detail__grid">
                <div><span>总时长</span><b>{{ fmtHours(g.playtimeHours) }} 小时</b></div>
                <div><span>近两周</span><b>{{ fmtHours(g.recentHours) }} 小时</b></div>
                <div><span>上次运行</span><b>{{ fmtTime(g.lastPlayedTime) }}</b></div>
                <div><span>平台</span><b>Steam · PC</b></div>
              </div>

              <div class="st-detail__ach">
                <div class="row between" style="margin-bottom:6px">
                  <span style="font-weight:700;font-size:12px">成就</span>
                  <span v-if="detailOf(g.appid).fetched" class="muted" style="font-size:11px">
                    {{ detailOf(g.appid).unlocked }} / {{ detailOf(g.appid).total }} 已解锁
                  </span>
                </div>
                <div v-if="detailOf(g.appid).loading" class="muted" style="font-size:12px;padding:8px 0">正在拉取成就…</div>
                <div v-else-if="detailOf(g.appid).error" class="muted" style="font-size:12px;padding:8px 0">{{ detailOf(g.appid).error }}</div>
                <div v-else-if="!detailOf(g.appid).achievements.length" class="muted" style="font-size:12px;padding:8px 0">该游戏没有公开成就</div>
                <div v-else class="st-ach-list">
                  <div v-for="a in detailOf(g.appid).achievements" :key="a.key" class="st-ach" :class="{ on: a.unlocked }">
                    <span class="st-ach__ico">
                      <Icon :name="a.unlocked ? 'trophy' : 'shield'" :size="13" />
                    </span>
                    <span class="st-ach__body">
                      <b>{{ a.name || a.key }}</b>
                      <i v-if="a.desc">{{ a.desc }}</i>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div v-else-if="!loading && !error" class="st-empty">
          <span class="empty-illu"><Icon name="gamepad" :size="32" /></span>
          <div class="es-title">{{ pulled ? '这个账号还没有公开游戏' : '游戏库将展示在这里' }}</div>
          <div class="es-sub">{{ pulled ? '检查 Steam 资料隐私设置后重试' : '在左侧填入 API Key 与 Steam ID，点击「拉取游戏库」即可同步你的游戏数据。' }}</div>
        </div>
      </GlassCard>
    </div>
  </div>
</template>

<style scoped>
/* 双栏：左配置右展示；窄屏自动上下堆叠 */
.st-layout { display: grid; grid-template-columns: 460px 1fr; gap: 14px; align-items: start; margin-top: 6px; }
@media (max-width: 1020px) { .st-layout { grid-template-columns: 1fr; } }

.st-hint {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; line-height: 1.75; color: var(--eo-ink-soft);
  padding: 11px 14px; margin-bottom: 16px;
  border-radius: 12px; background: var(--eo-chip);
  overflow-wrap: anywhere; word-break: break-word; white-space: normal;
}
.st-hint svg { flex: none; margin-top: 3px; }

.st-form { display: flex; flex-direction: column; gap: 15px; }
.st-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.st-label { font-size: 13px; font-weight: 700; color: var(--eo-ink); line-height: 1.5; }
.st-field input {
  width: 100%; min-width: 0; padding: 11px 14px;
  border-radius: 12px;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-glass-strong);
  backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%);
  box-shadow: inset 0 1px 0 var(--eo-glass-hi), 0 0 0 1px rgba(255, 255, 255, 0.04);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.st-field input:focus {
  outline: none; border-color: var(--eo-primary);
  box-shadow: inset 0 1px 0 var(--eo-glass-hi), 0 0 0 3px rgba(212, 163, 115, 0.22);
}
.st-sub { font-size: 11.5px; color: var(--eo-ink-soft); line-height: 1.65; overflow-wrap: anywhere; word-break: break-word; }

.st-sum { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--eo-glass-border); }
.st-sum__row { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--eo-ink-soft); padding: 4px 0; }
.st-sum__row b { font-size: 14px; color: var(--eo-ink); font-weight: 800; }

.st-right { min-height: 320px; }
.st-error {
  margin-bottom: 12px; padding: 12px 14px; color: var(--eo-bad);
  display: flex; align-items: flex-start; gap: 8px; font-size: 13px;
  background: var(--eo-chip); border-radius: 12px;
  overflow-wrap: anywhere; word-break: break-word; line-height: 1.6;
}
.st-error svg { flex: none; margin-top: 2px; }

/* ---- 小黑盒风格游戏卡：封面毛玻璃 + 信息浮层 ---- */
.st-games { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.st-card {
  padding: 0; overflow: hidden; border-radius: var(--eo-radius-sm);
  display: flex; flex-direction: column;
  transition: transform .22s cubic-bezier(.22,1,.36,1), box-shadow .22s ease;
}
.st-card:hover { transform: translateY(-3px); }
.st-card.open { grid-column: 1 / -1; }

.st-card__cover {
  position: relative; display: block; width: 100%;
  aspect-ratio: 16 / 9; overflow: hidden;
  border: none; padding: 0; cursor: pointer; text-align: left;
}
.st-card__bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
  transform: scale(1.06); filter: blur(1px) saturate(115%);
  transition: transform .4s cubic-bezier(.22,1,.36,1);
}
.st-card:hover .st-card__bg { transform: scale(1.12); }
/* 毛玻璃覆层：封面图上的液态玻璃渐变（Haze 满血，不降级为纯色） */
.st-card__veil {
  position: absolute; inset: 0;
  background:
    linear-gradient(180deg, rgba(20,16,12,.10) 0%, rgba(20,16,12,.34) 46%, rgba(20,16,12,.68) 100%),
    radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,.22), transparent 60%);
  backdrop-filter: blur(3px) saturate(140%);
  -webkit-backdrop-filter: blur(3px) saturate(140%);
}
.st-card__title {
  position: absolute; left: 12px; right: 12px; bottom: 42px;
  color: #fff; font-weight: 800; font-size: 14px; line-height: 1.35;
  text-shadow: 0 1px 6px rgba(0,0,0,.55);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.st-card__stats { position: absolute; left: 12px; right: 12px; bottom: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
.st-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #fff;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.st-chip.hot { background: rgba(212,163,115,.34); border-color: rgba(255,214,168,.42); }

.st-card__bar {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; min-width: 0;
}
.st-card__name {
  flex: 1; min-width: 0; font-weight: 700; font-size: 13px; color: var(--eo-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.st-card__ach { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--eo-primary-deep); font-weight: 700; flex: none; }
.st-card__ach.muted { color: var(--eo-ink-faint); font-weight: 600; }

/* ---- 展开详情 ---- */
.st-detail {
  border-top: 1px solid var(--eo-glass-border);
  padding: 12px 14px 14px;
  background: var(--eo-chip);
}
.st-detail__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.st-detail__grid > div { display: flex; flex-direction: column; gap: 2px; }
.st-detail__grid span { font-size: 11px; color: var(--eo-ink-soft); }
.st-detail__grid b { font-size: 13px; color: var(--eo-ink); font-weight: 700; }
@media (max-width: 640px) { .st-detail__grid { grid-template-columns: repeat(2, 1fr); } }

.st-detail__ach { margin-top: 12px; }
.st-ach-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; }
.st-ach { display: flex; gap: 8px; align-items: flex-start; padding: 7px 8px; border-radius: 10px; opacity: .55; }
.st-ach.on { opacity: 1; background: rgba(212,163,115,.12); }
.st-ach__ico { width: 22px; height: 22px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex: none; background: var(--eo-glass-strong); color: var(--eo-ink-soft); }
.st-ach.on .st-ach__ico { background: var(--eo-primary); color: #fff; }
.st-ach__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.st-ach__body b { font-size: 12px; color: var(--eo-ink); font-weight: 700; }
.st-ach__body i { font-size: 11px; font-style: normal; color: var(--eo-ink-soft); line-height: 1.5; }

.st-empty { text-align: center; padding: 46px 20px; display: flex; flex-direction: column; align-items: center; }
</style>
