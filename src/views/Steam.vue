<script setup>
// Steam 游戏库（独立页）：配置 API Key/ID → 拉取游戏库 → 卡片展示。仅云端，失败如实报错。
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
</script>

<template>
  <div class="page wide">
    <GlassCard padding="16" glow style="margin-top:6px">
      <div class="muted hint">Web 端仅支持云端数据。Steam Web API 默认不开放浏览器跨域(CORS)，如拉取失败请填写可信的 CORS 代理前缀（如 https://corsproxy.io/?url=）。</div>
      <div class="field"><label>Steam API Key</label><input v-model="cfg.apiKey" type="password" placeholder="从 steamcommunity.com/dev/apikey 申请" /></div>
      <div class="field"><label>Steam ID（17 位数字）</label><input v-model="cfg.steamId" placeholder="如：7656119xxxxxxxxxx" /></div>
      <div class="field"><label>CORS 代理前缀（可选）</label><input v-model="cfg.proxy" placeholder="留空直连；跨域失败时填写代理" /></div>
      <button class="btn" style="width:100%" :disabled="loading" @click="load">
        <Icon name="cloud" :size="16" /> {{ loading ? '拉取中…' : '拉取游戏库' }}
      </button>
    </GlassCard>

    <div v-if="error" class="glass card" style="margin-top:14px;padding:14px;color:var(--eo-bad);word-break:break-word">{{ error }}</div>

    <div v-if="games.length" class="muted" style="margin:14px 4px 8px;font-size:13px">共 {{ count }} 款 · 按游玩时长排序</div>
    <div v-if="games.length" class="grid2">
      <GlassCard v-for="g in games" :key="g.appid" padding="10" hover>
        <div class="row" style="gap:10px;align-items:center">
          <img v-if="g.logoUrl" :src="g.logoUrl" alt="" style="width:46px;height:46px;border-radius:10px;object-fit:cover;background:var(--eo-chip)" loading="lazy" />
          <span v-else class="avatar"><Icon name="cloud" :size="20" /></span>
          <div style="flex:1;min-width:0">
            <div class="gname">{{ g.name }}</div>
            <div class="muted" style="font-size:12px">{{ g.playtimeHours }} 小时</div>
          </div>
        </div>
      </GlassCard>
    </div>
    <div v-if="!loading && !error && !games.length" class="muted" style="text-align:center;padding:30px">配置并拉取后，这里会展示你的 Steam 游戏库。</div>
  </div>
</template>

<style scoped>
.hint { font-size: 12px; margin-bottom: 10px; word-break: break-word; overflow-wrap: anywhere; line-height: 1.6; }
.gname { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
