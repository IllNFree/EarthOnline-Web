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
        <!-- 纵向 Flex 表单：标签在上、输入框独占整行，长文本永远完整换行 -->
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
.st-layout { display: grid; grid-template-columns: 520px 1fr; gap: 14px; align-items: start; margin-top: 6px; }
@media (max-width: 1020px) { .st-layout { grid-template-columns: 1fr; } }

.st-hint {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; line-height: 1.75; color: var(--eo-ink-soft);
  padding: 11px 14px; margin-bottom: 16px;
  border-radius: 12px; background: var(--eo-chip);
  overflow-wrap: anywhere; word-break: break-word; white-space: normal;
}
.st-hint svg { flex: none; margin-top: 3px; }

/* 纵向 Flex 表单：每个字段 = 标签 + 输入框 + 说明（全宽，无左右分栏，永不错位） */
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
