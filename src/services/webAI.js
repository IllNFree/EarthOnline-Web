// ===== Web AI 调用（OpenAI 兼容 chat/completions） =====
// 支持 DeepSeek / OpenAI / Gemini（均按 OpenAI 兼容协议）。
export const AI_PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' }
}

export function resolveProvider(cfg) {
  if (cfg && cfg.provider && AI_PROVIDERS[cfg.provider]) {
    const p = AI_PROVIDERS[cfg.provider]
    return {
      baseUrl: cfg.baseUrl || p.baseUrl,
      model: cfg.model || p.model,
      apiKey: cfg.apiKey || ''
    }
  }
  return { baseUrl: cfg && cfg.baseUrl || '', model: cfg && cfg.model || '', apiKey: cfg && cfg.apiKey || '' }
}

/**
 * 调用大模型。返回文本字符串。失败抛出错误。
 * @param {object} cfg 含 baseUrl / apiKey / model
 * @param {string} system 系统提示
 * @param {string} user 用户消息
 */
export async function callWebAI(cfg, system, user) {
  const { baseUrl, model, apiKey } = resolveProvider(cfg)
  if (!baseUrl || !apiKey) throw new Error('未配置 AI（请到「设置 → AI」填写 Base URL / API Key / 模型）')
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.6,
    max_tokens: 1200
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error('AI 请求失败（' + res.status + '）' + txt.slice(0, 120))
  }
  const data = await res.json()
  const msg = data && data.choices && data.choices[0] && data.choices[0].message
  return (msg && msg.content) || ''
}
