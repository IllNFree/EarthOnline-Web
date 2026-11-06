<script setup>
// ===== 画布「新建」ActionSheet（v2.1.0 模块四）=====
// 双击画布空白处唤起：八类实体 → 选定后填表单 → 同时写入业务模块 + 生成画布节点（双向生成）。
// 满血 Haze：.glass + 背景模糊 + spring 入场，永不降级。
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { motion, AnimatePresence } from 'motion-v'
import { todayStr } from '../lib/model.js'
import Icon from './Icon.vue'

const props = defineProps({ show: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'create'])

const KINDS = [
  { key: 'memo', label: '笔记', icon: 'note', tint: '#A8A6A1' },
  { key: 'todo', label: 'Todo', icon: 'checklist', tint: '#2C2C2C' },
  { key: 'task', label: '任务', icon: 'tasks', tint: '#2C2C2C' },
  { key: 'item', label: '物品', icon: 'backpack', tint: '#C4C2BC' },
  { key: 'collection', label: '收藏', icon: 'star', tint: '#C4C2BC' },
  { key: 'location', label: '足迹', icon: 'map-pin', tint: '#8C8C8C' },
  { key: 'ledger', label: '记账', icon: 'wallet', tint: '#8C8C8C' },
  { key: 'photo', label: '照片', icon: 'album', tint: '#8F8D89' }
]

// v2.2.1：新建入口只保留「实体」—— 卡片矩阵入口已移除
const kind = ref('')
const form = ref(blank())
function blank() {
  return {
    title: '', body: '', tags: '', url: '',
    lat: '', lng: '', date: todayStr(),
    amount: '', category: '', ledgerType: 'expense', dataUrl: ''
  }
}
watch(() => props.show, (v) => {
  if (v) { kind.value = ''; form.value = blank() }
})

// ESC 关闭：遮罩是全屏 fixed，若不提供 ESC 退出，用户会被困在遮罩里无法继续操作画布。
function onKey(e) {
  if (e.key === 'Escape' && props.show) {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const cur = computed(() => KINDS.find((k) => k.key === kind.value) || null)
const titleLabel = computed(() => ({
  memo: '笔记标题', todo: '要做的事', task: '任务标题', item: '物品名称',
  collection: '收藏标题', location: '地点名称', ledger: '备注', photo: '照片名称'
}[kind.value] || '标题'))
const canSave = computed(() => {
  if (kind.value === 'ledger') return Number(form.value.amount) > 0
  if (kind.value === 'location') return !!form.value.title.trim() && form.value.lat !== '' && form.value.lng !== ''
  if (kind.value === 'photo') return !!form.value.dataUrl
  if (!kind.value) return false
  return !!form.value.title.trim()
})

function pick(k) { kind.value = k; form.value = blank() }
function back() { kind.value = '' }

function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  if (!f.type.startsWith('image/')) return
  const r = new FileReader()
  r.onload = () => { form.value.dataUrl = r.result }
  r.readAsDataURL(f)
  e.target.value = ''
}
function submit() {
  if (!canSave.value) return
  emit('create', {
    kind: kind.value,
    title: form.value.title.trim() || form.value.category || '未命名',
    body: form.value.body,
    tags: form.value.tags,
    url: form.value.url,
    lat: form.value.lat, lng: form.value.lng, date: form.value.date,
    amount: form.value.amount, category: form.value.category,
    ledgerType: form.value.ledgerType, dataUrl: form.value.dataUrl
  })
}

const maskVariants = {
  initial: { opacity: 0, backdropFilter: 'blur(0px)' },
  animate: { opacity: 1, backdropFilter: 'blur(18px)', transition: { duration: 0.24 } },
  exit: { opacity: 0, backdropFilter: 'blur(0px)', transition: { duration: 0.18 } }
}
const panelVariants = {
  initial: { opacity: 0, y: 40, scale: 0.95, filter: 'blur(12px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 340, damping: 26, mass: 0.8 } },
  exit: { opacity: 0, y: 24, scale: 0.96, filter: 'blur(8px)', transition: { duration: 0.16 } }
}
const gridVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { staggerChildren: 0.028, delayChildren: 0.05 } },
  exit: { opacity: 0 }
}
const itemVariants = {
  initial: { opacity: 0, y: 16, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 24 } },
  exit: { opacity: 0, scale: 0.92 }
}
</script>

<template>
  <AnimatePresence>
    <motion.div v-if="show" class="cs-mask" :variants="maskVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'" @click.self="emit('close')">
      <motion.div class="cs-sheet glass" :variants="panelVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'">
        <div class="cs-head">
          <button v-if="kind" class="ghost-btn" @click="back"><Icon name="chevron" :size="18" style="transform:rotate(180deg)" /></button>
          <h3 class="cs-title">{{ kind ? '新建' + cur.label : '新建到画布' }}</h3>
          <button class="ghost-btn" @click="emit('close')"><Icon name="x" :size="18" /></button>
        </div>

        <!-- 第一步：类型选择（仅实体） -->
        <motion.div v-if="!kind" class="cs-grid" :variants="gridVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'">
          <motion.button
            v-for="k in KINDS" :key="k.key"
            class="cs-tile" :variants="itemVariants" :initial="'initial'" :animate="'animate'" :exit="'exit'"
            @click="pick(k.key)">
            <span class="cs-tile-icon" :style="{ color: k.tint }"><Icon :name="k.icon" :size="20" /></span>
            <span class="cs-tile-label">{{ k.label }}</span>
          </motion.button>
        </motion.div>

        <!-- 第二步：表单（不同实体不同字段） -->
        <div v-else class="cs-form">
          <!-- 记账：先选收支类型 -->
          <div v-if="kind === 'ledger'" class="capsule cs-switch">
            <button :class="{ on: form.ledgerType === 'expense' }" @click="form.ledgerType = 'expense'">支出</button>
            <button :class="{ on: form.ledgerType === 'income' }" @click="form.ledgerType = 'income'">收入</button>
          </div>

          <!-- 照片：先选图 -->
          <div v-if="kind === 'photo'" class="field">
            <label>选择图片</label>
            <label class="cs-upload">
              <Icon name="upload" :size="16" /> {{ form.dataUrl ? '重新选择图片' : '点击选择图片' }}
              <input type="file" accept="image/*" style="display:none" @change="onFile" />
            </label>
            <div v-if="form.dataUrl" class="cs-prev" :style="{ backgroundImage: 'url(' + form.dataUrl + ')' }"></div>
          </div>

          <div v-if="kind !== 'ledger'" class="field">
            <label>{{ titleLabel }}</label>
            <input v-model="form.title" :placeholder="titleLabel" />
          </div>

          <div v-if="kind === 'memo'" class="field">
            <label>内容（支持 Markdown）</label>
            <textarea v-model="form.body" rows="3" placeholder="写点什么…"></textarea>
          </div>
          <div v-if="kind === 'memo' || kind === 'item' || kind === 'photo' || kind === 'collection'" class="field">
            <label>标签（空格或逗号分隔）</label>
            <input v-model="form.tags" placeholder="如：灵感 纪念" />
          </div>
          <div v-if="kind === 'todo' || kind === 'task' || kind === 'item'" class="field">
            <label>备注</label>
            <textarea v-model="form.body" rows="2" placeholder="补充说明"></textarea>
          </div>
          <div v-if="kind === 'collection'" class="field">
            <label>链接（可选）</label>
            <input v-model="form.url" placeholder="https://" />
          </div>
          <div v-if="kind === 'location'" class="row cs-row">
            <div class="field" style="flex:1"><label>纬度</label><input v-model="form.lat" placeholder="如 31.23" /></div>
            <div class="field" style="flex:1"><label>经度</label><input v-model="form.lng" placeholder="如 121.47" /></div>
          </div>
          <div v-if="kind === 'location'" class="field">
            <label>日期</label><input type="date" v-model="form.date" />
          </div>
          <div v-if="kind === 'ledger'" class="row cs-row">
            <div class="field" style="flex:1"><label>金额</label><input type="number" min="0" step="0.01" v-model="form.amount" placeholder="0.00" /></div>
            <div class="field" style="flex:1"><label>分类</label><input v-model="form.category" placeholder="如：餐饮" /></div>
          </div>
          <div v-if="kind === 'ledger'" class="field">
            <label>日期</label><input type="date" v-model="form.date" />
          </div>
          <div v-if="kind === 'ledger'" class="field">
            <label>备注</label><input v-model="form.title" placeholder="可选" />
          </div>

          <button class="btn cs-save" :disabled="!canSave" @click="submit">
            <Icon name="checklist" :size="16" /> 创建并放到画布
          </button>
          <div class="cs-tip">会同时在对应业务模块中生成一条真实数据</div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

<style scoped>
.cs-mask {
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: flex-end; justify-content: center;
  padding: 16px; background: rgba(44, 44, 44, .32);
}
@media (min-width: 800px) { .cs-mask { align-items: center; } }
.cs-sheet {
  width: 100%; max-width: 460px; max-height: 86vh; overflow-y: auto;
  border-radius: 24px; padding: 16px 18px 20px;
  box-shadow: 0 30px 70px -28px rgba(44, 44, 44, .6);
}
.cs-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.cs-title { margin: 0; flex: 1; text-align: center; font-size: 16px; font-weight: 800; }
.ghost-btn { color: var(--eo-ink-soft); padding: 4px; }
.cs-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cs-tabs { display: inline-flex; width: 100%; padding: 4px; gap: 4px; margin-bottom: 12px; background: var(--eo-chip); border-radius: 999px; }
.cs-tabs button { flex: 1; padding: 7px; border: none; border-radius: 999px; background: transparent; color: var(--eo-ink-soft); font-size: 13px; font-weight: 700; cursor: pointer; transition: background .14s ease, color .14s ease; }
.cs-tabs button.on { background: #fff; color: var(--eo-primary-deep); box-shadow: 0 4px 10px -6px rgba(44, 44, 44, .12); }
.cs-cardgroup { margin-bottom: 12px; }
.cs-cardgroup__t { font-size: 11px; font-weight: 800; color: var(--eo-ink-soft); opacity: .8; margin: 4px 2px 6px; }
.cs-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 4px; border-radius: 16px; cursor: pointer;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-glass-strong, rgba(255, 255, 255, .34));
  box-shadow: inset 0 1px 0 var(--eo-glass-hi);
  transition: transform .16s cubic-bezier(.22,1,.36,1), box-shadow .16s ease;
}
.cs-tile:hover { transform: translateY(-2px); box-shadow: 0 12px 26px -14px rgba(44, 44, 44, .6); }
.cs-tile-icon { width: 36px; height: 36px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: var(--eo-chip); }
.cs-tile-label { font-size: 12px; font-weight: 700; color: var(--eo-ink); }
.cs-form { display: flex; flex-direction: column; }
.cs-switch { display: inline-flex; padding: 4px; gap: 4px; margin-bottom: 12px; align-self: flex-start; }
.cs-switch button { padding: 6px 18px; border: none; border-radius: 999px; background: transparent; color: var(--eo-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.cs-switch button.on { background: var(--eo-primary); color: #fff; }
.cs-row { gap: 8px; }
.cs-upload {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; border-radius: 12px; cursor: pointer; font-size: 13px; font-weight: 600;
  border: 1px dashed var(--eo-glass-border); color: var(--eo-ink-soft);
}
.cs-prev { height: 110px; border-radius: 12px; margin-top: 8px; background-size: cover; background-position: center; }
.cs-save { width: 100%; margin-top: 6px; }
.cs-save:disabled { opacity: .45; cursor: not-allowed; }
.cs-tip { text-align: center; font-size: 11px; opacity: .6; margin-top: 8px; }
</style>
