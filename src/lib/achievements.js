// ===== 成就系统（canonical 48 + Web 彩蛋交叉键） =====
// 字段 key:'...' 与三端契约 check_achievements.js 的 web.files 正则一致。
import { todayStr } from './model.js'

export const ACHIEVEMENTS = [
  { key: 'first_task', title: '第一步', desc: '创建第一个任务', xp: 10, icon: 'flag' },
  { key: 'five_tasks', title: '小试牛刀', desc: '累计 5 个任务', xp: 20, icon: 'flag' },
  { key: 'ten_tasks', title: '渐入佳境', desc: '累计 10 个任务', xp: 30, icon: 'flag' },
  { key: 'thirty_tasks', title: '任务达人', desc: '累计 30 个任务', xp: 60, icon: 'flag' },
  { key: 'fifty_tasks', title: '任务大师', desc: '累计 50 个任务', xp: 100, icon: 'flag' },
  { key: 'hundred_tasks', title: '任务传奇', desc: '累计 100 个任务', xp: 200, icon: 'flag' },
  { key: 'first_item', title: '初备行囊', desc: '添加第一件物品', xp: 10, icon: 'backpack' },
  { key: 'ten_items', title: '收藏家', desc: '累计 10 件物品', xp: 30, icon: 'backpack' },
  { key: 'fifty_items', title: '仓库管理员', desc: '累计 50 件物品', xp: 100, icon: 'backpack' },
  { key: 'first_collection', title: '初见珍藏', desc: '添加第一个收藏', xp: 10, icon: 'star' },
  { key: 'ten_collections', title: '珍藏阁', desc: '累计 10 个收藏', xp: 30, icon: 'star' },
  { key: 'fifty_collections', title: '博物学者', desc: '累计 50 个收藏', xp: 100, icon: 'star' },
  { key: 'first_location', title: '启程', desc: '留下第一个足迹', xp: 10, icon: 'map-pin' },
  { key: 'five_locations', title: '漫游者', desc: '累计 5 个足迹', xp: 30, icon: 'map-pin' },
  { key: 'twenty_locations', title: '足迹遍布', desc: '累计 20 个足迹', xp: 100, icon: 'map-pin' },
  { key: 'first_memo', title: '落笔', desc: '写下第一篇笔记', xp: 10, icon: 'note' },
  { key: 'ten_memos', title: '记录者', desc: '累计 10 篇笔记', xp: 30, icon: 'note' },
  { key: 'fifty_memos', title: '笔耕不辍', desc: '累计 50 篇笔记', xp: 100, icon: 'note' },
  { key: 'notes_hundred', title: '著作等身', desc: '累计 100 篇笔记', xp: 200, icon: 'note' },
  { key: 'memo_long', title: '长篇大论', desc: '单篇笔记超过 2000 字', xp: 50, icon: 'note' },
  { key: 'day_100', title: '百日同行', desc: '坚持使用 100 天', xp: 80, icon: 'calendar' },
  { key: 'day_365', title: '周年纪念', desc: '坚持使用 365 天', xp: 200, icon: 'calendar' },
  { key: 'day_1000', title: '千日长跑', desc: '坚持使用 1000 天', xp: 500, icon: 'calendar' },
  { key: 'day_5000', title: '不离不弃', desc: '坚持使用 5000 天', xp: 1500, icon: 'calendar' },
  { key: 'day_10000', title: '世纪羁绊', desc: '坚持使用 10000 天', xp: 3000, icon: 'calendar' },
  { key: 'adult_18', title: '成年礼', desc: '年龄已满 18 岁', xp: 60, icon: 'cake' },
  { key: 'all_rounder', title: '全能玩家', desc: '任务/物品/收藏/笔记/足迹各≥1', xp: 120, icon: 'sparkles' },
  { key: 'five_star', title: '五星好评', desc: '佩戴满 3 枚徽章', xp: 80, icon: 'medal' },
  { key: 'grand_slam', title: '大满贯', desc: '解锁 30 项成就', xp: 300, icon: 'trophy' },
  { key: 'glass_tuner', title: '调色师', desc: '切换过主题配色', xp: 20, icon: 'palette' },
  { key: 'walmart_egg', title: '???,???', desc: '隐藏彩蛋', xp: 30, icon: 'egg' },
  { key: 'egg_gender_fluid', title: '流动的自我', desc: '性别设为保密', xp: 10, icon: 'egg' },
  { key: 'egg_3am', title: '凌晨三点', desc: '凌晨 3 点活动', xp: 10, icon: 'egg' },
  { key: 'egg_night_owl', title: '夜猫子', desc: '深夜活跃', xp: 10, icon: 'egg' },
  { key: 'egg_early_bird', title: '早起鸟', desc: '清晨活跃', xp: 10, icon: 'egg' },
  { key: 'egg_midnight_task', title: '午夜任务', desc: '午夜完成任务', xp: 10, icon: 'egg' },
  { key: 'egg_blank_title', title: '无名氏', desc: '留空标题被拦截', xp: 5, icon: 'egg' },
  { key: 'egg_long_title', title: '标题党', desc: '超长标题', xp: 5, icon: 'egg' },
  { key: 'egg_emoji_title', title: '表情标题', desc: '标题含 emoji', xp: 5, icon: 'egg' },
  { key: 'egg_period_title', title: '句号标题', desc: '标题以句号结尾', xp: 5, icon: 'egg' },
  { key: 'egg_test_title', title: '测试一下', desc: '标题为测试', xp: 5, icon: 'egg' },
  { key: 'egg_overdue', title: '拖延症', desc: '逾期任务', xp: 5, icon: 'egg' },
  { key: 'egg_marathon', title: '马拉松', desc: '单日完成 10 任务', xp: 20, icon: 'egg' },
  { key: 'egg_streak_7', title: '七日打卡', desc: '连续 7 天', xp: 30, icon: 'egg' },
  { key: 'egg_streak_30', title: '月度打卡', desc: '连续 30 天', xp: 100, icon: 'egg' },
  { key: 'egg_streak_365', title: '年度打卡', desc: '连续 365 天', xp: 500, icon: 'egg' },
  { key: 'egg_memo_emoji', title: '表情包', desc: '笔记含 emoji', xp: 5, icon: 'egg' },
  { key: 'egg_newyear', title: '新年快乐', desc: '元旦打卡', xp: 20, icon: 'egg' },
  { key: 'egg_throwback', title: '时光机', desc: '查看历年今日', xp: 15, icon: 'egg' },
  { key: 'egg_memory_album', title: '回忆相册', desc: '打开记忆相册', xp: 15, icon: 'egg' },
  // ===== v2.1.0 Web 专属成就（Web 独有能力，不进 canonical 三端）=====
  { key: 'web_whiteboard_first', title: '开板', desc: '在画布上创建第一个节点', xp: 15, icon: 'layout' },
  { key: 'web_whiteboard_ten', title: '灵感墙', desc: '画布上累计 10 个节点', xp: 40, icon: 'layout' },
  { key: 'web_bilink_first', title: '牵线搭桥', desc: '建立第一条双向链接', xp: 15, icon: 'link' },
  { key: 'web_bilink_ten', title: '知识网络', desc: '累计 10 条双向链接', xp: 40, icon: 'link' },
  { key: 'web_dashboard_first', title: '自定义看板', desc: '拖拽调整一次看板布局', xp: 20, icon: 'grid' },
  { key: 'web_ai_chat', title: '灵光一现', desc: '与 AI 中枢完成一次对话', xp: 20, icon: 'sparkles' },
  { key: 'web_tool_call', title: '言出必行', desc: '通过自然语言让 AI 执行一次操作', xp: 30, icon: 'sparkles' },
  { key: 'web_import_data', title: '拾荒者', desc: '导入一次外部账单或旧版笔记', xp: 20, icon: 'download' },
  { key: 'web_drag_upload', title: '拖拽入库', desc: '把文件拖入窗口完成上传', xp: 20, icon: 'upload' },
  { key: 'web_period_report', title: '复盘大师', desc: '生成一份 AI 周期报告', xp: 30, icon: 'chart' },
  { key: 'web_clipboard_catch', title: '灵光一现（剪贴板）', desc: '通过剪贴板监听捕获一次内容', xp: 15, icon: 'note' }
]

const BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]))

function meta(key) { return BY_KEY[key] || { key, title: key, xp: 0, icon: 'star' } }

// 根据 state 计算当前满足的成就 key 集合
export function evaluate(state) {
  const s = state || {}
  const tasks = s.tasks || []
  const doneTasks = tasks.filter((t) => t.status === 'done').length
  const items = s.items || []
  const cols = s.collections || []
  const memos = s.memos || []
  const locs = s.locations || []
  const ach = s.achievements || []
  const have = new Set(ach.map((a) => a.key))
  const set = new Set()
  const add = (k) => { if (BY_KEY[k]) set.add(k) }

  if (tasks.length >= 1) add('first_task')
  if (tasks.length >= 5) add('five_tasks')
  if (tasks.length >= 10) add('ten_tasks')
  if (tasks.length >= 30) add('thirty_tasks')
  if (tasks.length >= 50) add('fifty_tasks')
  if (tasks.length >= 100) add('hundred_tasks')
  if (items.length >= 1) add('first_item')
  if (items.length >= 10) add('ten_items')
  if (items.length >= 50) add('fifty_items')
  if (cols.length >= 1) add('first_collection')
  if (cols.length >= 10) add('ten_collections')
  if (cols.length >= 50) add('fifty_collections')
  if (locs.length >= 1) add('first_location')
  if (locs.length >= 5) add('five_locations')
  if (locs.length >= 20) add('twenty_locations')
  if (memos.length >= 1) add('first_memo')
  if (memos.length >= 10) add('ten_memos')
  if (memos.length >= 50) add('fifty_memos')
  if (memos.length >= 100) add('notes_hundred')
  if (memos.some((m) => (m.markdown || '').length > 2000)) add('memo_long')
  if ((s.profile && s.profile.gender === '') && (s.profile.name || s.profile.customTitle)) add('egg_gender_fluid')
  if (items.length && cols.length && memos.length && locs.length && tasks.length) add('all_rounder')
  if ((s.profile && (s.profile.wornBadges || []).length >= 3)) add('five_star')
  if (ach.length >= 30) add('grand_slam')
  if ((s.eggs && s.eggs.throwbackViewed)) add('egg_throwback')
  if ((s.eggs && s.eggs.albumViewed)) add('egg_memory_album')
  // ===== v2.1.0 Web 专属成就判定（Web 独有能力，不参与 canonical 三端对齐）=====
  const wn = Array.isArray(s.whiteboardNodes) ? s.whiteboardNodes : []
  if (wn.length >= 1) add('web_whiteboard_first')
  if (wn.length >= 10) add('web_whiteboard_ten')
  const bl = Array.isArray(s.biLinks) ? s.biLinks : []
  if (bl.length >= 1) add('web_bilink_first')
  if (bl.length >= 10) add('web_bilink_ten')
  if (Array.isArray(s.dashboardLayout) && s.dashboardLayout.length >= 2) add('web_dashboard_first')
  const wm = s.webMilestones || {}
  if ((wm.aiChat || 0) >= 1) add('web_ai_chat')
  if ((wm.toolCall || 0) >= 1) add('web_tool_call')
  if ((wm.dataImport || 0) >= 1) add('web_import_data')
  if ((wm.dragUpload || 0) >= 1) add('web_drag_upload')
  if ((wm.clipboardCatch || 0) >= 1) add('web_clipboard_catch')
  if ((wm.periodReport || 0) >= 1) add('web_period_report')
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
export function totalXp(state) {
  const have = new Set((state.achievements || []).map((a) => a.key))
  return ACHIEVEMENTS.reduce((sum, a) => (have.has(a.key) ? sum + (a.xp || 0) : sum), 0)
}
export function achievementMeta(key) { return meta(key) }
