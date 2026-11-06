<script setup>
// ===== 画布 AI 助手（右侧可折叠浮层） =====
// 能力：自然语言对话；按 JSON 动作建卡（便利贴 / 文档卡 / 笔记卡）；把选中卡整理成组；总结选中。
// 约束：只复用 store.data.aiConfig（不新增密钥）；未配置或离线时按钮置灰并给出提示。
// 所有建卡 / 分组动作统一走 ws.pushUndo()，可由 Ctrl+Z 撤销。
import { ref, computed, nextTick, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import { useAppStore } from '../../stores/app.js'
import { chat as aiChat, chatStream } from '../../lib/ai.js'
import { defaultCardData } from '../../lib/cardMatrix.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  ws: { type: Object, required: true },
  ui: { type: Object, required: true }
})
const emit = defineEmits(['toast', 'close'])

const store = useAppStore()
const cfg = computed(() => store.data.aiConfig || {})
const configured = computed(() => !!(cfg.value.apiKey && cfg.value.model))
const online = computed(() => store.online)
const ready = computed(() => configured.value && online.value)
const hintText = computed(() => {
  if (!configured.value) return '尚未配置 AI：请到「AI 中枢 → 配置」填写 Base URL / API Key / 模型。'
  if (!online.value) return '当前离线，AI 助手需要联网后使用。'
  return ''
})

const collapsed = ref(false)
function goConfig() {
  // 配置入口在「AI 中枢」页（设置里没有 AI 项），这里直接把人送过去
  window.location.hash = '#/ai'
}
const busy = ref(false)
const text = ref('')
const messages = ref([])
const listEl = ref(null)
const inputEl = ref(null)

const spaceName = computed(() => {
  props.ui.tick
  const sp = props.ws.spaces[props.ws.currentId]
  return sp ? sp.name : '当前空间'
})
const selectedNodes = computed(() => {
  props.ui.tick
  const ws = props.ws
  return (props.ui.selection || [])
    .map((id) => ws.nodeById(id))
    .filter((n) => n && n.spaceId === ws.currentId)
})
const selectionCount = computed(() => selectedNodes.value.length)
const canQuick = computed(() => ready.value && !busy.value && selectionCount.value > 0)

watch(() => props.open, (v) => {
  if (!v) return
  nextTick(() => { inputEl.value && inputEl.value.focus(); scrollBottom() })
})

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}
function pushMsg(role, content) {
  const m = { role, content, ts: Date.now() }
  messages.value.push(m)
  scrollBottom()
  return m
}

// ---------- 上下文 ----------
function nodeText(n) {
  const parts = [n.title || '']
  if (n.body) parts.push(n.body)
  if (n.text) parts.push(n.text)
  const cd = n.cardData || {}
  if (cd.title) parts.push(cd.title)
  if (cd.body) parts.push(cd.body)
  if (cd.text) parts.push(cd.text)
  if (Array.isArray(cd.tracks) && cd.tracks.length) parts.push('曲目：' + cd.tracks.map((t) => t.title || t.name || '').filter(Boolean).join('、'))
  return parts.filter(Boolean).join('\n')
}
function selectionBrief() {
  const list = selectedNodes.value
  if (!list.length) return '（当前没有选中卡片）'
  return list.map((n, i) => `${i + 1}. 「${n.title || '未命名'}」(${n.kind}${n.panelKind ? '/' + n.panelKind : ''}${n.cardKind ? '/' + n.cardKind : ''}) ${nodeText(n).replace(/\n/g, ' ').slice(0, 120)}`).join('\n')
}
function buildSystem() {
  return `你是「地球Online」画布内的 AI 助手。当前空间：${spaceName.value}。
可用卡片类型：便利贴（type:"memo"）、文档卡（type:"doc"，适合长文）、笔记卡（type:"note"，Markdown 节点）。
当用户要求创建卡片或整理画布时，只输出一行严格 JSON（不要解释、不要代码块）：
{"action":"create_cards","cards":[{"type":"memo|doc|note","title":"标题","body":"正文"}]}
{"action":"group_selected"}
{"action":"summarize"}
普通问答直接输出简洁中文，不要输出 JSON。
当前选中卡片：
${selectionBrief()}`
}

// ---------- 发送 ----------
async function send() {
  const msg = text.value.trim()
  if (!msg || busy.value) return
  if (!ready.value) { emit('toast', hintText.value); return }
  text.value = ''
  pushMsg('user', msg)
  const out = pushMsg('assistant', '')
  let raw = ''
  busy.value = true
  try {
    const history = messages.value
      .filter((m) => m.content)
      .slice(-9)
      .map((m) => ({ role: m.role, content: m.content }))
    const res = await chatStream(cfg.value, [{ role: 'system', content: buildSystem() }, ...history], {
      onToken: (d) => {
        raw += d
        const t = raw.trim()
        out.content = (t.startsWith('{') || t.startsWith('[')) ? '正在生成画布动作…' : raw
        scrollBottom()
      }
    })
    if (!res.ok) { out.content = '调用失败：' + res.error; emit('toast', 'AI 调用失败：' + res.error); return }
    const action = parseAction(res.text)
    if (action) {
      out.content = runAction(action)
    } else if (!raw.trim()) {
      out.content = '（无输出）'
    }
  } catch (e) {
    out.content = '调用失败：' + (e.message || '未知错误')
  } finally {
    busy.value = false
    scrollBottom()
  }
}
function parseAction(raw) {
  if (!raw) return null
  let obj = null
  try { obj = JSON.parse(raw) } catch (e) {
    const m = String(raw).match(/\{[\s\S]*\}/)
    if (m) { try { obj = JSON.parse(m[0]) } catch (e2) { obj = null } }
  }
  if (!obj || !obj.action) return null
  if (!['create_cards', 'group_selected', 'summarize'].includes(obj.action)) return null
  return obj
}
function runAction(a) {
  if (a.action === 'create_cards') {
    const n = createCards(a.cards)
    return n ? `已创建 ${n} 张卡片，可用 Ctrl+Z 撤销。` : '没有可创建的卡片。'
  }
  if (a.action === 'group_selected') {
    const g = groupSelection()
    return g ? `已把 ${selectionCount.value} 张卡片整理成组「${g.name}」，可拖动组框整体移动。` : '至少选中两张卡片才能整理成组。'
  }
  if (a.action === 'summarize') {
    summarizeSelection()
    return '正在总结选中卡片…'
  }
  return '未识别动作。'
}

// ---------- 画布动作 ----------
const CARD_DEFS = {
  memo: { kind: 'memo', w: 248, h: 160, color: '#F2C74F' },
  doc: { kind: 'card', cardKind: 'doc', w: 360, h: 320, color: '#DCD6C8' },
  note: { kind: 'note', w: 260, h: 160 }
}
function createCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return 0
  const ws = props.ws
  const cam = ws.space.camera
  const list = cards.slice(0, 6)
  ws.pushUndo()
  const ids = []
  list.forEach((c, i) => {
    const def = CARD_DEFS[c.type] || CARD_DEFS.memo
    const spot = ws.findFreeSpot(ws.currentId, def.w, def.h, cam.x + (i % 3) * 60, cam.y + Math.floor(i / 3) * 60)
    const title = (c.title || 'AI 卡片').toString().slice(0, 60)
    const body = (c.body || c.content || '').toString()
    let node
    if (def.kind === 'memo') {
      node = ws.addNode({ kind: 'memo', title, text: body || title, x: spot.x, y: spot.y, w: def.w, h: def.h, color: def.color })
    } else if (def.kind === 'card') {
      node = ws.addNode({
        kind: 'card', cardKind: def.cardKind, title, x: spot.x, y: spot.y, w: def.w, h: def.h,
        color: def.color, cardData: Object.assign({}, defaultCardData(def.cardKind), body ? { body } : {})
      })
    } else {
      node = ws.addNode({ kind: 'note', title, body, x: spot.x, y: spot.y, w: def.w, h: def.h })
    }
    if (node) ids.push(node.id)
  })
  if (!ids.length) return 0
  ws.rebuildIndex()
  ws.touch('ai:create-cards')
  store.bumpMilestone('aiCard')
  props.ui.selection = ids
  props.ui.tick++
  emit('toast', 'AI 已创建 ' + ids.length + ' 张卡片')
  return ids.length
}

function groupSelection() {
  const ids = selectedNodes.value.map((n) => n.id)
  if (ids.length < 2) return null
  const g = props.ws.group(ids)
  if (!g) return null
  props.ui.activeGroup = g.id
  props.ui.tick++
  emit('toast', '已整理成一个组')
  return g
}

async function summarizeSelection(ids) {
  if (!ready.value) { emit('toast', hintText.value); return }
  if (busy.value) { emit('toast', 'AI 正在处理，请稍候'); return }
  const ws = props.ws
  const list = (ids && ids.length ? ids : props.ui.selection)
    .map((id) => ws.nodeById(id))
    .filter((n) => n && n.spaceId === ws.currentId)
  if (!list.length) { emit('toast', '请先选中要总结的卡片'); return }
  const multi = list.length > 1
  busy.value = true
  const tip = pushMsg('assistant', '正在阅读 ' + list.length + ' 张卡片…')
  try {
    const user = list
      .map((n, i) => `【卡片${i + 1}】${n.title || ''}\n${nodeText(n).slice(0, 1200)}`)
      .join('\n\n')
    const sys = multi
      ? '你是画布总结助手。把多张卡片的信息合并成一篇结构清晰的中文总结，用 Markdown 小标题与要点组织。只输出总结正文，不要解释，不要输出 JSON。'
      : '你是画布总结助手。把这张卡片的内容提炼成简洁中文要点（3-6 条）。只输出总结正文，不要解释，不要输出 JSON。'
    const res = await aiChat(cfg.value, [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeout: 90000 })
    if (!res.ok) {
      tip.content = '总结失败：' + res.error
      emit('toast', 'AI 总结失败：' + res.error)
      return
    }
    const body = (res.text || '').trim()
    if (!body) { tip.content = 'AI 返回为空'; return }
    createSummaryCard(multi, body, list)
    store.bumpMilestone('aiSummary')
    tip.content = multi ? '已生成文档卡「AI 总结」' : '已生成便利贴「AI 总结」'
  } catch (e) {
    tip.content = '总结失败：' + (e.message || '未知错误')
  } finally {
    busy.value = false
    scrollBottom()
  }
}
function createSummaryCard(multi, body, list) {
  const ws = props.ws
  const cam = ws.space.camera
  const first = (list[0] && list[0].title) || spaceName.value
  ws.pushUndo()
  if (multi) {
    const def = CARD_DEFS.doc
    const spot = ws.findFreeSpot(ws.currentId, def.w, def.h, cam.x + 40, cam.y)
    ws.addNode({
      kind: 'card', cardKind: 'doc', title: 'AI 总结 · ' + list.length + ' 张卡片',
      x: spot.x, y: spot.y, w: def.w, h: def.h, color: def.color,
      cardData: Object.assign({}, defaultCardData('doc'), { body })
    })
  } else {
    const def = CARD_DEFS.memo
    const spot = ws.findFreeSpot(ws.currentId, def.w, def.h, cam.x + 40, cam.y)
    ws.addNode({ kind: 'memo', title: 'AI 总结 · ' + first.slice(0, 20), text: body, x: spot.x, y: spot.y, w: def.w, h: def.h, color: def.color })
  }
  ws.rebuildIndex()
  ws.touch('ai:summary')
  props.ui.tick++
  emit('toast', 'AI 已按总结生成' + (multi ? '文档卡' : '便利贴') + '，可 Ctrl+Z 撤销')
}

function clearChat() {
  messages.value = []
}

defineExpose({ summarizeSelection, send, groupSelection, clearChat })
</script>

<template>
  <div v-if="open" class="ai-dock" :style="{ right: ui.inspector ? '322px' : '16px' }" :class="{ collapsed }">
    <header class="ai-head">
      <span class="ai-mark"><Icon name="sparkles" :size="15" /></span>
      <div class="ai-titles">
        <span class="ai-name">AI 助手</span>
        <span class="ai-sub">{{ spaceName }}</span>
      </div>
      <button class="ai-ico" :title="collapsed ? '展开' : '折叠'" @click="collapsed = !collapsed">
        <Icon :name="collapsed ? 'chevdown' : 'chevup'" :size="14" />
      </button>
      <button class="ai-ico" title="关闭" @click="emit('close')"><Icon name="close" :size="14" /></button>
    </header>

    <div v-if="!collapsed" class="ai-body">
      <div class="ai-quick">
        <button :disabled="!canQuick || selectionCount < 2" title="把选中卡片整理成组" @click="groupSelection">
          整理选中为组{{ selectionCount > 1 ? ' · ' + selectionCount : '' }}
        </button>
        <button :disabled="!canQuick" title="把选中卡片总结为文档卡 / 便利贴" @click="summarizeSelection()">
          总结选中{{ selectionCount ? ' · ' + selectionCount : '' }}
        </button>
      </div>

      <div ref="listEl" class="ai-list">
        <div v-if="!messages.length" class="ai-empty">
          <span class="ai-empty-mark"><Icon name="sparkles" :size="18" /></span>
          <p>让 AI 帮你建卡、整理分组或总结选中内容。</p>
          <p class="ai-empty-tip">例：「把这三张卡片整理成一组」「总结选中的卡片」「新建三张周末计划便利贴」</p>
        </div>
        <div v-for="(m, i) in messages" :key="i" class="ai-msg" :class="m.role">
          <span class="ai-msg-who">{{ m.role === 'user' ? '我' : 'AI' }}</span>
          <div class="ai-msg-text">{{ m.content }}</div>
        </div>
        <div v-if="busy && !messages.length" class="ai-typing">AI 正在思考…</div>
      </div>

      <div class="ai-input">
        <textarea ref="inputEl" v-model="text" rows="2" :disabled="!ready"
          :placeholder="ready ? '描述你想做什么，Enter 发送 / Shift+Enter 换行' : (configured ? '离线状态不可用' : '未配置 AI')"
          @keydown.enter.exact.prevent="send"></textarea>
        <div class="ai-input-foot">
          <span v-if="hintText" class="ai-hint">{{ hintText }}</span>
          <button v-if="!configured" class="ai-cfg-btn" @pointerdown.stop @click.stop="goConfig">去配置</button>
          <span v-else class="ai-hint ok">{{ busy ? '处理中…' : '已连接 · ' + (cfg.model || '') }}</span>
          <button class="ai-send" :disabled="!ready || !text.trim() || busy" title="发送 (Enter)" @click="send">
            <Icon name="send" :size="13" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-dock {
  position: absolute; top: 66px; width: 340px; max-height: calc(100% - 150px); z-index: 26;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--sp-card, rgba(255,255,255,0.96)); border: 1px solid var(--sp-line, rgba(44, 44, 44, 0.10)); border-radius: 16px;
  box-shadow: 0 24px 60px -30px rgba(0, 0, 0, 0.32), 0 2px 10px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(12px); transition: right .25s ease;
  animation: aiIn .22s cubic-bezier(.2, .85, .24, 1) both;
}
.ai-dock.collapsed { max-height: none; }
@keyframes aiIn { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }

.ai-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; border-bottom: 1px solid var(--sp-line, rgba(44,44,44,0.08)); }
.ai-mark { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--eo-primary); color: #FAF9F6; flex: 0 0 auto; }
.ai-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.ai-name { font-size: 12px; font-weight: 800; color: var(--sp-ink, #2C2C2C); }
.ai-sub { font-size: 9.5px; color: var(--sp-ink-3, #9A968E); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-ico { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: var(--sp-ink-2, #8A867E); }
.ai-ico:hover { background: var(--eo-chip); color: var(--sp-ink, #2C2C2C); }

.ai-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.ai-quick { display: flex; gap: 6px; padding: 9px 10px 6px; }
.ai-quick button {
  flex: 1; min-width: 0; padding: 7px 8px; border-radius: 9px; font-size: 11px; font-weight: 700;
  color: var(--sp-ink-1, #4A4742); background: var(--sp-fill, #F6F4EE); border: 1px solid var(--sp-line, rgba(44,44,44,0.08));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ai-quick button:hover:not(:disabled) { background: var(--eo-primary); color: #FFFFFF; border-color: var(--eo-primary); }
.ai-quick button:disabled { opacity: .4; cursor: default; }

.ai-list { flex: 1; min-height: 110px; overflow-y: auto; padding: 4px 12px 10px; }
.ai-empty { padding: 14px 4px; text-align: center; color: var(--sp-ink-2, #8A867E); font-size: 11px; line-height: 1.6; }
.ai-empty-mark { display: inline-flex; width: 34px; height: 34px; border-radius: 10px; align-items: center; justify-content: center; background: var(--sp-fill, #F1EFE8); color: var(--sp-ink-2, #6E6A64); margin-bottom: 8px; }
.ai-empty p { margin: 0 0 4px; }
.ai-empty-tip { color: var(--sp-ink-3, #A29E96); font-size: 10px; }
.ai-msg { margin: 8px 0; }
.ai-msg-who { display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: .06em; color: var(--sp-ink-3, #A29E96); margin-bottom: 3px; }
.ai-msg-text { font-size: 11.5px; line-height: 1.65; color: var(--sp-ink-1, #34312D); white-space: pre-wrap; word-break: break-word; background: var(--sp-fill, #F7F5F0); border-radius: 10px; padding: 8px 10px; }
.ai-msg.user .ai-msg-text { background: var(--eo-primary); color: #FAF9F6; }
.ai-msg.user .ai-msg-who { color: var(--sp-ink-3, #C7C3BA); }
.ai-typing { font-size: 11px; color: var(--sp-ink-3, #9A968E); padding: 8px 6px; }

.ai-input { border-top: 1px solid var(--sp-line, rgba(44,44,44,0.08)); padding: 8px 10px 9px; background: var(--sp-field, #FCFBF8); }
.ai-input textarea {
  width: 100%; resize: none; border: none; outline: none; background: transparent;
  font-size: 11.5px; line-height: 1.55; color: var(--sp-ink, #2C2C2C); font-family: inherit; max-height: 88px;
}
.ai-input textarea::placeholder { color: var(--sp-ink-3, #B0ACA4); }
.ai-input-foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ai-hint { flex: 1; min-width: 0; font-size: 9.5px; color: #A05A4C; line-height: 1.4; }
.ai-hint.ok { color: var(--sp-ink-2, #8A867E); }
.ai-cfg-btn {
  flex: 0 0 auto; height: 24px; padding: 0 10px; border-radius: 7px;
  background: var(--eo-primary); color: #FFFFFF; font-size: 10.5px; font-weight: 600;
}
.ai-send { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--eo-primary); color: #FAF9F6; }
.ai-send:disabled { opacity: .32; cursor: default; }

@media (max-width: 899px) {
  .ai-dock {
    left: 0; right: 0 !important; top: auto; bottom: 0; width: 100%;
    max-height: 72vh; border-radius: 18px 18px 0 0;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 62px);
    animation: aiUp .24s cubic-bezier(.2, .85, .24, 1) both;
  }
  .ai-dock.collapsed { max-height: 54px; }
  @keyframes aiUp { from { transform: translateY(24px); opacity: .6 } to { transform: none; opacity: 1 } }
}
</style>
