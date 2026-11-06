// ============================================================
// 全局图标资源生成器（IconHub + Humbleicons 双源）
// 用法：npm run icons:map
// 产物：src/lib/iconSvg.js  —— 由开源图标库线性 SVG 资源编译而成
//   · 主源 @microsnow/iconhub  linear 风格（24×24 / stroke 1.5 / currentColor）
//   · 补源 humbleicons          线性风格（统一归一化到 stroke 1.5 / currentColor）
//   · 纯几何原语仅保留「单点」一项（非图标，属基本图形）
// 语义名 → 图标 id 的映射集中在下方 MAP，生成时会逐项校验存在性，
// 缺失即报错，避免生成出静默回退的坏图标。
// ============================================================
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ih = require('@microsnow/iconhub')
const root = process.cwd()
const HUMBLE = path.join(root, 'node_modules/humbleicons/icons')

// ---------- 语义名 → 图标源 ----------
// h = IconHub(linear)   m = Humbleicons   p = 纯几何原语
const MAP = {
  // 导航 / 主功能
  home: 'h:home',
  tasks: 'h:list-check',
  checklist: 'h:list-check',
  backpack: 'h:suitcase',
  note: 'h:file-text',
  album: 'h:image',
  globe: 'h:globe',
  wallet: 'h:wallet',
  chart: 'h:chart-line',
  map: 'h:map',
  steam: 'h:cloud',
  game: 'h:activity',
  gamepad: 'h:activity',
  ai: 'm:ai',
  spark: 'h:star',
  sparkles: 'm:ai',
  trophy: 'm:crown',
  medal: 'm:certificate',
  achievements: 'm:crown',
  // 通用动作
  bell: 'h:bell',
  shield: 'h:shield',
  clock: 'h:clock',
  timer: 'h:clock',
  file: 'h:file',
  music: 'h:music',
  video: 'h:video',
  link: 'h:link',
  link2: 'h:link',
  coins: 'h:credit-card',
  quote: 'h:quote',
  'map-pin': 'h:pin',
  pin: 'h:pin',
  settings: 'h:settings',
  user: 'h:user',
  trash: 'h:trash',
  plus: 'h:plus',
  search: 'h:search',
  star: 'h:star',
  calendar: 'h:calendar',
  x: 'h:close',
  close: 'h:close',
  send: 'h:send',
  edit: 'h:edit',
  pen: 'h:edit',
  tag: 'h:tag',
  palette: 'h:palette',
  grid: 'm:view-grid',
  layout: 'm:view-grid',
  puzzle: 'h:package',
  lock: 'h:lock',
  cloud: 'h:cloud',
  download: 'h:download',
  upload: 'h:upload',
  arrow: 'h:arrow-right',
  arrowleft: 'h:arrow-left',
  arrowup: 'h:arrow-up',
  arrowdown: 'h:arrow-down',
  heart: 'h:heart',
  egg: 'h:egg',
  cake: 'h:cake',
  image: 'h:image',
  location: 'h:location',
  chevron: 'h:chevron-right',
  'chevron-left': 'h:chevron-left',
  'chevron-right': 'h:chevron-right',
  chevdown: 'h:chevron-down',
  chevup: 'h:chevron-up',
  flag: 'h:flag',
  more: 'h:more-horizontal',
  mic: 'm:microphone',
  bolt: 'h:lightning-bolt',
  gift: 'h:gift',
  book: 'm:book',
  layers: 'h:layers',
  sprout: 'h:seedling',
  coffee: 'h:coffee',
  check: 'm:check',
  minus: 'm:minus',
  info: 'h:info',
  warning: 'h:warning',
  layout2: 'm:view-grid',
  reset: 'h:refresh',
  undo: 'h:undo',
  redo: 'h:redo',
  copy: 'h:copy',
  external: 'h:external-link',
  database: 'h:database',
  folder: 'h:folder',
  compass: 'h:compass',
  tree: 'h:tree',
  flow: 'h:workflow',
  org: 'h:tree',
  radial: 'm:pie-chart',
  branch: 'h:git-branch',
  import: 'h:import',
  // 画布 / 布局
  frame: 'm:square',
  square: 'm:square',
  select: 'm:cursor',
  waterfall: 'm:align-text-justify',
  columns: 'm:columns-two-halfs',
  sticky: 'm:document',
  // 媒体 / 播放
  play: 'h:play',
  pause: 'm:pause',
  volume: 'h:volume',
  filter: 'h:filter',
  sort: 'h:sort',
  list: 'h:list-check',
  activity: 'h:activity',
  // 纯几何原语（图标库无对应，且本质是基本图形而非图标）
  dot: 'p:dot',
}

// ---------- 归一化：去掉子元素上的描边属性，统一由根 <svg> 控制 ----------
function normalize(inner) {
  return inner
    .replace(/\s*stroke="currentColor"/g, '')
    .replace(/\s*stroke-width="[\d.]+"/g, '')
    .replace(/\s*stroke-linecap="round"/g, '')
    .replace(/\s*stroke-linejoin="round"/g, '')
    .replace(/\s*stroke="none"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fromIconHub(id) {
  const svg = ih.getIconSvg(id, 'linear')
  if (!svg) return null
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return m ? normalize(m[1]) : null
}

function fromHumble(file) {
  const p = path.join(HUMBLE, file + '.svg')
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, 'utf8')
  const m = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return m ? normalize(m[1]) : null
}

const PRIMITIVES = {
  dot: '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/>',
}

const out = {}
const missing = []
for (const [name, spec] of Object.entries(MAP)) {
  const [kind, id] = spec.split(':')
  let inner = null
  if (kind === 'h') inner = fromIconHub(id)
  else if (kind === 'm') inner = fromHumble(id)
  else if (kind === 'p') inner = PRIMITIVES[id] || null
  if (!inner) { missing.push(`${name} (${spec})`); continue }
  out[name] = inner
}

if (missing.length) {
  console.error('✗ 缺失图标映射：\n  ' + missing.join('\n  '))
  process.exit(1)
}

const body = Object.entries(out)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n')

const file = `// ============================================================
// 本文件由 tools/gen_icon_map.mjs 自动生成 —— 请勿手工编辑
// 资源来源：@microsnow/iconhub (linear, 24×24, stroke 1.5, currentColor)
//           humbleicons (归一化至 stroke 1.5 / currentColor)
// 重新生成：npm run icons:map
// ============================================================
export const ICON_SVG = {
${body}
}
`
const outPath = path.join(root, 'src/lib/iconSvg.js')
fs.writeFileSync(outPath, file, 'utf8')
console.log(`✓ 已生成 src/lib/iconSvg.js —— ${Object.keys(out).length} 个语义图标`)
