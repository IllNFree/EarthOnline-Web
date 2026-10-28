<script setup>
// ===== 双向链接渲染（需求 4 渲染层）：解析 @[Type:ID] 为差异化外观的 Inline Chip =====
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { tokenizeBiLinks, resolveBiLink, BI_LINK_TYPES } from '../lib/bilink.js'
import Icon from './Icon.vue'

const props = defineProps({
  text: { type: String, default: '' }
})
const store = useAppStore()
const router = useRouter()

const tokens = computed(() => tokenizeBiLinks(props.text))
function resolve(t) {
  return resolveBiLink(store.data, t.linkType, t.id)
}
function goto(t) {
  const route = (BI_LINK_TYPES[t.linkType] || {}).route
  if (route) router.push(route)
}
</script>

<template>
  <span class="bilink-text">
    <template v-for="(t, i) in tokens" :key="i">
      <span v-if="t.type === 'text'">{{ t.value }}</span>
      <button
        v-else
        class="bilink-chip"
        :class="'bilink-' + t.linkType"
        :title="resolve(t) ? resolve(t).title : '未找到关联实体'"
        @click="goto(t)"
      >
        <Icon :name="(BI_LINK_TYPES[t.linkType] || {}).icon || 'tag'" :size="13" />
        <span>{{ resolve(t) ? resolve(t).title : '失效关联' }}</span>
      </button>
    </template>
  </span>
</template>

<style scoped>
.bilink-text { line-height: 1.9; }
.bilink-chip {
  display: inline-flex; align-items: center; gap: 4px; vertical-align: baseline;
  padding: 1px 8px; margin: 0 2px; border-radius: 999px; font-size: 13px; font-weight: 600;
  background: var(--eo-chip); color: var(--eo-primary-deep);
  border: 1px solid var(--eo-glass-border);
  transition: transform .14s ease, filter .14s ease;
}
.bilink-chip:hover { filter: brightness(1.05); transform: translateY(-1px); }
.bilink-chip:active { transform: scale(.96); }
.bilink-task { color: var(--eo-primary-deep); }
.bilink-memo { color: var(--eo-accent); }
.bilink-item { color: #6E8BC4; }
.bilink-photo { color: var(--eo-good); }
.bilink-collection { color: var(--eo-bad); }
.bilink-location { color: #B08968; }
</style>
