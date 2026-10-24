<script setup>
// Steam 游戏库（独立页）：配置 API Key/ID → 拉取游戏库 → 卡片展示。仅云端，失败如实报错。
// 布局：标准 CSS Grid（左标签右输入自适应），所有长文本强制换行，绝不溢出
import { ref } from 'vue'
import { useAppStore } from '../stores/app.js'
import { fetchSteamGames } from '../lib/steam.js'
import Icon from '../components/Icon.vue'
import GlassCard from '../components/GlassCard.vue'

const store = useAppStore()
const cfg = ref({ ...store.data.steam })
const games = ref([])
const loading = ref(false)
const error = ref('')
const count = ref(0)

async function load() {
  loading.value = true; error.value = ''
  store.setSteamConfig({ ...cfg.value })
  const r = await fetchSteamGames(cfg.value)
  loading.value = false
  if (r.ok) {
    games.value = r.games; count.value = r.count
    if (!r.count) error.value = '该账号暂无公开游戏库，或 Steam 资料设为私密。'
    else store.showToast('已拉取 ' + r.count + ' 款游戏')
  } else {
    error.value = r.error
  }
}
const fmtHours = (h) => Number(h).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
</script>

<template>
  <div class="page wide">
    <GlassCard padding="16" glow style="margin-top:6px">
      <div class="st-hint">
        <Icon name="cloud" :size="14" />
        <span>Web 端仅支持云端数据。Steam Web API 默认不开放浏览器跨域(CORS)，如拉取失败请填写可信的 CORS 代理前缀（如 https://corsproxy.io/?url=）。</span>
      </div>
      <!-- Grid 表单：左列标签固定宽度，右列输入框自适应；窄屏自动上下堆叠 -->
      <div class="st-form">
        <label class="st-label" for="st-key">Steam API Key</label>
        <div class="st-ctrl">
          <input id="st-key" v-model="cfg.apiKey" type="password" placeholder="从 steamcommunity.com/dev/apikey 申请" autocomplete="off" />
          <div class="st-sub">密钥仅存本机，不会上传到任何服务器</div>
        </div>

        <label class="st-label" for="st-id">Steam ID</label>
        <div class="st-ctrl">
          <input id="st-id" v-model="cfg.steamId" inputmode="numeric" placeholder="17 位数字，如 7656119xxxxxxxxxx" autocomplete="off" />
          <div class="st-sub">可在个人资料页 URL 中找到</div>
        </div>

        <label class="st-label" for="st-proxy">CORS 代理前缀</label>
        <div class="st-ctrl">
          <input id="st-proxy" v-model="cfg.proxy" placeholder="留空直连；跨域失败时填写" autocomplete="off" />
          <div class="st-sub">可选。示例：https://corsproxy.io/?url=</div>
        </div>
      </div>
      <button class="btn" style="width:100%;margin-top:14px" :disabled="loading" @click="load">
        <Icon name="cloud" :size="16" /> {{ loading ? '拉取中…' : '拉取游戏库' }}
      </button>
    </GlassCard>

    <div v-if="error" class="glass card st-error">
      <Icon name="bolt" :size="16" />
      <span>{{ error }}</span>
    </div>

    <div v-if="games.length" class="muted st-count">共 {{ count }} 款 · 按游玩时长排序</div>
    <div v-if="games.length" class="grid2">
      <GlassCard v-for="g in games" :key="g.appid" padding="10" hover>
        <div class="st-game">
          <img v-if="g.logoUrl" :src="g.logoUrl" alt="" class="st-logo" loading="lazy" />
          <span v-else class="avatar"><Icon name="cloud" :size="20" /></span>
          <div class="st-meta">
            <div class="st-name" :title="g.name">{{ g.name }}</div>
            <div class="st-hours">{{ fmtHours(g.playtimeHours) }} 小时</div>
          </div>
        </div>
      </GlassCard>
    </div>
    <div v-if="!loading && !error && !games.length" class="muted st-empty">配置并拉取后，这里会展示你的 Steam 游戏库。</div>
  </div>
</template>

<style scoped>
.st-hint {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; line-height: 1.7; color: var(--eo-ink-soft);
  padding: 10px 12px; margin-bottom: 12px;
  border-radius: 12px; background: var(--eo-chip);
  overflow-wrap: anywhere; word-break: break-word; white-space: normal;
}
.st-hint svg { flex: none; margin-top: 3px; }

.st-form { display: grid; grid-template-columns: auto 1fr; gap: 12px 14px; align-items: start; }
.st-label {
  font-size: 13px; font-weight: 600; color: var(--eo-ink);
  padding-top: 10px; white-space: nowrap; min-width: 96px;
}
.st-ctrl { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.st-ctrl input { width: 100%; min-width: 0; }
.st-sub { font-size: 11px; color: var(--eo-ink-soft); line-height: 1.5; overflow-wrap: anywhere; }
@media (max-width: 560px) {
  .st-form { grid-template-columns: 1fr; gap: 4px; }
  .st-label { padding-top: 8px; white-space: normal; }
}

.st-error {
  margin-top: 14px; padding: 12px 14px; color: var(--eo-bad);
  display: flex; align-items: flex-start; gap: 8px; font-size: 13px;
  overflow-wrap: anywhere; word-break: break-word; line-height: 1.6;
}
.st-error svg { flex: none; margin-top: 2px; }
.st-count { margin: 14px 4px 8px; font-size: 13px; }

.st-game { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; }
.st-logo { width: 46px; height: 46px; border-radius: 10px; object-fit: cover; background: var(--eo-chip); flex: none; }
.st-meta { flex: 1; min-width: 0; }
.st-name {
  font-weight: 600; font-size: 13px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere; word-break: break-word;
}
.st-hours { font-size: 12px; color: var(--eo-ink-soft); margin-top: 2px; }

.st-empty { text-align: center; padding: 30px; }
</style>
