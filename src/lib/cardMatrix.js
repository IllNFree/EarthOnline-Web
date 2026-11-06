// ===== 内置卡片矩阵（ArcMind 级卡片目录） =====
// 画布原生卡片（不绑定业务实体），结构化数据存放在节点的 cardData 字段。
//
// v2.6 精简（2026-11-04）：按用户要求彻底下线「文字卡 / 链接卡 / 导航卡 / 导航面板 / 隐藏卡 / 热图卡」，
// 文字与链接统一由「便利贴」承载（kind:'memo'）；仅保留便签、时钟与音频三张真实可用的卡片。
export const CARD_GROUPS = [
  { key: 'base', label: '基础与办公' },
  { key: 'time', label: '时间与媒体' }
]

export const CARD_MATRIX = [
  // —— 基础与办公 ——
  { key: 'note', label: '便利贴卡片', icon: 'sticky', color: 'amber', group: 'base', w: 180, h: 140, desc: '随手贴', defaultData: () => ({ text: '随手记点什么…' }) },
  // 2026-11-04 P2：文档卡（整篇长文阅读）与图片卡（单张图片）
  { key: 'doc', label: '文档卡片', icon: 'file', color: 'gray', group: 'base', w: 360, h: 320, desc: '整篇长文阅读，双击编辑正文', defaultData: () => ({ body: '' }) },
  { key: 'image', label: '图片卡片', icon: 'image', color: 'gray', group: 'base', w: 280, h: 220, desc: '单张图片，点击查看大图', defaultData: () => ({ src: '', fit: 'cover' }) },
  // —— 时间与媒体 ——
  { key: 'clock', label: '时钟卡片', icon: 'clock', color: 'gray', group: 'time', w: 200, h: 140, desc: '显示秒', defaultData: () => ({ label: '本地时间', zone: 'local' }) },
  // 音乐卡：单卡承载多曲目，可联动收藏、导入本地音频
  { key: 'audio', label: '音乐卡片', icon: 'music', color: 'purple', group: 'time', w: 320, h: 240, desc: '多曲目播放器', defaultData: () => ({ title: '音乐', src: '', tracks: [] }) }
]

export const CARD_KEYS = CARD_MATRIX.map((c) => c.key)
export function cardMeta(key) { return CARD_MATRIX.find((c) => c.key === key) || null }
export function defaultCardData(key) {
  const m = cardMeta(key)
  if (!m) return {}
  try { return m.defaultData() } catch (e) { return {} }
}
