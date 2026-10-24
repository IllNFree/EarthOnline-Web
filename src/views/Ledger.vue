<script setup>
// 记账模块：收支记录 / 分类 / 月度概览（含分类环形图）
import { ref, computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { todayStr } from '../lib/model.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const showAdd = ref(false)
const form = ref({ type: 'expense', amount: '', category: '', note: '', date: '' })

const monthBase = ref(new Date())
const p2 = (n) => String(n).padStart(2, '0')
const monthKey = computed(() => monthBase.value.getFullYear() + '-' + p2(monthBase.value.getMonth() + 1))
const monthTitle = computed(() => monthBase.value.getFullYear() + ' 年 ' + (monthBase.value.getMonth() + 1) + ' 月')
function shiftMonth(n) { const d = new Date(monthBase.value); d.setMonth(d.getMonth() + n); monthBase.value = d }

const monthRecords = computed(() =>
  store.data.ledger.records
    .filter((r) => r.date.startsWith(monthKey.value))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
)
const summary = computed(() => {
  let income = 0, expense = 0
  monthRecords.value.forEach((r) => { if (r.type === 'income') income += r.amount; else expense += r.amount })
  return { income, expense, balance: income - expense }
})
const byCategory = computed(() => {
  const m = {}
  monthRecords.value.forEach((r) => {
    if (r.type !== 'expense') return
    if (!m[r.category]) m[r.category] = 0
    m[r.category] += r.amount
  })
  return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v)
})
const catColor = (i) => ['#D4A373', '#C9A87C', '#B08553', '#8FA98F', '#9A8FB0', '#C48B7A', '#B0A086', '#8C9BAB'][i % 8]
// 环形图
const donut = computed(() => {
  const total = byCategory.value.reduce((s, c) => s + c.v, 0) || 1
  let acc = 0
  const C = 2 * Math.PI * 42
  return byCategory.value.slice(0, 8).map((c, i) => {
    const frac = c.v / total
    const seg = { color: catColor(i), dasharray: (frac * C) + ' ' + C, dashoffset: -acc * C, pct: Math.round(frac * 100) }
    acc += frac
    return seg
  })
})
const cats = computed(() => form.value.type === 'income' ? store.data.ledger.incomeCategories : store.data.ledger.expenseCategories)

function openAdd() {
  form.value = { type: 'expense', amount: '', category: '', note: '', date: '' }
  showAdd.value = true
}
function setType(t) {
  form.value.type = t
  if (!cats.value.some((c) => c.name === form.value.category)) form.value.category = ''
}
function save() {
  const r = store.addLedgerRecord({ ...form.value, amount: Number(form.value.amount) })
  if (!r.ok) return store.showToast(r.error)
  store.showToast('已记账')
  showAdd.value = false
}
async function del(id) {
  const ok = await dialog.confirm({ title: '删除记录', message: '该记账记录将被删除。', danger: true, confirmText: '删除' })
  if (!ok) return
  store.deleteLedgerRecord(id)
  store.showToast('已删除')
}
// 数据导入 / 导出（按 id 去重合并）
function exportLedger() {
  const payload = { app: 'earth-online', kind: 'ledger', exportedAt: new Date().toISOString(), records: store.data.ledger.records }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'ledger-' + new Date().toISOString().slice(0, 10) + '.json'
  a.click()
  URL.revokeObjectURL(a.href)
  store.showToast('已导出 ' + store.data.ledger.records.length + ' 条账单')
}
function importLedger(e) {
  const f = e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try {
      const data = JSON.parse(r.result)
      const incoming = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : null)
      if (!incoming) throw new Error('文件格式不正确（缺少 records 数组）')
      const existIds = new Set(store.data.ledger.records.map((x) => x.id))
      let added = 0, skipped = 0
      incoming.forEach((raw) => {
        const amount = Number(raw && raw.amount)
        if (!isFinite(amount) || amount <= 0) { skipped++; return }
        const id = String(raw.id || '')
        if (id && existIds.has(id)) { skipped++; return } // 按 id 去重，不覆盖已有记录
        store.data.ledger.records.push({
          id: id || 'led-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          type: raw.type === 'income' ? 'income' : 'expense',
          amount: Math.min(99999999, amount),
          category: String(raw.category || '其他'),
          note: String(raw.note || ''),
          date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : todayStr(),
          createdAt: String(raw.createdAt || todayStr())
        })
        existIds.add(id)
        added++
      })
      store.persist()
      store.showToast('导入完成：新增 ' + added + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条（重复/无效）' : ''))
      if (added) store.recomputeXp()
    } catch (err) {
      store.showToast('导入失败：' + err.message)
    } finally {
      e.target.value = ''
    }
  }
  r.readAsText(f)
}
const fmtDay = (d) => d.slice(5).replace('-', ' 月 ') + ' 日'
</script>

<template>
  <div class="page wide">
    <!-- 月度切换 + 概览 -->
    <div class="glass card">
      <div class="row between" style="margin-bottom:10px">
        <button class="btn ghost" style="padding:6px 12px" @click="shiftMonth(-1)"><Icon name="chevron" :size="16" style="transform:rotate(180deg)" /></button>
        <span style="font-weight:700">{{ monthTitle }}</span>
        <button class="btn ghost" style="padding:6px 12px" @click="shiftMonth(1)"><Icon name="chevron" :size="16" /></button>
      </div>
      <div class="grid3" style="text-align:center">
        <div><div class="muted" style="font-size:12px">收入</div><div style="font-weight:800;font-size:18px;color:var(--eo-good)">+{{ summary.income.toFixed(2) }}</div></div>
        <div><div class="muted" style="font-size:12px">支出</div><div style="font-weight:800;font-size:18px;color:var(--eo-bad)">-{{ summary.expense.toFixed(2) }}</div></div>
        <div><div class="muted" style="font-size:12px">结余</div><div style="font-weight:800;font-size:18px">{{ summary.balance.toFixed(2) }}</div></div>
      </div>
    </div>

    <!-- 分类占比（支出环形图） -->
    <div v-if="byCategory.length" class="glass card row" style="gap:18px;align-items:center">
      <svg width="120" height="120" viewBox="0 0 120 120" style="flex:none">
        <circle cx="60" cy="60" r="42" fill="none" stroke="var(--eo-glass-border)" stroke-width="14" />
        <circle v-for="(s, i) in donut" :key="i" cx="60" cy="60" r="42" fill="none"
          :stroke="s.color" stroke-width="14" :stroke-dasharray="s.dasharray" :stroke-dashoffset="s.dashoffset"
          transform="rotate(-90 60 60)" />
        <text x="60" y="66" text-anchor="middle" font-size="13" font-weight="700" fill="var(--eo-ink)">{{ summary.expense.toFixed(0) }}</text>
      </svg>
      <div style="flex:1;min-width:0">
        <div v-for="(c, i) in byCategory.slice(0, 8)" :key="c.name" class="row between" style="padding:3px 0;font-size:13px">
          <span class="row" style="gap:8px"><i :style="{ width: '10px', height: '10px', borderRadius: '3px', background: catColor(i), display: 'inline-block' }"></i>{{ c.name }}</span>
          <span class="muted">{{ c.v.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <!-- 记录列表 -->
    <div class="section-title">账单明细</div>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="chip" @click="exportLedger"><Icon name="download" :size="13" /> 导出账单</button>
      <label class="chip" style="cursor:pointer"><Icon name="upload" :size="13" /> 导入账单<input type="file" accept="application/json,.json" style="display:none" @change="importLedger" /></label>
    </div>
    <div v-for="r in monthRecords" :key="r.id" class="glass list-item">
      <span class="avatar" :style="r.type === 'income' ? 'background:rgba(78,150,104,.16);color:var(--eo-good)' : 'background:var(--eo-chip);color:var(--eo-primary-deep)'">
        <Icon :name="r.type === 'income' ? 'coins' : 'wallet'" :size="20" />
      </span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">{{ r.category }}<span v-if="r.note" class="muted" style="font-weight:400;font-size:12px"> · {{ r.note }}</span></div>
        <div class="muted" style="font-size:12px">{{ fmtDay(r.date) }}</div>
      </div>
      <span style="font-weight:700" :style="r.type === 'income' ? 'color:var(--eo-good)' : 'color:var(--eo-bad)'">
        {{ r.type === 'income' ? '+' : '-' }}{{ r.amount.toFixed(2) }}
      </span>
      <button class="ghost-btn" @click="del(r.id)"><Icon name="trash" :size="16" /></button>
    </div>
    <div v-if="!monthRecords.length" class="muted" style="text-align:center;padding:30px">本月暂无记录，点下方「记一笔」开始。</div>

    <button class="btn notes-fab" @click="openAdd"><Icon name="plus" :size="18" /> 记一笔</button>

    <Modal title="记一笔" :show="showAdd" @close="showAdd = false">
      <div class="capsule" style="padding:4px;gap:4px;margin-bottom:12px">
        <button class="btn ghost" :style="form.type === 'expense' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setType('expense')">支出</button>
        <button class="btn ghost" :style="form.type === 'income' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setType('income')">收入</button>
      </div>
      <div class="field"><label>金额</label><input type="number" min="0" step="0.01" v-model="form.amount" placeholder="0.00" /></div>
      <div class="field"><label>分类</label>
        <div class="row wrap" style="gap:6px">
          <button v-for="c in cats" :key="c.name" class="chip" :style="form.category === c.name ? 'background:var(--eo-primary);color:#fff' : ''" @click="form.category = c.name">
            <Icon :name="c.icon || 'tag'" :size="12" /> {{ c.name }}
          </button>
        </div>
      </div>
      <div class="field"><label>日期</label><input type="date" v-model="form.date" /></div>
      <div class="field"><label>备注</label><input v-model="form.note" placeholder="可选" /></div>
      <button class="btn" style="width:100%" @click="save"><Icon name="wallet" :size="16" /> 保存</button>
    </Modal>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.notes-fab { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 96px); z-index: 58; }
@media (min-width: 900px) {
  .notes-fab { left: auto; right: 28px; transform: none; bottom: 28px; }
}
</style>
