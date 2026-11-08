<script setup>
// ===== 实体就地预览弹窗（v3.0.2）=====
// 统一承载「关联 chip / 笔记 @ 引用 / 画布关联角标」的点击结果：居中玻璃弹窗，绝不跳页。
// 关联列表里的 chip 可继续点开（带返回栈），底部次要按钮只把相机定位到画布节点。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { usePreview } from '../stores/preview.js'
import { BI_LINK_TYPES } from '../lib/bilink.js'
import GlassBottomSheet from './GlassBottomSheet.vue'
import MarkdownView from './MarkdownView.vue'
import Icon from './Icon.vue'
import { nodesForEntity } from '../space/core/entityRefs.js'

const { state, open, back, close } = usePreview()
const store = useAppStore()
const route = useRoute()
const router = useRouter()

const TYPE_LABEL = {
  task: '任务', memo: '笔记', photo: '照片', ledger: '账目',
  item: '物品', collection: '合集', location: '足迹'
}

function tagsOf(rec) {
  const t = rec && rec.tags
  if (Array.isArray(t)) return t.filter(Boolean)
  if (typeof t === 'string') return t.split(/[,，\s]+/).filter(Boolean)
  return []
}

const entity = computed(() => {
  const cur = state.current
  if (!cur) return null
  const d = store.data
  const alive = (arr, id) => (Array.isArray(arr) ? arr : []).find((x) => x && x.id === id && !x.deletedAt)
  let rec = null
  if (cur.type === 'photo') rec = alive(d.photos, cur.id)
  else if (cur.type === 'task') rec = alive(d.tasks, cur.id)
  else if (cur.type === 'memo') rec = alive(d.memos, cur.id)
  else if (cur.type === 'item') rec = alive(d.items, cur.id)
  else if (cur.type === 'collection') rec = alive(d.collections, cur.id)
  else if (cur.type === 'location') rec = alive(d.locations, cur.id)
  else if (cur.type === 'ledger') rec = alive(d.ledger && d.ledger.records, cur.id)
  if (!rec) return { type: cur.type, missing: true, title: '实体不存在或已删除', fields: [], tags: [] }

  const fields = []
  const push = (k, v) => { if (v !== undefined && v !== null && v !== '') fields.push({ k, v: String(v) }) }
  const type = cur.type
  let title = TYPE_LABEL[type] || '实体'
  let photoSrc = ''
  let bodyHtml = ''

  if (type === 'photo') {
    title = rec.name || '未命名照片'
    photoSrc = rec.dataUrl || ''
    push('分类', rec.category)
    push('添加于', rec.createdAt)
  } else if (type === 'task') {
    title = rec.title || '未命名任务'
    push('状态', rec.done ? '已完成' : '进行中')
    push('分类', rec.category)
    push('截止', rec.due || rec.dueDate)
    push('备注', rec.note || rec.remark)
  } else if (type === 'memo') {
    title = rec.title || '未命名笔记'
    bodyHtml = rec.markdown || rec.html || ''
    push('更新于', rec.updatedAt || rec.createdAt)
  } else if (type === 'ledger') {
    title = (rec.type === 'income' ? '收入 ' : '支出 ') + (rec.amount ?? '') + ' 元'
    push('分类', rec.category)
    push('日期', rec.date || rec.createdAt)
    push('备注', rec.note || rec.remark)
  } else if (type === 'item') {
    title = rec.name || '未命名物品'
    push('分类', rec.category)
    push('备注', rec.note || rec.remark)
  } else if (type === 'collection') {
    title = rec.title || '未命名合集'
    push('备注', rec.note || rec.remark)
  } else if (type === 'location') {
    title = rec.name || '未命名足迹'
    push('地址', rec.address)
    push('经纬度', (rec.lng != null && rec.lat != null) ? rec.lng + ', ' + rec.lat : '')
  }
  return { type, title, fields, tags: tagsOf(rec), photoSrc, bodyHtml, missing: false }
})

const rels = computed(() => {
  const cur = state.current
  return cur ? store.relatedEntitiesFor(cur.type, cur.id) : []
})

function focusInCanvas() {
  const cur = state.current
  if (!cur) return
  const g = window.__eoSpace
  const nodes = (g && g.ws) ? nodesForEntity(g.ws, cur.type, cur.id) : []
  if (!nodes.length) { store.showToast('画布上暂无该实体的卡片'); return }
  const n = nodes[0]
  const cam = g.ws.space.camera
  cam.x = n.x + n.w / 2
  cam.y = n.y + n.h / 2
  cam.s = Math.max(cam.s || 1, 0.85)
  g.ui.selection = [n.id]
  g.ui.tick++
  g.ws.touch('node:focus')
  close()
  // 从详情页调用时回画布（不跳实体详情页，仅定位）
  if (route.name !== 'home') router.push('/')
}
</script>

<template>
  <Teleport to="body">
    <GlassBottomSheet :show="state.show" :title="(TYPE_LABEL[state.current?.type] || '实体') + ' · 预览'" @close="close">
      <div v-if="entity" class="epd">
        <div class="epd-head">
          <button v-if="state.stack.length" class="epd-back" title="返回上一个实体" @click="back">
            <Icon name="chevron-left" :size="14" /> 返回
          </button>
          <h4 class="epd-title">{{ entity.title }}</h4>
          <span class="epd-type">{{ TYPE_LABEL[entity.type] || entity.type }}</span>
        </div>

        <div v-if="entity.missing" class="epd-missing">该记录可能已被删除或来自其他设备。</div>

        <template v-else>
          <div v-if="entity.photoSrc" class="epd-photo"><img :src="entity.photoSrc" :alt="entity.title" /></div>
          <div v-if="entity.fields.length" class="epd-fields">
            <div v-for="f in entity.fields" :key="f.k" class="epd-field">
              <span class="epd-k">{{ f.k }}</span><span class="epd-v">{{ f.v }}</span>
            </div>
          </div>
          <div v-if="entity.tags.length" class="epd-tags">
            <span v-for="t in entity.tags" :key="t" class="epd-tag">{{ t }}</span>
          </div>
          <div v-if="entity.bodyHtml" class="epd-body"><MarkdownView :text="entity.bodyHtml" is-html /></div>
        </template>

        <div class="epd-rel">
          <div class="epd-rel-lab">关联内容 <span>{{ rels.length }}</span></div>
          <div v-if="rels.length" class="epd-rel-list">
            <button v-for="(r, i) in rels" :key="r.type + r.id + i" class="epd-chip" :class="{ in: r.dir === 'in' }"
              @click="open(r.type, r.id)">
              <Icon :name="(BI_LINK_TYPES[r.type] || {}).icon || 'tag'" :size="12" />
              {{ r.title }}
            </button>
          </div>
          <div v-else class="epd-empty">暂无关联</div>
        </div>

        <div class="epd-foot">
          <button class="epd-locate" @click="focusInCanvas">
            <Icon name="map-pin" :size="14" /> 在画布中定位
          </button>
          <button class="epd-close" @click="close">关闭</button>
        </div>
      </div>
    </GlassBottomSheet>
  </Teleport>
</template>

<style scoped>
.epd { width: min(78vw, 520px); max-height: 72vh; overflow: auto; padding-right: 2px; }
.epd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.epd-title { margin: 0; font-size: 17px; font-weight: 700; color: var(--eo-ink); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.epd-type { flex: none; font-size: 11px; font-weight: 700; color: var(--eo-ink-soft); background: var(--eo-chip); border-radius: 999px; padding: 3px 9px; }
.epd-back { flex: none; display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--eo-ink-soft); background: transparent; border: none; cursor: pointer; padding: 3px 5px; border-radius: 7px; }
.epd-back:hover { background: var(--eo-chip); color: var(--eo-ink); }
.epd-photo { width: 100%; max-height: 280px; border-radius: 12px; overflow: hidden; background: var(--eo-chip); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; }
.epd-photo img { width: 100%; max-height: 280px; object-fit: contain; display: block; }
.epd-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 14px; margin-bottom: 10px; }
.epd-field { display: flex; gap: 8px; font-size: 13px; min-width: 0; }
.epd-k { flex: none; width: 46px; color: var(--eo-ink-soft); }
.epd-v { color: var(--eo-ink); font-weight: 600; word-break: break-all; }
.epd-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.epd-tag { font-size: 11px; color: var(--eo-ink-soft); background: var(--eo-chip); border-radius: 999px; padding: 3px 9px; }
.epd-body { font-size: 13px; color: var(--eo-ink); background: var(--eo-chip); border-radius: 10px; padding: 10px 12px; max-height: 220px; overflow: auto; margin-bottom: 12px; }
.epd-missing { font-size: 13px; color: var(--eo-ink-soft); padding: 18px 0; }
.epd-rel { border-top: 1px solid var(--eo-glass-border); padding-top: 10px; margin-bottom: 12px; }
.epd-rel-lab { font-size: 12px; font-weight: 700; color: var(--eo-ink-soft); margin-bottom: 8px; }
.epd-rel-lab span { color: var(--eo-ink); }
.epd-rel-list { display: flex; flex-wrap: wrap; gap: 6px; }
.epd-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--eo-ink); background: var(--eo-chip); border: 1px solid var(--eo-glass-border); border-radius: 999px; padding: 4px 10px; cursor: pointer; transition: transform .12s ease; }
.epd-chip:hover { transform: translateY(-1px); }
.epd-chip.in { background: rgba(44,44,44,.08); }
.epd-empty { font-size: 12px; color: var(--eo-ink-soft); }
.epd-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.epd-locate { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--eo-ink); background: var(--eo-chip); border: 1px solid var(--eo-glass-border); border-radius: 9px; padding: 7px 12px; cursor: pointer; }
.epd-locate:hover { background: rgba(44,44,44,.1); }
.epd-close { font-size: 12px; color: var(--eo-ink-soft); background: transparent; border: none; cursor: pointer; padding: 7px 10px; }
</style>
