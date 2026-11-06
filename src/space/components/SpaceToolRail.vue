<script setup>
// ===== 左侧工具轨 =====
// 导航 / 新建 / 布局 / 绘画 / 形状 / 媒体 六个入口，悬浮时展开画笔与形状面板。
// 快捷键提示与键盘映射共用一份定义（数字键 1-9,0）。
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Icon from '../../components/Icon.vue'

const props = defineProps({ ui: { type: Object, required: true } })
const emit = defineEmits(['tool', 'new-note', 'open-layout', 'tidy', 'media', 'ai'])

const panel = ref(null)
const root = ref(null)

const BRUSHES = [
  { id: 'ballpoint', label: '圆珠笔', key: '1' },
  { id: 'fountain', label: '钢笔', key: '2' },
  { id: 'pencil', label: '铅笔', key: '3' },
  { id: 'highlighter', label: '荧光笔', key: '4' },
  { id: 'laser', label: '激光笔', key: '5' }
]
const SHAPES = [
  { id: 'line', label: '直线', key: '6', icon: 'arrow' },
  { id: 'rect', label: '矩形', key: '7', icon: 'square' },
  { id: 'circle', label: '圆形', key: '8', icon: 'dot' },
  { id: 'scalpel', label: '柳叶刀', key: '9', icon: 'star' },
  { id: 'eraser', label: '橡皮擦', key: '0', icon: 'trash' }
]
const brushIds = BRUSHES.map((b) => b.id)
const shapeIds = SHAPES.map((s) => s.id)
const drawActive = computed(() => brushIds.includes(props.ui.tool))
const shapeActive = computed(() => shapeIds.includes(props.ui.tool))

function pick(tool) {
  panel.value = null
  emit('tool', tool)
}
function togglePanel(name) {
  panel.value = panel.value === name ? null : name
}
function pickMulti(mode) {
  panel.value = null
  props.ui.multiMode = mode
  props.ui.tick++
}
function onDocDown(e) {
  if (!root.value || root.value.contains(e.target)) return
  panel.value = null
}
onMounted(() => document.addEventListener('pointerdown', onDocDown, true))
onUnmounted(() => document.removeEventListener('pointerdown', onDocDown, true))
</script>

<template>
  <aside ref="root" class="tool-rail">
    <div class="rail-group">
      <button class="rail-btn" :class="{ on: ui.tool === 'select' }" title="选择：单击选中 / 长按拖拽（V）" @click="pick('select')">
        <Icon name="select" :size="19" />
      </button>
      <div class="rail-pop-anchor">
        <button class="rail-btn" :class="{ on: !!ui.multiMode || panel === 'multi' }" title="多选：自定义多选 / 框选" @click="togglePanel('multi')">
          <Icon name="layers" :size="19" />
        </button>
        <div v-if="panel === 'multi'" class="rail-pop">
          <div class="pop-title">多选模式 <span>单击只选中</span></div>
          <button class="pop-item" :class="{ on: ui.multiMode === 'click' }" @click="pickMulti('click')">
            <span class="pop-glyph"><Icon name="checklist" :size="14" /></span>自定义多选
            <em>连续点选</em>
          </button>
          <button class="pop-item" :class="{ on: ui.multiMode === 'box' }" @click="pickMulti('box')">
            <span class="pop-glyph"><Icon name="select" :size="14" /></span>框选
            <em>拖动框选</em>
          </button>
          <div class="pop-divider"></div>
          <button class="pop-item" :class="{ on: !ui.multiMode }" @click="pickMulti(null)">
            <span class="pop-glyph"><Icon name="close" :size="14" /></span>退出多选
          </button>
        </div>
      </div>
      <button class="rail-btn" :class="{ on: ui.linkMode }" title="连线模式 (L)：依次点击两张卡片" @click="ui.linkMode = !ui.linkMode; ui.tick++">
        <Icon name="link2" :size="19" />
      </button>
      <button class="rail-btn" title="新建节点（双击空白亦可）" @click="emit('new-note')">
        <Icon name="plus" :size="19" />
      </button>
    </div>

    <div class="rail-sep"></div>

    <div class="rail-group">
      <button class="rail-btn" title="整理当前空间卡片布局" @click="emit('tidy')">
        <Icon name="layout" :size="19" />
      </button>
      <button class="rail-btn" title="脑图布局" @click="emit('open-layout')">
        <Icon name="branch" :size="19" />
      </button>
      <div class="rail-pop-anchor">
        <button class="rail-btn" :class="{ on: drawActive || panel === 'draw' }" title="画笔工具 (1-5)" @click="togglePanel('draw')">
          <Icon name="pen" :size="19" />
        </button>
        <div v-if="panel === 'draw'" class="rail-pop">
          <div class="pop-title">画笔 <span>数字键 1-5</span></div>
          <button v-for="b in BRUSHES" :key="b.id" class="pop-item" :class="{ on: ui.tool === b.id }" @click="pick(b.id)">
            <span class="pop-glyph">{{ b.key }}</span>{{ b.label }}
          </button>
          <div class="pop-divider"></div>
          <div class="pop-row"><span>抬笔成型</span><button class="mini-toggle" :class="{ on: ui.recognize }" @click="ui.recognize = !ui.recognize">U</button></div>
          <div class="pop-row"><span>绘画合并</span><button class="mini-toggle" :class="{ on: ui.mergeMode }" @click="ui.mergeMode = !ui.mergeMode">M</button></div>
          <div class="pop-row"><span>颜色</span>
            <div class="pop-colors">
              <button v-for="c in ['#2C2C2C', '#C99C8C', '#9DB3A0', '#A8BBCB', '#E8B86D', '#D3A6A6']" :key="c"
                class="pop-swatch" :class="{ on: ui.stroke.color === c }" :style="{ background: c }" @click="ui.stroke.color = c"></button>
            </div>
          </div>
        </div>
      </div>
      <div class="rail-pop-anchor">
        <button class="rail-btn" :class="{ on: shapeActive || panel === 'shapes' }" title="形状工具 (6-0)" @click="togglePanel('shapes')">
          <Icon name="square" :size="19" />
        </button>
        <div v-if="panel === 'shapes'" class="rail-pop">
          <div class="pop-title">形状 <span>数字键 6-0</span></div>
          <button v-for="s in SHAPES" :key="s.id" class="pop-item" :class="{ on: ui.tool === s.id }" @click="pick(s.id)">
            <span class="pop-glyph"><Icon :name="s.icon" :size="14" /></span>{{ s.label }}
            <em>{{ s.key }}</em>
          </button>
          <div class="pop-divider"></div>
          <div class="pop-note">手绘圆 / 矩形 / 三角 / 星形，抬笔自动修正。U 开关。</div>
        </div>
      </div>
    </div>

    <div class="rail-sep"></div>

    <div class="rail-group">
      <button class="rail-btn" title="导入媒体 / 文件夹" @click="emit('media')">
        <Icon name="image" :size="19" />
      </button>
    </div>

    <div class="rail-sep"></div>

    <div class="rail-group">
      <button class="rail-btn" :class="{ on: ui.aiOpen }" title="AI 助手：对话建卡 / 总结 / 整理成组" @click="emit('ai')">
        <Icon name="sparkles" :size="19" />
      </button>
    </div>

  </aside>
</template>

<style scoped>
/* 顶部横向工具条：嵌在顶栏中段，弹层向下展开 */
.tool-rail {
  display: flex; flex-direction: row; align-items: center; gap: 3px; padding: 3px;
  background: var(--sp-card, #FFFFFF); border: 1px solid var(--sp-line, rgba(44,44,44,0.09));
  border-radius: 12px; flex: 0 0 auto;
}
.rail-group { display: flex; flex-direction: row; gap: 2px; }
.rail-sep { width: 1px; height: 22px; margin: 0 4px; background: var(--sp-line, rgba(44,44,44,0.09)); }
.rail-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: 9px; color: var(--sp-ink-2, #6E6A64); transition: background .15s ease, color .15s ease, transform .12s ease;
}
.rail-btn:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); color: var(--sp-ink, #2C2C2C); }
.rail-btn:active { transform: scale(0.96); }
.rail-btn.on { background: var(--eo-primary); color: #FFFFFF; }
.rail-pop-anchor { position: relative; }
.rail-pop {
  position: absolute; left: -10px; top: 40px; width: 208px; padding: 10px;
  background: var(--sp-card, #FFFFFF); border: 1px solid var(--sp-line, rgba(44,44,44,0.10)); border-radius: 14px;
  box-shadow: 0 24px 50px -26px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.05);
  z-index: 40;
}
.pop-title { display: flex; align-items: baseline; gap: 8px; font-size: 11px; font-weight: 800; color: var(--sp-ink, #2C2C2C); letter-spacing: .06em; padding: 2px 6px 8px; }
.pop-title span { font-weight: 500; font-size: 10px; color: var(--sp-ink-3, #A29E96); }
.pop-item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 8px;
  border-radius: 8px; font-size: 12px; color: var(--sp-ink-1, #4A4742); text-align: left;
}
.pop-item:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
.pop-item.on { background: var(--eo-primary); color: #FFFFFF; }
.pop-item em { margin-left: auto; font-style: normal; font-size: 10px; opacity: .55; }
.pop-glyph { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--sp-ink-2, #8A867E); }
.pop-item.on .pop-glyph { color: rgba(255,255,255,0.8); }
.pop-divider { height: 1px; margin: 8px 4px; background: var(--sp-line, rgba(44,44,44,0.08)); }
.pop-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--sp-ink-2, #6E6A64); padding: 5px 8px; }
.mini-toggle { width: 26px; height: 18px; border-radius: 999px; background: var(--sp-track, #E7E4DD); font-size: 0; position: relative; }
.mini-toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #FFFFFF; transition: left .16s ease; }
.mini-toggle.on { background: var(--eo-primary); }
.mini-toggle.on::after { left: 11px; }
.pop-colors { display: flex; gap: 5px; }
.pop-swatch { width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--sp-line, rgba(44,44,44,0.12)); }
.pop-swatch.on { box-shadow: 0 0 0 2px var(--eo-primary); }
.pop-note { font-size: 10px; line-height: 1.6; color: var(--sp-ink-3, #9A968E); padding: 4px 8px 2px; }
@media (max-width: 1180px) {
  .rail-btn { width: 30px; height: 30px; }
}
@media (max-width: 899px) {
  .tool-rail { gap: 1px; padding: 2px; }
  .rail-group { gap: 1px; }
  .rail-sep { margin: 0 1px; }
  .rail-btn { width: 28px; height: 28px; }
}
@media (max-width: 520px) {
  .rail-sep { display: none; }
}
</style>
