<script setup>
// 轻量 Markdown 渲染：仅渲染用户自身内容（笔记/任务备注），并做最小净化防止脚本注入。
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps({
  text: { type: String, default: '' },
  isHtml: { type: Boolean, default: false } // Notes 存的是 contenteditable HTML
})

function sanitize(html) {
  // 仅保留基础排版标签，剥离 <script>/<style>/on* 属性与 javascript: 链接
  return String(html)
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

const html = computed(() => {
  const raw = props.isHtml ? props.text : marked.parse(props.text || '', { breaks: true, gfm: true })
  return sanitize(raw)
})
</script>

<template>
  <div class="md" v-html="html"></div>
</template>

<style scoped>
.md { font-size: 14px; line-height: 1.6; color: var(--eo-ink); word-break: break-word; }
.md :deep(p) { margin: 0 0 8px; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { margin: 10px 0 6px; font-size: 15px; font-weight: 700; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.md :deep(li) { margin: 2px 0; }
.md :deep(code) { background: var(--eo-chip); border-radius: 6px; padding: 1px 6px; font-size: 13px; }
.md :deep(pre) { background: var(--eo-chip); border-radius: 10px; padding: 10px; overflow-x: auto; }
.md :deep(pre code) { background: none; padding: 0; }
.md :deep(a) { color: var(--eo-primary-deep); }
.md :deep(blockquote) { border-left: 3px solid var(--eo-primary-soft); margin: 6px 0; padding: 2px 10px; color: var(--eo-ink-soft); }
.md :deep(strong) { color: var(--eo-primary-deep); }
.md :deep(img) { max-width: 100%; border-radius: 10px; }
</style>
