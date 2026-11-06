<script setup>
// ===== 通用虚拟滚动容器（模块一：长列表性能优化）=====
// 仅渲染视口内可见行，适合行高固定的长列表（如 Todo 表格）。
import { ref, computed } from 'vue'
const props = defineProps({
  items: { type: Array, default: () => [] },
  itemHeight: { type: Number, default: 48 },
  gap: { type: Number, default: 8 },
  height: { type: Number, default: 560 }
})
const scrollTop = ref(0)
const rowStride = computed(() => props.itemHeight + props.gap)
const visibleCount = computed(() => Math.ceil(props.height / rowStride.value) + 3)
const startIdx = computed(() => Math.max(0, Math.floor(scrollTop.value / rowStride.value) - 1))
const endIdx = computed(() => Math.min(props.items.length, startIdx.value + visibleCount.value))
const visible = computed(() => props.items.slice(startIdx.value, endIdx.value).map((it, i) => ({ it, index: startIdx.value + i })))
const offsetY = computed(() => startIdx.value * rowStride.value)
const totalHeight = computed(() => props.items.length * rowStride.value)
function onScroll(e) { scrollTop.value = e.target.scrollTop }
</script>

<template>
  <div class="vlist" :style="{ height: height + 'px' }" @scroll="onScroll">
    <div class="vlist-phantom" :style="{ height: totalHeight + 'px' }"></div>
    <div class="vlist-content" :style="{ transform: 'translateY(' + offsetY + 'px)' }">
      <div v-for="v in visible" :key="v.index" class="vlist-row" :style="{ height: itemHeight + 'px', marginBottom: gap + 'px' }">
        <slot :item="v.it" :index="v.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist { position: relative; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.vlist-phantom { width: 1px; }
.vlist-content { position: absolute; top: 0; left: 0; right: 0; }
.vlist-row { box-sizing: border-box; }
</style>
