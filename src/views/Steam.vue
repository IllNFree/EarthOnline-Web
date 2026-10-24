<script setup>
// Steam 游戏库（独立页）：左=配置表单（优雅 Grid，自适应换行），右=游戏库展示区。仅云端，失败如实报错。
import { ref, computed } from 'vue'
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
const pulled = ref(false)

async function load() {
  loading.value = true; error.value = ''
  store.setSteamConfig({ ...cfg.value })
  const r = await fetchSteamGames(cfg.value)
  loading.value = false
  pulled.value = true
  if (r.ok) {
    games.value = r.games; count.value = r.count
    if (!r.count) error.value = '该账号暂无公开游戏库，或 Steam 资料设为私密。'
    else store.showToast('已拉取 ' + r.count + ' 款游戏')
  } else {
    error.value = r.error
  }
}
const fmtHours = (h) => Number(h).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const totalTime = computed(() => games.value.reduce((s, g) => s + (g.playtimeHours || 0), 0))
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
          <span>Web 端仅支持云端数据。Steam Web API 默认不开放浏览器跨域(CORS)，如拉取失败请填写可信的 CORS 代理前缀。</span>
        </div>
        <!-- Grid 表单：左列标签固定宽度，右列输入框自适应；窄屏自动上下堆叠 -->
        <div class="st-form">
          <label class="st-label" for="st-key">API Key</label>
          <div class="st-ctrl">
            <input id="st-key" v-model="cfg.apiKey" type="password" placeholder="从 steamcommunity.com/dev/apikey 申请" autocomplete="off" />
            <div class="st-sub">密钥仅存本机，不会上传到任何服务器</div>
          </div>

          <label class="st-label" for="st-id">Steam ID</label>
          <div class="st-ctrl">
            <input id="st-id" v-model="cfg.steamId" inputmode="numeric" placeholder="17 位数字，如 7656119xxxxxxxxxx" autocomplete="off" />
            <div class="st-sub">可在个人资料页 URL 中找到</div>
          </div>

          <label class="st-label" for="st-proxy">CORS 代理</label>
          <div class="st-ctrl">
            <input id="st-proxy" v-model="cfg.proxy" placeholder="留空直连；跨域失败时填写" autocomplete="off" />
            <div class="st-sub">可选。示例：https://corsproxy.io/?url=</div>
          </div>
        </div>
        <button class="btn" style="width:100%;margin-top:14px" :disabled="loading" @click="load">
          <Icon name="cloud" :size="16" /> {{ loading ? '拉取中…' : '拉取游戏库' }}
        </button>
      </GlassCard>

      <!-- 右：游戏数据展示区 -->
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
          <div v-for="g in games" :key="g.appid" class="st-game">
            <img v-if="g.logoUrl" :src="g.logoUrl" alt="" class="st-logo" loading="lazy" />
            <span v-else class="avatar"><Icon name="cloud" :size="20" /></span>
            <div class="st-meta">
              <div class="st-name" :title="g.name">{{ g.name }}</div>
              <div class="st-hours">{{ fmtHours(g.playtimeHours) }} 小时</div>
            </div>
          </div>
        </div>

        <div v-else-if="!loading && !error" class="st-empty">
          <div style="font-size:34px">🎮</div>
          <div style="font-weight:700;margin-top:8px">{{ pulled ? '这个账号还没有公开游戏' : '游戏库将展示在这里' }}</div>
          <div class="muted" style="font-size:13px;margin-top:4px;line-height:1.7">{{ pulled ? '检查 Steam 资料隐私设置后重试' : '在左侧填入 API Key 与 Steam ID，点击「拉取游戏库」即可同步你的游戏数据。' }}</div>
        </div>
      </GlassCard>
    </div>
  </div>
</template>

<style scoped>
/* 双栏：左配置右展示；窄屏自动上下堆叠 */
.st-layout { display: grid; grid-template-columns: 400px 1fr; gap: 14px; align-items: start; margin-top: 6px; }
@media (max-width: 900px) { .st-layout { grid-template-columns: 1fr; } }

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
  padding-top: 10px; white-space: nowrap; min-width: 82px;
}
.st-ctrl { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.st-ctrl input { width: 100%; min-width: 0; }
.st-sub { font-size: 11px; color: var(--eo-ink-soft); line-height: 1.5; overflow-wrap: anywhere; }
@media (max-width: 560px) {
  .st-form { grid-template-columns: 1fr; gap: 4px; }
  .st-label { padding-top: 8px; white-space: normal; }
}

.st-right { min-height: 320px; }
.st-error {
  margin-bottom: 12px; padding: 12px 14px; color: var(--eo-bad);
  display: flex; align-items: flex-start; gap: 8px; font-size: 13px;
  background: var(--eo-chip); border-radius: 12px;
  overflow-wrap: anywhere; word-break: break-word; line-height: 1.6;
}
.st-error svg { flex: none; margin-top: 2px; }

.st-games { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.st-game {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 10px; border-radius: 14px; background: var(--eo-chip);
  transition: transform .2s cubic-bezier(.22,1,.36,1);
}
.st-game:hover { transform: translateY(-2px); }
.st-logo { width: 46px; height: 46px; border-radius: 10px; object-fit: cover; background: var(--eo-glass-strong); flex: none; }
.st-meta { flex: 1; min-width: 0; }
.st-name {
  font-weight: 600; font-size: 13px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere; word-break: break-word;
}
.st-hours { font-size: 12px; color: var(--eo-ink-soft); margin-top: 2px; }

.st-empty { text-align: center; padding: 46px 20px; display: flex; flex-direction: column; align-items: center; }
</style>
