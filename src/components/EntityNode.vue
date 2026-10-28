<script setup>
// ===== 白板节点：按 entityType 渲染不同外观的便利贴（满血 Haze） =====
// 对应需求 2：全实体节点化 + 节点内的 @[Type:ID] 引用渲染。
import { computed } from 'vue'
import { useAppStore } from '../stores/app.js'
import { parseEntityRefs } from '../services/CanvasNavigator.js'
import Icon from './Icon.vue'

const props = defineProps({
  node: { type: Object, required: true },
  entity: { type: Object, default: null }
})
const emit = defineEmits(['navigate', 'drag-start', 'resize-start', 'menu', 'select'])

const store = useAppStore()
const TYPE_LABEL = {
  task: '任务', memo: '笔记', item: '物品', photo: '照片', collection: '收藏',
  location: '足迹', insight: '洞察', profile: '资料', game: '游戏'
}
const COLORS = {
  amber: 'rgba(245, 233, 218, 0.92)', blue: 'rgba(220, 232, 245, 0.92)',
  pink: 'rgba(245, 222, 232, 0.92)', green: 'rgba(225, 240, 226, 0.92)',
  purple: 'rgba(236, 232, 245, 0.92)', gray: 'rgba(232, 232, 232, 0.92)'
}
const nodeStyle = computed(() => ({
  left: props.node.x + 'px',
  top: props.node.y + 'px',
  width: props.node.w + 'px',
  height: props.node.h + 'px',
  background: COLORS[props.node.color] || COLORS.amber
}))

const refs = computed(() => parseEntityRefs(props.node.text || (props.entity && (props.entity.markdown || props.entity.content)) || ''))

function onNavigate(r) { emit('navigate', r) }
function headerDown(e) { emit('drag-start', e) }
function resizeDown(e) { emit('resize-start', e) }
function onMenu(e) { emit('menu', e) }
function onSelect() { emit('select') }

// 任务内联勾选
function toggleTask() {
  if (props.node.type === 'task' && props.entity) store.toggleTaskDone(props.entity.id)
}
// 迷你图表（洞察节点）：近 6 个月收支（内联 SVG，零额外依赖，避免破坏构建红线）
const chart = computed(() => {
  if (props.node.type !== 'insight') return null
  const recs = store.data.ledger.records || []
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const inc = months.map((mk) => recs.filter((r) => r.type === 'income' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const exp = months.map((mk) => recs.filter((r) => r.type === 'expense' && r.date.startsWith(mk)).reduce((s, r) => s + r.amount, 0))
  const max = Math.max(1, ...inc, ...exp)
  return { months, inc, exp, max }
})
</script>

<template>
  <div
    class="eo-node glass"
    :style="nodeStyle"
    @pointerdown.stop="onSelect"
    @contextmenu.prevent.stop="onMenu">
    <!-- 拖拽手柄 / 头部 -->
    <div class="eo-node-head" @pointerdown.stop="headerDown">
      <span class="eo-node-type">{{ TYPE_LABEL[node.type] || node.type }}</span>
      <span class="eo-node-id">{{ node.id.slice(0, 6) }}</span>
    </div>

    <!-- 内容区（按类型渲染） -->
    <div class="eo-node-body">
      <!-- 任务 -->
      <div v-if="node.type === 'task'" class="nb-task">
        <button class="nb-check" :class="{ done: entity && entity.status === 'done' }" @pointerdown.stop @click.stop="toggleTask">
          <Icon v-if="entity && entity.status === 'done'" name="check" :size="14" />
        </button>
        <div class="nb-task-main">
          <div class="nb-title" :class="{ strike: entity && entity.status === 'done' }">{{ entity ? entity.title : '（任务已删除）' }}</div>
          <div v-if="entity && entity.dueDate" class="nb-sub">截止 {{ entity.dueDate }}{{ entity.dueTime ? ' ' + entity.dueTime : '' }}</div>
        </div>
      </div>

      <!-- 笔记 -->
      <div v-else-if="node.type === 'memo'">
        <div class="nb-title">{{ entity ? entity.title : '（笔记已删除）' }}</div>
        <div class="nb-text">{{ entity ? (entity.markdown || '').slice(0, 120) : node.text }}</div>
      </div>

      <!-- 物品 -->
      <div v-else-if="node.type === 'item'">
        <div class="nb-title">{{ entity ? entity.name : '（物品已删除）' }}</div>
        <div class="nb-sub">×{{ entity ? entity.count : 1 }} · {{ entity && entity.category ? entity.category : '未分类' }}</div>
        <div v-if="entity && entity.cover" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.cover + ')' }"></div>
      </div>

      <!-- 照片 -->
      <div v-else-if="node.type === 'photo'" class="nb-photo">
        <img v-if="entity" :src="entity.dataUrl" alt="" />
        <div v-else class="nb-text">（照片已删除）</div>
      </div>

      <!-- 收藏 / 媒体（音频带播放控件） -->
      <div v-else-if="node.type === 'collection'">
        <div class="nb-title">{{ entity ? entity.title : '（收藏已删除）' }}</div>
        <div v-if="entity && entity.url" class="nb-link">{{ entity.url }}</div>
        <div v-if="entity && entity.fileMeta && entity.fileMeta.mime && entity.fileMeta.mime.startsWith('audio/')" class="nb-audio">
          <audio :src="entity.fileMeta.dataUrl" controls preload="none"></audio>
        </div>
        <div v-else-if="entity && entity.fileMeta && entity.fileMeta.mime && entity.fileMeta.mime.startsWith('image/')" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.fileMeta.dataUrl + ')' }"></div>
        <div v-else-if="entity && entity.cover" class="nb-thumb" :style="{ backgroundImage: 'url(' + entity.cover + ')' }"></div>
      </div>

      <!-- 足迹 -->
      <div v-else-if="node.type === 'location'">
        <div class="nb-title">{{ entity ? entity.name : '（足迹已删除）' }}</div>
        <div class="nb-sub" v-if="entity">{{ entity.lat.toFixed(3) }}, {{ entity.lng.toFixed(3) }}</div>
      </div>

      <!-- 洞察（迷你 SVG 图表） -->
      <div v-else-if="node.type === 'insight'" class="nb-insight">
        <div v-if="chart" class="nb-chart">
          <svg viewBox="0 0 200 80" preserveAspectRatio="none" width="100%" height="100%">
            <g v-for="(m, i) in chart.months" :key="m">
              <rect :x="8 + i * 32" y="70 - (chart.exp[i] / chart.max) * 60" width="10" height="(chart.exp[i] / chart.max) * 60" fill="rgba(255,99,71,.8)" />
              <rect :x="20 + i * 32" y="70 - (chart.inc[i] / chart.max) * 60" width="10" height="(chart.inc[i] / chart.max) * 60" fill="rgba(52,199,89,.8)" />
            </g>
          </svg>
          <div class="nb-chart-cap">近 6 月收支（红支 / 绿收）</div>
        </div>
        <div v-else class="nb-text">暂无数据</div>
      </div>

      <!-- 资料 -->
      <div v-else-if="node.type === 'profile'">
        <div class="nb-title">{{ store.data.profile.name || '未命名旅人' }}</div>
        <div class="nb-text">{{ store.data.profile.signature || '这个人很神秘' }}</div>
      </div>

      <!-- 游戏 / 其他 -->
      <div v-else>
        <div class="nb-title">{{ entity ? (entity.name || '游戏数据') : '游戏数据' }}</div>
        <div class="nb-text">Steam 游戏库节点</div>
      </div>

      <!-- 双向链接引用标签 -->
      <div v-if="refs.length" class="nb-refs">
        <button v-for="(r, i) in refs" :key="i" class="nb-ref" @pointerdown.stop @click.stop="onNavigate(r)">@[{{ r.type }}]</button>
      </div>
    </div>

    <!-- 缩放手柄 -->
    <div class="eo-node-resize" @pointerdown.stop="resizeDown" title="拖拽调整大小"></div>
  </div>
</template>

<style scoped>
.eo-node {
  position: absolute; border-radius: 14px; box-sizing: border-box;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 30px -14px rgba(120, 90, 50, 0.5);
  border: 1px solid var(--eo-glass-border);
  cursor: default; user-select: none; -webkit-user-select: none; touch-action: none;
}
.eo-node-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; cursor: grab; font-size: 11px; font-weight: 700;
  color: #6b5638; border-bottom: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.25);
}
.eo-node-head:active { cursor: grabbing; }
.eo-node-id { font-size: 9px; opacity: 0.5; font-weight: 600; }
.eo-node-body { flex: 1; min-height: 0; padding: 8px 10px; overflow: hidden; font-size: 12px; color: #3a2f22; }
.nb-title { font-weight: 700; font-size: 13px; line-height: 1.3; }
.nb-text { margin-top: 4px; font-size: 11px; line-height: 1.4; opacity: 0.78; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.nb-sub { font-size: 10px; opacity: 0.66; margin-top: 3px; }
.nb-link { font-size: 10px; color: #2b6cb0; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-thumb { margin-top: 6px; height: 46px; border-radius: 8px; background-size: cover; background-position: center; background-color: rgba(0,0,0,.06); }
.nb-photo { height: 100%; }
.nb-photo img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
.nb-task { display: flex; gap: 8px; align-items: flex-start; }
.nb-check { width: 20px; height: 20px; border-radius: 6px; border: 2px solid #b08553; background: transparent; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; }
.nb-check.done { background: #34C759; border-color: #34C759; }
.nb-task-main { flex: 1; min-width: 0; }
.nb-insight { height: 100%; }
.nb-chart { height: calc(100% - 14px); }
.nb-chart svg { display: block; }
.nb-chart-cap { font-size: 9px; opacity: 0.6; text-align: center; }
.nb-audio audio { width: 100%; height: 28px; margin-top: 4px; }
.nb-refs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.nb-ref { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: rgba(123, 111, 168, 0.18); color: #5a4f8a; border: none; cursor: pointer; }
.nb-ref:hover { background: rgba(123, 111, 168, 0.34); }
.strike { text-decoration: line-through; opacity: 0.6; }
.eo-node-resize {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  cursor: nwse-resize; background:
    linear-gradient(135deg, transparent 0 50%, rgba(120,90,50,.5) 50% 60%, transparent 60% 72%, rgba(120,90,50,.5) 72% 82%, transparent 82%);
}
</style>
