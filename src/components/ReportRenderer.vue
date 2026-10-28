<script setup>
// ===== 年度人生报告渲染（需求 2）：Vico 风格图表 + 满血 Haze =====
// 零依赖：使用原生 SVG 绘制趋势图（满血 backdrop-filter，不降级为纯色）。
import { computed } from 'vue'
import { TOKENS } from '../lib/design-tokens.js'

const props = defineProps({
  report: { type: Object, required: true }
})

const title = computed(() => props.report.title || '人生报告')
const summary = computed(() => props.report.summary || '')
const trends = computed(() => Array.isArray(props.report.trends) ? props.report.trends : [])
const letter = computed(() => props.report.letter || '')

// 为每条趋势生成 SVG 折线 + 面积路径（统一坐标系）
function pathOf(points) {
  const vals = points.map((p) => Number(p.value) || 0)
  if (!vals.length) return { line: '', area: '', max: 0, min: 0, last: 0 }
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const span = max - min || 1
  const W = 280
  const H = 90
  const step = vals.length > 1 ? W / (vals.length - 1) : 0
  const coords = vals.map((v, i) => [i * step, H - ((v - min) / span) * (H - 12) - 6])
  const line = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ')
  const area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z'
  return { line, area, max, min, last: vals[vals.length - 1] }
}
function gradientId(i) { return 'eo-rg-' + i }
</script>

<template>
  <div class="report glass glass-strong">
    <div class="report__head">
      <div class="report__title">{{ title }}</div>
      <div v-if="summary" class="report__summary">{{ summary }}</div>
    </div>

    <div class="report__charts">
      <div v-for="(t, i) in trends" :key="i" class="report__chart glass">
        <div class="report__chart-head">
          <span class="report__chart-label">{{ t.label }}</span>
          <span class="report__chart-val">{{ pathOf(t.points).last }}<span class="report__unit">{{ t.unit || '' }}</span></span>
        </div>
        <svg class="report__svg" viewBox="0 0 280 90" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient :id="gradientId(i)" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" :stop-color="TOKENS.primary" stop-opacity="0.42" />
              <stop offset="100%" :stop-color="TOKENS.primary" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="pathOf(t.points).area" :fill="'url(#' + gradientId(i) + ')'" />
          <path :d="pathOf(t.points).line" fill="none" :stroke="TOKENS.primaryDeep" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <div class="report__chart-foot">
          <span class="faint">峰值 {{ pathOf(t.points).max }}{{ t.unit || '' }}</span>
          <span v-if="t.points.length" class="faint">{{ t.points[0].date }} → {{ t.points[t.points.length - 1].date }}</span>
        </div>
      </div>
    </div>

    <div v-if="letter" class="report__letter glass">
      <div class="report__letter-tag"><span class="empty-illu" style="margin:0;width:34px;height:34px;border-radius:11px"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16v14H4z"/><path d="M4 7l8 6 8-6"/></svg></span> AI 年度信</div>
      <p class="report__letter-text">{{ letter }}</p>
    </div>
  </div>
</template>

<style scoped>
.report { padding: 22px; border-radius: var(--eo-radius); margin-bottom: 16px; }
.report__title { font-size: 22px; font-weight: 800; color: var(--eo-ink); }
.report__summary { margin-top: 8px; font-size: 14px; line-height: 1.7; color: var(--eo-ink-soft); }
.report__charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 18px 0; }
.report__chart { padding: 14px; border-radius: var(--eo-radius-sm); }
.report__chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.report__chart-label { font-size: 13px; font-weight: 700; color: var(--eo-primary-deep); }
.report__chart-val { font-size: 20px; font-weight: 800; color: var(--eo-ink); font-variant-numeric: tabular-nums; }
.report__unit { font-size: 12px; font-weight: 600; color: var(--eo-ink-soft); margin-left: 2px; }
.report__svg { width: 100%; height: 90px; margin: 8px 0 4px; display: block; }
.report__chart-foot { display: flex; justify-content: space-between; font-size: 11px; }
.report__letter { padding: 18px; border-radius: var(--eo-radius-sm); margin-top: 6px; }
.report__letter-tag { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--eo-primary-deep); margin-bottom: 10px; }
.report__letter-text { font-size: 14px; line-height: 1.8; color: var(--eo-ink); white-space: pre-wrap; margin: 0; }
</style>
