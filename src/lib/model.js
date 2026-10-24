// ===== 地球Online Web · 数据模型与纯函数层 =====
// 字段名严格对齐旧版 earth_data 存档，保证历史数据无缝加载。
export const APP_INFO = {
  appName: '地球Online',
  version: '2.0.0',
  buildDate: '2026-10-24',
  channel: 'web'
}
export const STORAGE_KEY = 'earth_data'
export const TRASH_TTL_DAYS = 30
export const TRASH_KINDS = ['task', 'item', 'collection', 'memo', 'location', 'photo']

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
    cardAlpha: 1,
    ledger: { records: [], expenseCategories: [], incomeCategories: [] },
    eggs: sanitizeEggs(null)
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
export const CHANGELOG = [
  {
    version: '2.0.0', date: '2026-10-24',
    items: [
      '全局液态玻璃材质：所有卡片强制毛玻璃 + 半透明白 + 高光白边，透出底层壁纸',
      '主页真 3D 层叠卡片（拖拽切换、景深透视、页码随滑动更新）',
      '速览改为主页内悬浮快捷操作：新任务 / 装背包 / 写笔记 / 传照片 / 记一笔 / 回收站',
      '记账模块：多巴胺多色环形图 + 收支趋势柱状图 + 分类管理 + 胶囊按钮',
      '列表页统一：添加按钮移至右上、全局搜索（标签/关键字）、卡片二次编辑',
      '地图深度交互：双击建足迹、搜索切换「地点/足迹」、列表点击自动居中',
      '主页卡片自适应：两栏可拖拽调节、同行动态等高、时间轴/动态限高滚动',
      '空状态全面矢量插画化（Todo 补「轻松搞定琐碎小事」等治愈系文案）',
      'Steam 入口精简、配置页输入框液态玻璃圆角化'
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
      tags: parseTagsInput(t.tags)
    })),
    memos: arrOf(raw.memos).filter((m) => m && typeof m === 'object').map((m) => ({
      id: str(m.id) || uid('memo'),
      title: str(m.title, 200),
      markdown: str(m.markdown, 50000),
      type: MEMO_TYPE[m.type] ? m.type : 'note',
      tags: parseTagsInput(m.tags),
      createdAt: str(m.createdAt, 30) || todayStr(),
      updatedAt: str(m.updatedAt, 30) || todayStr()
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
      createdAt: str(i.createdAt, 30) || todayStr()
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
      createdAt: str(c.createdAt, 30) || todayStr()
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
      tags: parseTagsInput(l.tags)
    })),
    photos: arrOf(raw.photos).filter((p) => p && typeof p === 'object' && String(p.dataUrl || '').startsWith('data:')).map((p) => ({
      id: str(p.id) || uid('photo'),
      name: str(p.name, 120),
      category: str(p.category, 60),
      dataUrl: str(p.dataUrl, 3000000),
      tags: parseTagsInput(p.tags),
      createdAt: str(p.createdAt, 30) || todayStr()
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
    cardAlpha: clamp01(raw.cardAlpha, 1),
    ledger: sanitizeLedger(raw.ledger),
    eggs: sanitizeEggs(raw.eggs)
  }
  return s
}

export function pushActivity(state, icon, text) {
  state.activities.unshift({ id: uid('act'), icon, text, time: todayStr() })
  if (state.activities.length > 60) state.activities.length = 60
}
