<script setup>
// ===== 堆叠组全局预览抽屉（v2.2.5）=====
// 当堆叠组超过 5 张时，悬停 / 点击展开图标 → 右侧抽屉一次性平铺全部卡片：
// 标题 + 图标 + 摘要，支持滚动与筛选；点击任意卡片置顶并聚焦，或单独抽出。
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 }
})
const emit = defineEmits(['close', 'pick', 'extract', 'flatten'])

const q = ref('')
const openedAt = ref(0)
watch(() => props.show, (v) => {
  if (v) { q.value = ''; openedAt.value = Date.now() }
})
// 悬停自动展开时，避免紧随其后的点击立刻把抽屉关掉
function onMaskDown() {
  if (Date.now() - openedAt.value < 420) return
  emit('close')
}

const filtered = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) return props.items
  return props.items.filter((it) => (it.title + ' ' + it.summary + ' ' + it.kind).toLowerCase().includes(t))
})
</script>

<template>
  <Teleport to="body">
    <transition name="sd">
      <div v-if="show" class="sd-mask" @pointerdown.self="onMaskDown">
        <aside class="sd-panel" role="dialog" aria-label="堆叠组预览">
          <header class="sd-head">
            <span class="sd-head__ico"><Icon name="layers" :size="16" /></span>
            <div class="sd-head__txt">
              <div class="sd-head__title">堆叠组 · {{ total }} 张</div>
              <div class="sd-head__sub">点选置顶并聚焦 · 右侧按钮单独抽出</div>
            </div>
            <button class="sd-x" title="关闭" @click="emit('close')"><Icon name="close" :size="15" /></button>
          </header>

          <div class="sd-tools">
            <label class="sd-search">
              <Icon name="search" :size="13" />
              <input v-model="q" type="text" placeholder="筛选卡片…" />
              <button v-if="q" class="sd-search__x" title="清空" @click="q = ''"><Icon name="x" :size="11" /></button>
            </label>
            <button class="sd-flat" title="全部平铺（网格散开）" @click="emit('flatten')">
              <Icon name="columns" :size="13" /> 全部平铺
            </button>
          </div>

          <div class="sd-list">
            <div v-for="it in filtered" :key="it.id" class="sd-row" :class="'ac-' + (it.accent || 'amber')"
              role="button" tabindex="0" @click="emit('pick', it.id)" @keydown.enter="emit('pick', it.id)">
              <span class="sd-row__idx">{{ it.index }}</span>
              <span class="sd-row__ico"><Icon :name="it.icon" :size="15" /></span>
              <span class="sd-row__body">
                <span class="sd-row__title">{{ it.title }}</span>
                <span class="sd-row__sum">{{ it.summary }}</span>
              </span>
              <span class="sd-row__kind">{{ it.kind }}</span>
              <button class="sd-row__pull" title="从堆叠组抽出" @click.stop="emit('extract', it.id)">
                <Icon name="external" :size="12" />
              </button>
            </div>
            <div v-if="!filtered.length" class="sd-empty">
              <Icon name="search" :size="20" />
              <span>没有匹配的卡片</span>
            </div>
          </div>

          <footer class="sd-foot">
            <span><Icon name="arrowup" :size="11" /> 点击卡片置顶</span>
            <span><Icon name="external" :size="11" /> 抽出到画布</span>
            <span><Icon name="columns" :size="11" /> 全部平铺</span>
          </footer>
        </aside>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.sd-mask {
  position: fixed; inset: 0; z-index: 120;
  display: flex; justify-content: flex-end;
  background: rgba(44, 44, 44, 0.16);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.sd-panel {
  width: min(430px, 92vw); height: 100%;
  display: flex; flex-direction: column; min-height: 0;
  padding: 18px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--eo-glass-strong, rgba(255, 255, 255, 0.92));
  border-left: 1px solid var(--eo-glass-border, rgba(44, 44, 44, 0.06));
  box-shadow: -24px 0 60px -34px rgba(44, 44, 44, 0.18);
  -webkit-backdrop-filter: blur(26px) saturate(165%); backdrop-filter: blur(26px) saturate(165%);
  color: var(--eo-ink, #2C2C2C);
}
[data-theme='dark'] .sd-panel {
  background: rgba(28, 28, 30, 0.94);
  border-left-color: rgba(255, 255, 255, 0.12);
  box-shadow: -24px 0 60px -34px rgba(44, 44, 44, 0.8);
}

/* 头部 */
.sd-head { display: flex; align-items: center; gap: 10px; flex: none; padding: 2px 2px 14px; }
.sd-head__ico {
  width: 34px; height: 34px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  color: #2C2C2C; background: rgba(44, 44, 44, 0.2);
  box-shadow: inset 0 0 0 1px rgba(44, 44, 44, 0.34);
}
[data-theme='dark'] .sd-head__ico { color: #B8B5B0; background: rgba(44, 44, 44, 0.16); }
.sd-head__txt { flex: 1; min-width: 0; }
.sd-head__title { font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
.sd-head__sub { font-size: 11px; color: var(--eo-ink-soft, #86868B); margin-top: 2px; }
.sd-x {
  width: 28px; height: 28px; border-radius: 999px; flex: none; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--eo-glass-border, rgba(44, 44, 44, 0.06));
  background: transparent; color: var(--eo-ink-soft, #86868B); cursor: pointer;
  transition: background .16s ease, color .16s ease;
}
.sd-x:hover { background: var(--eo-chip, rgba(44, 44, 44, 0.07)); color: var(--eo-ink, #2C2C2C); }

/* 工具条 */
.sd-tools { display: flex; align-items: center; gap: 8px; flex: none; padding: 0 2px 12px; }
.sd-search {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 10px; border-radius: 11px;
  border: 1px solid var(--eo-glass-border, rgba(44, 44, 44, 0.06));
  background: rgba(255, 255, 255, 0.34);
  color: var(--eo-ink-soft, #86868B);
}
[data-theme='dark'] .sd-search { background: rgba(255, 255, 255, 0.06); }
.sd-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  color: var(--eo-ink, #2C2C2C); font-size: 12.5px; font-family: inherit;
}
.sd-search input::placeholder { color: var(--eo-ink-soft, #86868B); opacity: .7; }
.sd-search__x {
  width: 18px; height: 18px; border-radius: 999px; border: none; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(44, 44, 44, 0.08); color: var(--eo-ink-soft, #86868B); cursor: pointer;
}
.sd-flat {
  flex: none; display: flex; align-items: center; gap: 5px;
  height: 34px; padding: 0 11px; border-radius: 11px; cursor: pointer;
  border: 1px solid transparent; background: var(--eo-primary, #2C2C2C); color: #fff;
  font-size: 11.5px; font-weight: 800; letter-spacing: .02em;
  box-shadow: 0 8px 18px -12px rgba(44, 44, 44, 0.7);
  transition: background .16s ease, transform .16s ease;
}
.sd-flat:hover { background: var(--eo-primary-deep, #2C2C2C); transform: translateY(-1px); }

/* 列表 */
.sd-list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 2px 4px; scrollbar-width: thin; }
.sd-list::-webkit-scrollbar { width: 5px; }
.sd-list::-webkit-scrollbar-thumb { background: rgba(44, 44, 44, 0.16); border-radius: 999px; }
.sd-row {
  position: relative; display: flex; align-items: center; gap: 9px;
  padding: 9px 9px; border-radius: 13px; cursor: pointer;
  border: 1px solid transparent;
  transition: transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.sd-row + .sd-row { margin-top: 2px; }
.sd-row:hover {
  transform: translateY(var(--eo-lift, -3px));
  box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08));
}
.sd-row__idx {
  flex: none; width: 18px; text-align: right;
  font-size: 10px; font-weight: 800; color: var(--eo-ink-soft, #86868B);
  opacity: .6; font-variant-numeric: tabular-nums;
}
.sd-row__ico {
  flex: none; width: 30px; height: 30px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #2C2C2C; background: rgba(44, 44, 44, 0.16);
  box-shadow: inset 0 0 0 1px rgba(44, 44, 44, 0.24);
}
[data-theme='dark'] .sd-row__ico { color: #B8B5B0; background: rgba(44, 44, 44, 0.14); }
.sd-row.ac-blue .sd-row__ico { color: #8C8C8C; background: rgba(213, 210, 204, 0.16); }
.sd-row.ac-pink .sd-row__ico { color: #A8A5A0; background: rgba(229, 226, 219, 0.16); }
.sd-row.ac-green .sd-row__ico { color: #8C8C8C; background: rgba(185, 183, 177, 0.16); }
.sd-row.ac-purple .sd-row__ico { color: #8C8C8C; background: rgba(196, 194, 188, 0.16); }
.sd-row.ac-gray .sd-row__ico { color: #8A8A8F; background: rgba(138, 138, 143, 0.16); }
[data-theme='dark'] .sd-row.ac-blue .sd-row__ico,
[data-theme='dark'] .sd-row.ac-pink .sd-row__ico,
[data-theme='dark'] .sd-row.ac-green .sd-row__ico,
[data-theme='dark'] .sd-row.ac-purple .sd-row__ico,
[data-theme='dark'] .sd-row.ac-gray .sd-row__ico { color: #B8B5B0; background: rgba(255, 255, 255, 0.12); }
.sd-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sd-row__title {
  font-size: 12.5px; font-weight: 700; color: var(--eo-ink, #2C2C2C);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sd-row__sum {
  font-size: 10.5px; color: var(--eo-ink-soft, #86868B); line-height: 1.4;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.sd-row__kind {
  flex: none; font-size: 9.5px; font-weight: 800; letter-spacing: .04em;
  padding: 2px 6px; border-radius: 999px; color: var(--eo-ink-soft, #86868B);
  background: rgba(44, 44, 44, 0.06);
}
[data-theme='dark'] .sd-row__kind { background: rgba(255, 255, 255, 0.1); }
.sd-row__pull {
  flex: none; width: 24px; height: 24px; border-radius: 8px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--eo-glass-border, rgba(44, 44, 44, 0.06));
  background: rgba(255, 255, 255, 0.4); color: var(--eo-ink-soft, #86868B);
  cursor: pointer; opacity: 0; transform: translateX(3px);
  transition: opacity .16s ease,
    transform var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1)),
    box-shadow var(--eo-lift-dur, .2s) var(--eo-lift-ease, cubic-bezier(.2,.8,.2,1));
}
.sd-row:hover .sd-row__pull, .sd-row:focus-within .sd-row__pull { opacity: 1; transform: translateX(0); }
.sd-row .sd-row__pull:hover { transform: translateY(var(--eo-lift, -3px)); box-shadow: var(--eo-shadow-lift, 0 8px 24px rgba(0,0,0,.08)); }
[data-theme='dark'] .sd-row__pull { background: rgba(255, 255, 255, 0.08); }

.sd-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 12px; color: var(--eo-ink-soft, #86868B); font-size: 12px; opacity: .7;
}

/* 底部提示 */
.sd-foot {
  flex: none; display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 4px 0;
  border-top: 1px solid var(--eo-glass-border, rgba(44, 44, 44, 0.06));
  margin-top: 8px; font-size: 10px; color: var(--eo-ink-soft, #86868B); opacity: .75;
}
.sd-foot span { display: flex; align-items: center; gap: 4px; }

/* 进出场：遮罩淡入 + 抽屉从右侧滑入 */
.sd-enter-active, .sd-leave-active { transition: opacity .22s ease; }
.sd-enter-from, .sd-leave-to { opacity: 0; }
.sd-enter-active .sd-panel, .sd-leave-active .sd-panel { transition: transform .34s cubic-bezier(.22, 1, .36, 1); }
.sd-enter-from .sd-panel, .sd-leave-to .sd-panel { transform: translateX(26px) scale(.985); }

@media (max-width: 520px) {
  .sd-panel { width: 100%; border-left: none; padding: 16px 14px calc(14px + env(safe-area-inset-bottom, 0px)); }
  .sd-foot { display: none; }
}
</style>
