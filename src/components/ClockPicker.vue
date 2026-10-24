<script setup>
// 钟表盘时间选择器：点小时 → 点分钟，两步选完（方便快速选择较近时间）
// 展开面板走「内联文档流」而非 absolute 弹层 —— 根治被弹窗 overflow 裁剪/挤压的问题
import { ref, computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const mode = ref('hour')
const open = ref(false)

const hh = computed(() => {
  if (!props.modelValue) return null
  const h = parseInt(props.modelValue.split(':')[0], 10)
  return isNaN(h) ? null : h % 24
})
const mm = computed(() => {
  if (!props.modelValue) return null
  const m = parseInt(props.modelValue.split(':')[1], 10)
  return isNaN(m) ? null : m
})
const display = computed(() => props.modelValue || '--:--')

function pos(i, n, r) {
  const ang = (i / n) * Math.PI * 2 - Math.PI / 2
  return { x: 90 + r * Math.cos(ang), y: 90 + r * Math.sin(ang) }
}
const hourItems = computed(() => Array.from({ length: 12 }, (_, i) => ({ v: i === 0 ? 12 : i, ...pos(i, 12, 64) })))
const minItems = computed(() => Array.from({ length: 12 }, (_, i) => ({ v: i * 5, ...pos(i, 12, 64) })))

function pickHour(v) {
  const m = mm.value || 0
  emit('update:modelValue', String(v).padStart(2, '0') + ':' + String(m).padStart(2, '0'))
  mode.value = 'minute'
}
function pickMin(v) {
  const h = hh.value == null ? 12 : hh.value
  emit('update:modelValue', String(h).padStart(2, '0') + ':' + String(v).padStart(2, '0'))
  open.value = false
  mode.value = 'hour'
}
function clear() { emit('update:modelValue', ''); open.value = false }
</script>

<template>
  <div class="cp">
    <button class="chip" type="button" :style="modelValue ? '' : 'color:var(--eo-ink-soft)'" @click="open = !open">
      <Icon name="clock" :size="13" /> {{ display }}
    </button>
    <!-- 内联展开面板：占位在文档流内，绝不被弹窗裁剪 -->
    <div v-if="open" class="cp-panel glass">
      <div class="row between" style="padding:8px 12px 0">
        <button class="chip" :style="mode === 'hour' ? 'background:var(--eo-primary);color:#fff' : ''" @click="mode = 'hour'">时</button>
        <button class="chip" :style="mode === 'minute' ? 'background:var(--eo-primary);color:#fff' : ''" @click="mode = 'minute'">分</button>
        <button class="chip" @click="clear">清除</button>
      </div>
      <svg width="180" height="180" viewBox="0 0 180 180" style="display:block;margin:0 auto">
        <circle cx="90" cy="90" r="86" fill="rgba(212,163,115,.08)" />
        <circle v-if="hh != null" cx="90" cy="90" r="4" fill="var(--eo-primary)" />
        <line v-if="hh != null" x1="90" y1="90" :x2="90 + 34 * Math.cos(((hh % 12) / 12) * Math.PI * 2 - Math.PI / 2)" :y2="90 + 34 * Math.sin(((hh % 12) / 12) * Math.PI * 2 - Math.PI / 2)" stroke="var(--eo-primary)" stroke-width="3" stroke-linecap="round" />
        <line v-if="mm != null && mode === 'minute'" x1="90" y1="90" :x2="90 + 50 * Math.cos((mm / 60) * Math.PI * 2 - Math.PI / 2)" :y2="90 + 50 * Math.sin((mm / 60) * Math.PI * 2 - Math.PI / 2)" stroke="var(--eo-primary)" stroke-width="2" stroke-linecap="round" opacity=".6" />
        <template v-if="mode === 'hour'">
          <g v-for="it in hourItems" :key="it.v">
            <circle :cx="it.x" :cy="it.y" r="14" :fill="hh === it.v ? 'var(--eo-primary)' : 'transparent'" />
            <text :x="it.x" :y="it.y + 4.5" text-anchor="middle" font-size="14" :fill="hh === it.v ? '#fff' : 'var(--eo-ink)'" style="font-weight:600;cursor:pointer" @click="pickHour(it.v)">{{ it.v }}</text>
          </g>
        </template>
        <template v-else>
          <g v-for="it in minItems" :key="it.v">
            <circle :cx="it.x" :cy="it.y" r="14" :fill="mm === it.v ? 'var(--eo-primary)' : 'transparent'" />
            <text :x="it.x" :y="it.y + 4.5" text-anchor="middle" font-size="13" :fill="mm === it.v ? '#fff' : 'var(--eo-ink)'" style="font-weight:600;cursor:pointer" @click="pickMin(it.v)">{{ it.v }}</text>
          </g>
        </template>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.cp { display: block; width: 100%; }
.cp-panel { border-radius: 18px; padding-bottom: 8px; margin-top: 8px; }
</style>
