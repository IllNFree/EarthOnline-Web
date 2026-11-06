<script setup>
// ===== 右侧属性面板 =====
// 五块：节点 / 脑图布局 / 视觉样式 / 画布偏好 / 空间与媒体。
import { computed, ref, nextTick } from 'vue'
import Icon from '../../components/Icon.vue'
import { PALETTES, paletteById } from '../core/palettes.js'
import { LAYOUT_MODES } from '../core/layouts.js'

const props = defineProps({
  ws: { type: Object, required: true },
  ui: { type: Object, required: true }
})
const emit = defineEmits(['edit', 'layout', 'delete-selected', 'group', 'duplicate', 'fit', 'reset',
  'import-folder', 'import-files', 'import-files-bg', 'new-space', 'enter-space', 'stress', 'toast'])

// 画布设置面板：默认全部收起，展开状态记忆在本地
const OPEN_KEY = 'eo:inspector:sections:v2'
const DEFAULT_OPEN = { node: false, layout: false, style: false, canvas: false, space: false, media: false }
function readOpen() {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    if (raw) return Object.assign({}, DEFAULT_OPEN, JSON.parse(raw))
  } catch (e) { /* 隐私模式 / 脏数据忽略 */ }
  return Object.assign({}, DEFAULT_OPEN)
}
const open = ref(readOpen())
const bgFile = ref(null)
const scrollEl = ref(null)
// 通过工具条「脑图布局」等入口进入时，把面板标题与滚动位置直接对准目标区块
const focusKey = ref('')
const SECTION_LABEL = { node: '节点属性', layout: '脑图布局', style: '视觉样式', canvas: '画布偏好', space: '空间', media: '空间与媒体' }
const titleText = computed(() => {
  if (selectionCount.value) return multiple.value ? '已选 ' + selectionCount.value + ' 项' : '节点属性'
  return focusKey.value ? (SECTION_LABEL[focusKey.value] || '画布设置') : '画布设置'
})
function openSection(key) {
  if (!open.value[key]) toggle(key)
  focusKey.value = key
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    const card = el.querySelector('[data-sec="' + key + '"]')
    if (!card) return
    const top = card.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
    el.scrollTo({ top: Math.max(0, top - 4), behavior: 'smooth' })
  })
}
defineExpose({ openSection })

const selectionCount = computed(() => props.ui.selection.length)
const node = computed(() => (props.ui.selection.length === 1 ? props.ws.nodeById(props.ui.selection[0]) : null))
const multiple = computed(() => props.ui.selection.length > 1)
// 已在组里的卡片不能再「组合」：必须先右键移出组，否则会出现一个卡片属于两个组、
// 旧组变成空壳的脏数据（用户反馈的「已经设置了组的还能设置」）。
const selectedNodes = computed(() => props.ui.selection.map((id) => props.ws.nodeById(id)).filter(Boolean))
const groupedInSelection = computed(() => selectedNodes.value.filter((n) => n.groupId && props.ws.groups[n.groupId]))
const canGroup = computed(() => multiple.value && !groupedInSelection.value.length)
const groupDisabledHint = computed(() => groupedInSelection.value.length ? '所选卡片已在组中，请先右键「移出组」' : '')
const palette = computed(() => {
  if (props.ws.settings.palette === 'custom') {
    return { id: 'custom', name: '自定义', colors: customColors.value }
  }
  return paletteById(props.ws.settings.palette)
})
const selectedChildren = computed(() => {
  const spaces = (props.ws.space.childIds || []).map((id) => props.ws.spaces[id]).filter(Boolean)
  return spaces
})
const stats = computed(() => props.ws.stats())
const customColors = computed(() => {
  if (!props.ws.settings.customColors) props.ws.settings.customColors = ['#2C2C2C', '#C99C8C', '#9DB3A0', '#A8BBCB', '#E8B86D', '#9A9A96']
  return props.ws.settings.customColors
})

function toggle(key) {
  open.value[key] = !open.value[key]
  if (key === focusKey.value && !open.value[key]) focusKey.value = ''
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(open.value)) } catch (e) { /* ignore */ }
}
function updateNode(patch) {
  if (!node.value) return
  props.ws.updateNode(node.value.id, patch)
}
function applyNodeColor(c) {
  if (node.value) updateNode({ color: c })
  else props.ui.stroke.color = c
}
function smartColor() {
  if (!node.value) return
  const p = palette.value
  const idx = Array.from(props.ws.nodes).findIndex((n) => n.id === node.value.id)
  updateNode({ color: p.colors[Math.max(0, idx) % p.colors.length] })
}
function setPalette(id) {
  props.ws.settings.palette = id
  props.ws.touch('palette')
}
function applyPaletteToCanvas() {
  const p = palette.value
  const nodes = props.ws.nodesInSpace
  props.ws.pushUndo()
  nodes.forEach((n, i) => { n.color = p.colors[i % p.colors.length] })
  props.ws.touch('palette:apply')
  emit('toast', '已将「' + p.name + '」应用到当前画布')
}
function setEdgeStyle(type) {
  props.ws.settings.edgeStyle = type
  props.ws.edges.filter((e) => e.spaceId === props.ws.currentId).forEach((e) => {
    e.type = type
    ;[e.fromId, e.toId].forEach((id) => {
      const n = props.ws.nodeById(id)
      if (n) n.edges = (n.edges || []).map((x) => (x.edgeId === e.id ? Object.assign({}, x, { type }) : x))
    })
  })
  props.ws.touch('edge:style')
}
function setBgPattern(pattern) {
  props.ws.settings.background.pattern = pattern
  props.ws.touch('bg')
}
function updateBg(key, value) {
  props.ws.settings.background[key] = value
  props.ws.touch('bg')
}
function onBgFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  emit('import-files-bg', file)
  e.target.value = ''
}
function fmtSize(n) {
  const k = n.media && n.media.size
  if (!k) return ''
  if (k > 1024 * 1024) return (k / 1024 / 1024).toFixed(1) + ' MB'
  return Math.round(k / 1024) + ' KB'
}
function applySpacing() {
  const s = props.ws.settings.spacing
  s.node = Math.max(12, Math.min(120, Number(s.node) || 36))
  s.level = Math.max(32, Math.min(240, Number(s.level) || 88))
  props.ws.touch('spacing')
}
</script>

<template>
  <aside class="inspector" :data-rev="ui.tick">
    <div class="insp-head">
      <div>
        <div class="insp-kicker">INSPECTOR</div>
        <div class="insp-title">{{ titleText }}</div>
      </div>
      <button class="insp-close" title="收起面板" @click="ui.inspector = false"><Icon name="chevron-right" :size="16" /></button>
    </div>

    <div ref="scrollEl" class="insp-scroll">
      <!-- 节点 -->
      <section class="card" v-if="selectionCount">
        <button class="card-head" @click="toggle('node')">
          <span>节点</span><Icon :name="open.node ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.node" class="card-body">
          <div v-if="node" class="node-sum">
            <span class="node-swatch" :style="{ background: node.color || '#CFCABF' }"></span>
            <div class="node-sum-text">
              <div class="node-name">{{ node.title || '未命名节点' }}</div>
              <div class="node-sub">
                <span v-if="node.parentId">子节点 {{ (node.childrenIds || []).length }} 个</span>
                <span v-else>根节点</span>
                <span class="dot-sep">·</span>
                <span>{{ node.kind === 'space' ? '空间卡片' : node.kind === 'image' ? '图片' : node.kind === 'video' ? '视频' : '节点' }}</span>
              </div>
            </div>
          </div>
          <div v-if="multiple" class="multi-note">批量操作会作用于全部选中元素。</div>

          <div class="btn-row" v-if="node">
            <button class="btn primary sm" @click="emit('edit', node.id)"><Icon name="edit" :size="14" />编辑内容</button>
            <button class="btn sm" @click="emit('duplicate')"><Icon name="copy" :size="14" />复制</button>
            <button class="btn sm" @click="emit('group')" :disabled="!canGroup" :title="groupDisabledHint"><Icon name="layout2" :size="14" />组合</button>
          </div>
          <div class="btn-row" v-else>
            <button class="btn sm" @click="emit('duplicate')"><Icon name="copy" :size="14" />复制</button>
            <button class="btn sm" @click="emit('group')" :disabled="!canGroup" :title="groupDisabledHint"><Icon name="layout2" :size="14" />组合 (G)</button>
          </div>

          <div class="field-grid" v-if="node">
            <label class="field"><span>宽度</span><input type="number" :value="Math.round(node.w)" min="120" max="1200" @change="updateNode({ w: Math.max(120, Number($event.target.value) || node.w) })" /></label>
            <label class="field"><span>高度</span><input type="number" :value="Math.round(node.h)" min="64" max="900" @change="updateNode({ h: Math.max(64, Number($event.target.value) || node.h) })" /></label>
          </div>

          <div class="label-row"><span>颜色</span><button class="link" @click="smartColor">智能配色</button></div>
          <div class="swatches">
            <button v-for="c in palette.colors" :key="c" class="swatch" :class="{ on: node && node.color === c }" :style="{ background: c }" @click="applyNodeColor(c)"></button>
            <label class="swatch custom" title="自定义颜色">
              <input type="color" :value="node ? node.color || '#2C2C2C' : ui.stroke.color" @input="applyNodeColor($event.target.value)" />
            </label>
          </div>

          <div class="node-actions" v-if="node">
            <button class="link" v-if="node.kind === 'space' && node.targetSpaceId" @click="emit('enter-space', node.targetSpaceId)">进入空间</button>
            <button class="link danger" @click="emit('delete-selected')">删除节点</button>
          </div>
          <div class="node-actions" v-else>
            <button class="link danger" @click="emit('delete-selected')">删除所选</button>
          </div>
          <div class="meta-line" v-if="node && node.media">{{ node.media.path }} · {{ fmtSize(node) }}</div>
        </div>
      </section>

      <!-- 布局 -->
      <section class="card" data-sec="layout">
        <button class="card-head" @click="toggle('layout')">
          <span>脑图布局</span><Icon :name="open.layout ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.layout" class="card-body">
          <div class="layout-grid">
            <button v-for="m in LAYOUT_MODES" :key="m.id" class="layout-cell" :class="{ on: ui.layoutMode === m.id }" @click="ui.layoutMode = m.id">
              <span class="layout-ico"><Icon :name="m.icon" :size="18" /></span>
              <span class="layout-label">{{ m.label }}</span>
              <span class="layout-hint">{{ m.hint }}</span>
            </button>
          </div>
          <div class="seg">
            <button :class="{ on: ui.layoutScope === 'all' }" @click="ui.layoutScope = 'all'">全局</button>
            <button :class="{ on: ui.layoutScope === 'local' }" @click="ui.layoutScope = 'local'" :disabled="!selectionCount">局部（选中子树）</button>
          </div>
          <label class="slider-row">
            <span>节点间距 <em>{{ ws.settings.spacing.node }}</em></span>
            <input type="range" min="12" max="100" v-model.number="ws.settings.spacing.node" @input="applySpacing" />
          </label>
          <label class="slider-row">
            <span>层级间距 <em>{{ ws.settings.spacing.level }}</em></span>
            <input type="range" min="36" max="200" v-model.number="ws.settings.spacing.level" @input="applySpacing" />
          </label>
          <button class="btn block" @click="emit('layout', ui.layoutMode, ui.layoutScope)">
            <Icon name="sparkles" :size="14" />应用布局
          </button>
          <p class="hint">dagre 驱动，布局后自动重路由连线，减少交叉。</p>
        </div>
      </section>

      <!-- 样式 -->
      <section class="card">
        <button class="card-head" @click="toggle('style')">
          <span>视觉样式</span><Icon :name="open.style ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.style" class="card-body">
          <div class="label-row"><span>主题配色</span><button class="link" @click="applyPaletteToCanvas">应用到画布</button></div>
          <div class="palette-list">
            <button v-for="p in PALETTES" :key="p.id" class="palette-item" :class="{ on: ws.settings.palette === p.id }" @click="setPalette(p.id)">
              <span class="palette-dots">
                <i v-for="c in p.colors.slice(0, 4)" :key="c" :style="{ background: c }"></i>
              </span>
              <span class="palette-name">{{ p.name }}</span>
            </button>
          </div>
          <div class="label-row"><span>自定义预设</span><span class="muted">6 色</span></div>
          <div class="swatches">
            <label v-for="(c, i) in customColors" :key="i" class="swatch custom" :title="'自定义色 ' + (i + 1)">
              <input type="color" v-model="customColors[i]" @input="ws.settings.palette = 'custom'; ws.touch('custom-color')" />
            </label>
          </div>

          <div class="label-row"><span>连线</span><span class="muted">{{ ws.settings.edgeStyle === 'curve' ? '曲线' : ws.settings.edgeStyle === 'straight' ? '直线' : '折线' }}</span></div>
          <div class="seg small">
            <button :class="{ on: ws.settings.edgeStyle === 'curve' }" @click="setEdgeStyle('curve')">曲线</button>
            <button :class="{ on: ws.settings.edgeStyle === 'straight' }" @click="setEdgeStyle('straight')">直线</button>
            <button :class="{ on: ws.settings.edgeStyle === 'orthogonal' }" @click="setEdgeStyle('orthogonal')">折线</button>
          </div>
          <div class="switch-row">
            <span>箭头</span>
            <button class="switch" :class="{ on: ws.settings.arrow }" @click="ws.settings.arrow = !ws.settings.arrow; ws.touch('arrow')"></button>
          </div>

          <div class="label-row"><span>背景图案</span><span class="muted">{{ Math.round(ws.settings.background.opacity * 100) }}%</span></div>
          <div class="seg small">
            <button :class="{ on: ws.settings.background.pattern === 'dots' }" @click="setBgPattern('dots')">圆点</button>
            <button :class="{ on: ws.settings.background.pattern === 'grid' }" @click="setBgPattern('grid')">网格</button>
            <button :class="{ on: ws.settings.background.pattern === 'lines' }" @click="setBgPattern('lines')">线条</button>
            <button :class="{ on: ws.settings.background.pattern === 'none' }" @click="setBgPattern('none')">无</button>
          </div>
          <label class="slider-row">
            <span>透明度</span>
            <input type="range" min="0" max="1" step="0.05" :value="ws.settings.background.opacity" @input="updateBg('opacity', Number($event.target.value))" />
          </label>
          <div class="bg-image-row">
            <button class="btn xs" @click="bgFile && bgFile.click()">自定义背景</button>
            <button class="link danger" v-if="ws.settings.background.image" @click="updateBg('image', '')">移除图片</button>
            <input ref="bgFile" type="file" accept="image/*" hidden @change="onBgFile" />
          </div>

          <div class="switch-row">
            <span>扁平模式</span>
            <button class="switch" :class="{ on: ui.flat }" @click="ui.flat = !ui.flat"></button>
          </div>
          <p class="hint">扁平模式：关闭阴影、毛玻璃与悬浮立体感，界面更「平」、低配设备更流畅（外观不变，只省性能）。</p>
          <div class="switch-row">
            <span>自动配色</span>
            <button class="switch" :class="{ on: ws.settings.autoColor }" @click="ws.settings.autoColor = !ws.settings.autoColor; ws.touch('autocolor')"></button>
          </div>
        </div>
      </section>

      <!-- 画布 -->
      <section class="card">
        <button class="card-head" @click="toggle('canvas')">
          <span>画布偏好</span><Icon :name="open.canvas ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.canvas" class="card-body">
          <div class="switch-row">
            <span>网格吸附</span>
            <button class="switch" :class="{ on: ws.settings.snap }" @click="ws.settings.snap = !ws.settings.snap; ws.touch('snap')"></button>
          </div>
          <div class="switch-row">
            <span>对齐辅助线</span>
            <button class="switch" :class="{ on: ws.settings.guides }" @click="ws.settings.guides = !ws.settings.guides; ws.touch('guides')"></button>
          </div>
          <div class="switch-row">
            <span>迷你地图</span>
            <button class="switch" :class="{ on: ws.settings.minimap }" @click="ws.settings.minimap = !ws.settings.minimap; ws.touch('minimap')"></button>
          </div>
          <div class="btn-row">
            <button class="btn sm" @click="emit('fit')">适应全部</button>
            <button class="btn sm" @click="emit('reset')">重置视口</button>
          </div>
          <div class="stat-grid">
            <div><strong>{{ stats.nodes }}</strong><span>节点</span></div>
            <div><strong>{{ stats.edges }}</strong><span>连线</span></div>
            <div><strong>{{ stats.drawings }}</strong><span>笔画</span></div>
            <div><strong>{{ ws.index.size }}</strong><span>索引</span></div>
          </div>
          <button class="link subtle" @click="emit('stress')">生成 1000 节点压测</button>
        </div>
      </section>

      <!-- 空间 -->
      <section class="card">
        <button class="card-head" @click="toggle('space')">
          <span>空间</span><Icon :name="open.space ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.space" class="card-body">
          <div class="space-name">{{ ws.space.name }}</div>
          <div class="meta-line">{{ selectedChildren.length }} 个子空间 · {{ ws.pathOf(ws.currentId).length }} 层</div>
          <div class="child-list" v-if="selectedChildren.length">
            <button v-for="s in selectedChildren" :key="s.id" class="child-item" @click="emit('enter-space', s.id)">
              <Icon name="folder" :size="14" /><span>{{ s.name }}</span>
              <Icon name="chevron-right" :size="13" class="child-arrow" />
            </button>
          </div>
          <button class="btn block" @click="emit('new-space')"><Icon name="plus" :size="14" />新建子空间</button>
        </div>
      </section>

      <!-- 媒体 -->
      <section class="card">
        <button class="card-head" @click="toggle('media')">
          <span>外部媒体</span><Icon :name="open.media ? 'chevup' : 'chevdown'" :size="14" />
        </button>
        <div v-if="open.media" class="card-body">
          <div class="btn-row">
            <button class="btn sm flex" @click="emit('import-folder')"><Icon name="folder" :size="14" />文件夹</button>
            <button class="btn sm flex" @click="emit('import-files')"><Icon name="upload" :size="14" />文件</button>
          </div>
          <p class="hint">支持拖拽文件夹到画布，递归扫描最深 5 层；图片与视频会生成媒体节点。</p>
          <div class="progress" v-if="ui.mediaProgress">
            <div class="progress-bar"><i :style="{ width: (ui.mediaProgress.done / Math.max(1, ui.mediaProgress.total)) * 100 + '%' }"></i></div>
            <span>{{ ui.mediaProgress.label || ('缩略图 ' + ui.mediaProgress.done + '/' + ui.mediaProgress.total) }}</span>
          </div>
        </div>
      </section>

      <div class="insp-foot">
        <span>Canvas 2D · 四叉树裁剪</span>
        <span>{{ Math.round(ws.space.camera.s * 100) }}%</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  position: absolute; right: 16px; top: 68px; bottom: 16px; width: 292px; z-index: 19;
  display: flex; flex-direction: column;
  background: var(--sp-card); border: 1px solid var(--sp-line);
  border-radius: 18px; box-shadow: 0 26px 60px -34px rgba(0,0,0,0.38);
  backdrop-filter: blur(12px); overflow: hidden;
}
.insp-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 15px 16px 10px; }
.insp-kicker { font-size: 9px; font-weight: 800; letter-spacing: .2em; color: var(--sp-ink-3); }
.insp-title { font-size: 15px; font-weight: 700; color: var(--sp-ink); margin-top: 3px; }
.insp-close { color: var(--sp-ink-3); padding: 4px; border-radius: 7px; }
.insp-close:hover { background: var(--sp-fill); color: var(--sp-ink); }
.insp-scroll { flex: 1; overflow-y: auto; padding: 0 12px 14px; scrollbar-width: thin; scrollbar-gutter: stable; }
.card { background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
.card-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 11px 12px; font-size: 11.5px; font-weight: 700; color: var(--sp-ink); letter-spacing: .04em; }
.card-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--sp-line); }
.card-body { padding: 2px 12px 12px; }
.node-sum { display: flex; gap: 9px; align-items: center; padding: 6px 0 8px; }
.node-swatch { width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--sp-line); flex: none; }
.node-sum-text { min-width: 0; }
.node-name { font-size: 12.5px; font-weight: 700; color: var(--sp-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-sub { font-size: 10px; color: var(--sp-ink-3); margin-top: 2px; }
.dot-sep { margin: 0 4px; }
.multi-note { font-size: 10.5px; color: var(--sp-ink-3); padding: 2px 0 8px; }
.btn-row { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--sp-ink-1); background: var(--sp-fill); transition: background .14s ease; }
.btn:hover { background: var(--sp-fill-2); color: var(--sp-ink); }
.btn.sm { padding: 6px 9px; }
.btn.xs { padding: 5px 8px; font-size: 10.5px; }
.btn.block { width: 100%; background: var(--eo-primary); color: #FFFFFF; margin-top: 8px; }
.btn.block:hover { filter: brightness(.96); }
.btn.flex { flex: 1; }
.btn.primary { background: var(--eo-primary); color: #FFFFFF; }
.btn.primary:hover { filter: brightness(.96); }
.btn:disabled { opacity: .45; cursor: default; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0 4px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: var(--sp-ink-3); }
.field input { width: 100%; padding: 6px 8px; border: 1px solid var(--sp-line); border-radius: 7px; font-size: 11.5px; color: var(--sp-ink); background: var(--sp-field); outline: none; }
.field input:focus { border-color: var(--sp-ink-3); }
.label-row { display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; color: var(--sp-ink-2); margin: 10px 0 6px; }
.link { font-size: 10.5px; font-weight: 600; color: var(--sp-ink-2); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--sp-line); }
.link:hover { color: var(--sp-ink); }
.link.danger { color: #A05A4C; }
:global([data-theme='dark'] .link.danger) { color: #E08A78; }
.link.subtle { display: block; margin-top: 10px; color: var(--sp-ink-3); }
.muted { color: var(--sp-ink-3); font-size: 10px; }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.swatch { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--sp-line); position: relative; }
.swatch.on { box-shadow: 0 0 0 2px var(--sp-ink); }
.swatch.custom { overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: conic-gradient(#E8B86D, #9DB3A0, #A8BBCB, #D3A6A6, #E8B86D); }
.swatch.custom input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.node-actions { display: flex; gap: 12px; margin-top: 10px; }
.meta-line { font-size: 10px; color: var(--sp-ink-3); margin-top: 6px; word-break: break-all; }
.layout-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.layout-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 8px 9px; border: 1px solid var(--sp-line); border-radius: 9px; background: var(--sp-field); text-align: left; }
.layout-cell:hover { border-color: var(--sp-ink-3); }
.layout-cell.on { background: var(--eo-primary); border-color: var(--eo-primary); }
.layout-cell.on .layout-ico, .layout-cell.on .layout-label, .layout-cell.on .layout-hint { color: #FFFFFF; }
.layout-ico { color: var(--sp-ink-2); }
.layout-label { font-size: 11px; font-weight: 700; color: var(--sp-ink); margin-top: 3px; }
.layout-hint { font-size: 9px; color: var(--sp-ink-3); }
.layout-cell.on .layout-hint { opacity: .6; }
.seg { display: flex; gap: 3px; background: var(--sp-fill); padding: 3px; border-radius: 8px; margin: 10px 0 2px; }
.seg button { flex: 1; padding: 5px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600; color: var(--sp-ink-2); }
.seg button.on { background: var(--sp-card); color: var(--sp-ink); box-shadow: 0 1px 3px rgba(0,0,0,0.10); }
.seg.small { margin: 6px 0 4px; }
.seg button:disabled { opacity: .4; }
.slider-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; font-size: 10.5px; color: var(--sp-ink-2); }
.slider-row em { font-style: normal; color: var(--sp-ink); font-weight: 700; }
.slider-row input[type=range] { flex: 1; max-width: 130px; accent-color: var(--sp-ink); }
.hint { font-size: 9.5px; line-height: 1.6; color: var(--sp-ink-3); margin: 6px 0 0; }
.palette-list { display: flex; gap: 5px; flex-wrap: wrap; }

@media (max-width: 899px) {
  .inspector {
    left: 0; right: 0; top: auto; bottom: 0; width: 100%; height: 68vh;
    border-radius: 18px 18px 0 0; z-index: 30;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 70px);
  }
}
.palette-item { display: flex; align-items: center; gap: 6px; padding: 5px 7px 5px 5px; border: 1px solid var(--sp-line); border-radius: 999px; background: var(--sp-field); }
.palette-item.on { border-color: var(--eo-primary); box-shadow: 0 0 0 1px var(--eo-primary) inset; }
.palette-dots { display: flex; }
.palette-dots i { width: 9px; height: 9px; border-radius: 50%; margin-left: -2px; border: 1px solid var(--sp-line); }
.palette-dots i:first-child { margin-left: 0; }
.palette-name { font-size: 10px; color: var(--sp-ink-1); }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 11px; color: var(--sp-ink-1); border-top: 1px solid var(--sp-line); }
.switch { width: 30px; height: 18px; border-radius: 999px; background: var(--sp-track); position: relative; transition: background .16s ease; flex: none; }
.switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0,0,0,0.18); transition: left .16s ease; }
.switch.on { background: var(--eo-primary); }
.switch.on::after { left: 15px; }
.bg-image-row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 10px 0 2px; }
.stat-grid div { background: var(--sp-fill); border-radius: 8px; padding: 7px 6px; text-align: center; }
.stat-grid strong { display: block; font-size: 13px; color: var(--sp-ink); }
.stat-grid span { font-size: 9px; color: var(--sp-ink-3); }
.space-name { font-size: 12px; font-weight: 700; color: var(--sp-ink); }
.child-list { margin: 8px 0; display: flex; flex-direction: column; gap: 3px; }
.child-item { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 7px; font-size: 11px; color: var(--sp-ink-1); background: var(--sp-fill); }
.child-item:hover { background: var(--sp-fill-2); }
.child-arrow { margin-left: auto; color: var(--sp-ink-3); }
.progress { margin-top: 8px; }
.progress-bar { height: 4px; border-radius: 99px; background: var(--sp-track); overflow: hidden; margin-bottom: 4px; }
.progress-bar i { display: block; height: 100%; background: var(--eo-primary); transition: width .2s ease; }
.progress span { font-size: 9.5px; color: var(--sp-ink-3); }
.insp-foot { display: flex; justify-content: space-between; padding: 12px 6px 4px; font-size: 9px; color: var(--sp-ink-3); letter-spacing: .05em; }
.insp-scroll::-webkit-scrollbar { width: 5px; }
.insp-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--sp-ink) 14%, transparent); border-radius: 99px; }
</style>
