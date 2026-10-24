<script setup>
// 玻璃风格上传组件：点击 / 拖拽上传，替代系统原生文件框触发观感（选择器仍由系统提供）
import { ref } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  label: { type: String, default: '点击或拖拽图片到此处' },
  accept: { type: String, default: 'image/*' },
  icon: { type: String, default: 'image' }
})
const emit = defineEmits(['file'])
const over = ref(false)
const inputRef = ref(null)

function pick() { inputRef.value && inputRef.value.click() }
function onChange(e) {
  const f = e.target.files && e.target.files[0]
  if (f) emit('file', f)
  e.target.value = ''
}
function onDrop(e) {
  over.value = false
  const f = e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) emit('file', f)
}
</script>

<template>
  <div class="up" :class="{ over }" @click="pick" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
    <Icon :name="icon" :size="22" />
    <span class="up__label">{{ label }}</span>
    <input ref="inputRef" type="file" :accept="accept" style="display:none" @change="onChange" />
  </div>
</template>

<style scoped>
.up {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 18px 14px; border-radius: 16px; text-align: center;
  border: 1.5px dashed var(--eo-glass-border); background: var(--eo-glass);
  color: var(--eo-ink-soft); font-size: 13px; cursor: pointer;
  transition: border-color .2s ease, background .2s ease, color .2s ease, transform .2s ease;
}
.up:hover, .up.over { border-color: var(--eo-primary); color: var(--eo-primary-deep); background: var(--eo-chip); transform: translateY(-1px); }
.up.over { box-shadow: 0 0 0 3px rgba(232, 132, 60, .14); }
</style>
