import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const root = process.cwd()
const src = path.join(root, 'public/icons/icon.svg')
const svg = fs.readFileSync(src)

const targets = [
  path.join(root, 'public/icons'),
  path.join(root, 'icons'),
  path.join(root, 'webroot/icons'),
  path.join(root, 'dist/icons'),
]

const files = [
  { name: 'icon-512.png', size: 512 },
  { name: 'icon.png', size: 192 },
  { name: 'apple-touch-icon.png', size: 180 },
]

let wrote = []
for (const dir of targets) {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }) }
  // sync svg
  fs.copyFileSync(src, path.join(dir, 'icon.svg'))
  wrote.push(path.join(dir, 'icon.svg'))
  for (const f of files) {
    const out = path.join(dir, f.name)
    await sharp(svg, { density: 384 })
      .resize(f.size, f.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out)
    wrote.push(out)
  }
}

console.log('WROTE:')
for (const w of wrote) console.log(' ', w)
