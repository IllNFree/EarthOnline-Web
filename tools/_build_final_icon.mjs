// 地球Online 最终图标
//   地球 = Noun Project #8386758 (Studio Danro) 官方 PNG 原样矢量化，占画面 70%（绝对主体）
//   笔记本 = 地球上的镂空（负空间，不填充任何颜色），尺寸为地球 1/4，位于左下并覆盖球面
//   内部细节（螺旋圈 / 页面行）用地球色，落在镂空区上；无书签带、无描边线
// 产物：icon-candidates/final/{icon-final-night.svg, icon-final-light.svg, icon-final-glyph.svg, earth-only-night.svg}
import fs from 'fs'
import path from 'path'
import potrace from 'potrace'

const root = process.cwd()
const outDir = path.join(root, 'icon-candidates/final')
fs.mkdirSync(outDir, { recursive: true })

// ---------- 1) 地球矢量化（官方 PNG，阈值描摹，负空间大陆由 evenodd 保留） ----------
await new Promise((resolve, reject) => {
  potrace.trace(path.join(root, 'icon-candidates/earth-noun.png'), {
    threshold: 160, turdSize: 2, optTolerance: 0.4,
    color: '#000000', background: 'transparent',
  }, (err, svg) => {
    if (err) return reject(err)
    fs.writeFileSync(path.join(outDir, 'earth-traced-raw.svg'), svg)
    resolve()
  })
})
const rawSvg = fs.readFileSync(path.join(outDir, 'earth-traced-raw.svg'), 'utf8')
const rawPath = (rawSvg.match(/<path[^>]*>/) || [])[0] || ''
const earthD = (rawPath.match(/ d="([^"]+)"/) || [])[1] || ''
const earthRule = (rawPath.match(/fill-rule="([^"]+)"/) || [])[1] || 'evenodd'
if (!earthD) { console.error('✗ 地球描摹失败'); process.exit(1) }
console.log('地球 path: 1 条 | fill-rule:', earthRule)

// ---------- 2) 笔记本（镂空） ----------
// 面积 = 49,104 ≈ 图标(262,144) 的 18.7% —— 比上一版（21.6%）再小一点点；位置左下、覆盖球面。
const NB = { X: 40, Y: 244, W: 198, H: 248, R: 26 }

// 镂空本体（用于 mask 挖除）
function notebookCut() {
  return `<rect x="${NB.X}" y="${NB.Y}" width="${NB.W}" height="${NB.H}" rx="${NB.R}" fill="#000"/>`
}

// 镂空区内的细节（地球色）：轮廓边 + 螺旋圈（圆环 donut）+ 页面行
// 轮廓边的作用：镂空透出底色，而底色与大陆同色 —— 没有这条边，笔记本会隐入大陆
function notebookDetails(earthFill) {
  const cx = NB.X + 31, ro = 16, ri = 6.5
  const coilYs = [NB.Y + 45, NB.Y + 113, NB.Y + 181]
  const coils = coilYs.map(cy => `
    <path fill-rule="evenodd" d="M ${cx} ${cy - ro} A ${ro} ${ro} 0 1 0 ${cx} ${cy + ro} A ${ro} ${ro} 0 1 0 ${cx} ${cy - ro} Z
      M ${cx} ${cy - ri} A ${ri} ${ri} 0 1 1 ${cx} ${cy + ri} A ${ri} ${ri} 0 1 1 ${cx} ${cy - ri} Z"/>`).join('')
  const lines = `
    <rect x="${NB.X + 61}" y="${NB.Y + 50}" width="${NB.W - 61 - 34}" height="13" rx="6.5"/>
    <rect x="${NB.X + 61}" y="${NB.Y + 121}" width="${NB.W - 61 - 46}" height="13" rx="6.5"/>
    <rect x="${NB.X + 61}" y="${NB.Y + 192}" width="${NB.W - 61 - 58}" height="13" rx="6.5"/>
  `
  const rim = `<rect x="${NB.X}" y="${NB.Y}" width="${NB.W}" height="${NB.H}" rx="${NB.R}" fill="none" stroke="${earthFill}" stroke-width="7.5"/>`
  return coils + lines + rim
}

// ---------- 3) 合成 ----------
function compose({ tile, earthFill, size = 512 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="地球Online">
  <defs>
    <clipPath id="tile"><rect x="0" y="0" width="512" height="512" rx="118"/></clipPath>
    <mask id="cut">
      <rect width="512" height="512" fill="#000"/>
      <path d="${earthD}" fill="#fff" fill-rule="${earthRule}"/>
      ${notebookCut()}
    </mask>
  </defs>
  <g clip-path="url(#tile)">
    ${tile ? `<rect width="512" height="512" fill="${tile}"/>` : ''}
    <g mask="url(#cut)"><rect width="512" height="512" fill="${earthFill}"/></g>
    <g fill="${earthFill}">${notebookDetails(earthFill)}</g>
  </g>
</svg>`
}

fs.writeFileSync(path.join(outDir, 'icon-final-night.svg'), compose({ tile: '#23201C', earthFill: '#F5EDDE' }))
fs.writeFileSync(path.join(outDir, 'icon-final-light.svg'), compose({ tile: '#F8F4EC', earthFill: '#3A2E22' }))
fs.writeFileSync(path.join(outDir, 'icon-final-glyph.svg'), compose({ tile: '', earthFill: '#3A2E22' }))
fs.writeFileSync(path.join(outDir, 'earth-only-night.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><g fill="#F5EDDE" fill-rule="${earthRule}"><path d="${earthD}"/></g></svg>`)

console.log('✓ 产出: icon-final-night.svg / icon-final-light.svg / icon-final-glyph.svg / earth-only-night.svg')
