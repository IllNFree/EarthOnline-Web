<script setup>
// ===== v2.1.0：整月 / 整周日历网格（周一起始）=====
// 纯展示组件：只读任务数据，按日期聚合「分类色条 + 任务名」，不写入任何 store。
// 自适应：格子尺寸完全由容器决定（CSS Grid + 弹性字号）；任务名任何尺寸常显（2026-11-03 用户指定）。
// 2026-11-03 增强：①事件分类色条（同分类全站同色，见 calColors.js）；②今日高亮环；③周视图切换。
import { computed } from 'vue'
import { buildCatColorMap, colorOf } from '../lib/calColors.js'

const props = defineProps({
  // 锚点日期：月视图取 year/month，周视图取所在周
  cursor: { type: Date, required: true },
  view: { type: String, default: 'month' }, // 'month' | 'week'
  tasks: { type: Array, default: () => [] },
  // 历史兼容参数：2026-11-03 起「日期格内任务名」任何尺寸都常显（用户指定不隐藏），
  // compact 仅保留入参不再影响渲染；小格子靠 cqh 弹性字号自然收缩。
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['pick'])

// 周一到周日（需求明确周一起始）
const WD = ['一', '二', '三', '四', '五', '六', '日']

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d)

const todayKey = computed(() => {
  const n = new Date()
  return keyOf(n.getFullYear(), n.getMonth(), n.getDate())
})

// 分类 → 颜色映射（全站一致）
const catMap = computed(() => buildCatColorMap(props.tasks))
const colorOfCat = (cat) => colorOf(catMap.value, cat)

// 按日期聚合：分类色条 + 任务名（带完成态）
const agg = computed(() => {
  const map = {}
  ;(props.tasks || []).forEach((t) => {
    if (!t || !t.dueDate) return
    const k = t.dueDate.length > 10 ? t.dueDate.slice(0, 10) : t.dueDate
    const o = map[k] || (map[k] = { items: [], cats: [], catSet: new Set() })
    const cat = t.category || 'task'
    o.items.push({ title: t.title || '(无标题)', category: cat, done: t.status === 'done' })
    if (!o.catSet.has(cat)) { o.catSet.add(cat); o.cats.push(cat) }
  })
  Object.values(map).forEach((o) => { o.catSet = undefined; o.cats = o.cats.slice(0, 4) })
  return map
})

// 月视图：从当月 1 号所在周的周一开始，铺满 42 格；周视图：锚点所在周 7 天
const cells = computed(() => {
  const y = props.cursor.getFullYear()
  const m = props.cursor.getMonth()
  let start
  if (props.view === 'week') {
    const cur = new Date(y, m, props.cursor.getDate())
    const offset = (cur.getDay() + 6) % 7 // 周一为 0
    start = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - offset)
  } else {
    const first = new Date(y, m, 1)
    const offset = (first.getDay() + 6) % 7
    start = new Date(y, m, 1 - offset)
  }
  const count = props.view === 'week' ? 7 : 42
  const cap = props.view === 'week' ? 4 : 2
  const out = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const k = keyOf(d.getFullYear(), d.getMonth(), d.getDate())
    const a = agg.value[k]
    const items = a ? a.items.slice(0, cap) : []
    const cats = a ? a.cats : []
    out.push({
      key: k,
      dom: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: k === todayKey.value,
      has: !!(a && a.items.length),
      items,
      cats
    })
  }
  return out
})

function pick(c) { emit('pick', c.key) }
</script>

<template>
  <div class="mg" :class="{ 'mg--week': view === 'week' }">
    <div class="mg-wd">
      <span v-for="w in WD" :key="w" class="mg-wd__i">{{ w }}</span>
    </div>
    <div class="mg-grid" :class="{ 'mg-grid--week': view === 'week' }">
      <button
        v-for="c in cells"
        :key="c.key"
        class="mg-cell"
        :class="{ out: !c.inMonth, today: c.isToday, has: c.has }"
        :title="c.key + (c.items.length ? ' · ' + c.items.map(i => i.title).join(' / ') : '')"
        @pointerdown.stop @click.stop="pick(c)">
        <span class="mg-top">
          <span class="mg-dom">{{ c.dom }}</span>
          <span v-if="c.cats.length" class="mg-count">{{ c.items.length }}</span>
        </span>
        <span v-if="c.items.length" class="mg-names">
          <i v-for="(t, i) in c.items" :key="i" :class="{ done: t.done }">{{ t.title }}</i>
        </span>
        <!-- 事件分类色条：同分类全站同色，直观区分任务类型 -->
        <span v-if="c.cats.length" class="mg-bars">
          <i v-for="(cat, i) in c.cats" :key="i" class="mg-bar" :style="{ background: colorOfCat(cat) }"></i>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mg { height: 100%; min-height: 0; display: flex; flex-direction: column; container-type: size; }
.mg-wd { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; flex: none; margin-bottom: 1px; }
.mg-wd__i { text-align: center; font-size: 13px; font-weight: 800; opacity: .6; letter-spacing: .06em; }
.mg-grid {
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 1px;
}
.mg-grid--week { grid-template-rows: minmax(0, 1fr); }
.mg-cell {
  position: relative; min-width: 0; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start;
  gap: 1px; padding: 2px 2px; border: none; border-radius: 6px;
  background: rgba(255, 255, 255, .34);
  color: #2C2C2C; cursor: pointer;
  transition: background .16s ease, transform .16s ease;
  font-family: inherit;
}
.mg-cell:hover { background: rgba(255, 255, 255, .62); }
.mg-cell.out { opacity: .34; }
/* 今日：高亮环（用卡片自身 accent，日历卡为暖琥珀，全站一致） */
.mg-cell.today {
  background: rgba(44, 44, 44, 0.05);
  box-shadow: inset 0 0 0 2px var(--eo-accent, #E2A94F);
}
.mg-top { display: flex; align-items: center; justify-content: center; gap: 3px; width: 100%; flex: none; min-width: 0; }
.mg-dom { font-size: clamp(14px, 6.4cqh, 21px); font-weight: 800; line-height: 1.05; flex: none; }
.mg-cell.today .mg-dom { color: var(--eo-accent, #E2A94F); }
.mg-count {
  font-style: normal; font-size: 8.5px; font-weight: 800; line-height: 1;
  min-width: 13px; height: 13px; padding: 0 3px; border-radius: 99px;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--eo-accent, #2C2C2C) 16%, transparent);
  color: var(--eo-accent-deep, #2C2C2C);
}
/* 格子够大时展示任务名（月视图最多 2 条，周视图 4 条，超出省略） */
.mg-names { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 0; flex: 1; overflow: hidden; }
.mg-names i {
  font-style: normal; font-size: clamp(8px, 3cqh, 12px); line-height: 1.25;
  width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: .78; text-align: left; padding-left: 2px;
}
.mg-names i.done { opacity: .4; text-decoration: line-through; }
/* 事件分类色条：细小圆角色块，一眼区分当天任务类型 */
.mg-bars { display: flex; gap: 2px; width: 100%; flex: none; padding: 0 2px 1px; }
.mg-bar { height: 3px; flex: 1; min-width: 0; border-radius: 99px; opacity: .92; }
</style>
