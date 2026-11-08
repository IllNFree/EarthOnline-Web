// ===== 地球Online Web · 数据模型与纯函数层 =====
// 字段名严格对齐旧版 earth_data 存档，保证历史数据无缝加载。
export const APP_INFO = {
  appName: '地球Online',
  version: '3.0.1',
  buildDate: '2026-11-08',
  channel: 'web'
}
export const STORAGE_KEY = 'earth_data'
// ---------- v2.1.1 画布精简：堆叠组（Stack Group）----------
// 旧模型用「画框（whiteboardFrames）」同时承载 分区框 与 堆叠组 两种语义；
// 新模型彻底删除画框：堆叠组只保留「成员关系 + 槽位顺序」，坐标一律绝对坐标。
// · stackId  —— 所属堆叠组 id（null = 自由卡片）
// · stackIdx —— 组内槽位（0 = 顶层卡，其余逐层向下露出标题边）
export const STACK_STRIP_H = 36   // 下层卡片压缩成一条标题边的高度
export const STACK_DX = 18        // 下层卡片逐层向右下错位，形成清晰楼梯式纸堆（从第一张开始一层层往右下角重叠）
export const STACK_DY = 18        // 与 STACK_DX 等值 → 45° 对角线错位，四边露出的错位距离绝对均匀
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
    customFields: [],
    // 个人主页：加入日期（首次创建存档时写入）与第三方主页链接（GitHub / B站 / Steam / 微博 / X）
    joinedAt: todayStr(),
    links: {}
  }
}
// 个人主页博客：独立文章模型 + 外链分享（与笔记 / 收藏解耦，可跨端单独备份）
// posts：source='note' 表示由笔记导入（noteId 指向原 memo），'self' 表示站内新写；
// links：外链聚合，cover 为空时由 UI 用域名首字渐变占位。
export function defaultBlog() {
  return { posts: [], links: [] }
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
    blog: defaultBlog(),
    activities: [],
    trash: [],
    locations: [],
    photos: [],
    ledgerOpened: false,
    itemCategories: [],
    collectionCategories: [],
    calendarNotes: {},
    aiConfig: { baseUrl: '', apiKey: '', model: '' },
    steam: { apiKey: '', steamId: '', proxy: '', profile: null, bio: '', showcases: [], manualGames: [] },
    wallpaper: '',
    wallAlpha: 1,
    wallBlur: 0,
    // v2.0.0 P0-6：卡片不透明度出厂默认与 Android 对齐 —— 80%（原 Web 为 50%）
    cardAlpha: 0.8,
    glassAlphaMigrated: true,
    // v2.0.0 一次性迁移标记：把历史用户（含出厂 50%）统一拉到 80% 基线，之后尊重用户手调值
    cardAlphaV2: true,
    // 模块三：主页图片「相框 / 无边框」偏好（默认相框）
    photoFrame: true,
    // v2.0.0 P0-1：WebDAV 同步水位线，用于拉云备份前的冲突比对（与 Android lastSyncAt 同语义）
    lastSyncAt: '',
    ledger: { records: [], expenseCategories: [], incomeCategories: [] },
    eggs: sanitizeEggs(null),
    // v2.1.0：白板便利贴节点与连线（持久化 + 纳入 WebDAV 同步契约，按主键合并）
    whiteboardNodes: [],
    whiteboardEdges: [],
    // v2.2.0 绘图层：手绘 / 形状 / 批注（按 spaceId 归属）
    whiteboardDrawings: [],
    // v2.1.0：自定义看板布局序列化（可拖拽模块位置）
    dashboardLayout: [],
    // v2.1.0：双向链接反向索引（系统级实体关联，覆盖全实体）
    biLinks: [],
    // v2.1.0：桌面级生产力交互开关（落库同步，对齐 Android 偏好）
    enableCustomContextMenu: true,
    enableClipboardWatch: true,
    // v2.1.0 模块二：实体自动同步至画布（默认开启，持久化）
    enableAutoCanvasSync: true,
    // v2.1.0 模块五：成就音效静音（默认关闭）
    achievementSoundMuted: false,
    // v2.1.0：主页默认视图（仪表盘 / 画布），设置中心可配
    // v2.1.0：Web 专属成就里程碑计数（白板 / 双链 / 看板 / AI / 导入 / 拖拽 / 剪贴板 / 周期报告）
    webMilestones: sanitizeWebMilestones(null),
    // v2.1.0 模块六：平台化插件系统（已安装插件清单，含启用状态 / 权限授权记录）
    // 内置插件（Steam 游戏库）必须出厂即在清单内，否则插件中心首次进入显示为空
    plugins: BUILTIN_PLUGINS.map((p) => Object.assign({}, p, { permissions: [...p.permissions] })),
    // v2.2.3 插件发现：远程清单订阅地址（仅存 URL，不存清单内容）
    pluginSources: [],
    // v2.1.0 模块二：画布数据面板可见性（kind → bool，缺省全开）
    canvasPanels: defaultCanvasPanels(),
    // v2.1.1 画布精简：分区框（Zoning）体系已彻底移除，堆叠组改为节点级元数据（stackId / stackIdx）
    stackMode: 'waterfall',
    cardRadius: 18,
    // v2.2.0 多级空间（Space）架构：空间枢纽 + 嵌套空间 + 独立视口记忆
    spaces: [],
    // v2.2.0 扁平模式：一键关闭阴影 / 毛玻璃 / 3D 悬浮，换取极致流畅
    flatMode: false,
    // v2.2.0 画布背景样式（圆点 / 网格 / 线条 / 自定义图片 + 透明度）
    canvasBgStyle: 'dot',
    canvasBgOpacity: 0.5,
    canvasBgImage: '',
    // v2.1.0 模块二：画布双击空白处新建（开关可关，关闭后双击不再唤起新建面板）
    canvasDblClickCreate: true,
    // v2.1.0 模块三：默认布局迁移标记（不常用卡片收纳进卡片堆叠组，仅执行一次）
    canvasStackV1: false,
    // v2.2.4：智能排版 / 低频收纳 / 拆堆叠 迁移标记（必须持久化，否则每次加载都会重跑并覆盖用户布局）
    canvasStackV2: false,
    canvasUnstackV1: false,
    arcmindHomeV3: false,
    arcmindHomeV4: false,
    homeLayoutV3: false,
    // 主页 Bento 版式版本号（0 = 下次进入主页需重新铺开默认版式；
    // 清空数据后必须归零，否则主页只剩数据面板、装饰卡全部消失 →「卡片乱飞」）
    arcmindHomeV2: 0,
    // 黄金网格迁移标记（Bento 版式自带坐标，无需再迁移）
    goldenLayoutV1: false,
    // v2.5.0 默认视图迁移标记（2026-11-03：删热力图/背包/成就/Steam 默认堆叠 + 新错落布局）
    homeLayoutV5: false,
    // v2.5.x：足迹地图改为独立全屏页，移除画布上的地图卡片（仅一次，已被 mapCardBackV1 取代）
    noMapCardV1: false,
    // v2.5.x 还原（2026-11-03）：地图卡片回归主页（无边框）—— 恢复被 noMapCardV1 关闭的开关并复活被软删的地图面板
    mapCardBackV1: false,
    // v2.5.3 还原（2026-11-03 晚）：背包/成就/Steam 恢复进默认视图（用户只要求删热力图）+ 默认堆叠
    lowFreqBackV1: false,
    lowFreqStackV1: false,
    // v2.1.0 终极封板：自定义强调色（空串 = 跟随默认 Haze 主题色）
    accent: '',
    // v2.1.0 终极封板：画布模板（另存为模板 / 一键套用）
    canvasTemplates: [],
    // v2.1.0 终极封板：自动备份 + 回收站保留天数
    autoBackup: { enabled: true, intervalMin: 30 },
    trashRetentionDays: 30
  }
}
export function sanitizeCanvasTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const t = {
    id: str(raw.id, 80) || uid('tpl'),
    name: str(raw.name, 60) || '未命名模板',
    createdAt: str(raw.createdAt, 30) || todayStr(),
    // 保存画布布局；card 类卡片（无 refId）的 text/cardData 属于画布内容，一并保留
    nodes: arrOf(raw.nodes).filter((n) => n && n.id).map((n) => ({
      id: str(n.id, 80), type: str(n.type, 20), panelKind: str(n.panelKind, 40) || null,
      cardKind: str(n.cardKind, 40) || null, refId: str(n.refId, 80) || null, x: Number(n.x) || 0, y: Number(n.y) || 0,
      w: Number(n.w) || 200, h: Number(n.h) || 140, color: str(n.color, 20) || 'amber',
      text: str(n.text, 4000) || null, cardData: (n.cardData && typeof n.cardData === 'object' && !Array.isArray(n.cardData)) ? n.cardData : null,
      stackId: str(n.stackId, 40) || null, stackIdx: typeof n.stackIdx === 'number' ? n.stackIdx : 0
    }))
  }
  return t
}

// ---------- 记账 ----------
export const LEDGER_EXPENSE_PRESET = [
  { name: '餐饮', icon: 'cake' }, { name: '交通', icon: 'flag' }, { name: '购物', icon: 'gift' },
  { name: '居住', icon: 'home' }, { name: '娱乐', icon: 'sparkles' }, { name: '医疗', icon: 'heart' },
  { name: '学习', icon: 'book' }, { name: '人情往来', icon: 'gift' }, { name: '通讯', icon: 'bolt' },
  { name: '旅行', icon: 'flag' }, { name: '宠物', icon: 'heart' }, { name: '其他', icon: 'tag' }
]
export const LEDGER_INCOME_PRESET = [
  { name: '工资', icon: 'wallet' }, { name: '奖金', icon: 'coins' }, { name: '兼职', icon: 'bolt' },
  { name: '理财收益', icon: 'chart' }, { name: '红包', icon: 'gift' }, { name: '报销', icon: 'coins' },
  { name: '其他', icon: 'tag' }
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
    version: '3.0.1', date: '2026-11-08',
    items: [
      '照片卡视觉统一：画布与相册照片改为满幅无边框，仅保留 10px 轻微圆角',
      '时间卡：文本冒号替换为圆点分隔，排版更贴近地球Online整体 UI',
      '天气卡：正面新增 5 日高低温曲线与体感 / 湿度 / AQI / 风指标，详情改为底部抽屉上滑动画',
      '音乐卡：保留原有样式，播放时封面唱片平滑旋转（暂停即减速待机）',
      '足迹编辑：点击已保存足迹即可回填表单修改名称 / 日期 / 备注 / 标签，保存后地图标记同步更新',
      '成就系统：取消稀有度（等级）设定，统一解锁光效与音效，保留进度与解锁记录',
      '通知中心：成就动态不再按稀有度筛选，改为展示最近解锁的成就'
    ]
  },
  {
    version: '3.0.0', date: '2026-11-06',
    items: [
      '版本号统一：Web 与 Android 同步升至 3.0.0，两端备份契约与博客数据字段保持同一口径',
      'Android 对齐：个人主页博客文章系统 —— 文章 / 草稿 / 标签云 / 按月归档 / 从笔记导入 / 置顶 / 分享链接',
      'Android 对齐：无限画布基础版 —— 卡片 / 连线 / 平移缩放 / 多选 / 属性面板 / 深色适配 / 「无量空处」彩蛋',
      '备份契约补齐 blog.posts / blog.links：导出过滤软删墓碑，导入按 id 合并，旧备份不影响本地文章',
      // 原 v2.1.0 的全部更新已并入 3.0.0（取消独立的 2.1.0 版本条目），以下为完整增量记录
      '画布即主页（终极重构）：移除独立仪表盘，主页唯一入口即无限画布，任务 / 笔记 / 照片 / 物品 / 收藏 / 足迹 / 洞察均可作为便利贴，支持磁吸、碰撞避让、智能堆叠与语义连线',
      '画布沉浸体验：主页隐藏顶部全局状态栏，左侧不再拥堵；画布工具栏重构为底部居中胶囊 Dock（放大缩小、连线、检索、一键整理、分区、框选、导出），并保留满血 Haze 磨砂玻璃质感',
      '导出按钮重设计：原画布导出入口替换为直观的【下载】图标，整合进底部胶囊工具栏，一键导出只读 HTML',
      '双击空白新建：新增浏览器默认行为拦截（阻止双击误选中文字），并在「设置 → 桌面级交互」中提供「画布双击新建」开关',
      '设置页滚动体验：顶部锚点导航改为随页面正常滚动（取消 sticky / fixed 悬浮遮挡），点击锚点平滑滚动且标题不再被遮挡',
      'Steam 游戏库重构：绑定入口移至右上角模态框，主页面采用小黑盒风格网格卡片（封面图、名称、总时长、近两周时长、成就进度）',
      '全局空状态统一：提取独立 EmptyState 组件，所有模块复用同一套带玻璃卡片框的空状态样式，修复任务 / 背包页空状态卡片重叠问题',
      '隐私政策补全：新增「WebDAV 加密同步」与「插件沙箱隔离」数据安全说明，如实陈述第三方服务数据流向',
      '全局顶栏彻底移除：所有页面（含主页、功能页、设置页）不再有顶部 Header，原顶栏的搜索 / 设置入口下沉到桌面侧边栏顶部与移动端底部导航',
      '设置页锚点导航改为悬浮胶囊（fixed + 满血 Haze），随滚动常驻顶部不遮挡内容，目标区块配 scroll-margin-top 保证标题不被压住',
      '全局空状态去卡片化：移除空状态的背景卡片框 / 边框 / 阴影，改为纯透明居中 + 留白呼吸感，图标徽标保留液态玻璃质感',
      '画布双击误选彻底修复：根 DOM 全局拦截 mousedown / dblclick，强制 preventDefault + stopPropagation',
      '画布节点整块可拖：解除「只能拖顶部标题栏」的限制，位移超过阈值即进入拖拽，拖拽后抑制 click / dblclick，与单击连线、双击编辑互不冲突',
      '分区画框增强：支持拖动（带阈值防误触），新增折叠收纳按钮，折叠后仅保留标题、内部节点与连线隐藏，释放画布空间',
      '通知设置精简：待关注提醒只保留高价值事件 —— 任务临近死线、史诗级成就解锁、WebDAV 同步失败',
      '右键菜单收敛为四个核心项：刷新数据 / 立即备份 / 本地搜索 / 设置（全局与画布空白处一致）',
      '侧边栏扩展区顺序重排：Steam 游戏库 → AI 中枢 → 成就殿堂 → 数据中心 → 插件中心',
      '数据中心融合：新增【周期报告】模块，统合日报 / 周报 / 月报 / 年报，可由 AI 统一生成并展示',
      '成就系统同步 v2.1.0：新增 11 项 Web 专属成就（画布 / 双链 / 看板 / AI / 导入 / 拖拽 / 剪贴板 / 周期报告）',
      '拖拽松手误触跳转彻底修复：真正发生拖拽后短暂屏蔽 click / 页面跳转，只有未产生有效位移的纯点击才会执行跳转，拖拽与点击各行其道',
      '画布自由排布：取消碰撞避让，节点可自由重叠，最近操作的节点自动置顶，摆放更随心',
      '撤销 / 重做引擎：Cmd / Ctrl + Z 撤销、Shift + Z 或 Ctrl + Y 重做，覆盖拖拽、缩放、连线、删除等全部画布操作，最多回溯 80 步',
      '键盘快捷删除：选中节点后按 Delete / Backspace 直接删除，配合框选可一次批量删除多个节点',
      '画布锁定：一键锁定后节点与分区不可拖动 / 缩放，仅可平移与缩放画布，防止误操作',
      '演示模式：一键隐藏侧栏、悬浮球、底栏与小地图，画布铺满整屏专注展示；Esc 或点按底栏即可退出',
      '小地图导航：右下角缩略图实时呈现全部节点分布与当前视口，点击地图任意处快速跳转定位',
      '画布模板：可将当前节点与分区另存为模板，随时一键套用到新画布，也支持删除管理',
      '全局语义检索快捷键：Cmd / Ctrl + K 随时随地唤起搜索，自然语言直达任务 / 记账 / 相册 / 笔记',
      '本地时光机：重大操作（如批量删除）前自动留存快照，可一键回到此前任意版本',
      '全量数据加密备份：新增 AES-GCM 加密导出 / 导入，用自定义密码在本机加密后再落盘，密码绝不上传',
      '多标签页实时同步：多个标签页同时打开时数据自动保持一致，一处修改处处更新',
      '定时静默备份与自动清理：按设定周期在后台静默备份，回收站超过保留期自动清理，无需手动打理',
      '全局异常隔离：单个模块出错也不会白屏，界面给出友好提示并可就地恢复',
      '自定义主题强调色：外观设置新增强调色色板与任意取色，按钮、光晕与高亮随主题实时联动，保留满血 Haze 玻璃质感',
      '日历卡片整月视图：日历面板改为完整 7 列 × 6 行整月网格（周一起始），每个日期格聚合当天任务与待办并打点计数，今日高亮、非本月日期置灰，支持左右翻月',
      '日历自适应缩放：卡片拉大时日期格内直接显示任务名称，卡片缩小时自动收缩为打点计数，字号随格子尺寸弹性缩放，永不溢出',
      '全局竖屏适配：手机竖屏下所有页面自动切换为单列布局，卡片统一最大 90vw 居中，触控命中区放大至 44px，表单字号防 iOS 聚焦放大',
      '设置页竖屏横滑 Tab：顶部锚点导航在竖屏下变为可左右滑动的标签条，内容区单列满宽，标题不再被遮挡',
      '移动端「更多」导航：底部导航第七项改为「更多」，弹出底部功能面板，相册 / 足迹 / 记账 / AI 中枢 / 成就殿堂 / 插件中心 / 回收站 / 设置等全部入口一屏可达',
      '画布双指缩放：手机端支持双指捏合以两指中点为锚点缩放画布，单指仍保持拖拽节点与平移视口',
      '画布 Dock 竖屏收缩：窄屏下底部胶囊工具栏自动收紧并支持横向滑动，不再挤出屏幕，桌面端与横屏布局完全不受影响',
      '日历交互解耦：彻底移除「点击日历整卡跳转全屏页」的逻辑，改为只有点击具体日期格才触发交互；点日期即在画布上就地弹出当天任务 / 待办 / 记账详情（Haze 玻璃浮层），不离开画布，点空白处自动收起',
      '数据卡片与便利贴视觉强解耦：数据卡片统一为满血 Haze 毛玻璃 + 标准化标题栏 + 液态高光边缘；便利贴改为多彩纯色纸张、无标题栏、随手微旋转并带右上角折角阴影，画布上一眼可分',
      '默认画布布局重构：首次进入时日历 / 待办 / 记账三张高频核心卡片在视口中心错落展开；不常用的笔记 / 相册 / 背包 / 足迹 / Steam / 成就被默认收纳进「卡片堆叠组」，折叠时呈现一叠略微错开的卡片，单击像扇子一样展开、再点即叠起，组内卡片仍可拖出独立摆放',
      '卡片体系精简：双击空白的新建菜单收敛为 15 项（11 个数据面板 + 便利贴 / 音乐 / 时钟 + Steam 插件项），文字卡 / 链接卡 / 导航卡 / 导航面板 / 隐藏卡 / 热图卡退役，存量节点自动迁移为便利贴并保留正文',
      '同类数据面板支持重复新建，不再合并；插件关闭时其菜单项与画布卡片同步移除；任务与「待办」拆分为两张独立卡片',
      '日历面板议程同时显示「任务」「Todo」与记账（不同标记区分），任务同样支持设置截止日期与时间',
      '收藏面板支持就地新建收藏；新增「数据可视化」面板（六宫格指标 + 近 7 天活跃柱图）',
      '插件中心升级为管理页：已安装 / 发现 / 开发者三 Tab，支持安装、启停、卸载、逐项权限勾选、扩展点查看与异常重试、插件清单导入导出，并内置 4 个可安装示例插件',
      '新建空间入口补全：顶栏「空间」旁新增实心「新建空间」按钮，空间抽屉与画布空白右键菜单均保留新建入口',
      '顶栏工具条去重与重排：撤销 / 重做 / 新建空间 / 空间 / 默认布局 / 更多各自独立图标，扁平模式、属性面板、快捷键收进「更多」浮层；工具轨连线改用链接图标、整理改用排列图标',
      '画布背景自适应铺满：缩放极小时圆点 / 网格 / 横线按倍率自动合并间距并移除固定行列上限，全屏不再露出边缘空白带',
      '新增独立「用户协议与免责声明」页面；隐私政策补充插件清单导出 / 导入与画布空间数据的本地存储说明'
    ]
  },
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
      '收支配色规范化：收入鼠尾草绿 #7E9A7E / 支出陶土红 #A97C72',
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
      '液态玻璃视觉体系与苹果灰白蓝配色'
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

// v2.1.0：Web 专属成就里程碑计数（Web 独有能力，iOS / Windows / Android 不具备）
export const WEB_MILESTONES = [
  'aiChat', 'toolCall', 'dataImport', 'dragUpload', 'clipboardCatch', 'periodReport',
  'spaceCreate', 'groupCreate', 'crossSpaceMove', 'aiCard', 'aiSummary', 'musicPlay', 'themeSwitch'
]

export function sanitizeWebMilestones(raw) {
  const out = {}
  WEB_MILESTONES.forEach((k) => {
    const v = raw && typeof raw === 'object' ? Number(raw[k]) : 0
    out[k] = isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 999999) : 0
  })
  return out
}

// 累加里程碑计数（用于触发 Web 专属成就），返回是否发生变化
export function bumpWebMilestone(state, key, delta) {
  if (!state || !WEB_MILESTONES.includes(key)) return false
  if (!state.webMilestones) state.webMilestones = sanitizeWebMilestones(null)
  const d = delta && isFinite(delta) && delta > 0 ? Math.floor(delta) : 1
  const before = state.webMilestones[key] || 0
  state.webMilestones[key] = Math.min(before + d, 999999)
  return state.webMilestones[key] !== before
}
// ---------- 画布数据面板（模块一 / 模块二：主页画布预置数据面板 + 开关） ----------
// 这是画布「数据面板节点」的 canonical 注册表：顺序即默认排布顺序。
// 模块一：默认布局改为错落有致 —— 大日历为视觉主角（约 2×2），其余卡片按不同 w/h 错落排布；
// x / y 为画布初始落位坐标（与 SANP 网格对齐），syncCanvasPanels 优先采用，缺失时退回三列网格。
export const CANVAS_PANELS = [
  // v2.5.3 暖白版式（2026-11-03 晚，仿用户参考稿）：行式对齐 + 统一 28px 间距，禁止重叠。
  // 行 1（y 0~440）：日历主视觉｜待办+记账｜笔记+时钟｜无边框足迹地图
  { kind: 'calendar', label: '日历聚合', icon: 'calendar', color: 'amber', x: 0, y: 0, w: 620, h: 440 },
  { kind: 'map', label: '足迹地图', icon: 'map-pin', color: 'blue', x: 1352, y: 0, w: 480, h: 440 },
  { kind: 'todo', label: '待办清单', icon: 'checklist', color: 'blue', x: 648, y: 0, w: 368, h: 208 },
  { kind: 'ledger', label: '近期记账', icon: 'wallet', color: 'green', x: 648, y: 232, w: 368, h: 208 },
  { kind: 'notes', label: '笔记列表', icon: 'note', color: 'purple', x: 1044, y: 0, w: 280, h: 208 },
  { kind: 'album', label: '相册预览', icon: 'album', color: 'pink', x: 396, y: 468, w: 280, h: 208 },
  // 背包/成就/Steam：恢复进默认视图，注册表坐标 = 堆叠组锚点 + k×18 对角错位（applyStackLowFreq 负责组网）
  { kind: 'backpack', label: '背包统计', icon: 'backpack', color: 'purple', x: 1352, y: 468, w: 280, h: 208 },
  { kind: 'steam', label: 'Steam 游戏库', icon: 'game', color: 'gray', x: 1370, y: 486, w: 280, h: 208 },
  { kind: 'achievements', label: '成就展示', icon: 'trophy', color: 'pink', x: 1388, y: 504, w: 280, h: 208 }
]
export const CANVAS_PANEL_KINDS = CANVAS_PANELS.map((p) => p.kind)
// 默认收纳进堆叠组的面板类型（2026-11-03：默认视图取消自动堆叠，恒为空；堆叠仍可手动拖拽合并）
export const STACK_PANEL_KINDS = []

// ===== ArcMind 主页版式（v2.4.0）：与参考设计稿逐像素对齐的默认画布 =====
// 只描述「长什么样」，不绑定任何业务数据；seedArcMindHome() 据此一次性铺开。

// ===== 主页默认版式（v2.5.3 暖白版式，2026-11-03 晚，仿用户参考稿） =====
// 行式对齐 + 统一 28px 间距（两行网格，禁止重叠）；
// 行 1：日历主视觉｜待办+记账｜笔记+时钟｜无边框足迹地图；行 2：音乐（红胶）｜相册｜便利贴｜背包/成就/Steam 堆叠组。
// 热力图卡已按用户指定移出默认视图；背包/成就/Steam 恢复并默认堆叠（applyRestoreLowFreq + applyStackLowFreq）。
export const ARCMIND_HOME = [
  { type: 'panel', panelKind: 'calendar', color: 'amber', x: 0, y: 0, w: 620, h: 440 },
  // 足迹地图：无边框地图卡（瓦片地图铺满卡面，可整卡拖动）
  { type: 'panel', panelKind: 'map', color: 'blue', x: 1352, y: 0, w: 480, h: 440 },
  { type: 'panel', panelKind: 'todo', color: 'blue', x: 648, y: 0, w: 368, h: 208 },
  { type: 'panel', panelKind: 'ledger', color: 'green', x: 648, y: 232, w: 368, h: 208 },
  { type: 'panel', panelKind: 'notes', color: 'purple', x: 1044, y: 0, w: 280, h: 208 },
  { type: 'panel', panelKind: 'album', color: 'pink', x: 396, y: 468, w: 280, h: 208 },
  // 音乐播放器（本地音频 + 网易云 + QQ 音乐）：行 2 首位 · 网易云红强调
  { type: 'card', cardKind: 'audio', color: 'gray', x: 0, y: 468, w: 368, h: 208, cardData: { title: '地球Online · 极简铺底', src: '/audio/demo-loop.wav', source: 'local', format: 'wav' } },
  // 本地时间：行 1 末位（amber 与日历呼应，分处同行两端）
  { type: 'card', cardKind: 'clock', color: 'amber', x: 1044, y: 232, w: 280, h: 208, cardData: { label: '本地时间' } }
]

// ===== 内置插件（模块三：Steam 游戏库插件化） =====
// 内置插件随应用发布、以普通插件条目的形态出现在「插件中心」，可开关；
// 关闭后其导航入口 / 页面路由 / 画布数据面板 / 相关数据一并隐藏。
export const BUILTIN_PLUGINS = [
  {
    id: 'builtin_steam',
    name: 'Steam 游戏库',
    version: '1.0.0',
    author: '内置',
    source: 'builtin',
    builtin: 'steam',
    entry: '',
    permissions: [],
    enabled: false,
    removable: false,
    // 插件提供的左侧导航入口（挂载时注册到 pluginRegistry.navItems）
    nav: { name: 'steam', icon: 'cloud', label: 'Steam 游戏库', path: '/steam' },
    // 插件拥有的画布数据面板（关闭插件时该面板一并隐藏）
    panelKind: 'steam'
  }
]
export const BUILTIN_PLUGIN_IDS = BUILTIN_PLUGINS.map((p) => p.id)
// 取内置插件在已安装列表中的实例（未安装则按默认定义返回）
export function builtinPluginInstance(plugins, id) {
  const list = Array.isArray(plugins) ? plugins : []
  const found = list.find((p) => p && p.id === id)
  if (found) return found
  const def = BUILTIN_PLUGINS.find((p) => p.id === id)
  return def ? Object.assign({}, def) : null
}
export function isBuiltinEnabled(plugins, id) {
  const inst = builtinPluginInstance(plugins, id)
  return !!(inst && inst.enabled)
}
export function defaultCanvasPanels() {
  const out = {}
  CANVAS_PANELS.forEach((p) => { out[p.kind] = !p.defaultOff })
  return out
}
export function sanitizeCanvasPanels(raw) {
  const out = defaultCanvasPanels()
  if (raw && typeof raw === 'object') {
    // 显式覆盖优先（true / false 都尊重）：defaultOff 面板可被用户手动开启
    CANVAS_PANELS.forEach((p) => {
      if (raw[p.kind] === false) out[p.kind] = false
      else if (raw[p.kind] === true) out[p.kind] = true
    })
  }
  return out
}

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
// 个人主页：旧存档没有 joinedAt —— 用最早一条业务记录的创建日期回填
function earliestCreatedAt(raw) {
  let min = ''
  ;['tasks', 'memos', 'items', 'collections', 'locations', 'photos'].forEach((k) => {
    arrOf(raw && raw[k]).forEach((x) => {
      const d = str(x && x.createdAt, 30).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!min || d < min)) min = d
    })
  })
  return min
}
// 个人主页：第三方链接只保留已知平台，值原样保存（展示时再做协议校验）
function sanitizeProfileLinks(raw) {
  const out = {}
  const d = raw && typeof raw === 'object' ? raw : {}
  ;['github', 'bilibili', 'steam', 'weibo', 'x'].forEach((k) => {
    const v = str(d[k], 600).trim()
    if (v) out[k] = v
  })
  return out
}
function sanitizeProfile(rawProfile, rawState) {
  const base = defaultProfile()
  const fallbackJoined = base.joinedAt
  const p = rawProfile && typeof rawProfile === 'object' ? rawProfile : {}
  const out = Object.assign(base, p)
  // 旧存档没有 joinedAt：优先回填最早一条记录的创建日期，仍无记录则用当天
  const rawJoined = str(p.joinedAt, 30).slice(0, 10)
  out.joinedAt = /^\d{4}-\d{2}-\d{2}$/.test(rawJoined) ? rawJoined : (earliestCreatedAt(rawState) || fallbackJoined)
  out.links = sanitizeProfileLinks(p.links)
  return out
}
// 个人主页博客：旧存档缺 blog 时补默认结构；坏条目直接丢弃（宁缺毋滥，避免空壳文章）
function sanitizeBlog(rawBlog) {
  const d = rawBlog && typeof rawBlog === 'object' ? rawBlog : {}
  return {
    posts: arrOf(d.posts)
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        id: str(p.id, 80) || uid('post'),
        title: str(p.title, 200),
        summary: str(p.summary, 400),
        cover: str(p.cover, 3000000),
        tags: parseTagsInput(p.tags),
        body: str(p.body, 200000),
        status: p.status === 'published' ? 'published' : 'draft',
        pinned: p.pinned === true,
        source: p.source === 'note' ? 'note' : 'self',
        noteId: str(p.noteId, 80) || null,
        createdAt: str(p.createdAt, 30) || todayStr(),
        updatedAt: str(p.updatedAt, 30) || todayStr(),
        // 软删除标记：仅用于跨端/备份合并去重，主页不渲染
        deletedAt: str(p.deletedAt, 40) || null
      }))
      .filter((p) => p.title || p.body),
    links: arrOf(d.links)
      .filter((l) => l && typeof l === 'object')
      .map((l) => ({
        id: str(l.id, 80) || uid('blink'),
        title: str(l.title, 200),
        url: str(l.url, 1000),
        cover: str(l.cover, 3000000),
        note: str(l.note, 2000),
        createdAt: str(l.createdAt, 30) || todayStr(),
        deletedAt: str(l.deletedAt, 40) || null
      }))
      .filter((l) => l.url)
  }
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
// ---------- v2.2.6：下线卡片种类（图表 / 倒计时 / 图片堆叠）与主页「资料库」便利贴 ----------
// 背景：用户要求删除「图表卡片 / 倒计时卡片 / 资料库卡片 / 图片堆叠」。
//  · chart / countdown / imageStack 是「纯展示、无业务实体」的卡片种类 —— 卡片种类下线，
//    存量节点必须一并移除，否则它们会退化成没有 cardKind 的空壳卡（渲染出一张空白卡）。
//  · 「资料库」便利贴是主页默认版式里的演示 memo，按 seed 文本指纹精确识别后移除，
//    不会误伤用户自己写的同名便利贴。
// ⚠️ 移除后必须重排堆叠组槽位：否则组内会留下空洞（stackIdx 跳号），错位渲染且翻页错乱。
const RETIRED_CARD_KINDS = ['chart', 'countdown', 'imageStack']
const RETIRED_SEED_MEMO = '☯  资料库\n文件夹 · 12'
function dropRetiredCanvasCards(nodes) {
  const kept = nodes.filter((n) => {
    if (n.type === 'card' && RETIRED_CARD_KINDS.includes(n.cardKind)) return false
    if (n.type === 'memo' && String(n.text || '') === RETIRED_SEED_MEMO) return false
    return true
  })
  if (kept.length === nodes.length) return nodes
  // 重排堆叠组槽位：同一 stackId 内按原 stackIdx 顺序重新编号（0 = 组顶）
  const bySid = new Map()
  kept.forEach((n) => {
    if (!n.stackId) return
    if (!bySid.has(n.stackId)) bySid.set(n.stackId, [])
    bySid.get(n.stackId).push(n)
  })
  bySid.forEach((list) => {
    list.sort((a, b) => (a.stackIdx || 0) - (b.stackIdx || 0))
    list.forEach((n, i) => { n.stackIdx = i })
  })
  return kept
}

// ---------- v2.2.6：演示便利贴位置迁移 ----------
// 演示便利贴（wbn-demo-sticky）原先落在 (856,488)，与足迹地图面板 (888,416) 叠压。
// 四张卡下线后 (0,592) 空出 ⇒ seed 位置改为 (0,592)。
// ⚠️ 条件迁移：只有「坐标仍等于旧 seed 位置」时才搬 —— 用户自己拖动过的必须尊重用户操作。
const DEMO_STICKY_OLD_POS = { x: 856, y: 488 }
const DEMO_STICKY_NEW_POS = { x: 0, y: 592 }
function migrateDemoSticky(nodes) {
  const n = nodes.find((x) => x && x.id === 'wbn-demo-sticky')
  if (!n) return nodes
  if (Math.abs((Number(n.x) || 0) - DEMO_STICKY_OLD_POS.x) > 1) return nodes
  if (Math.abs((Number(n.y) || 0) - DEMO_STICKY_OLD_POS.y) > 1) return nodes
  n.x = DEMO_STICKY_NEW_POS.x
  n.y = DEMO_STICKY_NEW_POS.y
  return nodes
}

// ---------- v2.1.1 画布精简：历史画框数据迁移 ----------
// 旧画框（whiteboardFrames）同时承载两种语义：
//   · stack === true  → 旧堆叠组：转写为节点级 stackId / stackIdx，坐标还原为绝对坐标
//   · stack !== true  → 旧分区框：内部卡片全部「原地释放」为独立节点，分区框随之丢弃
// 迁移幂等：已迁移的数据（无 frameId）直接原样返回，可反复加载。
function migrateLegacyFrames(raw) {
  const nodes = arrOf(raw && raw.whiteboardNodes).filter((n) => n && n.id)
  const frames = arrOf(raw && raw.whiteboardFrames).filter((f) => f && f.id)
  if (!frames.length) return nodes
  const frameById = new Map(frames.map((f) => [f.id, f]))
  const groups = new Map()
  nodes.forEach((n) => {
    n.spaceId = null
    const f = n.frameId ? frameById.get(n.frameId) : null
    if (!f) { n.stackId = null; n.stackIdx = 0; return }
    // 旧模型：子节点 x/y 是绝对坐标，rx/ry 是相对画框原点的偏移
    const ax = typeof n.rx === 'number' ? f.x + n.rx : (Number(n.x) || 0)
    const ay = typeof n.ry === 'number' ? f.y + n.ry : (Number(n.y) || 0)
    n.x = ax; n.y = ay
    delete n.frameId; delete n.rx; delete n.ry
    if (f.stack === true) {
      n.stackId = 'wsg_' + f.id
      n.stackIdx = 0
      if (!groups.has(f.id)) groups.set(f.id, [])
      groups.get(f.id).push(n)
    } else {
      // 旧分区框：卡片原地释放为独立节点
      n.stackId = null; n.stackIdx = 0
    }
  })
  // 旧堆叠组：还原「一叠纸」对角线排布（顶层卡占锚点，其余逐层往右下错位，与渲染/翻页公式完全一致）
  groups.forEach((list) => {
    const top = list[0]
    list.forEach((n, i) => {
      n.stackIdx = i
      if (i === 0) return
      n.x = top.x + i * STACK_DX
      n.y = top.y + i * STACK_DY
    })
  })
  return nodes
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
    profile: sanitizeProfile(raw.profile, raw),
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
    // 个人主页博客：缺省补默认结构，旧存档无缝升级
    blog: sanitizeBlog(raw.blog),
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
      ? {
          apiKey: str(raw.steam.apiKey, 500),
          steamId: str(raw.steam.steamId, 60),
          proxy: str(raw.steam.proxy, 500),
          profile: raw.steam.profile && typeof raw.steam.profile === 'object' ? {
            steamId: str(raw.steam.profile.steamId, 60),
            personaName: str(raw.steam.profile.personaName, 200),
            avatarFull: str(raw.steam.profile.avatarFull, 2000),
            avatarMedium: str(raw.steam.profile.avatarMedium, 2000),
            profileUrl: str(raw.steam.profile.profileUrl, 2000),
            bio: str(raw.steam.profile.bio, 2000),
            timecreated: Number(raw.steam.profile.timecreated) || 0,
            accountAgeYears: Number(raw.steam.profile.accountAgeYears) || 0,
            level: Number(raw.steam.profile.level) || 0,
            personastate: Number(raw.steam.profile.personastate) || 0,
            lastlogoff: Number(raw.steam.profile.lastlogoff) || 0
          } : null,
          bio: str(raw.steam.bio, 2000),
          showcases: Array.isArray(raw.steam.showcases)
            ? raw.steam.showcases.map((s) => str(s, 200)).filter(Boolean).slice(0, 8)
            : [],
          manualGames: Array.isArray(raw.steam.manualGames)
            ? raw.steam.manualGames.map((g) => ({
                appid: str(g.appid, 60),
                name: str(g.name, 200),
                playtimeHours: Number(g.playtimeHours) || 0
              })).filter((g) => g.name).slice(0, 200)
            : []
        }
      : { apiKey: '', steamId: '', proxy: '', profile: null, bio: '', showcases: [], manualGames: [] },
    wallpaper: str(raw.wallpaper, 3000000),
    wallAlpha: clamp01(raw.wallAlpha, 1),
    wallBlur: clampNum(raw.wallBlur, 0, 30, 0),
    // v2.0.0 P0-6：卡片不透明度与 Android LocalCardOpacity=0.8f 对齐。
    // 未打过 v2 标记的历史存档（出厂 50%）一律强制拉到 80%，标记后尊重用户手调值。
    cardAlpha: raw.cardAlphaV2 ? clamp01(raw.cardAlpha, 0.8) : 0.8,
    glassAlphaMigrated: true,
    cardAlphaV2: true,
    // 模块三：主页图片相框偏好（默认开启相框）
    photoFrame: raw.photoFrame === false ? false : true,
    lastSyncAt: str(raw.lastSyncAt, 40),
    ledger: sanitizeLedger(raw.ledger),
    eggs: sanitizeEggs(raw.eggs),
    whiteboardNodes: migrateDemoSticky(dropRetiredCanvasCards(
      arrOf(migrateLegacyFrames(raw)).filter((n) => n && typeof n === 'object' && n.id)
    )).map(sanitizeWhiteboardNode),
    // v2.2.0 多级空间（Space）架构
    spaces: sanitizeSpaces(raw.spaces),
    flatMode: raw.flatMode === true,
    canvasBgStyle: ['dot', 'grid', 'line', 'image', 'none'].includes(raw.canvasBgStyle) ? raw.canvasBgStyle : 'dot',
    canvasBgOpacity: clampNum(raw.canvasBgOpacity, 0.05, 1, 0.5),
    canvasBgImage: str(raw.canvasBgImage, 8 * 1024 * 1024),
    whiteboardEdges: arrOf(raw.whiteboardEdges).filter((e) => e && typeof e === 'object' && e.id).map(sanitizeWhiteboardEdge),
    whiteboardDrawings: arrOf(raw.whiteboardDrawings).filter((d) => d && d.id).map(sanitizeWhiteboardDrawing),
    dashboardLayout: arrOf(raw.dashboardLayout).filter((l) => l && typeof l === 'object' && l.i).map(sanitizeDashboardItem),
    biLinks: arrOf(raw.biLinks).filter((b) => b && typeof b === 'object' && b.id).map(sanitizeBiLink),
    enableCustomContextMenu: raw.enableCustomContextMenu === false ? false : true,
    enableClipboardWatch: raw.enableClipboardWatch === false ? false : true,
    enableAutoCanvasSync: raw.enableAutoCanvasSync === false ? false : true,
    achievementSoundMuted: raw.achievementSoundMuted === true ? true : false,
    webMilestones: sanitizeWebMilestones(raw.webMilestones),
    // v2.1.0 模块二：画布数据面板可见性开关
    canvasPanels: sanitizeCanvasPanels(raw.canvasPanels),
    // v2.1.1 画布精简：分区画框体系移除（历史数据在下方迁移为自由卡片 / 堆叠组）
    stackMode: ['waterfall', 'compact', 'bytype'].includes(raw.stackMode) ? raw.stackMode : 'waterfall',
    cardRadius: Math.min(28, Math.max(10, Number(raw.cardRadius) || 18)),
    canvasDblClickCreate: raw.canvasDblClickCreate === false ? false : true,
    canvasStackV1: raw.canvasStackV1 === true,
    canvasStackV2: raw.canvasStackV2 === true,
    canvasUnstackV1: raw.canvasUnstackV1 === true,
    arcmindHomeV3: raw.arcmindHomeV3 === true,
    arcmindHomeV4: raw.arcmindHomeV4 === true,
    homeLayoutV3: raw.homeLayoutV3 === true,
    // ⚠️ 这三个标记由 ops 在运行时写入 state 再随 persist 落库，此前未进 sanitize 白名单，
    // 导致每次加载都被丢弃 → applyGoldenLayout / seedCanvasDemo 每次加载都重跑并覆盖用户布局。
    // 2026-11-03 起正确持久化（与 ops.js 229 行注释「必须持久化」的意图一致）。
    goldenLayoutV1: raw.goldenLayoutV1 === true,
    canvasDemoV1: raw.canvasDemoV1 === true,
    homeLayoutV5: raw.homeLayoutV5 === true,
    noMapCardV1: raw.noMapCardV1 === true,
    mapCardBackV1: raw.mapCardBackV1 === true,
    lowFreqBackV1: raw.lowFreqBackV1 === true,
    lowFreqStackV1: raw.lowFreqStackV1 === true,
    // v2.1.0 模块六：插件清单（仅存授权后的元数据，绝不存代码本体 / 私密凭据）
    plugins: sanitizePlugins(raw.plugins),
    pluginSources: arrOf(raw.pluginSources)
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 20),
    // v2.1.0 终极封板：自定义强调色 / 画布模板 / 自动备份 / 回收站保留期
    accent: str(raw.accent, 32),
    canvasTemplates: arrOf(raw.canvasTemplates).map(sanitizeCanvasTemplate).filter(Boolean),
    autoBackup: raw.autoBackup && typeof raw.autoBackup === 'object'
      ? { enabled: raw.autoBackup.enabled !== false, intervalMin: clampNum(raw.autoBackup.intervalMin, 1, 240, 30) }
      : { enabled: true, intervalMin: 30 },
    trashRetentionDays: clampNum(raw.trashRetentionDays, 1, 365, 30)
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
// 插件清单清洗：保留用户条目的授权状态，并保证内置插件始终存在于清单中（默认开启）
function sanitizePlugins(raw) {
  const list = arrOf(raw).filter((p) => p && str(p.id)).map((p) => ({
    id: str(p.id, 80),
    name: str(p.name, 80) || str(p.id, 80),
    version: str(p.version, 30),
    author: str(p.author, 80),
    source: p.source === 'url' ? 'url' : (p.source === 'builtin' ? 'builtin' : 'local'),
    builtin: str(p.builtin, 40) || null,
    entry: p.source === 'url' ? str(p.entry, 2000) : '',
    permissions: arrOf(p.permissions).filter((x) => typeof x === 'string').map((x) => str(x, 40)),
    enabled: !!p.enabled,
    removable: p.source === 'builtin' ? false : true
  }))
  // 内置插件：清单缺失时补入（默认开启）；已存在则保留用户的开关状态
  BUILTIN_PLUGINS.forEach((b) => {
    const i = list.findIndex((p) => p.id === b.id)
    if (i < 0) list.push(Object.assign({}, b, { enabled: true }))
    else list[i] = Object.assign({}, b, list[i], { source: 'builtin', removable: false })
  })
  return list
}

function sanitizeWhiteboardNode(n) {
  const id = str(n.id) || uid('wbn')
  const rawType = n.type === 'note' ? 'memo' : n.type
  const type = ['task', 'memo', 'item', 'photo', 'collection', 'location', 'insight', 'profile', 'game', 'panel', 'ledger', 'card'].includes(rawType) ? rawType : 'memo'
  const rawKind = str(n.panelKind, 40)
  const rawCard = str(n.cardKind, 40)
  return {
    id,
    type,
    // 数据面板节点的子类型（背包统计 / 笔记列表 / …），非 panel 节点恒为 null
    panelKind: type === 'panel' && CANVAS_PANEL_KINDS.includes(rawKind) ? rawKind : null,
    // v2.2.0 卡片矩阵：画布原生卡片的子类型（文字 / 待办 / 图表 / 时钟 …），非 card 节点恒为 null
    cardKind: type === 'card' ? (rawCard || 'note') : null,
    refId: str(n.refId, 80) || null,
    x: clampNum(n.x, -100000, 100000, 0),
    y: clampNum(n.y, -100000, 100000, 0),
    w: clampNum(n.w, 120, 1200, 200),
    h: clampNum(n.h, 80, 1200, 140),
    color: str(n.color, 20) || 'amber',
    text: str(n.text, 2000),
    // v2.2.0 卡片矩阵：结构化卡片数据（图表序列 / 倒计时目标 / 健康指标 …），容错为对象
    cardData: (n.cardData && typeof n.cardData === 'object') ? n.cardData : null,
    // v2.1.0 终极重构：节点标签（自定义分组）
    tags: parseTagsInput(n.tags),
    // v2.1.1 画布精简：所属堆叠组（null = 自由卡片）+ 组内槽位（0 = 顶层卡）
    stackId: str(n.stackId, 40) || null,
    stackIdx: typeof n.stackIdx === 'number' && isFinite(n.stackIdx) ? Math.max(0, Math.floor(n.stackIdx)) : 0,
    // v2.2.0 多级空间：所属空间（null = 空间枢纽根层）
    spaceId: str(n.spaceId, 40) || null,
    createdAt: str(n.createdAt, 30) || todayStr(),
    updatedAt: str(n.updatedAt, 30) || todayStr(),
    deletedAt: n.deletedAt || null
  }
}
// ---------- v2.2.0 多级空间（Space）----------
// 空间：画布枢纽中的「文件夹」—— 双击进入 3D 展开，内部承载节点与子空间，并独立记忆视口。
function sanitizeSpaces(raw) {
  return arrOf(raw).filter((s) => s && s.id).map((s) => ({
    id: str(s.id, 40),
    name: str(s.name, 40) || '未命名空间',
    emoji: str(s.emoji, 8) || '📁',
    color: str(s.color, 20) || 'amber',
    parentId: s.parentId ? str(s.parentId, 40) : null,
    x: clampNum(s.x, -100000, 100000, 0),
    y: clampNum(s.y, -100000, 100000, 0),
    w: clampNum(s.w, 160, 1200, 240),
    h: clampNum(s.h, 120, 1200, 168),
    viewport: s.viewport && typeof s.viewport === 'object'
      ? {
          panX: clampNum(s.viewport.panX, -1000000, 1000000, 0),
          panY: clampNum(s.viewport.panY, -1000000, 1000000, 0),
          scale: clampNum(s.viewport.scale, 0.2, 2.5, 1)
        }
      : null,
    createdAt: str(s.createdAt, 30) || todayStr(),
    deletedAt: s.deletedAt || null
  }))
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
function sanitizeWhiteboardDrawing(d) {
  const tool = ['pen', 'fountain', 'pencil', 'hl', 'laser', 'line', 'rect', 'circle', 'scalpel', 'tri', 'star', 'erase'].includes(d.tool) ? d.tool : 'pen'
  const rawPts = Array.isArray(d.pts) ? d.pts.filter((p) => Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1])).slice(0, 4000) : []
  return {
    id: str(d.id) || uid('wbd'),
    spaceId: str(d.spaceId, 40) || null,
    tool,
    color: str(d.color, 20) || '#2C2C2C',
    width: clampNum(d.width, 1, 60, 3),
    opacity: clampNum(d.opacity, 0.1, 1, 1),
    pts: rawPts,
    // 形状类（line/rect/circle/tri/star）：起止点
    x1: clampNum(d.x1, -100000, 100000, 0), y1: clampNum(d.y1, -100000, 100000, 0),
    x2: clampNum(d.x2, -100000, 100000, 0), y2: clampNum(d.y2, -100000, 100000, 0),
    createdAt: str(d.createdAt, 30) || todayStr(),
    deletedAt: d.deletedAt || null
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
    // v2.1.0：inline=true 表示由正文内联 @[Type:ID] 自动生成，解除正文时才移除
    inline: b.inline === true,
    createdAt: str(b.createdAt, 30) || todayStr(),
    deletedAt: b.deletedAt || null
  }
}
