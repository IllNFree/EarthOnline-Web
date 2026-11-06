<script setup>
// ===== 全局图标组件（开源图标库驱动） =====
// 资源来源：@microsnow/iconhub（linear 风格）+ humbleicons，由 tools/gen_icon_map.mjs 编译为
// src/lib/iconSvg.js 的语义映射。统一规格：24×24 网格 / stroke 1.5 / 圆头圆角 / currentColor，
// 因此图标天然跟随所在容器的文字颜色，天然支持浅色·深色主题。
// 重新生成：npm run icons:map
import { computed } from 'vue'
import { ICON_SVG } from '../lib/iconSvg.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 22 }
})

// 未登记的语义名回落到通用星形（避免出现空图标）
const inner = computed(() => ICON_SVG[props.name] || ICON_SVG.spark || '')
</script>

<template>
  <svg
    :width="size" :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="inner"
  />
</template>
