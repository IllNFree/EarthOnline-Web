<script setup>
// ===== AI 命令面板（/ 技能 · @ 引用 · 自然语言建图） =====
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useAppStore } from '../stores/app.js'
import { callWebAI, AI_PROVIDERS } from '../services/webAI.js'
import Icon from './Icon.vue'

const props = defineProps({ show: { type: Boolean, default: false }, contextText: { type: String, default: '' } })
const emit = defineEmits(['close', 'create'])
const store = useAppStore()
const text = ref('')
const busy = ref(false)
const hint = ref('')
const inputEl = ref(null)
const provider = ref(store.data.aiConfig.provider || 'deepseek')

const configured = computed(() => !!(store.data.aiConfig && store.data.aiConfig.apiKey))

onMounted(() => { if (props.show) nextTick(() => inputEl.value && inputEl.value.focus()) })

watch(() => props.show, (v) => { if (v) nextTick(() => inputEl.value && inputEl.value.focus()) })

function setProvider(p) {
  provider.value = p
  store.data.aiConfig = Object.assign({}, store.data.aiConfig, { provider: p })
  store.persist()
}

async function send() {
  const msg = text.value.trim()
  if (!msg || busy.value) return
  busy.value = true; hint.value = ''
  try {
    if (!configured.value) { hint.value = '尚未配置 AI，已按本地规则处理。请到「设置 → AI」填写密钥。'; await localFallback(msg); }
    else { await aiFlow(msg) }
  } catch (e) {
    hint.value = (e && e.message) || 'AI 调用失败'
    await localFallback(msg)
  } finally {
    busy.value = false
    text.value = ''
  }
}

// 本地兜底：把输入拆成若干卡片（无网也能建图）
async function localFallback(msg) {
  const parts = msg.split(/[；;。\n]+/).map((s) => s.trim()).filter(Boolean)
  const list = parts.length ? parts : [msg]
  list.slice(0, 8).forEach((p, i) => emit('create', { cardKind: 'note', title: p.slice(0, 40), cardData: { text: p }, pos: { x: 80 + i * 40, y: 80 + i * 30 } }))
  emit('close')
}

// AI 流程：让模型产出节点数组
async function aiFlow(msg) {
  const isCmd = msg.startsWith('/')
  let system, user
  if (isCmd) {
    const [cmd] = msg.slice(1).split(/\s+/)
    const sel = store.selectedNodeOf()
    const src = sel && sel.type === 'card' ? JSON.stringify(sel.cardData || {}) : (sel && (sel.text || sel.title) || '')
    system = '你是笔记助手。只输出纯文本结果，不要解释。'
    user = '/' + cmd + '：' + (props.contextText || msg)
  } else {
    system = '你是思维导图助手。根据用户描述，生成一组画布节点。只输出一个 JSON 数组，元素形如 {"cardKind":"text|todo|note|link|clock|spending","title":"标题","body":"内容"}。不要输出多余文字。'
    user = msg
  }
  const out = await callWebAI(store.data.aiConfig, system, user)
  if (isCmd) {
    emit('create', { cardKind: 'note', title: (msg.slice(0, 30) || 'AI 结果'), cardData: { text: out }, pos: { x: 120, y: 120 } })
  } else {
    let arr = null
    try { arr = JSON.parse(out) } catch (e) { const m = out.match(/\[[\s\S]*\]/); if (m) try { arr = JSON.parse(m[0]) } catch (e2) {} }
    if (Array.isArray(arr)) {
      arr.slice(0, 10).forEach((n, i) => emit('create', {
        cardKind: n.cardKind || 'note',
        title: n.title || '节点',
        cardData: Object.assign(cardMetaDefault(n.cardKind), n.body ? { text: n.body, markdown: n.body } : {}, n.cardData || {}),
        pos: { x: 100 + i * 36, y: 100 + i * 26 }
      }))
    } else {
      emit('create', { cardKind: 'note', title: msg.slice(0, 40), cardData: { text: out }, pos: { x: 100, y: 100 } })
    }
  }
  emit('close')
}
function cardMetaDefault(k) { return {} }
</script>

<template>
  <div class="cap-mask" v-if="show" @click.self="emit('close')">
    <div class="cap glass">
      <div class="cap-head">
        <Icon name="sparkles" :size="16" />
        <input ref="inputEl" v-model="text" class="cap-input" :placeholder="'输入指令：/总结 或用自然语言描述要建的图…'"
          @keydown.enter.prevent="send" />
        <button class="cap-x" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>
      <div class="cap-providers">
        <button v-for="(p, k) in AI_PROVIDERS" :key="k" class="cap-p" :class="{ on: provider === k }" @click="setProvider(k)">{{ p.label }}</button>
        <span class="cap-cfg" :class="{ ok: configured }">{{ configured ? '已配置密钥' : '未配置' }}</span>
      </div>
      <div v-if="hint" class="cap-hint">{{ hint }}</div>
      <div class="cap-tip">提示：<b>/summary</b> 总结选中卡片 · <b>/translate</b> 翻译 · <b>/expand</b> 扩写 · 直接描述即可批量建节点</div>
    </div>
  </div>
</template>

<style scoped>
.cap-mask { position: fixed; inset: 0; z-index: 130; display: flex; align-items: flex-start; justify-content: center; padding-top: 16vh; background: rgba(44, 44, 44, .32); }
.cap { width: 100%; max-width: 560px; border-radius: 20px; padding: 12px 14px; box-shadow: 0 30px 70px -28px rgba(44, 44, 44, .2); }
.cap-head { display: flex; align-items: center; gap: 8px; }
.cap-input { flex: 1; border: none; background: transparent; font-size: 14px; outline: none; color: var(--eo-ink); }
.cap-x { color: var(--eo-ink-soft); }
.cap-providers { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.cap-p { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--eo-glass-border); background: rgba(255,255,255,.4); font-size: 11px; font-weight: 700; cursor: pointer; }
.cap-p.on { background: var(--eo-primary); color: #fff; border-color: transparent; }
.cap-cfg { margin-left: auto; font-size: 11px; opacity: .6; }
.cap-cfg.ok { color: var(--eo-ink-soft); opacity: 1; }
.cap-hint { font-size: 11px; color: var(--eo-ink-soft); margin-top: 6px; }
.cap-tip { font-size: 11px; opacity: .65; margin-top: 8px; }
</style>
