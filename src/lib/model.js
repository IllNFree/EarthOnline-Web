// ===== 地球Online Web · 数据模型与纯函数层 =====
// 字段名严格对齐旧版 earth_data 存档，保证历史数据无缝加载。
export const APP_INFO = {
  appName: '地球Online',
  version: '2.0.0',
  buildDate: '2026-10-25',
  channel: 'web'
}
export const STORAGE_KEY = 'earth_data'
export const TRASH_TTL_DAYS = 30
export const TRASH_KINDS = ['task', 'item', 'collection', 'memo', 'location', 'photo']
// v2.0.0 P0：软删除模型改为与 Android 同构的 deletedAt 字段（实体留在本集合内，打时间戳标记）
// 旧模型是「搬进 trash[] 数组」，会导致跨端合并出幽灵数据，此处保留 TRASH_KINDS 仅用于兼容迁移
export const SOFT_KIND_MAP = {
  task: 'tasks', item: 'items', collection: 'collections',
  memo: 'memos', location: 'locations', photo: 'photos'
}
export const SOFT_KINDS = Object.keys(SOFT_KIND_MAP)

/** 是否已软删除 */
export function isDeleted(x) { return !!x && !!x.deletedAt }
/** 取出某集合的未删除记录 */
export function liveList(state, key) { return (state[key] || []).filter((x) => !isDeleted(x)) }

function expireOf(deletedAt) {
  const d = new Date(deletedAt)
  if (isNaN(d)) return ''
  d.setDate(d.getDate() + TRASH_TTL_DAYS)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 回收站视图：由各集合内带 deletedAt 的实体实时派生，不再单独维护 trash[] */
export function trashList(state) {
  const out = []
  SOFT_KINDS.forEach((kind) => {
    ;(state[SOFT_KIND_MAP[kind]] || []).forEach((rec) => {
      if (!isDeleted(rec)) return
      out.push({ id: rec.id, kind, data: rec, deletedAt: rec.deletedAt, expireAt: expireOf(rec.deletedAt) })
    })
  })
  return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

/** 清理过期（超过 30 天）的软删除记录 —— 真正物理移除 */
export function purgeExpiredSoftDeleted(state) {
  const now = new Date().toISOString().slice(0, 10)
  let n = 0
  SOFT_KINDS.forEach((kind) => {
    const key = SOFT_KIND_MAP[kind]
    const arr = state[key]
    if (!Array.isArray(arr)) return
    for (let i = arr.length - 1; i >= 0; i--) {
      const rec = arr[i]
      if (!isDeleted(rec)) continue
      const exp = expireOf(rec.deletedAt)
      if (!exp || exp <= now) { arr.splice(i, 1); n++ }
    }
  })
  return n
}

/**
 * 迁移：把旧模型 trash[] 里的记录搬回各自集合并补 deletedAt。
 * 老用户升级后回收站内容不丢，之后统一走 deletedAt 口径。
 */
export function migrateTrashToDeletedAt(state) {
  const legacy = Array.isArray(state.trash) ? state.trash : []
  legacy.forEach((t) => {
    const key = SOFT_KIND_MAP[t && t.kind]
    if (!key || !Array.isArray(state[key])) return
    const rec = t.data && typeof t.data === 'object' ? t.data : null
    if (!rec || !rec.id) return
    if (state[key].some((x) => x.id === rec.id)) return
    rec.deletedAt = rec.deletedAt || t.deletedAt || ''
    if (!rec.deletedAt) return
    state[key].push(rec)
  })
  state.trash = []
  return state
}

export const TASK_CATEGORY = {
  main: { label: '主线', cls: 'cat-main' },
  side: { label: '支线', cls: 'cat-side' },
  todo: { label: 'To Do', cls: 'cat-todo' }
}
export const TASK_CATEGORY_ORDER = ['main', 'side', 'todo']
export const TASK_STATUS = {
  planning: { label: '规划中', cls: 'status-planning' },
  active: { label: '进行中', cls: 'status-active' },
  paused: { label: '搁置', cls: 'status-paused' },
  done: { label: '已完成', cls: 'status-done' }
}
export const ITEM_TYPE = {
  virtual: { label: '虚拟物品', cls: 'item-virtual' },
  physical: { label: '实体物品', cls: 'item-physical' }
}
export const MEMO_TYPE = {
  note: { label: '随笔', cls: 'memo-dot-note' },
  important: { label: '重要', cls: 'memo-dot-important' },
  idea: { label: '灵感', cls: 'memo-dot-idea' },
  mood: { label: '心情', cls: 'memo-dot-mood' }
}

export const GROWTH_STAGES = [
  { key: 'seed', label: '种子', min: 0, icon: 'egg' },
  { key: 'sprout', label: '嫩芽', min: 50, icon: 'spark' },
  { key: 'sapling', label: '树苗', min: 150, icon: 'layers' },
  { key: 'bloom', label: '花开', min: 400, icon: 'heart' },
  { key: 'tree', label: '大树', min: 900, icon: 'flag' },
  { key: 'forest', label: '森林', min: 1800, icon: 'book' },
  { key: 'legend', label: '传奇', min: 3600, icon: 'trophy' }
]
export function growthStageOf(xp) {
  let cur = GROWTH_STAGES[0]
  for (const s of GROWTH_STAGES) if ((xp || 0) >= s.min) cur = s
  return cur
}

// 全局 XP 等级进度：以成长阶段为等级档位，返回当前等级/进度。已废弃连击机制，仅保留等级。
export function xpLevelInfo(xp) {
  const x = xp || 0
  let idx = 0
  for (let i = 0; i < GROWTH_STAGES.length; i++) if (x >= GROWTH_STAGES[i].min) idx = i
  const cur = GROWTH_STAGES[idx]
  const next = GROWTH_STAGES[idx + 1] || null
  const currMin = cur.min
  const nextMin = next ? next.min : cur.min
  const span = nextMin - currMin
  const pct = span > 0 ? Math.min(100, Math.round(((x - currMin) / span) * 100)) : 100
  return { level: idx + 1, stage: cur, next, currMin, nextMin, pct, isMax: !next }
}

export function defaultProfile() {
  return {
    name: '',
    avatarKey: '',
    avatarData: null,
    gender: '',
    country: '',
    province: '',
    signature: '',
    customTitle: '',
    wornBadges: [],
    customFields: []
  }
}
export function defaultState() {
  return {
    version: 3,
    birthDate: '',
    tasks: [],
    memos: [],
    items: [],
    achievements: [],
    profile: defaultProfile(),
    collections: [],
    activities: [],
    trash: [],
    locations: [],
    photos: [],
    ledgerOpened: false,
    itemCategories: [],
    collectionCategories: [],
    calendarNotes: {},
    aiConfig: { baseUrl: '', apiKey: '', model: '' },
    steam: { apiKey: '', steamId: '', proxy: '' },
    wallpaper: '',
    wallAlpha: 1,
    wallBlur: 0,
    // v2.0.0 P0-6：卡片不透明度出厂默认与 Android 对齐 —— 80%（原 Web 为 50%）
    cardAlpha: 0.8,
    glassAlphaMigrated: true,
    // v2.0.0 一次性迁移标记：把历史用户（含出厂 50%）统一拉到 80% 基线，之后尊重用户手调值
    cardAlphaV2: true,
    // v2.0.0 P0-1：WebDAV 同步水位线，用于拉云备份前的冲突比对（与 Android lastSyncAt 同语义）
    lastSyncAt: '',
    ledger: { records: [], expenseCategories: [], incomeCategories: [] },
    eggs: sanitizeEggs(null),
    // v2.1.0：白板便利贴节点与连线（持久化 + 纳入 WebDAV 同步契约，按主键合并）
    whiteboardNodes: [],
    whiteboardEdges: [],
    // v2.1.0：自定义看板布局序列化（可拖拽模块位置）
    dashboardLayout: [],
    // v2.1.0：双向链接反向索引（系统级实体关联，覆盖全实体）
    biLinks: [],
    // v2.1.0：桌面级生产力交互开关（落库同步，对齐 Android 偏好）
    enableCustomContextMenu: true,
    enableClipboardWatch: true
  }
}

// ---------- 记账 ----------
export const LEDGER_EXPENSE_PRESET = [
  { name: '餐饮', icon: 'cake' }, { name: '交通', icon: 'flag' }, { name: '购物', icon: 'gift' },
  { name: '居住', icon: 'home' }, { name: '娱乐', icon: 'sparkles' }, { name: '医疗', icon: 'heart' },
  { name: '学习', icon: 'book' }, { name: '其他', icon: 'tag' }
]
export const LEDGER_INCOME_PRESET = [
  { name: '工资', icon: 'wallet' }, { name: '兼职', icon: 'bolt' }, { name: '理财', icon: 'chart' },
  { name: '红包', icon: 'gift' }, { name: '其他', icon: 'tag' }
]
export function sanitizeLedger(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  return {
    records: arrOf(d.records).filter((r) => r && typeof r === 'object' && isFinite(Number(r.amount))).map((r) => ({
      id: str(r.id) || uid('led'),
      type: r.type === 'income' ? 'income' : 'expense',
      amount: Math.min(99999999, Math.max(0, Number(r.amount))),
      category: str(r.category, 60) || '其他',
      note: str(r.note, 500),
      date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayStr(),
      createdAt: str(r.createdAt, 30) || todayStr()
    })),
    expenseCategories: arrOf(d.expenseCategories).filter((c) => c && str(c.name)).map((c) => ({ name: str(c.name, 60), icon: str(c.icon, 20) })),
    incomeCategories: arrOf(d.incomeCategories).filter((c) => c && str(c.name)).map((c) => ({ name: str(c.name, 60), icon: str(c.icon, 20) }))
  }
}

// ---------- 更新日志（结构化，替代「本次更新/检查更新」） ----------
// 版本号严格平滑递增：v1.0.0 → v1.0.6 → v1.0.7 … v1.0.9 → v1.1.0 … v1.9.0 → v2.0.0
export const CHANGELOG = [
  {
    version: '2.0.0', date: '2026-10-25',
    items: [
      '全局文字对比度大幅加深：次要文字由浅灰调整为深墨色，大屏阅读清晰不刺眼',
      '外观设置新增「壁纸模糊度」滑块（0–30px），背景可柔化、玻璃卡片上的文字更清晰',
      '全局卡片默认不透明度调整为 50%，默认即可透出壁纸底图且不遮挡文字',
      '隐私政策全面改版：补充高德地图 API、大模型 API、Steam API 等第三方服务的数据处理规范',
      '记账页空状态重排：移除突兀的横向分割线，图标 / 文案 / 按钮干净居中',
      '双端自适应持续完善：桌面 Web 与手机 PWA 共用一套设计语言'
    ]
  },
  {
    version: '1.9.0', date: '2026-10-24',
    items: [
      '更新日志排版重做：消除版本块之间的巨大空白断层，改用虚线分隔',
      '更新日志独立 60vh 滚动容器 + 细窄滚动条，滚轮可从头连续长滚动',
      '版本编年史补全：从 v1.0.0 到 v2.0.0 全量历史记录按版本号分段展示'
    ]
  },
  {
    version: '1.8.0', date: '2026-10-24',
    items: [
      '主页底部三卡绝对等高：日历 · 任务 / 人生时间轴 / 最近动态同行 stretch 对齐',
      '卡片高度支持拖拽底边自由调节，高度偏好本地记忆',
      '时间轴 / 最近动态内容过多时卡片内滚动，绝不撑破布局'
    ]
  },
  {
    version: '1.7.0', date: '2026-10-24',
    items: [
      '背包与收藏列表补齐矢量空状态插画与引导文案',
      'Steam 游戏库入口移出收藏列表，独立置于页面右上角',
      '记账页移除右下角悬浮 FAB，「记一笔」统一到右上角',
      '全局添加按钮位置统一：各页面新增操作一律右上角'
    ]
  },
  {
    version: '1.6.0', date: '2026-10-24',
    items: [
      '记账新增近 12 个月收支趋势柱状图（绿=收入 / 红=支出）',
      '账单明细彩色分类图标 + 虚线分隔 + 加粗金额',
      '收支配色规范化：收入绿 #34C759 / 支出红 #FF3B30',
      '分类管理入口前置，支持自定义支出 / 收入分类'
    ]
  },
  {
    version: '1.5.0', date: '2026-10-24',
    items: [
      '记账环形图升级为多巴胺多色配色，中心大字号显示当月总额',
      '导出 / 导入改为胶囊按钮，账单区新增玻璃发光 FAB',
      '月度概览顶部新增收入 / 支出 / 结余三栏居中汇总'
    ]
  },
  {
    version: '1.4.0', date: '2026-10-23',
    items: [
      '速览重构为主页内悬浮快捷操作：不再跳转页面',
      '快捷入口重排为「新任务 → 装背包 → 写笔记 → 传照片 → 记一笔 → 回收站」',
      '看板「最近照片」改为「今日成就」，实时显示今日解锁成就'
    ]
  },
  {
    version: '1.3.0', date: '2026-10-23',
    items: [
      '主页两栏宽度可拖拽调节：左 2/3 日历 · 任务 / 右 1/3 时间轴 + 动态',
      '同行卡片 align-items:stretch 绝对等高，右栏数据过多时内部滚动',
      '左右宽度偏好本地记忆'
    ]
  },
  {
    version: '1.2.0', date: '2026-10-23',
    items: [
      '主页数据卡升级为真 3D 层叠：透视 + z 轴景深 + 拖拽切换',
      '层叠卡片页码随滑动实时更新，修复 1/6 页码显示异常',
      '卡片高度自适应，层叠阴影随层级递减'
    ]
  },
  {
    version: '1.1.0', date: '2026-10-23',
    items: [
      '全局液态玻璃材质体系：毛玻璃 blur(16px) + 半透明白 + 1px 高光白边',
      '镜面反光 + 指针聚光灯随鼠标移动，卡片 hover 提亮并轻微悬浮',
      '图片渲染统一 object-fit:cover + 圆角 + overflow:hidden，杜绝变形拉伸'
    ]
  },
  {
    version: '1.0.9', date: '2026-10-22',
    items: [
      '地图深度交互：双击地图直接创建足迹',
      '地图搜索支持「地点 / 足迹」双模式切换，足迹可按名称检索',
      '足迹列表点击后地图自动居中并定位标记'
    ]
  },
  {
    version: '1.0.8', date: '2026-10-22',
    items: [
      '列表页交互统一：添加按钮移至右上角',
      '全局搜索支持名称 / 标签 / 关键字多维过滤',
      '所有卡片支持点击二次编辑，无需删除重建'
    ]
  },
  {
    version: '1.0.7', date: '2026-10-22',
    items: [
      '双端自适应基线：≥900px 电脑网站模式（侧边栏），<900px 手机 PWA 模式（底部悬浮导航）',
      '手机端状态栏与安全区适配，触摸滚动更顺滑',
      'PWA 离线缓存策略优化，弱网下仍可打开'
    ]
  },
  {
    version: '1.0.6', date: '2026-10-22',
    items: [
      '三端赞助名单同步（5 位赞助者）',
      '版本号统一收敛，Web/Android/Windows 对齐',
      '液态玻璃视觉体系与暖琥珀配色'
    ]
  },
  {
    version: '1.0.5', date: '2026-10-01',
    items: [
      '回收站：任务/物品/收藏/日志删除后保留 30 天，可恢复或彻底删除',
      '全局搜索升级（6 类）、批量操作、导入增强',
      '历年今日、记忆相册、庆祝连击、快捷键、灵感接力',
      '系统通知、成长阶段、成就契约对齐、彩蛋 +2'
    ]
  },
  {
    version: '1.0.4', date: '2026-09-30',
    items: ['正式发布基线', 'PWA 缓存根治（网络优先）', '深色模式跟随系统']
  },
  {
    version: '1.0.3', date: '2026-09-15',
    items: [
      '主页优化 · 头像/壁纸原图裁剪',
      '背包分类、日历美化、地图保存反馈与实时刷新',
      '收藏卡同构物品卡、空状态统一大引导卡',
      '设置页精简、数据页视图切换、导入导出'
    ]
  },
  {
    version: '1.0.1', date: '2026-08-10',
    items: [
      '跨端导入还原自定义字段',
      'WebDAV 备份恢复、发布说明与契约测试脚手架',
      '版本号统一收敛至 v1.0.0 基线'
    ]
  },
  {
    version: '1.0.0', date: '2026-07-01',
    items: [
      '地球Online 网页端初版发布（零依赖原生 JS，可部署 GitHub Pages）',
      '任务（主线/支线/Todo）、背包、笔记、相册、足迹基础功能',
      '日历与今日看板、设置与数据管理、PWA 离线可安装'
    ]
  }
]

// ---------- 工具 ----------
export function uid(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8)
  return (prefix || 'id') + '_' + Date.now().toString(36) + rnd
}
export function todayStr(d) {
  const x = d ? new Date(d) : new Date()
  const p = (n) => String(n).padStart(2, '0')
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate())
}
export function clampProgress(v) {
  const n = Number(v)
  if (isNaN(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}
export function parseTagsInput(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean)
  return String(v || '')
    .split(/[,#\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}
export function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b)
  return Math.round((db - da) / 86400000)
}
export function getAge(birth) {
  if (!birth) return null
  const b = new Date(birth)
  if (isNaN(b)) return null
  const n = new Date()
  let age = n.getFullYear() - b.getFullYear()
  const m = n.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) age--
  return age
}
export function getLifeStats(birth) {
  const age = getAge(birth)
  if (age == null) return { age: 0, daysLived: 0, daysToNext: 0, nextBirthday: null, progress: 0, hasBirth: false }
  const b = new Date(birth)
  const now = new Date()
  const daysLived = Math.max(0, daysBetween(b, now))
  const nextBirthday = new Date(now.getFullYear(), b.getMonth(), b.getDate())
  if (nextBirthday < now) nextBirthday.setFullYear(now.getFullYear() + 1)
  const daysToNext = Math.max(0, daysBetween(now, nextBirthday))
  const lifeExpect = 80
  const progress = Math.min(1, Math.max(0, (age + (1 - daysToNext / 365)) / lifeExpect))
  return { age, daysLived, daysToNext, nextBirthday: todayStr(nextBirthday), progress, hasBirth: true }
}

// ---------- 彩蛋计数器 ----------
export const EGG_COUNTERS = ['blankTitleTries', 'throwbackViewed', 'albumViewed']
export function sanitizeEggs(raw) {
  const out = { blankTitleTries: 0, throwbackViewed: 0, albumViewed: 0 }
  if (raw && typeof raw === 'object') {
    for (const k of EGG_COUNTERS) {
      const v = Number(raw[k])
      if (isFinite(v) && v >= 0) out[k] = Math.min(Math.floor(v), 999999)
    }
  }
  return out
}
export function bumpEgg(eggs, key, delta) {
  if (!eggs || !EGG_COUNTERS.includes(key)) return
  const d = delta && isFinite(delta) && delta > 0 ? Math.floor(delta) : 1
  eggs[key] = Math.min((eggs[key] || 0) + d, 999999)
}

// ---------- 历年今日 ----------
export function onThisDayMemories(state, day) {
  const key = day || todayStr()
  const mmdd = key.slice(5)
  const out = []
  const pushMemo = (m) => {
    if (m && m.createdAt && m.createdAt.slice(5) === mmdd) {
      out.push({ kind: 'memo', id: m.id, text: (m.title || m.markdown || '').slice(0, 60), date: m.createdAt })
    }
  }
  ;(state.memos || []).forEach(pushMemo)
  return out
}

// ---------- 容错清洗（保证 save->load 幂等） ----------
function str(v, max) {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  return max ? s.slice(0, max) : s
}
function arrOf(v) {
  return Array.isArray(v) ? v : []
}
function clamp01(v, def) {
  const n = Number(v)
  if (!isFinite(n)) return def
  return Math.min(1, Math.max(0, n))
}
function clampNum(v, min, max, def) {
  const n = Number(v)
  if (!isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return defaultState()
  const d = defaultState()
  const s = {
    version: 3,
    birthDate: str(raw.birthDate, 30),
    tasks: arrOf(raw.tasks).filter((t) => t && typeof t === 'object').map((t) => ({
      id: str(t.id) || uid('task'),
      parentId: t.parentId || null,
      category: TASK_CATEGORY[t.category] ? t.category : 'side',
      title: str(t.title),
      status: TASK_STATUS[t.status] ? t.status : 'planning',
      progress: clampProgress(t.progress),
      note: str(t.note, 20000),
      dueDate: t.dueDate || null,
      dueTime: /^\d{2}:\d{2}$/.test(t.dueTime || '') ? t.dueTime : null,
      createdAt: str(t.createdAt, 30) || todayStr(),
      lastModified: str(t.lastModified, 30) || todayStr(),
      doneAt: t.doneAt || null,
      tags: parseTagsInput(t.tags),
      deletedAt: t.deletedAt || null
    })),
    memos: arrOf(raw.memos).filter((m) => m && typeof m === 'object').map((m) => ({
      id: str(m.id) || uid('memo'),
      title: str(m.title, 200),
      markdown: str(m.markdown, 50000),
      type: MEMO_TYPE[m.type] ? m.type : 'note',
      tags: parseTagsInput(m.tags),
      createdAt: str(m.createdAt, 30) || todayStr(),
      updatedAt: str(m.updatedAt, 30) || todayStr(),
      deletedAt: m.deletedAt || null
    })),
    items: arrOf(raw.items).filter((i) => i && typeof i === 'object').map((i) => ({
      id: str(i.id) || uid('item'),
      name: str(i.name, 200),
      type: ITEM_TYPE[i.type] ? i.type : 'physical',
      category: str(i.category, 60),
      count: Number(i.count) || 1,
      description: str(i.description, 20000),
      cover: str(i.cover, 200000),
      tags: parseTagsInput(i.tags),
      createdAt: str(i.createdAt, 30) || todayStr(),
      deletedAt: i.deletedAt || null
    })),
    achievements: arrOf(raw.achievements).filter((a) => a && typeof a === 'object').map((a) => ({
      key: str(a.key), unlockedAt: str(a.unlockedAt, 30) || todayStr()
    })),
    profile: Object.assign(d.profile, raw.profile && typeof raw.profile === 'object' ? raw.profile : {}),
    collections: arrOf(raw.collections).filter((c) => c && typeof c === 'object').map((c) => ({
      id: str(c.id) || uid('col'),
      title: str(c.title, 200),
      content: str(c.content, 50000),
      category: str(c.category, 60),
      cover: str(c.cover, 3000000),
      url: str(c.url, 1000),
      fileMeta: c.fileMeta && typeof c.fileMeta === 'object'
        ? { name: str(c.fileMeta.name, 200), mime: str(c.fileMeta.mime, 120), size: Number(c.fileMeta.size) || 0, dataUrl: str(c.fileMeta.dataUrl, 8000000) }
        : null,
      tags: parseTagsInput(c.tags),
      createdAt: str(c.createdAt, 30) || todayStr(),
      deletedAt: c.deletedAt || null
    })),
    activities: arrOf(raw.activities).filter((a) => a && typeof a === 'object').map((a) => ({
      id: str(a.id) || uid('act'), icon: str(a.icon, 20), text: str(a.text, 300), time: str(a.time, 30) || todayStr()
    })),
    trash: arrOf(raw.trash).filter((t) => t && typeof t === 'object').map((t) => ({
      id: str(t.id) || uid('tr'),
      kind: TRASH_KINDS.includes(t.kind) ? t.kind : 'task',
      data: t.data || {},
      deletedAt: str(t.deletedAt, 30) || todayStr(),
      expireAt: str(t.expireAt, 30) || todayStr()
    })),
    locations: arrOf(raw.locations).filter((l) => l && typeof l === 'object' && isFinite(Number(l.lat)) && isFinite(Number(l.lng))).map((l) => ({
      id: str(l.id) || uid('loc'),
      name: str(l.name, 100) || '未命名足迹',
      lat: Number(l.lat), lng: Number(l.lng),
      date: /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : todayStr(),
      note: str(l.note, 20000),
      tags: parseTagsInput(l.tags),
      deletedAt: l.deletedAt || null
    })),
    photos: arrOf(raw.photos).filter((p) => p && typeof p === 'object' && String(p.dataUrl || '').startsWith('data:')).map((p) => ({
      id: str(p.id) || uid('photo'),
      name: str(p.name, 120),
      category: str(p.category, 60),
      dataUrl: str(p.dataUrl, 3000000),
      tags: parseTagsInput(p.tags),
      createdAt: str(p.createdAt, 30) || todayStr(),
      deletedAt: p.deletedAt || null
    })),
    ledgerOpened: !!raw.ledgerOpened,
    itemCategories: arrOf(raw.itemCategories).filter((c) => c && typeof c === 'object' && str(c.name)).map((c) => ({ name: str(c.name, 60), icon: str(c.icon, 20) })),
    collectionCategories: arrOf(raw.collectionCategories).filter((c) => c && typeof c === 'object' && str(c.name)).map((c) => ({ name: str(c.name, 60), icon: str(c.icon, 20) })),
    calendarNotes: raw.calendarNotes && typeof raw.calendarNotes === 'object' ? raw.calendarNotes : {},
    aiConfig: raw.aiConfig && typeof raw.aiConfig === 'object'
      ? { baseUrl: str(raw.aiConfig.baseUrl, 500), apiKey: str(raw.aiConfig.apiKey, 500), model: str(raw.aiConfig.model, 200) }
      : { baseUrl: '', apiKey: '', model: '' },
    steam: raw.steam && typeof raw.steam === 'object'
      ? { apiKey: str(raw.steam.apiKey, 500), steamId: str(raw.steam.steamId, 60), proxy: str(raw.steam.proxy, 500) }
      : { apiKey: '', steamId: '', proxy: '' },
    wallpaper: str(raw.wallpaper, 3000000),
    wallAlpha: clamp01(raw.wallAlpha, 1),
    wallBlur: clampNum(raw.wallBlur, 0, 30, 0),
    // v2.0.0 P0-6：卡片不透明度与 Android LocalCardOpacity=0.8f 对齐。
    // 未打过 v2 标记的历史存档（出厂 50%）一律强制拉到 80%，标记后尊重用户手调值。
    cardAlpha: raw.cardAlphaV2 ? clamp01(raw.cardAlpha, 0.8) : 0.8,
    glassAlphaMigrated: true,
    cardAlphaV2: true,
    lastSyncAt: str(raw.lastSyncAt, 40),
    ledger: sanitizeLedger(raw.ledger),
    eggs: sanitizeEggs(raw.eggs),
    whiteboardNodes: arrOf(raw.whiteboardNodes).filter((n) => n && typeof n === 'object' && n.id).map(sanitizeWhiteboardNode),
    whiteboardEdges: arrOf(raw.whiteboardEdges).filter((e) => e && typeof e === 'object' && e.id).map(sanitizeWhiteboardEdge),
    dashboardLayout: arrOf(raw.dashboardLayout).filter((l) => l && typeof l === 'object' && l.i).map(sanitizeDashboardItem),
    biLinks: arrOf(raw.biLinks).filter((b) => b && typeof b === 'object' && b.id).map(sanitizeBiLink),
    enableCustomContextMenu: raw.enableCustomContextMenu === false ? false : true,
    enableClipboardWatch: raw.enableClipboardWatch === false ? false : true
  }
  // 旧模型 trash[] → 新模型 deletedAt（记录搬回各自集合，回收站内容不丢）
  migrateTrashToDeletedAt(s)
  return s
}

export function pushActivity(state, icon, text) {
  state.activities.unshift({ id: uid('act'), icon, text, time: todayStr() })
  if (state.activities.length > 60) state.activities.length = 60
}

// ---------- v2.1.0：白板 / 看板 / 双向链接 容错清洗 ----------
function sanitizeWhiteboardNode(n) {
  const id = str(n.id) || uid('wbn')
  const type = ['task', 'memo', 'item', 'photo', 'note'].includes(n.type) ? n.type : 'note'
  return {
    id,
    type,
    refId: str(n.refId, 80) || null,
    x: clampNum(n.x, -100000, 100000, 0),
    y: clampNum(n.y, -100000, 100000, 0),
    w: clampNum(n.w, 120, 1200, 200),
    h: clampNum(n.h, 80, 1200, 140),
    color: str(n.color, 20) || 'amber',
    text: str(n.text, 2000),
    createdAt: str(n.createdAt, 30) || todayStr(),
    updatedAt: str(n.updatedAt, 30) || todayStr(),
    deletedAt: n.deletedAt || null
  }
}
function sanitizeWhiteboardEdge(e) {
  return {
    id: str(e.id) || uid('wbe'),
    from: str(e.from, 80),
    to: str(e.to, 80),
    label: str(e.label, 60),
    createdAt: str(e.createdAt, 30) || todayStr(),
    deletedAt: e.deletedAt || null
  }
}
function sanitizeDashboardItem(l) {
  return {
    i: str(l.i, 60) || uid('dash'),
    x: clampNum(l.x, 0, 100, 0),
    y: clampNum(l.y, 0, 100, 0),
    w: clampNum(l.w, 1, 12, 4),
    h: clampNum(l.h, 1, 24, 6),
    module: ['chart', 'calendar', 'tasks', 'stats', 'recent'].includes(l.module) ? l.module : 'tasks'
  }
}
function sanitizeBiLink(b) {
  const types = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'ledger']
  return {
    id: str(b.id) || uid('bil'),
    sourceType: types.includes(b.sourceType) ? b.sourceType : 'memo',
    sourceId: str(b.sourceId, 80),
    targetType: types.includes(b.targetType) ? b.targetType : 'task',
    targetId: str(b.targetId, 80),
    createdAt: str(b.createdAt, 30) || todayStr(),
    deletedAt: b.deletedAt || null
  }
}
