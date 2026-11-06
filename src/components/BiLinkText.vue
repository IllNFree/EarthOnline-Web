<script setup>
// ===== 双向链接渲染（需求 4 渲染层）：解析 @[Type:ID] 为差异化外观的 Inline Chip =====
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { tokenizeBiLinks, resolveBiLink, BI_LINK_TYPES } from '../lib/bilink.js'
import { gotoEntity } from '../services/CanvasNavigator.js'
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
  // 模块四：点击关联标签 → 穿梭回画布对应节点（画布激活则聚焦，否则跳回画布并定位）
  gotoEntity({ type: t.linkType, id: t.id, router })
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
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.bilink-chip:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.bilink-chip:active { transform: translateY(-1px); }
.bilink-task { color: var(--eo-primary-deep); }
.bilink-memo { color: var(--eo-accent); }
.bilink-item { color: #C4C2BC; }
.bilink-photo { color: var(--eo-ink-soft); }
.bilink-collection { color: var(--eo-ink-soft); }
.bilink-location { color: #8C8C8C; }
</style>
