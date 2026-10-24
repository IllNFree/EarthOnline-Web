// ===== AI 中枢（OpenAI 兼容云端调用 + 快捷意图识别 + Tool Calling） =====
// Web 端仅支持云端模型（无法运行本地大模型），UI 中隐藏本地模型选项。
import { addTask, addMemo, addLocation } from './ops.js'

function headers(cfg) {
  const h = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey
  return h
}
function endpoint(cfg) {
  let base = (cfg.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) base = 'https://api.openai.com/v1'
  return base + '/chat/completions'
}
export async function testConnection(cfg) {
  try {
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ model: cfg.model || 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: '密钥无效（401/403）' }
    if (res.status === 404) return { ok: false, error: '模型或地址不存在（404）' }
    if (res.status === 429) return { ok: false, error: '请求过于频繁（429）' }
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message || '网络错误' } }
}
export async function chat(config, messages, opts) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 60000)
  try {
    const res = await fetch(endpoint(config), {
      method: 'POST',
      headers: headers(config),
      signal: ctrl.signal,
      body: JSON.stringify({ model: config.model || 'gpt-3.5-turbo', messages, stream: false })
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: 'HTTP ' + res.status + ' ' + t.slice(0, 120), text: '' }
    }
    const json = await res.json()
    const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || ''
    return { ok: true, error: '', text }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求超时' : (e.message || '网络错误'), text: '' }
  } finally { clearTimeout(timer) }
}

// 流式对话：SSE / ReadableStream 逐字输出。onFirst 在首 token 到达时触发（用于切换 Typing 指示）。
export async function chatStream(config, messages, handlers) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), (handlers && handlers.timeout) || 60000)
  let first = true
  try {
    const res = await fetch(endpoint(config), {
      method: 'POST',
      headers: headers(config),
      signal: ctrl.signal,
      body: JSON.stringify({ model: config.model || 'gpt-3.5-turbo', messages, stream: true })
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: 'HTTP ' + res.status + ' ' + t.slice(0, 120), text: '' }
    }
    if (!res.body) return { ok: false, error: '当前浏览器不支持流式响应', text: '' }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''
          if (delta) {
            full += delta
            if (first) { first = false; if (handlers && handlers.onFirst) handlers.onFirst() }
            if (handlers && handlers.onToken) handlers.onToken(delta)
          }
        } catch (e) { /* 忽略非 JSON 心跳行 */ }
      }
    }
    return { ok: true, error: '', text: full }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求超时' : (e.message || '网络错误'), text: '' }
  } finally { clearTimeout(timer) }
}

// 快捷中枢：识别用户一句话意图，返回严格 JSON（只做字段清洗，真实大模型调用）
export async function decodeQuickIntent(config, text) {
  const today = new Date()
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]
  const dateLine = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} ${weekday}`
  const sys = `你是地球Online的快捷指令解析器。当前日期：${dateLine}。只回一行严格 JSON，不要解释。
格式：{"action":"task|memo|location|none","payload":{"title":...,"note":...,"category":"main|side|todo","name":...,"lat":...,"lng":...,"date":...}}。
若只是聊天或无明确动作，返回 {"action":"none","payload":{}}。`
  const r = await chat(config, [
    { role: 'system', content: sys },
    { role: 'user', content: text }
  ], { timeout: 15000 })
  if (!r.ok) return { ok: false, error: r.error, intent: null }
  // 提取首个 JSON 对象
  const m = r.text.match(/\{[\s\S]*\}/)
  if (!m) return { ok: true, intent: { action: 'none', payload: {} }, raw: r.text }
  try {
    const intent = JSON.parse(m[0])
    return { ok: true, intent, raw: r.text }
  } catch (e) { return { ok: true, intent: { action: 'none', payload: {} }, raw: r.text } }
}

// 将意图落到数据（Tool Calling）
export function applyIntent(state, intent) {
  if (!intent || !intent.action) return { ok: false, error: '无动作' }
  const p = intent.payload || {}
  if (intent.action === 'task') {
    const r = addTask(state, { title: p.title || p.note || '新任务', note: p.note || '', category: p.category || 'side' })
    return r.ok ? { ok: true, kind: 'task', label: '已创建任务' } : { ok: false, error: r.error }
  }
  if (intent.action === 'memo') {
    const r = addMemo(state, { title: p.title || '快捷笔记', markdown: p.note || p.title || '' })
    return r.ok ? { ok: true, kind: 'memo', label: '已保存笔记' } : { ok: false, error: r.error }
  }
  if (intent.action === 'location') {
    const r = addLocation(state, { name: p.name || p.title || '新足迹', lat: p.lat, lng: p.lng, note: p.note || '' })
    return r.ok ? { ok: true, kind: 'location', label: '已添加足迹' } : { ok: false, error: r.error }
  }
  return { ok: false, error: '未识别为可执行动作' }
}
