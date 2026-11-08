<script setup>
// ===== v2.1.0 模块四：统一关联面板（含反向索引「被哪些实体引用」）=====
// v3.0.2：关联 chip 改为就地打开实体预览弹窗，不再 router.push 跳功能列表页。
import { computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { usePreview } from '../stores/preview.js'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import Icon from './Icon.vue'

const props = defineProps({
  type: { type: String, required: true },
  id: { type: String, required: true },
  hideOutgoing: { type: Boolean, default: false }
})
const store = useAppStore()
const { open } = usePreview()

const rels = computed(() => store.relatedEntitiesFor(props.type, props.id))
const outgoing = computed(() => rels.value.filter((r) => r.dir === 'out'))
const incoming = computed(() => rels.value.filter((r) => r.dir === 'in'))

function go(r) { open(r.type, r.id) }
</script>

<template>
  <div class="erp">
    <div v-if="!hideOutgoing && outgoing.length" class="erp-row">
      <span class="erp-lab">我关联的</span>
      <button v-for="r in outgoing" :key="'o' + r.type + r.id" class="erp-chip" @click="go(r)">
        <Icon :name="(BI_LINK_TYPES[r.type] || {}).icon || 'tag'" :size="13" />
        {{ r.title }}
      </button>
    </div>
    <div v-if="incoming.length" class="erp-row">
      <span class="erp-lab in">被引用</span>
      <button v-for="r in incoming" :key="'i' + r.type + r.id" class="erp-chip in" @click="go(r)">
        <Icon :name="(BI_LINK_TYPES[r.type] || {}).icon || 'tag'" :size="13" />
        {{ r.title }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.erp { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.erp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.erp-lab { font-size: 11px; font-weight: 700; color: var(--eo-ink-soft); flex: none; padding: 2px 6px; border-radius: 6px; background: var(--eo-chip); }
.erp-lab.in { color: var(--eo-ink); background: rgba(44, 44, 44, 0.1); }
.erp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--eo-ink); background: var(--eo-chip); border: 1px solid var(--eo-glass-border); transition: transform .12s ease; }
.erp-chip:hover { transform: translateY(-1px); }
.erp-chip.in { background: rgba(44, 44, 44, .2); border-color: rgba(44, 44, 44, .45); }
</style>
