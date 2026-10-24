<script setup>
// 全局胶囊半透明输入框组件：统一对齐 Android 端输入框质感。
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  label: { type: String, default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <label class="eo-field">
    <span v-if="label" class="eo-field__label">{{ label }}</span>
    <span class="eo-field__pill capsule">
      <input
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        @input="emit('update:modelValue', $event.target.value)"
      />
    </span>
  </label>
</template>

<style scoped>
.eo-field { display: block; margin: 10px 0; }
.eo-field__label { display: block; font-size: 12px; color: var(--eo-ink-soft); margin-bottom: 6px; }
.eo-field__pill { width: 100%; }
.eo-field__pill input { width: 100%; color: var(--eo-ink); }
</style>
