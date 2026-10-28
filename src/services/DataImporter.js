// ===== 第三方数据导入（需求 5）：微信/支付宝账单 CSV + 旧版 Markdown =====
// 零依赖：内置稳健 CSV 解析器（正确处理引号/逗号/换行），避免引入 PapaParse 的构建风险。
// 映射标准严格对齐 model.js 内部记账/笔记模型（camelCase）。
import { useAppStore } from '../stores/app.js'

/** 稳健 CSV 解析：支持引号包裹、字段内逗号与换行、转义双引号 */
export function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  const src = String(text || '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* 忽略，跟换行 */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x !== ''))
}

/** 探测金额/收支/日期/描述列下标 */
function detectColumns(header) {
  const h = header.map((x) => String(x || '').trim())
  const idx = (keys) => h.findIndex((x) => keys.some((k) => x.indexOf(k) >= 0))
  return {
    amount: idx(['金额', '金额(元)', '交易金额', '收/支金额']),
    type: idx(['收/支', '收支', '收付款类型', '交易类型']),
    date: idx(['交易时间', '记账时间', '时间', '日期']),
    desc: idx(['商品', '商品名称', '交易分类', '备注', '交易对方', '名称'])
  }
}
function parseAmount(v) {
  const n = Number(String(v || '').replace(/[^\d.\-]/g, ''))
  return isFinite(n) ? n : 0
}
function parseDate(v) {
  // 支持 "2024-01-01 12:00:00" / "2024/01/01" → YYYY-MM-DD
  const m = String(v || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0')
  return ''
}
function parseType(v) {
  return /收入|进账|收款/.test(String(v || '')) ? 'income' : 'expense'
}

/**
 * 导入账单 CSV → 内部记账模型（逐条调用 store.addLedgerRecord）。
 * 返回 { ok, imported, skipped }。
 */
export function importBillToLedger(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { ok: false, error: 'CSV 行数不足', imported: 0, skipped: 0 }
  const header = rows[0]
  const col = detectColumns(header)
  if (col.amount < 0) return { ok: false, error: '未识别到金额列', imported: 0, skipped: 0 }
  const store = useAppStore()
  let imported = 0
  let skipped = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const amount = parseAmount(r[col.amount])
    if (!amount) { skipped++; continue }
    const type = col.type >= 0 ? parseType(r[col.type]) : 'expense'
    const date = col.date >= 0 ? parseDate(r[col.date]) : ''
    const desc = col.desc >= 0 ? String(r[col.desc] || '').trim() : ''
    const res = store.addLedgerRecord({ type, amount, category: desc || '其他', note: desc, date })
    if (res.ok) imported++
    else skipped++
  }
  return { ok: true, imported, skipped }
}

/** 导入旧版 Markdown → 内部笔记结构（按首个 H1/H2 作标题，余下作正文） */
export function importMarkdownToNotes(text) {
  const src = String(text || '').replace(/\r\n/g, '\n')
  if (!src.trim()) return { ok: false, error: '内容为空', imported: 0 }
  const store = useAppStore()
  // 按 H2 切分为多篇笔记（无 H2 则整篇一篇）
  const blocks = src.split(/\n\s*(#{1,2})\s+/).slice(1)
  let imported = 0
  if (blocks.length < 2) {
    const firstHeading = src.match(/^#{1,2}\s+(.+)$/m)
    const title = firstHeading ? firstHeading[1].trim() : '导入笔记'
    const body = src.replace(/^#{1,2}\s+.+$/m, '').trim()
    if (store.addMemo({ title, markdown: body }).ok) imported++
  } else {
    for (let i = 0; i < blocks.length; i += 2) {
      const title = blocks[i + 1] ? blocks[i + 1].trim() : '导入笔记'
      const body = blocks[i + 2] !== undefined ? blocks[i + 2] : blocks[i]
      if (store.addMemo({ title: title.slice(0, 200), markdown: body.trim() }).ok) imported++
    }
  }
  return { ok: true, imported }
}
