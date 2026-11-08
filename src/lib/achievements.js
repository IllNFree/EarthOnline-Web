// ===== 成就系统（canonical + Web 彩蛋交叉键） =====
// 字段 key:'...' 与三端契约 check_achievements.js 的 web.files 正则一致。
// 已移除 XP 与等级设定：成就只保留「是否解锁」与进度，不再换算经验值。
import { todayStr } from './model.js'

export const ACHIEVEMENTS = [
  { key: 'first_task', title: '第一步', desc: '创建第一个任务', icon: 'flag' },
  { key: 'five_tasks', title: '小试牛刀', desc: '累计 5 个任务', icon: 'flag' },
  { key: 'ten_tasks', title: '渐入佳境', desc: '累计 10 个任务', icon: 'flag' },
  { key: 'thirty_tasks', title: '任务达人', desc: '累计 30 个任务', icon: 'flag' },
  { key: 'fifty_tasks', title: '任务大师', desc: '累计 50 个任务', icon: 'flag' },
  { key: 'hundred_tasks', title: '任务传奇', desc: '累计 100 个任务', icon: 'flag' },
  { key: 'first_item', title: '初备行囊', desc: '添加第一件物品', icon: 'backpack' },
  { key: 'ten_items', title: '收藏家', desc: '累计 10 件物品', icon: 'backpack' },
  { key: 'fifty_items', title: '仓库管理员', desc: '累计 50 件物品', icon: 'backpack' },
  { key: 'first_collection', title: '初见珍藏', desc: '添加第一个收藏', icon: 'star' },
  { key: 'ten_collections', title: '珍藏阁', desc: '累计 10 个收藏', icon: 'star' },
  { key: 'fifty_collections', title: '博物学者', desc: '累计 50 个收藏', icon: 'star' },
  { key: 'first_location', title: '启程', desc: '留下第一个足迹', icon: 'map-pin' },
  { key: 'five_locations', title: '漫游者', desc: '累计 5 个足迹', icon: 'map-pin' },
  { key: 'twenty_locations', title: '足迹遍布', desc: '累计 20 个足迹', icon: 'map-pin' },
  { key: 'first_memo', title: '落笔', desc: '写下第一篇笔记', icon: 'note' },
  { key: 'ten_memos', title: '记录者', desc: '累计 10 篇笔记', icon: 'note' },
  { key: 'fifty_memos', title: '笔耕不辍', desc: '累计 50 篇笔记', icon: 'note' },
  { key: 'notes_hundred', title: '著作等身', desc: '累计 100 篇笔记', icon: 'note' },
  { key: 'memo_long', title: '长篇大论', desc: '单篇笔记超过 2000 字', icon: 'note' },
  { key: 'day_100', title: '百日同行', desc: '坚持使用 100 天', icon: 'calendar' },
  { key: 'day_365', title: '周年纪念', desc: '坚持使用 365 天', icon: 'calendar' },
  { key: 'day_1000', title: '千日长跑', desc: '坚持使用 1000 天', icon: 'calendar' },
  { key: 'day_5000', title: '不离不弃', desc: '坚持使用 5000 天', icon: 'calendar' },
  { key: 'day_10000', title: '世纪羁绊', desc: '坚持使用 10000 天', icon: 'calendar' },
  { key: 'adult_18', title: '成年礼', desc: '年龄已满 18 岁', icon: 'cake' },
  { key: 'all_rounder', title: '全能玩家', desc: '任务/物品/收藏/笔记/足迹各≥1', icon: 'sparkles' },
  { key: 'five_star', title: '五星好评', desc: '佩戴满 3 枚徽章', icon: 'medal' },
  { key: 'grand_slam', title: '大满贯', desc: '解锁 30 项成就', icon: 'trophy' },
  { key: 'glass_tuner', title: '调色师', desc: '切换过主题配色', icon: 'palette' },
  { key: 'walmart_egg', title: '尊贵的沃尔玛购物袋', desc: '隐藏彩蛋 · 把性别设为「沃尔玛购物袋」', icon: 'egg' },
  { key: 'egg_gender_fluid', title: '流动的自我', desc: '性别设为保密', icon: 'egg' },
  { key: 'egg_3am', title: '凌晨三点', desc: '凌晨 3 点活动', icon: 'egg' },
  { key: 'egg_night_owl', title: '夜猫子', desc: '深夜活跃', icon: 'egg' },
  { key: 'egg_early_bird', title: '早起鸟', desc: '清晨活跃', icon: 'egg' },
  { key: 'egg_midnight_task', title: '午夜任务', desc: '午夜完成任务', icon: 'egg' },
  { key: 'egg_blank_title', title: '无名氏', desc: '留空标题被拦截', icon: 'egg' },
  { key: 'egg_long_title', title: '标题党', desc: '超长标题', icon: 'egg' },
  { key: 'egg_emoji_title', title: '表情标题', desc: '标题含 emoji', icon: 'egg' },
  { key: 'egg_period_title', title: '句号标题', desc: '标题以句号结尾', icon: 'egg' },
  { key: 'egg_test_title', title: '测试一下', desc: '标题为测试', icon: 'egg' },
  { key: 'egg_overdue', title: '拖延症', desc: '逾期任务', icon: 'egg' },
  { key: 'egg_marathon', title: '马拉松', desc: '单日完成 10 任务', icon: 'egg' },
  { key: 'egg_streak_7', title: '七日打卡', desc: '连续 7 天', icon: 'egg' },
  { key: 'egg_streak_30', title: '月度打卡', desc: '连续 30 天', icon: 'egg' },
  { key: 'egg_streak_365', title: '年度打卡', desc: '连续 365 天', icon: 'egg' },
  { key: 'egg_memo_emoji', title: '表情包', desc: '笔记含 emoji', icon: 'egg' },
  { key: 'egg_newyear', title: '新年快乐', desc: '元旦打卡', icon: 'egg' },
  { key: 'egg_throwback', title: '时光机', desc: '查看历年今日', icon: 'egg' },
  { key: 'egg_memory_album', title: '回忆相册', desc: '打开记忆相册', icon: 'egg' },
  // 隐藏成就（Web 彩蛋）：解锁前不展示标题与条件，点击后由成就页直接写入解锁记录
  { key: 'egg_rickroll', title: '你被骗了', desc: '一个不该被发现的彩蛋', icon: 'egg' },
  { key: 'egg_self_inflicted', title: '你自找的', desc: '隐藏彩蛋 · 把头像旁的小熊点了六次', icon: 'egg' },
  // ===== Web 专属成就（Web 独有能力，不进 canonical 三端）=====
  { key: 'web_whiteboard_first', title: '开板', desc: '在画布上创建第一个节点', icon: 'layout' },
  { key: 'web_whiteboard_ten', title: '灵感墙', desc: '画布上累计 10 个节点', icon: 'layout' },
  { key: 'web_bilink_first', title: '牵线搭桥', desc: '建立第一条双向链接', icon: 'link' },
  { key: 'web_bilink_ten', title: '知识网络', desc: '累计 10 条双向链接', icon: 'link' },
  { key: 'web_dashboard_first', title: '自定义看板', desc: '拖拽调整一次看板布局', icon: 'grid' },
  { key: 'web_ai_chat', title: '灵光一现', desc: '与 AI 中枢完成一次对话', icon: 'sparkles' },
  { key: 'web_tool_call', title: '言出必行', desc: '通过自然语言让 AI 执行一次操作', icon: 'sparkles' },
  { key: 'web_import_data', title: '拾荒者', desc: '导入一次外部账单或旧版笔记', icon: 'download' },
  { key: 'web_drag_upload', title: '拖拽入库', desc: '把文件拖入窗口完成上传', icon: 'upload' },
  { key: 'web_period_report', title: '复盘大师', desc: '生成一份 AI 周期报告', icon: 'chart' },
  { key: 'web_clipboard_catch', title: '灵光一现（剪贴板）', desc: '通过剪贴板监听捕获一次内容', icon: 'note' },
  // ===== 画布 / 空间 / 组 / AI / 音乐（v2.1.1 新增）=====
  { key: 'web_space_first', title: '空间拓荒者', desc: '创建第一个空间', icon: 'layers' },
  { key: 'web_space_five', title: '空间城邦', desc: '累计创建 5 个空间', icon: 'layers' },
  { key: 'web_group_first', title: '井井有条', desc: '第一次把卡片整理成组', icon: 'grid' },
  { key: 'web_crossspace_first', title: '跨界搬运', desc: '第一次把卡片拖入其他空间', icon: 'layers' },
  { key: 'web_ai_card', title: '心想事成', desc: '让 AI 在画布上创建一张卡片', icon: 'sparkles' },
  { key: 'web_ai_summary', title: '一语中的', desc: '让 AI 总结一次画布内容', icon: 'sparkles' },
  { key: 'web_music_first', title: '第一首', desc: '播放一次音乐卡', icon: 'music' }
]

// 所有彩蛋类成就统一标记为隐藏成就（Steam 风格）：解锁前不对外展示标题与达成条件
ACHIEVEMENTS.forEach((a) => { if (a.icon === 'egg') a.secret = true })

const BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]))

// 等级（稀有度）设定已取消：成就只保留「是否解锁」与进度，光效 / 音效 / 反馈统一沿用。
function meta(key) {
  const a = BY_KEY[key]
  if (!a) return { key, title: key, desc: '', icon: 'star' }
  return { key: a.key, title: a.title, desc: a.desc, icon: a.icon || 'star' }
}

// ---------- 通用统计 ----------
const live = (s, key) => (Array.isArray(s[key]) ? s[key].filter((x) => x && !x.deletedAt) : [])

function firstDay(s) {
  const stamps = []
  ;['tasks', 'items', 'collections', 'memos', 'locations', 'photos'].forEach((k) => {
    live(s, k).forEach((x) => { if (x.createdAt) stamps.push(String(x.createdAt).slice(0, 10)) })
  })
  ;(s.achievements || []).forEach((a) => { if (a.unlockedAt) stamps.push(String(a.unlockedAt).slice(0, 10)) })
  return stamps.length ? stamps.sort()[0] : todayStr()
}
function daysUsed(s) {
  const d0 = new Date(firstDay(s))
  const d1 = new Date(todayStr())
  if (isNaN(d0) || isNaN(d1)) return 1
  return Math.max(1, Math.floor((d1 - d0) / 86400000) + 1)
}
function prevDay(day) {
  const d = new Date(day)
  if (isNaN(d)) return day
  d.setDate(d.getDate() - 1)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function streakDays(s) {
  const done = new Set()
  live(s, 'tasks').forEach((t) => { if (t.doneAt) done.add(String(t.doneAt).slice(0, 10)) })
  let n = 0
  let day = todayStr()
  while (done.has(day)) { n++; day = prevDay(day) }
  return n
}
function ageYears(birthDate) {
  if (!birthDate) return 0
  const b = new Date(birthDate)
  if (isNaN(b)) return 0
  const now = new Date(todayStr())
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return Math.max(0, age)
}
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const textOf = (x) => String((x && (x.title || x.markdown || x.name || '')) || '')
const hourNow = () => new Date().getHours()

// ---------- 进度规则（成就页进度条复用）----------
const PROGRESS = {
  first_task: { goal: 1, cur: (s) => live(s, 'tasks').length },
  five_tasks: { goal: 5, cur: (s) => live(s, 'tasks').length },
  ten_tasks: { goal: 10, cur: (s) => live(s, 'tasks').length },
  thirty_tasks: { goal: 30, cur: (s) => live(s, 'tasks').length },
  fifty_tasks: { goal: 50, cur: (s) => live(s, 'tasks').length },
  hundred_tasks: { goal: 100, cur: (s) => live(s, 'tasks').length },
  first_item: { goal: 1, cur: (s) => live(s, 'items').length },
  ten_items: { goal: 10, cur: (s) => live(s, 'items').length },
  fifty_items: { goal: 50, cur: (s) => live(s, 'items').length },
  first_collection: { goal: 1, cur: (s) => live(s, 'collections').length },
  ten_collections: { goal: 10, cur: (s) => live(s, 'collections').length },
  fifty_collections: { goal: 50, cur: (s) => live(s, 'collections').length },
  first_location: { goal: 1, cur: (s) => live(s, 'locations').length },
  five_locations: { goal: 5, cur: (s) => live(s, 'locations').length },
  twenty_locations: { goal: 20, cur: (s) => live(s, 'locations').length },
  first_memo: { goal: 1, cur: (s) => live(s, 'memos').length },
  ten_memos: { goal: 10, cur: (s) => live(s, 'memos').length },
  fifty_memos: { goal: 50, cur: (s) => live(s, 'memos').length },
  notes_hundred: { goal: 100, cur: (s) => live(s, 'memos').length },
  day_100: { goal: 100, cur: daysUsed },
  day_365: { goal: 365, cur: daysUsed },
  day_1000: { goal: 1000, cur: daysUsed },
  day_5000: { goal: 5000, cur: daysUsed },
  day_10000: { goal: 10000, cur: daysUsed },
  egg_streak_7: { goal: 7, cur: streakDays },
  egg_streak_30: { goal: 30, cur: streakDays },
  egg_streak_365: { goal: 365, cur: streakDays },
  grand_slam: { goal: 30, cur: (s) => (s.achievements || []).length },
  five_star: { goal: 3, cur: (s) => ((s.profile && s.profile.wornBadges) || []).length },
  web_whiteboard_first: { goal: 1, cur: (s) => (s.whiteboardNodes || []).length },
  web_whiteboard_ten: { goal: 10, cur: (s) => (s.whiteboardNodes || []).length },
  web_bilink_first: { goal: 1, cur: (s) => (s.biLinks || []).length },
  web_bilink_ten: { goal: 10, cur: (s) => (s.biLinks || []).length },
  web_space_first: { goal: 1, cur: (s) => ((s.webMilestones && s.webMilestones.spaceCreate) || 0) },
  web_space_five: { goal: 5, cur: (s) => ((s.webMilestones && s.webMilestones.spaceCreate) || 0) }
}

export function achievementProgress(key, state) {
  const p = PROGRESS[key]
  if (!p) return null
  const cur = Math.max(0, Math.min(p.goal, Number(p.cur(state || {})) || 0))
  return { cur, goal: p.goal }
}

// 根据 state 计算当前满足的成就 key 集合
export function evaluate(state) {
  const s = state || {}
  const tasks = live(s, 'tasks')
  const items = live(s, 'items')
  const cols = live(s, 'collections')
  const memos = live(s, 'memos')
  const locs = live(s, 'locations')
  const ach = s.achievements || []
  const wm = s.webMilestones || {}
  const set = new Set()
  const add = (k) => { if (BY_KEY[k]) set.add(k) }

  const n = (k) => (Array.isArray(k) ? k.length : 0)
  if (n(tasks) >= 1) add('first_task')
  if (n(tasks) >= 5) add('five_tasks')
  if (n(tasks) >= 10) add('ten_tasks')
  if (n(tasks) >= 30) add('thirty_tasks')
  if (n(tasks) >= 50) add('fifty_tasks')
  if (n(tasks) >= 100) add('hundred_tasks')
  if (n(items) >= 1) add('first_item')
  if (n(items) >= 10) add('ten_items')
  if (n(items) >= 50) add('fifty_items')
  if (n(cols) >= 1) add('first_collection')
  if (n(cols) >= 10) add('ten_collections')
  if (n(cols) >= 50) add('fifty_collections')
  if (n(locs) >= 1) add('first_location')
  if (n(locs) >= 5) add('five_locations')
  if (n(locs) >= 20) add('twenty_locations')
  if (n(memos) >= 1) add('first_memo')
  if (n(memos) >= 10) add('ten_memos')
  if (n(memos) >= 50) add('fifty_memos')
  if (n(memos) >= 100) add('notes_hundred')
  if (memos.some((m) => String(m.markdown || '').length > 2000)) add('memo_long')

  if ((s.profile && s.profile.gender === '') && (s.profile.name || s.profile.customTitle)) add('egg_gender_fluid')
  if (tasks.length && items.length && cols.length && memos.length && locs.length) add('all_rounder')
  if (((s.profile && s.profile.wornBadges) || []).length >= 3) add('five_star')
  if (ach.length >= 30) add('grand_slam')
  if (s.profile && s.profile.gender === '沃尔玛购物袋') add('walmart_egg')
  if (s.eggs && s.eggs.throwbackViewed) add('egg_throwback')
  if (s.eggs && s.eggs.albumViewed) add('egg_memory_album')
  if (s.eggs && s.eggs.blankTitleTries >= 1) add('egg_blank_title')

  // 使用天数 / 成年
  const used = daysUsed(s)
  if (used >= 100) add('day_100')
  if (used >= 365) add('day_365')
  if (used >= 1000) add('day_1000')
  if (used >= 5000) add('day_5000')
  if (used >= 10000) add('day_10000')
  if (ageYears(s.profile && s.profile.birthDate) >= 18) add('adult_18')

  // 彩蛋：标题 / 逾期 / 单日冲刺 / 连击 / 时段 / 元旦
  const titles = [].concat(tasks.map(textOf), memos.map(textOf))
  if (titles.some((t) => t.trim().length > 40)) add('egg_long_title')
  if (titles.some((t) => EMOJI_RE.test(t))) add('egg_emoji_title')
  if (titles.some((t) => /[。.]\s*$/.test(t))) add('egg_period_title')
  if (titles.some((t) => /^(测试|测试一下|test)/i.test(t.trim()))) add('egg_test_title')
  if (memos.some((m) => EMOJI_RE.test(String(m.title || '') + String(m.markdown || ''))) && memos.length) add('egg_memo_emoji')
  const today = todayStr()
  if (tasks.some((t) => t.status !== 'done' && t.dueDate && t.dueDate < today)) add('egg_overdue')
  if (tasks.filter((t) => t.status === 'done' && String(t.doneAt || '').slice(0, 10) === today).length >= 10) add('egg_marathon')
  const streak = streakDays(s)
  if (streak >= 7) add('egg_streak_7')
  if (streak >= 30) add('egg_streak_30')
  if (streak >= 365) add('egg_streak_365')
  const h = hourNow()
  if (h === 3) add('egg_3am')
  if (h >= 0 && h < 5) add('egg_night_owl')
  if (h >= 5 && h < 7) add('egg_early_bird')
  if (h >= 0 && h < 5 && tasks.some((t) => t.status === 'done' && String(t.doneAt || '').slice(0, 10) === today)) add('egg_midnight_task')
  if (today.slice(5) === '01-01') add('egg_newyear')

  // Web 专属
  const wn = Array.isArray(s.whiteboardNodes) ? s.whiteboardNodes : []
  if (wn.length >= 1) add('web_whiteboard_first')
  if (wn.length >= 10) add('web_whiteboard_ten')
  const bl = Array.isArray(s.biLinks) ? s.biLinks : []
  if (bl.length >= 1) add('web_bilink_first')
  if (bl.length >= 10) add('web_bilink_ten')
  if (Array.isArray(s.dashboardLayout) && s.dashboardLayout.length >= 2) add('web_dashboard_first')
  if ((wm.aiChat || 0) >= 1) add('web_ai_chat')
  if ((wm.toolCall || 0) >= 1) add('web_tool_call')
  if ((wm.dataImport || 0) >= 1) add('web_import_data')
  if ((wm.dragUpload || 0) >= 1) add('web_drag_upload')
  if ((wm.clipboardCatch || 0) >= 1) add('web_clipboard_catch')
  if ((wm.periodReport || 0) >= 1) add('web_period_report')
  if ((wm.themeSwitch || 0) >= 1) add('glass_tuner')
  if ((wm.spaceCreate || 0) >= 1) add('web_space_first')
  if ((wm.spaceCreate || 0) >= 5) add('web_space_five')
  if ((wm.groupCreate || 0) >= 1) add('web_group_first')
  if ((wm.crossSpaceMove || 0) >= 1) add('web_crossspace_first')
  if ((wm.aiCard || 0) >= 1) add('web_ai_card')
  if ((wm.aiSummary || 0) >= 1) add('web_ai_summary')
  if ((wm.musicPlay || 0) >= 1) add('web_music_first')
  return set
}

// 同步成就：将 evaluate 命中的、尚未解锁的写入 state.achievements，返回新解锁列表
export function syncAchievements(state) {
  const satisfied = evaluate(state)
  const have = new Set((state.achievements || []).map((a) => a.key))
  const newly = []
  for (const k of satisfied) {
    if (!have.has(k)) {
      const a = { key: k, unlockedAt: todayStr() }
      state.achievements.push(a)
      newly.push(meta(k))
    }
  }
  return newly
}
export function achievementMeta(key) { return meta(key) }
