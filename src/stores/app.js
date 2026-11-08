import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { loadState, saveState, resetAll, getStorageStats, requestPersist, setStorageErrorHandler } from '../lib/storage.js'
import { defaultState, sanitizeState, todayStr, APP_INFO, trashList, bumpWebMilestone, defaultCanvasPanels, CANVAS_PANEL_KINDS, parseTagsInput, BUILTIN_PLUGINS } from '../lib/model.js'
import { syncAchievements } from '../lib/achievements.js'
import { searchAll } from '../lib/search.js'
import * as ops from '../lib/ops.js'
import { cardMeta, defaultCardData } from '../lib/cardMatrix.js'
import { resolveBiLink } from '../lib/bilink.js'
import { AudioService } from '../services/AudioService.js'
import { clearSavedSpace } from '../space/core/workspace.js'

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
  // v2.1.0 模块五：沉浸式成就反馈队列（Haze 气泡 + 音效），5s 自动淡出
  const achievementFeed = ref([])
  let achSeq = 0
  let toastTimer = null
  const aiHistory = ref(loadAiHistory())
  const installPrompt = ref(null)

  // v2.0.0 P0：live 视图 = 过滤掉 deletedAt 的记录；业务 UI 一律读这里，回收站读 trashItems
  const live = computed(() => ({
    tasks: data.tasks.filter((x) => !x.deletedAt),
    memos: data.memos.filter((x) => !x.deletedAt),
    items: data.items.filter((x) => !x.deletedAt),
    collections: data.collections.filter((x) => !x.deletedAt),
    locations: data.locations.filter((x) => !x.deletedAt),
    photos: data.photos.filter((x) => !x.deletedAt)
  }))
  // 回收站：由 deletedAt 实时派生（不再单独存 trash 数组）
  const trashItems = computed(() => trashList(data))
  // v2.0.0 P1：断网全局提示（对齐 Android NetworkMonitor 离线横幅）
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  // v2.0.0 P1：全局搜索（6 类聚合 + 直达路由）
  const searchQuery = ref('')
  const searchOpen = ref(false)
  const searchResults = computed(() => (searchQuery.value.trim() ? searchAll(data, searchQuery.value) : []))
  // v2.0.0 P1：全局新增 FAB —— 各列表页自行注册自己的「新增」动作，由右下角悬浮按钮触发
  const quickAdd = ref(null)
  function setQuickAdd(fn) { quickAdd.value = typeof fn === 'function' ? fn : null }
  function runQuickAdd() { if (quickAdd.value) quickAdd.value() }

  let saveTimer = null
  const persistListeners = []
  function onPersist(fn) { if (typeof fn === 'function') persistListeners.push(fn) }
  // 存储健康度：体积 / 配额 / 保存状态（设置页展示）
  const storageInfo = reactive({
    mainBytes: 0, mediaBytes: 0, mediaCount: 0, usage: null, quota: null,
    persisted: null, fallback: false, ok: true, error: '', checkedAt: 0
  })
  let lastSaveWarnAt = 0
  function reportSaveError(msg) {
    // 同一类错误 30 秒内只提示一次，避免每次输入都弹一次
    const now = Date.now()
    if (now - lastSaveWarnAt < 30000) return
    lastSaveWarnAt = now
    showToast('本地保存失败：' + msg)
  }
  setStorageErrorHandler(reportSaveError)
  function persist() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveState(JSON.parse(JSON.stringify(data))).then((r) => {
        if (r && !r.ok) reportSaveError(r.error || '未知原因')
        else { storageInfo.ok = true; storageInfo.error = '' }
      }).catch((e) => reportSaveError(e && e.message ? e.message : '写入异常'))
      persistListeners.forEach((f) => { try { f() } catch (e) {} })
    }, 250)
  }
  async function refreshStorage() {
    try {
      const st = await getStorageStats()
      Object.assign(storageInfo, st, { checkedAt: Date.now() })
      return st
    } catch (e) { return null }
  }
  async function persistStorage() {
    const ok = await requestPersist()
    storageInfo.persisted = ok
    return ok
  }
  // 立即落库（不等 debounce），导出 / 关闭页面等场景调用
  async function flushSave() {
    clearTimeout(saveTimer)
    const r = await saveState(JSON.parse(JSON.stringify(data)))
    if (r && !r.ok) reportSaveError(r.error || '未知原因')
    return r
  }
  function showToast(msg) {
    toast.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = '' }, 2600)
  }
  // 模块五：推送一条成就解锁到反馈队列（统一光效 + 同档音效），6 秒后淡出（可手动关闭）
  function notifyAchievement(meta) {
    if (!meta || !meta.key) return
    const id = ++achSeq
    achievementFeed.value.push(Object.assign({ id, leaving: false }, meta))
    AudioService.play()
    setTimeout(() => dismissAchievement(id), 6000)
  }
  function dismissAchievement(id) {
    const it = achievementFeed.value.find((x) => x.id === id)
    if (!it || it.leaving) return
    it.leaving = true
    setTimeout(() => {
      achievementFeed.value = achievementFeed.value.filter((x) => x.id !== id)
    }, 600)
  }

  // ---------- v2.1.0 终极封板：撤销 / 重做 + 时光机（会话内快照栈，不落库避免存档膨胀）----------
  const undoStack = []
  const redoStack = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  function snapshotData() { try { return JSON.stringify(data) } catch (e) { return '{}' } }
  // 在「会改动白板结构」的操作之前调用，记录操作前状态
  function pushHistory() {
    try {
      undoStack.push(snapshotData())
      if (undoStack.length > 80) undoStack.shift()
      redoStack.length = 0
      canUndo.value = undoStack.length > 0
      canRedo.value = false
    } catch (e) {}
  }
  function undo() {
    if (!undoStack.length) return
    try {
      redoStack.push(snapshotData())
      Object.assign(data, JSON.parse(undoStack.pop()))
      persist()
      canUndo.value = undoStack.length > 0
      canRedo.value = true
      showToast('已撤销')
    } catch (e) {}
  }
  function redo() {
    if (!redoStack.length) return
    try {
      undoStack.push(snapshotData())
      Object.assign(data, JSON.parse(redoStack.pop()))
      persist()
      canUndo.value = true
      canRedo.value = redoStack.length > 0
      showToast('已重做')
    } catch (e) {}
  }
  // 时光机：重大操作（如批量删除）前自动留底，可一键还原
  const timeMachine = ref([])
  function snapshotTimeMachine(label) {
    try {
      timeMachine.value.unshift({ label: label || '快照', ts: Date.now(), data: JSON.parse(snapshotData()) })
      if (timeMachine.value.length > 12) timeMachine.value.pop()
    } catch (e) {}
  }
  function restoreTimeMachine(i) {
    const s = timeMachine.value[i]
    if (!s) return
    pushHistory()
    Object.assign(data, s.data)
    persist()
    showToast('已还原到「' + s.label + '」')
  }

  // ===== 模块三：泛实体深度关联（双向绑定 + 画布语义连线） =====
  // 找到某实体在画布上的节点 id（无则 null）
  function findNodeIdByEntity(type, refId) {
    const n = data.whiteboardNodes.find((x) => !x.deletedAt && x.type === type && x.refId === refId)
    return n ? n.id : null
  }
  // 在画布两实体节点间建立/断开语义连线（仅当两节点都存在时生效）
  function syncRelationCanvas(sType, sId, tType, tId, add) {
    const from = findNodeIdByEntity(sType, sId)
    const to = findNodeIdByEntity(tType, tId)
    if (!from || !to) return
    if (add) {
      const dup = data.whiteboardEdges.find((e) => !e.deletedAt && e.from === from && e.to === to)
      if (!dup) ops.addWhiteboardEdge(data, { from, to, label: '' })
    } else {
      const e = data.whiteboardEdges.find((x) => !x.deletedAt && ((x.from === from && x.to === to) || (x.from === to && x.to === from)))
      if (e) ops.deleteWhiteboardEdge(data, e.id)
    }
  }
  // 设置某实体的全部关联（目标集合为全量，内部做差量增删）。
  // 关联表 biLinks 是画布连线与详情页关联的唯一事实来源：改完直接重建画布连线，保证两端永远同源、双向同步。
  // 语义为「无向对」：一对实体只保留一条记录（谁先建立谁当 source），任一端解除都会同时清除两端视图。
  function setEntityRelations(sourceType, sourceId, targets) {
    const pairKey = (a, b) => [a + ':' + b, b + ':' + a].sort().join('|')
    const want = new Set((targets || []).map((t) => pairKey(sourceType + ':' + sourceId, t.type + ':' + t.id)))
    // 与我相关的全部记录（不论方向）
    const related = data.biLinks.filter((b) => !b.deletedAt && (
      (b.sourceType === sourceType && b.sourceId === sourceId) ||
      (b.targetType === sourceType && b.targetId === sourceId)
    ))
    // 先删除「不再需要」的对（解除任一端 → 两端同步消失）
    related.forEach((b) => {
      const k = pairKey(b.sourceType + ':' + b.sourceId, b.targetType + ':' + b.targetId)
      if (!want.has(k)) ops.deleteBiLink(data, b.id)
    })
    // 再补齐「新增」的对（已有同向记录则跳过，避免重复）
    ;(targets || []).forEach((t) => {
      const dup = data.biLinks.find((b) => !b.deletedAt && (
        (b.sourceType === sourceType && b.sourceId === sourceId && b.targetType === t.type && b.targetId === t.id) ||
        (b.sourceType === t.type && b.sourceId === t.id && b.targetType === sourceType && b.targetId === sourceId)
      ))
      if (!dup) ops.addBiLink(data, { sourceType, sourceId, targetType: t.type, targetId: t.id })
    })
    ops.rebuildRelationEdges(data)
    syncAchievements(data); persist()
  }
  // 查询某实体的全部关联（双向：out=我指向的，in=指向我的），返回带标题的列表
  function relatedEntitiesFor(type, id) {
    const out = []
    data.biLinks.filter((b) => !b.deletedAt).forEach((b) => {
      if (b.sourceType === type && b.sourceId === id) out.push({ dir: 'out', type: b.targetType, id: b.targetId, title: (resolveBiLink(data, b.targetType, b.targetId) || {}).title || '未命名' })
      if (b.targetType === type && b.targetId === id) out.push({ dir: 'in', type: b.sourceType, id: b.sourceId, title: (resolveBiLink(data, b.sourceType, b.sourceId) || {}).title || '未命名' })
    })
    return out
  }

  async function init() {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('eo_theme')) || 'auto'
    theme.value = saved
    const s = await loadState()
    Object.assign(data, s)
    // 内置插件的名称/版本/作者以代码定义为准：旧存档里的版本号不会随代码更新，
    // 否则插件中心会一直显示历史版本（用户反馈「应该是 1.0.0，之前说了没改」）。
    ;(data.plugins || []).forEach((p) => {
      const def = BUILTIN_PLUGINS.find((b) => b.id === p.id)
      if (!def) return
      p.name = def.name
      p.version = def.version
      p.author = def.author
    })
    // 一次性迁移：Steam 内置插件默认关闭（旧存档可能仍为开启），关闭后入口/路由/画布卡片同步消失
    try {
      if (typeof localStorage !== 'undefined' && !localStorage.getItem('eo_steam_default_off')) {
        const sp = (data.plugins || []).find((p) => p.id === 'builtin_steam')
        if (sp && sp.enabled) {
          sp.enabled = false
          saveState(JSON.parse(JSON.stringify(data)))
        }
        localStorage.setItem('eo_steam_default_off', '1')
      }
    } catch (e) { /* ignore */ }
    ops.ensureLedgerCategories(data)
    // 一次性补齐新增默认分类（老存档只有旧预设，用户自定义分类保留）
    try {
      if (typeof localStorage !== 'undefined' && !localStorage.getItem('eo_ledger_preset_v2')) {
        ops.mergeLedgerPresets(data)
        localStorage.setItem('eo_ledger_preset_v2', '1')
        saveState(JSON.parse(JSON.stringify(data)))
      }
    } catch (e) { /* ignore */ }
    // 启动时清一次过期回收站（30 天 TTL，与 Android 一样「冷启动 + 进页面」双触发）
    ops.purgeExpiredTrash(data)
    ready.value = true
    bindNetwork()
    // 启动对账：确保画布数据面板始终存在。
    // 若「进入画布」的 onMounted 早于本 init 执行，其生成的面板节点会被上面的 Object.assign(data, s) 覆盖，
    // 此处兜底再对账一次，保证面板无论如何都能渲染出来。
    reconcileCanvasPanels()
  }

  // 画布数据面板对账：闭包函数（init 与进入画布时都要调用，确保面板节点始终存在；
  // 避免 onMounted 早于 init 时生成的节点被 Object.assign(data, s) 覆盖而消失）
  // 模块三：内置插件关闭时，其拥有的数据面板一并隐藏（相关数据与入口彻底消失）
  function effectiveCanvasPanels() {
    const map = Object.assign({}, data.canvasPanels)
    ;(data.plugins || []).forEach((p) => {
      if (p.source !== 'builtin' || p.enabled) return
      const def = BUILTIN_PLUGINS.find((b) => b.id === p.id)
      if (def && def.panelKind) map[def.panelKind] = false
    })
    return map
  }
  function reconcileCanvasPanels() {
    if (!data.canvasPanels) data.canvasPanels = defaultCanvasPanels()
    // v2.5.x 还原（2026-11-03）：地图卡片回归主页（无边框 + /map 独立页双入口）
    // 必须先于 syncCanvasPanels 恢复 map 开关，否则同步会依据旧开关把地图面板再删一次
    const mr = ops.applyRestoreMapCard(data)
    // v2.5.3 还原（2026-11-03 晚）：背包/成就/Steam 回归默认视图（用户只要求删热力图）
    // 必须先于 syncCanvasPanels 恢复开关 + 复活被误删面板；黄金网格重跑归位新暖白版式
    const lf = ops.applyRestoreLowFreq(data)
    // 主页默认卡片：仅对「根空间」自动铺设数据面板矩阵。
    // v2.2.1：新建卡片入口已只保留实体，故此处恢复主页默认卡片；已有节点一律不删不移。
    // v2.5.0（2026-11-03）：默认视图迁移 —— 删热力图默认堆叠 + 新布局（仅一次）
    const v5 = ops.applyDefaultViewV5(data)
    const h = ops.seedArcMindHome(data)
    const r = ops.syncCanvasPanels(data, effectiveCanvasPanels())
    // 首次进入把不常用 / 信息量大的卡片默认收纳进「卡片堆叠组」（只执行一次）
    const s = ops.applyDefaultStacking(data)
    // v2.2.2：拆掉历史堆叠组，改为平铺错位（每张卡内容完整可见）
    const u = ops.unstackCanvasPanels(data)
    // 种子一张示例便利贴（仅首次、且无便利贴时）
    const d = ops.seedCanvasDemo(data)
    // 黄金网格迁移 —— 把核心面板一次性归位到网格坐标（仅执行一次，只改坐标不丢数据）
    const g = ops.applyGoldenLayout(data)
    // v2.5.3：背包/成就/Steam 默认堆叠 —— 必须在 sync + golden 之后（节点已存在并已落位锚点坐标）
    const ls = ops.applyStackLowFreq(data)
    if (v5.applied || mr.applied || lf.applied || r.added.length || r.removed.length || s.applied || u.applied || d.applied || g.applied || h.applied || ls.applied) persist()
    return r
  }

  // 恢复主页默认版式（一次性重铺装饰性卡片，实体节点不动）
  function reseedHomeLayout() {
    data.arcmindHomeV2 = 0
    const r = ops.seedArcMindHome(data)
    persist()
    return r
  }

  // ---- 网络状态监听（离线横幅 + 发送前离线拦截的数据源） ----
  function bindNetwork() {
    if (typeof window === 'undefined') return
    window.addEventListener('online', () => { online.value = true })
    window.addEventListener('offline', () => { online.value = false })
    online.value = navigator.onLine
  }
  /** 发送/同步前调用：离线时给出人话提示并阻断 */
  function requireOnline(what) {
    if (online.value) return true
    showToast('当前处于离线状态，' + (what || '该操作') + '需要联网后才能进行')
    return false
  }

  function toggleSearch(open) {
    searchOpen.value = open === undefined ? !searchOpen.value : !!open
    if (!searchOpen.value) searchQuery.value = ''
  }

  // v2.1.0 模块四：WebDAV 同步失败状态（仅内存，不落库）——供「待关注提醒」高价值事件使用
  const syncError = ref('')
  function setSyncError(msg) { syncError.value = String(msg || '') }

  // 数据变更订阅：书写操作完成（含持久化）后回调，用于 WebDAV 自动同步等副作用。
  // 刻意不放在 lastSyncAt 写入路径上，避免「推送→记水位→再推送」死循环。
  const changeListeners = []
  function onDataChanged(fn) { if (typeof fn === 'function') changeListeners.push(fn) }

  // ---- 包裹业务操作：执行后重算成就 + 持久化 ----
  function wrap(fn) {
    return (...args) => {
      const r = fn(data, ...args)
      const newly = syncAchievements(data)
      newly.forEach((m) => notifyAchievement(m))
      persist()
      changeListeners.forEach((f) => { try { f() } catch (e) {} })
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
    // 个人主页博客：文章 + 外链分享（走统一 wrap → 持久化）
    addBlogPost: wrap(ops.addBlogPost),
    updateBlogPost: wrap(ops.updateBlogPost),
    deleteBlogPost: wrap(ops.deleteBlogPost),
    addBlogLink: wrap(ops.addBlogLink),
    updateBlogLink: wrap(ops.updateBlogLink),
    deleteBlogLink: wrap(ops.deleteBlogLink),
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
    updateLedgerRecord: wrap(ops.updateLedgerRecord),
    deleteLedgerRecord: wrap(ops.deleteLedgerRecord),
    // v2.1.0：白板（无限画布便利贴 + 连线）
    addWhiteboardNode: wrap(ops.addWhiteboardNode),
    updateWhiteboardNode: wrap(ops.updateWhiteboardNode),
    deleteWhiteboardNode: wrap(ops.deleteWhiteboardNode),
    addWhiteboardDrawing: wrap(ops.addWhiteboardDrawing),
    updateWhiteboardDrawing: wrap(ops.updateWhiteboardDrawing),
    deleteWhiteboardDrawing: wrap(ops.deleteWhiteboardDrawing),
    addWhiteboardEdge: wrap(ops.addWhiteboardEdge),
    deleteWhiteboardEdge: wrap(ops.deleteWhiteboardEdge),
    updateWhiteboardEdge: wrap(ops.updateWhiteboardEdge),
    // v2.1.0 终极重构：画布节点间连线 = 建立实体关联（同源 biLinks，双向同步）
    connectNodes(aId, bId) {
      const a = data.whiteboardNodes.find((n) => !n.deletedAt && n.id === aId)
      const b = data.whiteboardNodes.find((n) => !n.deletedAt && n.id === bId)
      if (!a || !b || a.type === 'panel' || b.type === 'panel') return { ok: false, error: '面板节点不可连线' }
      // v2.5.3：两端都有实体 → biLinks 语义连线（画布连线与详情页关联同源）；
      // 任一端是纯文本便利贴（无实体）→ 手工连线（manual），重建时不被 biLinks 对账清除。
      if (a.refId && b.refId) {
        const existing = data.biLinks.find((l) => !l.deletedAt && (
          (l.sourceType === a.type && l.sourceId === a.refId && l.targetType === b.type && l.targetId === b.refId) ||
          (l.sourceType === b.type && l.sourceId === b.refId && l.targetType === a.type && l.targetId === a.refId)))
        if (!existing) ops.addBiLink(data, { sourceType: a.type, sourceId: a.refId, targetType: b.type, targetId: b.refId })
        ops.rebuildRelationEdges(data)
        syncAchievements(data); persist()
        return { ok: true }
      }
      const dup = data.whiteboardEdges.find((e) => !e.deletedAt && e.manual &&
        ((e.from === aId && e.to === bId) || (e.from === bId && e.to === aId)))
      if (!dup) ops.addWhiteboardEdge(data, { from: aId, to: bId, label: '', manual: true })
      syncAchievements(data); persist()
      return { ok: true }
    },
    disconnectNodes(fromId, toId) {
      const a = data.whiteboardNodes.find((n) => !n.deletedAt && n.id === fromId)
      const b = data.whiteboardNodes.find((n) => !n.deletedAt && n.id === toId)
      if (!a || !b) return
      data.biLinks.forEach((l) => {
        if (!l.deletedAt && (
          (l.sourceType === a.type && l.sourceId === a.refId && l.targetType === b.type && l.targetId === b.refId) ||
          (l.sourceType === b.type && l.sourceId === b.refId && l.targetType === a.type && l.targetId === a.refId))) l.deletedAt = nowIso()
      })
      ops.rebuildRelationEdges(data)
      persist()
    },
    rebuildRelationEdges() { ops.rebuildRelationEdges(data); persist() },
    // 节点标签（自定义分组）+ 堆叠方向偏好
    setNodeTags(id, tags) {
      const n = data.whiteboardNodes.find((x) => x.id === id)
      if (n) { n.tags = parseTagsInput(tags); persist() }
    },
    setStackMode(mode) {
      data.stackMode = ['waterfall', 'compact', 'bytype'].includes(mode) ? mode : 'waterfall'
      persist()
    },
    // v2.2.0 多级空间（Space）
    addSpace: wrap(ops.addSpace),
    updateSpace: wrap(ops.updateSpace),
    deleteSpace: wrap(ops.deleteSpace),
    duplicateWhiteboardNode: wrap(ops.duplicateWhiteboardNode),
    detachNodeEdges: wrap(ops.detachNodeEdges),
    ensureWhiteboardNodeForEntity: wrap(ops.ensureWhiteboardNodeForEntity),
    // v2.1.0：双向链接
    addBiLink: wrap(ops.addBiLink),
    deleteBiLink: wrap(ops.deleteBiLink),
    // v2.1.0：看板布局保存
    saveDashboardLayout: wrap(ops.saveDashboardLayout),
    // v2.1.0 模块二：画布数据面板可见性开关（开关即唯一事实来源，改开关立即增删节点）
    setCanvasPanel(kind, on) {
      if (!CANVAS_PANEL_KINDS.includes(kind)) return
      data.canvasPanels[kind] = !!on
      ops.syncCanvasPanels(data, data.canvasPanels)
      persist()
    },
    // 进入画布时按当前开关对账一次（首次进入自动铺满六块面板）
    reconcileCanvasPanels,
    reseedHomeLayout,
    // 模块四：画布上创建实体（画布 → 业务模块双向生成），返回新实体
    createEntityAndNode(payload) {
      const kind = String(payload.kind || '')
      const pos = payload.pos || { x: 0, y: 0 }
      // v2.2.0 卡片矩阵：画布原生卡片（不绑定业务实体），直接建节点
      if (payload.cardKind) {
        const meta = cardMeta(payload.cardKind) || { w: 220, h: 150, color: 'amber' }
        const n = ops.addWhiteboardNode(data, {
          type: 'card', cardKind: payload.cardKind,
          x: pos.x, y: pos.y,
          w: payload.w || meta.w, h: payload.h || meta.h,
          color: payload.color || meta.color,
          cardData: Object.assign({}, defaultCardData(payload.cardKind), payload.cardData || {})
        })
        persist()
        changeListeners.forEach((f) => { try { f() } catch (e) {} })
        return { ok: true, node: n.node }
      }
      let type = ''
      let ent = null
      if (kind === 'memo') {
        const r = ops.addMemo(data, { title: payload.title, tags: payload.tags, markdown: payload.body || '' })
        if (r.ok) ent = r.memo
        type = 'memo'
      } else if (kind === 'todo') {
        const r = ops.addTask(data, { title: payload.title, category: 'todo', status: 'active', note: payload.body || '' })
        if (r.ok) ent = r.task
        type = 'task'
      } else if (kind === 'task') {
        const r = ops.addTask(data, { title: payload.title, category: 'side', status: 'active', note: payload.body || '' })
        if (r.ok) ent = r.task
        type = 'task'
      } else if (kind === 'item') {
        const r = ops.addItem(data, { name: payload.title, count: 1, description: payload.body || '', cover: '', tags: payload.tags })
        if (r.ok) ent = r.item
        type = 'item'
      } else if (kind === 'collection') {
        const r = ops.addCollection(data, { title: payload.title, url: payload.url || '', note: payload.body || '' })
        if (r.ok) ent = r.collection
        type = 'collection'
      } else if (kind === 'location') {
        const r = ops.addLocation(data, {
          name: payload.title, lat: Number(payload.lat) || 0, lng: Number(payload.lng) || 0,
          date: payload.date || todayStr(), note: payload.body || ''
        })
        if (r.ok) ent = r.entry
        type = 'location'
      } else if (kind === 'ledger') {
        const r = ops.addLedgerRecord(data, {
          type: payload.ledgerType === 'income' ? 'income' : 'expense',
          amount: Number(payload.amount) || 0, category: payload.category || '其他',
          note: payload.title || '', date: payload.date || todayStr()
        })
        if (r.ok) ent = r.record
        type = 'ledger'
      } else if (kind === 'photo') {
        const r = ops.addPhoto(data, { name: payload.title, dataUrl: payload.dataUrl || '', tags: payload.tags, category: '' })
        if (r.ok) ent = r.photo
        type = 'photo'
      }
      if (!ent) return { ok: false, node: null }
      // 画布 → 业务模块双向生成：落库成功后立即在画布上生成对应节点
      const nodeText = type === 'ledger'
        ? ((ent.type === 'income' ? '收入 ' : '支出 ') + ent.amount + ' 元 · ' + ent.category)
        : (payload.title || '')
      const rn = ops.ensureWhiteboardNodeForEntity(data, {
        type, refId: ent.id, x: pos.x, y: pos.y, w: 230, h: 150, text: nodeText
      })
      const newly = syncAchievements(data)
      newly.forEach((m) => notifyAchievement(m))
      persist()
      changeListeners.forEach((f) => { try { f() } catch (e) {} })
      return { ok: true, entity: ent, node: rn.node }
    },
    // v2.1.0：Web 专属成就里程碑计数（AI 对话 / 工具调用 / 导入 / 拖拽 / 剪贴板 / 周期报告）
    bumpMilestone(key) {
      const changed = bumpWebMilestone(data, key, 1)
      if (changed) { syncAchievements(data); persist() }
      return changed
    },
    // v2.1.0 终极封板：撤销 / 重做 / 时光机
    pushHistory, undo, redo, canUndo, canRedo, snapshotTimeMachine, restoreTimeMachine,
    timeMachine,
    // v2.1.0 终极封板：画布模板（另存 / 套用 / 删除）
    saveCanvasTemplate(name) {
      const tpl = {
        id: 'tpl' + Date.now().toString(36),
        name: name || ('模板 ' + (data.canvasTemplates.length + 1)),
        createdAt: todayStr(),
        nodes: data.whiteboardNodes.filter((n) => !n.deletedAt).map((n) => ({ id: n.id, type: n.type, panelKind: n.panelKind, cardKind: n.cardKind || null, refId: n.refId, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text || null, cardData: n.cardData || null, stackId: n.stackId || null, stackIdx: n.stackIdx || 0, spaceId: n.spaceId || null }))
      }
      data.canvasTemplates.push(tpl)
      persist()
      showToast('已保存画布模板：' + tpl.name)
      return tpl.id
    },
    applyCanvasTemplate(id) {
      const tpl = data.canvasTemplates.find((t) => t.id === id)
      if (!tpl) return
      pushHistory()
      data.whiteboardNodes = []
      data.whiteboardEdges = []
      tpl.nodes.forEach((n) => {
        data.whiteboardNodes.push({ id: 'wbn' + Math.random().toString(36).slice(2, 9), type: n.type, panelKind: n.panelKind, cardKind: n.cardKind || null, refId: n.refId, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text || null, cardData: n.cardData || null, stackId: n.stackId || null, stackIdx: n.stackIdx || 0, spaceId: n.spaceId || null, createdAt: todayStr(), updatedAt: todayStr(), deletedAt: null })
      })
      persist()
      showToast('已套用模板：' + tpl.name)
    },
    deleteCanvasTemplate(id) {
      data.canvasTemplates = data.canvasTemplates.filter((t) => t.id !== id)
      persist()
    },
    // v2.1.0 终极封板：自定义强调色（驱动 Haze 光晕）
    setAccent(v) { data.accent = v || ''; persist(); applyAccent() },
    // 模块三：主页图片相框开关（默认相框）
    setPhotoFrame(v) { data.photoFrame = !!v; persist(); applyAppearance(theme.value === 'dark' || (theme.value === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) },
    applyAccent,
    // 回收站按保留期自动清理（软删除超过 N 天）
    purgeOldTrash() {
      const days = Number(data.trashRetentionDays) || 30
      const isoCut = new Date(Date.now() - days * 86400000).toISOString()
      let n = 0
      const keys = ['tasks', 'memos', 'items', 'collections', 'locations', 'photos', 'whiteboardNodes', 'whiteboardEdges', 'biLinks']
      keys.forEach((k) => {
        if (!Array.isArray(data[k])) return
        data[k].forEach((r) => { if (r.deletedAt && r.deletedAt !== 'PURGED' && r.deletedAt < isoCut) { r.deletedAt = 'PURGED'; n++ } })
      })
      if (n) { persist(); showToast('已自动清理 ' + n + ' 条过期回收站数据') }
    },
    // 多标签页同步：从另一标签页广播后重载本地状态
    async reloadFromStorage() {
      try {
        const raw = await loadState()
        if (raw) Object.assign(data, raw)
      } catch (e) {}
    },
    onPersist
  }

  function setTheme(t) {
    theme.value = t
    try { localStorage.setItem('eo_theme', t) } catch (e) {}
    applyTheme()
    // 「调色师」成就：主题切换计数（首次切换即解锁）
    const changed = bumpWebMilestone(data, 'themeSwitch', 1)
    if (changed) {
      syncAchievements(data)
      persist()
    }
  }
  function applyTheme() {
    let dark = theme.value === 'dark'
    if (theme.value === 'auto') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    applyAppearance(dark)
    applyAccent()
  }
  // 外观参数：wallAlpha / cardAlpha 存的是「alpha 不透明度」(0=全透明, 1=全不透明)
  // 注意：滑块展示的是「透明度」(0%=实体不透明, 100%=彻底透明)，两者互补，取值时需 1-x 翻转
  function applyAppearance(dark) {
    const raw = Number(data.cardAlpha)
    const a = isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5
    const r = document.documentElement.style
    // 玻璃质感随透明度同步淡出：alpha 越低，白底/边框/高光/聚光罩/毛玻璃一起收敛，100% 透明 = 彻底看不见
    const sheen = Math.min(1, a * 2)          // alpha≥0.5 时质感满格，低于 0.5 线性淡出
    const base = dark ? '30, 30, 28' : '255, 255, 255'
    r.setProperty('--eo-glass', 'rgba(' + base + ', ' + a + ')')
    r.setProperty('--eo-glass-strong', 'rgba(' + base + ', ' + Math.min(1, a + 0.18) + ')')
    r.setProperty('--eo-glass-hi', dark
      ? 'rgba(255, 255, 255, ' + (0.20 * sheen).toFixed(3) + ')'
      : 'rgba(255, 255, 255, ' + (0.95 * sheen).toFixed(3) + ')')
    // 边框 / 分割线：浅色模式统一暖极浅灰 #EBE9E6；深色模式为中性白描边
    r.setProperty('--eo-glass-border', dark
      ? 'rgba(255, 255, 255, ' + (0.14 * sheen).toFixed(3) + ')'
      : 'rgba(234, 231, 225, ' + (0.90 * sheen).toFixed(3) + ')')
    r.setProperty('--eo-glass-sheen', sheen.toFixed(3))
    // 完全透明时关闭毛玻璃，卡片彻底消失；否则保留 18px 雾化质感（模块三：强化高斯模糊液态玻璃）
    r.setProperty('--eo-glass-blur', a < 0.02 ? '0px' : '22px')
    r.setProperty('--eo-wall-blur', (Number(data.wallBlur) || 0) + 'px')
    // 卡片过于透明时给文字加一层浅色描边阴影，保证任何壁纸下都可读
    r.setProperty('--eo-glass-text-shade', a < 0.42
      ? (dark ? '0 1px 3px rgba(44, 44, 44, .6)' : '0 1px 3px rgba(255,255,255,.75)')
      : 'none')
    // 模块三：主页图片相框偏好 → body 属性，CSS 据此切换相框 / 无边框
    try { document.body.setAttribute('data-photo-frame', data.photoFrame === false ? 'none' : 'frame') } catch (e) {}
  }
  // v2.1.0 终极封板：自定义强调色 → 覆盖 Haze 主题色与光晕
  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '')
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    return [44, 44, 44]
  }
  function hexToRgba(hex, a) { const [r, g, b] = hexToRgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')' }
  function applyAccent() {
    const v = data.accent
    const r = document.documentElement.style
    if (!v) {
      r.removeProperty('--eo-primary'); r.removeProperty('--eo-primary-deep')
      r.removeProperty('--eo-accent'); r.removeProperty('--eo-glow')
      return
    }
    const deep = hexToRgba(v, 1)
    const [rr, gg, bb] = hexToRgb(v)
    const d = (c) => Math.max(0, Math.min(255, Math.round(c * 0.82)))
    r.setProperty('--eo-primary', v)
    r.setProperty('--eo-primary-deep', 'rgb(' + d(rr) + ',' + d(gg) + ',' + d(bb) + ')')
    r.setProperty('--eo-accent', v)
    r.setProperty('--eo-glow', hexToRgba(v, 0.4))
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
    // 画布存档与主页实例（KeepAlive 常驻）都要重置，否则清空后仍显示旧画布
    clearSavedSpace()
    Object.assign(data, defaultState())
    try { window.dispatchEvent(new CustomEvent('eo:data-reset')) } catch (e) {}
    showToast('已清空全部数据')
  }

  return {
    data, live, trashItems, ready, theme, toast, aiHistory, installPrompt,
    online, searchQuery, searchOpen, searchResults, quickAdd, syncError,
    achievementFeed, notifyAchievement, dismissAchievement,
    init, persist, showToast, requireOnline, toggleSearch, onDataChanged,
    storageInfo, refreshStorage, persistStorage, flushSave,
    setQuickAdd, runQuickAdd, setSyncError,
    ...actions,
    setTheme, applyTheme, pushAi, pushAiStreaming, appendAiToken, persistAi, clearAiHistory, hardReset,
    setEntityRelations, relatedEntitiesFor,
    APP_INFO
  }
})
