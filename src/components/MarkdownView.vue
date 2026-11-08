<script setup>
// 轻量 Markdown 渲染：仅渲染用户自身内容（笔记/任务备注），并做最小净化防止脚本注入。
// v3.0.2：把正文里的 @[Type:ID] 双向链接渲染成可点 chip，点击就地打开实体预览（不跳页）。
import { computed } from 'vue'
import { marked } from 'marked'
import { usePreview } from '../stores/preview.js'
import { useAppStore } from '../stores/app.js'
import { resolveBiLink, BI_LINK_TYPES } from '../lib/bilink.js'

const props = defineProps({
  text: { type: String, default: '' },
  isHtml: { type: Boolean, default: false } // Notes 存的是 contenteditable HTML
})
const { open } = usePreview()
const store = useAppStore()

function sanitize(html) {
  // 仅保留基础排版标签，剥离 <script>/<style>/on* 属性与 javascript: 链接
  return String(html)
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function chipLabel(type, id) {
  const meta = BI_LINK_TYPES[type]
  let title = ''
  try {
    const r = resolveBiLink(store.data, type, id)
    title = (r && r.title) || ''
  } catch (e) { /* ledger 等容器类型解析不到时回退类型名 */ }
  return esc((meta ? meta.label : type) + (title ? ' · ' + title : ''))
}

const html = computed(() => {
  const raw = props.isHtml ? props.text : marked.parse(props.text || '', { breaks: true, gfm: true })
  const clean = sanitize(raw)
  // 只替换正文里的引用语法；生成内容全部转义，不把用户输入拼进属性
  return clean.replace(/@\[([a-zA-Z]+):([^\]\s<>]+)\]/g, (_, type, id) => {
    const t = String(type).toLowerCase()
    if (!BI_LINK_TYPES[t]) return _
    return '<button type="button" class="md-bilink" data-type="' + esc(t) + '" data-id="' + esc(id) + '">@ ' + chipLabel(t, id) + '</button>'
  })
})

function onChipClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('.md-bilink') : null
  if (!el) return
  e.preventDefault(); e.stopPropagation()
  open(el.dataset.type, el.dataset.id)
}
</script>

<template>
  <div class="md" v-html="html" @click="onChipClick"></div>
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
.md :deep(.md-bilink) {
  display: inline-flex; align-items: center; gap: 3px; font: inherit; font-size: .92em;
  color: var(--eo-primary-deep); background: var(--eo-chip);
  border: 1px solid var(--eo-glass-border); border-radius: 999px;
  padding: 1px 8px; margin: 0 2px; cursor: pointer; vertical-align: baseline;
  transition: transform .12s ease, background .12s ease;
}
.md :deep(.md-bilink:hover) { transform: translateY(-1px); background: rgba(44,44,44,.12); }
</style>
