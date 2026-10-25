import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { loadState, saveState, resetAll } from '../lib/storage.js'
import { defaultState, sanitizeState, todayStr, APP_INFO } from '../lib/model.js'
import { syncAchievements, totalXp } from '../lib/achievements.js'
import * as ops from '../lib/ops.js'

const AI_HISTORY_KEY = 'eo_ai_history_v1'

function loadAiHistory() {
  try { return JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]') } catch (e) { return [] }
}
function saveAiHistory(h) {
  try { localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(h.slice(-200))) } catch (e) {}
}

export const useAppStore = defineStore('app', () => {
  const data = reactive(defaultState())
  const ready = ref(false)
  const theme = ref('auto') // light | dark | auto
  const toast = ref('')
  let toastTimer = null
  const aiHistory = ref(loadAiHistory())
  const installPrompt = ref(null)
  const xp = ref(0)

  let saveTimer = null
  function persist() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveState(JSON.parse(JSON.stringify(data))) }, 250)
  }
  function showToast(msg) {
    toast.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = '' }, 2600)
  }
  function recomputeXp() { xp.value = totalXp(data) }

  async function init() {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('eo_theme')) || 'auto'
    theme.value = saved
    const s = await loadState()
    Object.assign(data, s)
    ops.ensureLedgerCategories(data)
    ready.value = true
    recomputeXp()
  }

  // ---- 包裹业务操作：执行后重算成就/XP + 持久化 ----
  function wrap(fn) {
    return (...args) => {
      const r = fn(data, ...args)
      syncAchievements(data)
      recomputeXp()
      persist()
      return r
    }
  }
  const actions = {
    addTask: wrap(ops.addTask),
    updateTask: wrap(ops.updateTask),
    toggleTaskDone: wrap(ops.toggleTaskDone),
    deleteTask: wrap(ops.deleteTask),
    addMemo: wrap(ops.addMemo),
    updateMemo: wrap(ops.updateMemo),
    deleteMemo: wrap(ops.deleteMemo),
    addItem: wrap(ops.addItem),
    updateItem: wrap(ops.updateItem),
    deleteItem: wrap(ops.deleteItem),
    addCollection: wrap(ops.addCollection),
    updateCollection: wrap(ops.updateCollection),
    deleteCollection: wrap(ops.deleteCollection),
    addLocation: wrap(ops.addLocation),
    updateLocation: wrap(ops.updateLocation),
    deleteLocation: wrap(ops.deleteLocation),
    addPhoto: wrap(ops.addPhoto),
    updatePhoto: wrap(ops.updatePhoto),
    deletePhoto: wrap(ops.deletePhoto),
    restoreFromTrash: wrap(ops.restoreFromTrash),
    purgeTrashEntry: wrap(ops.purgeTrashEntry),
    emptyTrash: wrap(ops.emptyTrash),
    purgeExpiredTrash: wrap(ops.purgeExpiredTrash),
    setProfile: wrap(ops.setProfile),
    setAiConfig: wrap(ops.setAiConfig),
    setSteamConfig: wrap(ops.setSteamConfig),
    setWallpaper: wrap(ops.setWallpaper),
    setAppearance: wrap(ops.setAppearance),
    setBirthDate: wrap(ops.setBirthDate),
    addCategory: wrap(ops.addCategory),
    removeCategory: wrap(ops.removeCategory),
    addLedgerRecord: wrap(ops.addLedgerRecord),
    deleteLedgerRecord: wrap(ops.deleteLedgerRecord)
  }

  function setTheme(t) {
    theme.value = t
    try { localStorage.setItem('eo_theme', t) } catch (e) {}
    applyTheme()
  }
  function applyTheme() {
    let dark = theme.value === 'dark'
    if (theme.value === 'auto') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    applyAppearance(dark)
  }
  // 外观参数：wallAlpha / cardAlpha 存的是「alpha 不透明度」(0=全透明, 1=全不透明)
  // 注意：滑块展示的是「透明度」(0%=实体不透明, 100%=彻底透明)，两者互补，取值时需 1-x 翻转
  function applyAppearance(dark) {
    const raw = Number(data.cardAlpha)
    const a = isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5
    const r = document.documentElement.style
    // 玻璃质感随透明度同步淡出：alpha 越低，白底/边框/高光/聚光罩/毛玻璃一起收敛，100% 透明 = 彻底看不见
    const sheen = Math.min(1, a * 2)          // alpha≥0.5 时质感满格，低于 0.5 线性淡出
    const base = dark ? '40, 36, 30' : '255, 253, 250'
    r.setProperty('--eo-glass', 'rgba(' + base + ', ' + a + ')')
    r.setProperty('--eo-glass-strong', 'rgba(' + base + ', ' + Math.min(1, a + 0.18) + ')')
    r.setProperty('--eo-glass-hi', dark
      ? 'rgba(255, 235, 210, ' + (0.20 * sheen).toFixed(3) + ')'
      : 'rgba(255, 255, 255, ' + (0.95 * sheen).toFixed(3) + ')')
    r.setProperty('--eo-glass-border', dark
      ? 'rgba(232, 214, 190, ' + (0.14 * sheen).toFixed(3) + ')'
      : 'rgba(255, 255, 255, ' + (0.6 * sheen).toFixed(3) + ')')
    r.setProperty('--eo-glass-sheen', sheen.toFixed(3))
    // 完全透明时关闭毛玻璃，卡片彻底消失；否则保留 16px 雾化质感
    r.setProperty('--eo-glass-blur', a < 0.02 ? '0px' : '16px')
    r.setProperty('--eo-wall-blur', (Number(data.wallBlur) || 0) + 'px')
    // 卡片过于透明时给文字加一层浅色描边阴影，保证任何壁纸下都可读
    r.setProperty('--eo-glass-text-shade', a < 0.42
      ? (dark ? '0 1px 3px rgba(0,0,0,.6)' : '0 1px 3px rgba(255,255,255,.75)')
      : 'none')
  }
  function pushAi(role, content) {
    aiHistory.value.push({ id: 'm' + Date.now(), role, content, ts: Date.now() })
    saveAiHistory(aiHistory.value)
  }
  function pushAiStreaming(role) {
    const id = 'm' + Date.now()
    aiHistory.value.push({ id, role, content: '', ts: Date.now() })
    saveAiHistory(aiHistory.value)
    return id
  }
  function appendAiToken(id, delta) {
    const m = aiHistory.value.find((x) => x.id === id)
    if (m) m.content += delta
    saveAiHistory(aiHistory.value)
  }
  function clearAiHistory() { aiHistory.value = []; saveAiHistory([]) }
  function persistAi() { saveAiHistory(aiHistory.value) }

  async function hardReset() {
    await resetAll()
    Object.assign(data, defaultState())
    recomputeXp()
    showToast('已清空全部数据')
  }

  return {
    data, ready, theme, toast, aiHistory, installPrompt, xp,
    init, persist, showToast, recomputeXp,
    ...actions,
    setTheme, applyTheme, pushAi, pushAiStreaming, appendAiToken, persistAi, clearAiHistory, hardReset,
    APP_INFO
  }
})
