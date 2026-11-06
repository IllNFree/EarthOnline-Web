<script setup>
// ===== 基础功能页统一页头 =====
// 任务 / 背包 / 笔记 / 相册 / 足迹 / 记账 共用同一套结构与间距：
//   第一行：标题 + 副标题（占位弹性）| 搜索胶囊（固定宽度）| 主操作区
//   第二行：筛选器（横向滚动）| 右侧工具区
// 搜索框、按钮、筛选器的位置与尺寸在所有页面完全一致。
import Icon from './Icon.vue'
import { ref } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  query: { type: String, default: '' },
  placeholder: { type: String, default: '搜索…' },
  searchable: { type: Boolean, default: true }
})

const emit = defineEmits(['update:query', 'enter', 'clear'])

const inputEl = ref(null)
// 供父组件聚焦搜索框（如空状态按钮「搜索一个地点」）
defineExpose({ focus: () => { if (inputEl.value) inputEl.value.focus() } })

function onClear() {
  emit('update:query', '')
  emit('clear')
}
</script>

<template>
  <header class="pg-head">
    <div class="pg-head__top">
      <div class="pg-head__id">
        <h1 class="pg-head__title">{{ title }}</h1>
        <div v-if="subtitle || $slots.sub" class="pg-head__sub">
          <slot name="sub">{{ subtitle }}</slot>
        </div>
      </div>

      <div v-if="searchable" class="pg-head__search search-bar">
        <Icon name="search" :size="16" />
        <input
          ref="inputEl"
          :value="query"
          :placeholder="placeholder"
          @input="emit('update:query', $event.target.value)"
          @keyup.enter="emit('enter')"
        />
        <button v-if="query" class="clear" title="清空" @click="onClear">
          <Icon name="close" :size="13" />
        </button>
      </div>

      <div class="pg-head__actions"><slot name="actions" /></div>
    </div>

    <div v-if="$slots.filters || $slots.tools" class="pg-head__row2">
      <div class="pg-head__filters"><slot name="filters" /></div>
      <div class="pg-head__tools"><slot name="tools" /></div>
    </div>
  </header>
</template>
