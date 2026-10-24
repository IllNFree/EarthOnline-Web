<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useAppStore } from '../stores/app.js'
import { testConnection, chatStream, decodeQuickIntent, applyIntent } from '../lib/ai.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
// 快捷中枢与对话页合并：单一输入框 + 快捷模式开关，共用一套全局会话历史（需求 #11）
const quickMode = ref(false)
const input = ref('')
const typing = ref(false)
const showConfig = ref(false)
const cfg = ref({ baseUrl: store.data.aiConfig.baseUrl, apiKey: store.data.aiConfig.apiKey, model: store.data.aiConfig.model })
const testing = ref(false)
const testRes = ref('')
const scrollRef = ref(null)

const configured = computed(() => store.data.aiConfig.apiKey && store.data.aiConfig.model)
const messages = computed(() => store.aiHistory)

function scrollDown() { nextTick(() => { if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight }) }
watch(messages, scrollDown)

function saveConfig() {
  store.setAiConfig({ ...cfg.value })
  store.showToast('已保存 AI 配置')
  showConfig.value = false
}
async function doTest() {
  testing.value = true; testRes.value = ''
  const r = await testConnection({ ...cfg.value })
  testRes.value = r.ok ? '✓ 连接成功' : '✗ ' + r.error
  testing.value = false
}
async function send() {
  const text = input.value.trim()
  if (!text) return
  if (!configured.value) { showConfig.value = true; return }
  input.value = ''
  store.pushAi('user', text)
  typing.value = true
  // 历史消息（排除空占位）送入 API，流式逐字写入当前助手消息，全局历史同步
  const history = messages.value.map((m) => ({ role: m.role, content: m.content })).filter((m) => m.content)
  const id = store.pushAiStreaming('assistant')
  const r = await chatStream(store.data.aiConfig, history, {
    onFirst: () => { typing.value = false; scrollDown() },
    onToken: (d) => { store.appendAiToken(id, d); scrollDown() }
  })
  typing.value = false
  const msg = store.aiHistory.find((x) => x.id === id)
  if (!r.ok) {
    if (msg && !msg.content) msg.content = '（出错了：' + r.error + '）'
    else if (msg) msg.content += '\n（连接中断：' + r.error + '）'
    store.persistAi()
  }
  scrollDown()
}
async function quick() {
  const text = input.value.trim()
  if (!text) return
  if (!configured.value) { showConfig.value = true; return }
  input.value = ''
  store.pushAi('user', '⚡ ' + text)
  typing.value = true
  const r = await decodeQuickIntent(store.data.aiConfig, text)
  typing.value = false
  if (!r.ok) { store.pushAi('assistant', '（识别失败：' + r.error + '）'); return }
  const res = applyIntent(store.data, r.intent)
  store.pushAi('assistant', res.ok ? ('✅ ' + res.label) : ('⚠️ ' + (res.error || '未能执行')))
  if (res.ok) store.showToast(res.label)
}
</script>

<template>
  <div class="page wide" style="padding:0;display:flex;flex-direction:column">
    <div class="row between" style="padding:12px 16px 4px">
      <span class="chip"><Icon name="sparkles" :size="13" /> 云端 AI · 对话与快捷中枢已合并</span>
      <button class="chip" @click="showConfig = true"><Icon name="settings" :size="14" /> 配置</button>
    </div>

    <div ref="scrollRef" style="flex:1;overflow-y:auto;padding:6px 16px 12px">
      <div v-if="!messages.length" class="muted" style="text-align:center;padding:30px">
        云端 AI 助手（Web 端仅支持云端模型）<br />
        普通提问直接发送；打开 <b>⚡ 快捷</b> 后说一句话即可创建任务 / 笔记 / 足迹
      </div>
      <div v-for="m in messages" :key="m.id" class="row" :style="m.role === 'user' ? 'flex-direction:row-reverse' : ''" style="margin:8px 0">
        <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip);color:var(--eo-primary-deep)">
          <Icon :name="m.role === 'user' ? 'user' : 'sparkles'" :size="18" />
        </span>
        <div class="glass" style="max-width:74%;padding:10px 14px;font-size:14px;white-space:pre-wrap;border-radius:16px">{{ m.content }}</div>
      </div>
      <div v-if="typing" class="row" style="margin:8px 0">
        <span class="avatar" style="width:34px;height:34px;background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="sparkles" :size="18" /></span>
        <div class="glass" style="padding:12px 16px;border-radius:16px">
          <span class="typing"><i></i><i></i><i></i></span>
        </div>
      </div>
    </div>

    <div class="capsule" style="margin:0 14px calc(env(safe-area-inset-bottom,0px) + 92px)">
      <button class="chip" :style="quickMode ? 'background:var(--eo-primary);color:#fff' : ''" @click="quickMode = !quickMode" title="快捷模式：一句话创建任务/笔记/足迹">
        <Icon name="bolt" :size="14" /> 快捷
      </button>
      <input v-model="input" :placeholder="quickMode ? '例如：明天下午提醒我交报告' : '问点什么…'" @keyup.enter="quickMode ? quick() : send()" />
      <button class="btn" style="padding:8px 14px" @click="quickMode ? quick() : send()"><Icon name="send" :size="16" /></button>
    </div>

    <Modal title="AI 模型配置（OpenAI 兼容）" :show="showConfig" @close="showConfig = false">
      <div class="muted" style="font-size:12px;margin-bottom:8px">Web 端无法运行本地离线大模型，仅支持云端 API。</div>
      <div class="field"><label>Base URL</label><input v-model="cfg.baseUrl" placeholder="https://api.openai.com/v1" /></div>
      <div class="field"><label>API Key</label><input v-model="cfg.apiKey" type="password" placeholder="sk-..." /></div>
      <div class="field"><label>模型名</label><input v-model="cfg.model" placeholder="gpt-3.5-turbo" /></div>
      <div class="row" style="gap:8px">
        <button class="btn ghost" @click="doTest" :disabled="testing"><Icon name="bolt" :size="16" /> {{ testing ? '测试中' : '测试连接' }}</button>
        <button class="btn" @click="saveConfig"><Icon name="checklist" :size="16" /> 保存</button>
      </div>
      <div v-if="testRes" class="muted" style="margin-top:8px">{{ testRes }}</div>
    </Modal>
  </div>
</template>

<style scoped>
.typing { display: inline-flex; gap: 4px; align-items: center; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--eo-primary); display: inline-block; animation: bounce 1s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5 } 30% { transform: translateY(-5px); opacity: 1 } }
</style>
