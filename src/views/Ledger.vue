<script setup>
// 记账模块：收支记录 / 分类 / 月度概览（含分类环形图）
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { todayStr } from '../lib/model.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/GlassBottomSheet.vue'

const store = useAppStore()
const dialog = useDialogStore()
const route = useRoute()
const showAdd = ref(false)
const form = ref({ type: 'expense', amount: '', category: '', note: '', date: '' })
const amountInput = ref(null)
// 主页速览「记一笔」直达：自动弹开记账窗口并聚焦金额输入框
onMounted(() => {
  if (route.query.add) {
    openAdd()
    nextTick(() => amountInput.value && amountInput.value.focus())
  }
})

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
const kw = ref('')
const shownRecords = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return monthRecords.value
  return monthRecords.value.filter((r) => (r.category || '').toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q))
})
const summary = computed(() => {
  let income = 0, expense = 0
  monthRecords.value.forEach((r) => { if (r.type === 'income') income += r.amount; else expense += r.amount })
  return { income, expense, balance: income - expense }
})
const byCategoryType = ref('expense') // 环形图切换：支出 / 收入
const byCategory = computed(() => {
  const m = {}
  monthRecords.value.forEach((r) => {
    if (r.type !== byCategoryType.value) return
    if (!m[r.category]) m[r.category] = 0
    m[r.category] += r.amount
  })
  return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v)
})
const byCategoryTotal = computed(() => byCategory.value.reduce((s, c) => s + c.v, 0))
// 多巴胺分类配色（高饱和、按分类名确定性取色，保证环形图与列表一致）
const PALETTE = ['#FF6B6B', '#FF9F43', '#FECA57', '#1DD1A1', '#10AC84', '#48DBFB', '#54A0FF', '#5F27CD', '#EE5253', '#00D2D3', '#FF9FF3', '#F368E0']
function catColor(i) { return PALETTE[i % PALETTE.length] }
function catIndexOf(name) {
  let h = 0
  for (let i = 0; i < String(name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % PALETTE.length
}
function catColorOf(name) { return catColor(catIndexOf(name)) }
// 账单列表按分类取色（确定性）
const rowColor = (r) => catColorOf(r.category)
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
// 近 12 个月收支趋势（柱状图，绿=收入 / 红=支出）
const trend = computed(() => {
  const arr = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.getFullYear() + '-' + p2(d.getMonth() + 1)
    let inc = 0, exp = 0
    store.data.ledger.records.forEach((r) => {
      if (r.date.startsWith(key)) { if (r.type === 'income') inc += r.amount; else exp += r.amount }
    })
    arr.push({ key, label: (d.getMonth() + 1) + '月', income: inc, expense: exp })
  }
  return arr
})
const trendMax = computed(() => Math.max(1, ...trend.value.map((m) => Math.max(m.income, m.expense))))
const cats = computed(() => form.value.type === 'income' ? store.data.ledger.incomeCategories : store.data.ledger.expenseCategories)
// 自定义分类：记一笔弹窗内直接添加
const newCat = ref('')
function addCat() {
  const name = String(newCat.value || '').trim()
  if (!name) return
  if (cats.value.some((c) => c.name === name)) { store.showToast('分类已存在'); return }
  cats.value.push({ name, icon: 'tag' })
  form.value.category = name
  newCat.value = ''
  store.persist()
  store.showToast('已添加分类：' + name)
}

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
// 分类管理：自定义支出 / 收入分类（增删）
const catMgr = ref(false)
const catMgrType = ref('expense')
const catNew = ref('')
function catList() { return catMgrType.value === 'income' ? store.data.ledger.incomeCategories : store.data.ledger.expenseCategories }
function addCatMgr() {
  const name = String(catNew.value || '').trim()
  if (!name) return
  if (catList().some((c) => c.name === name)) { store.showToast('分类已存在'); return }
  catList().push({ name, icon: 'tag' })
  catNew.value = ''
  store.persist()
  store.showToast('已添加分类：' + name)
}
function delCat(name) {
  const list = catList()
  const idx = list.findIndex((c) => c.name === name)
  if (idx >= 0) list.splice(idx, 1)
  store.persist()
  store.showToast('已删除分类：' + name)
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
    <div class="page-head">
      <div class="search-bar" style="max-width:240px">
        <Icon name="search" :size="16" />
        <input v-model="kw" placeholder="搜索分类 / 备注…" />
      </div>
      <div class="row" style="gap:8px">
        <button class="add-btn" @click="openAdd"><Icon name="plus" :size="16" /> 记一笔</button>
        <button class="ghost-btn-soft" @click="catMgr = true"><Icon name="tag" :size="16" /> 分类管理</button>
      </div>
    </div>
    <!-- 月度切换 + 概览 -->
    <div class="glass card">
      <div class="row between" style="margin-bottom:10px">
        <button class="btn ghost" style="padding:6px 12px" @click="shiftMonth(-1)"><Icon name="chevron" :size="16" style="transform:rotate(180deg)" /></button>
        <span style="font-weight:700">{{ monthTitle }}</span>
        <button class="btn ghost" style="padding:6px 12px" @click="shiftMonth(1)"><Icon name="chevron" :size="16" /></button>
      </div>
      <div class="led-summary">
        <div class="led-sum-item"><div class="muted" style="font-size:12px">收入</div><div style="font-weight:800;font-size:18px;color:#34C759">+{{ summary.income.toFixed(2) }}</div></div>
        <div class="led-sum-item"><div class="muted" style="font-size:12px">支出</div><div style="font-weight:800;font-size:18px;color:#FF3B30">-{{ summary.expense.toFixed(2) }}</div></div>
        <div class="led-sum-item"><div class="muted" style="font-size:12px">结余</div><div style="font-weight:900;font-size:20px;color:var(--eo-ink)">{{ summary.balance.toFixed(2) }}</div></div>
      </div>
    </div>

    <!-- 分类占比（支出/收入环形图切换）+ 近 12 月收支趋势 -->
    <div class="glass card" style="padding:14px">
      <div class="capsule" style="display:inline-flex;padding:3px;gap:3px;margin-bottom:10px">
        <button class="btn ghost" :style="byCategoryType === 'expense' ? 'background:var(--eo-primary);color:#fff;padding:4px 14px' : 'padding:4px 14px'" @click="byCategoryType = 'expense'">支出占比</button>
        <button class="btn ghost" :style="byCategoryType === 'income' ? 'background:var(--eo-primary);color:#fff;padding:4px 14px' : 'padding:4px 14px'" @click="byCategoryType = 'income'">收入占比</button>
      </div>
      <div class="led-charts">
        <div class="led-donut">
          <svg width="120" height="120" viewBox="0 0 120 120" style="flex:none">
            <circle cx="60" cy="60" r="42" fill="none" stroke="var(--eo-glass-border)" stroke-width="14" />
            <circle v-for="(s, i) in donut" :key="i" cx="60" cy="60" r="42" fill="none"
              :stroke="s.color" stroke-width="14" :stroke-dasharray="s.dasharray" :stroke-dashoffset="s.dashoffset"
              transform="rotate(-90 60 60)" />
            <text x="60" y="58" text-anchor="middle" font-size="19" font-weight="800" fill="var(--eo-ink)">{{ byCategoryTotal.toFixed(0) }}</text>
            <text x="60" y="74" text-anchor="middle" font-size="10" fill="var(--eo-ink-soft)">元</text>
          </svg>
          <div style="min-width:0">
            <div v-for="(c, i) in byCategory.slice(0, 8)" :key="c.name" class="row between" style="padding:3px 0;font-size:13px">
              <span class="row" style="gap:8px"><i :style="{ width: '10px', height: '10px', borderRadius: '3px', background: catColor(i), display: 'inline-block' }"></i>{{ c.name }}</span>
              <span class="muted">{{ c.v.toFixed(2) }} · {{ Math.round(c.v / (byCategoryTotal || 1) * 100) }}%</span>
            </div>
          </div>
        </div>
        <!-- 近 12 个月收支趋势：纯 CSS 柱状图（绿=收入 / 红=支出） -->
        <div class="led-trend">
          <div class="led-trend-cap">近 12 个月收支趋势</div>
          <div class="trend">
            <div v-for="m in trend" :key="m.key" class="trend-m">
              <div class="trend-bars">
                <span class="trend-bar inc" :style="{ height: Math.max(2, m.income / trendMax * 120) + 'px' }" :title="'收入 ' + m.income.toFixed(0) + ' 元'"></span>
                <span class="trend-bar exp" :style="{ height: Math.max(2, m.expense / trendMax * 120) + 'px' }" :title="'支出 ' + m.expense.toFixed(0) + ' 元'"></span>
              </div>
              <div class="trend-lab">{{ m.label }}</div>
            </div>
          </div>
          <div class="trend-legend"><span><i class="dot inc"></i>收入</span><span><i class="dot exp"></i>支出</span></div>
        </div>
      </div>
    </div>

    <!-- 记录列表 -->
    <div class="row between" style="margin-bottom:10px">
      <div class="section-title" style="margin:0">账单明细</div>
      <div class="row" style="gap:8px">
        <button class="btn ghost" style="padding:7px 12px;font-size:13px" @click="exportLedger"><Icon name="download" :size="14" /> 导出</button>
        <label class="btn ghost" style="padding:7px 12px;font-size:13px;cursor:pointer"><Icon name="upload" :size="14" /> 导入<input type="file" accept="application/json,.json" style="display:none" @change="importLedger" /></label>
      </div>
    </div>
    <div class="glass card" style="padding:6px 14px">
      <div v-for="r in shownRecords" :key="r.id" class="led-row">
        <span class="led-cat" :style="'background:' + rowColor(r) + '22' + ';color:' + rowColor(r)">
          <Icon :name="r.type === 'income' ? 'coins' : 'wallet'" :size="20" />
        </span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">{{ r.category }}<span v-if="r.note" class="muted" style="font-weight:400;font-size:12px"> · {{ r.note }}</span></div>
          <div class="muted" style="font-size:12px">{{ fmtDay(r.date) }}</div>
        </div>
        <span class="led-amt" :style="r.type === 'income' ? 'color:#34C759' : 'color:#FF3B30'">
          {{ r.type === 'income' ? '+' : '-' }}{{ r.amount.toFixed(2) }}
        </span>
        <button class="ghost-btn" @click="del(r.id)"><Icon name="trash" :size="16" /></button>
      </div>
    </div>
    <div v-if="!shownRecords.length" class="empty-state">
      <span class="empty-illu"><Icon name="wallet" :size="32" /></span>
      <div class="es-title">本月还没有账单</div>
      <div class="es-sub">点右上角「记一笔」，记录第一笔收支</div>
      <button class="btn" style="margin-top:6px" @click="openAdd"><Icon name="plus" :size="16" /> 记一笔</button>
    </div>

    <Modal title="记一笔" :show="showAdd" @close="showAdd = false">
      <div class="capsule" style="padding:4px;gap:4px;margin-bottom:12px">
        <button class="btn ghost" :style="form.type === 'expense' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setType('expense')">支出</button>
        <button class="btn ghost" :style="form.type === 'income' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setType('income')">收入</button>
      </div>
      <div class="field"><label>金额</label><input ref="amountInput" type="number" min="0" step="0.01" v-model="form.amount" placeholder="0.00" /></div>
      <div class="field"><label>分类</label>
        <div class="row wrap" style="gap:6px">
          <button v-for="c in cats" :key="c.name" class="chip" :style="form.category === c.name ? 'background:var(--eo-primary);color:#fff' : ''" @click="form.category = c.name">
            <Icon :name="c.icon || 'tag'" :size="12" /> {{ c.name }}
          </button>
        </div>
        <div class="row" style="gap:6px;margin-top:8px">
          <input v-model="newCat" placeholder="自定义分类…" style="flex:1" @keyup.enter="addCat" />
          <button class="chip" style="flex:none" @click="addCat"><Icon name="plus" :size="12" /> 添加</button>
        </div>
      </div>
      <div class="field"><label>日期</label><input type="date" v-model="form.date" /></div>
      <div class="field"><label>备注</label><input v-model="form.note" placeholder="可选" /></div>
      <button class="btn" style="width:100%" @click="save"><Icon name="wallet" :size="16" /> 保存</button>
    </Modal>

    <!-- 分类管理 -->
    <Modal title="分类管理" :show="catMgr" @close="catMgr = false">
      <div class="capsule" style="display:inline-flex;padding:3px;gap:3px;margin-bottom:12px">
        <button class="btn ghost" :style="catMgrType === 'expense' ? 'background:var(--eo-primary);color:#fff;padding:4px 14px' : 'padding:4px 14px'" @click="catMgrType = 'expense'">支出分类</button>
        <button class="btn ghost" :style="catMgrType === 'income' ? 'background:var(--eo-primary);color:#fff;padding:4px 14px' : 'padding:4px 14px'" @click="catMgrType = 'income'">收入分类</button>
      </div>
      <div class="row wrap" style="gap:8px;margin-bottom:12px">
        <span v-for="c in catList()" :key="c.name" class="chip" :style="'background:' + catColorOf(c.name) + '22;color:' + catColorOf(c.name) + ';border-color:transparent'">
          <i class="cat-dot" :style="'background:' + catColorOf(c.name)"></i>{{ c.name }}
          <button class="ghost-btn" style="padding:0 0 0 4px" @click="delCat(c.name)"><Icon name="x" :size="13" /></button>
        </span>
      </div>
      <div class="row" style="gap:6px">
        <input v-model="catNew" placeholder="新分类名称…" style="flex:1" @keyup.enter="addCatMgr" />
        <button class="btn" @click="addCatMgr"><Icon name="plus" :size="14" /> 添加</button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.ghost-btn { color: var(--eo-ink-soft); padding: 6px; }
.ghost-btn-soft {
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; font-size: 14px; font-weight: 600;
  color: var(--eo-primary-deep); background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
  backdrop-filter: blur(16px) saturate(165%); -webkit-backdrop-filter: blur(16px) saturate(165%);
  box-shadow: inset 0 1px 0 var(--eo-glass-hi); transition: background .15s ease, transform .2s cubic-bezier(.22,1,.36,1);
}
.ghost-btn-soft:hover { background: var(--eo-chip); transform: translateY(-1px); }
/* 环形图 + 趋势图并排（窄屏堆叠） */
.led-charts { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
.led-donut { display: flex; align-items: center; gap: 18px; }
.led-trend { flex: 1; min-width: 240px; }
.led-trend-cap { font-size: 13px; font-weight: 700; color: var(--eo-ink-soft); margin-bottom: 8px; }
.trend { display: flex; align-items: flex-end; gap: 6px; height: 140px; }
.trend-m { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
.trend-bar { width: 7px; border-radius: 4px 4px 2px 2px; transition: height .3s cubic-bezier(.22,1,.36,1); }
.trend-bar.inc { background: #34C759; }
.trend-bar.exp { background: #FF3B30; }
.trend-lab { font-size: 10px; color: var(--eo-ink-soft); }
.trend-legend { display: flex; gap: 14px; justify-content: flex-end; font-size: 11px; color: var(--eo-ink-soft); margin-top: 6px; }
.trend-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
.trend-legend .dot.inc { background: #34C759; }
.trend-legend .dot.exp { background: #FF3B30; }
@media (max-width: 640px) { .led-charts { flex-direction: column; align-items: stretch; } .led-donut { justify-content: center; } }
.led-summary { display: flex; justify-content: center; gap: 30px; text-align: center; padding: 4px 0; }
.led-summary .led-sum-item { min-width: 78px; }
</style>
