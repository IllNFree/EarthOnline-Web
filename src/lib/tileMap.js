// ===== 轻量瓦片地图引擎（Web Mercator + 视口裁剪 + LRU + 并发优先级队列）=====
// 设计目标（v2.3.0）：零依赖、不阻塞主线程、只加载视口内瓦片、失败自动降级。
// 1) 投影：标准 Web Mercator（与 OSM / 高德 栅格瓦片一致）
// 2) 缓存：LRU（Map 保序），超出上限淘汰最久未用
// 3) 调度：并发上限 + 优先级队列（离视口中心越近越先加载）
// 4) 降级：主源失败自动切备用源；连续失败落「占位瓦片」，绝不无限重试

export const TILE_SIZE = 256
const MAX_ZOOM = 19
const MIN_ZOOM = 3

// 主源：高德栅格（国内速度快、免 key）；备用源：OSM
const SOURCES = [
  (z, x, y) => 'https://webrd0' + (1 + ((x + y) % 4)) + '.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=' + x + '&y=' + y + '&z=' + z,
  (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png'
]

export function clampZoom(z) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }

// 经度 → 世界像素 X（zoom 层）
export function lngToWorldX(lng, z) {
  return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, z)
}
// 纬度 → 世界像素 Y（Web Mercator）
export function latToWorldY(lat, z) {
  const s = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
  return y * TILE_SIZE * Math.pow(2, z)
}
export function worldXToLng(x, z) {
  return (x / (TILE_SIZE * Math.pow(2, z))) * 360 - 180
}
export function worldYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * Math.pow(2, z))
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

// 根据点位集合与容器尺寸，算出「刚好装下」的浮点缩放级别
export function fitZoom(points, w, h, pad) {
  if (!points || !points.length || !w || !h) return 5
  const p = pad || 36
  let minX = 180, maxX = -180, minY = 85, maxY = -85
  points.forEach((pt) => {
    minX = Math.min(minX, pt.lng); maxX = Math.max(maxX, pt.lng)
    minY = Math.min(minY, pt.lat); maxY = Math.max(maxY, pt.lat)
  })
  let z = 12
  for (; z > MIN_ZOOM; z--) {
    const x0 = lngToWorldX(minX, z), x1 = lngToWorldX(maxX, z)
    const y0 = latToWorldY(maxY, z), y1 = latToWorldY(minY, z)
    if (x1 - x0 <= w - p * 2 && y1 - y0 <= h - p * 2) break
  }
  return clampZoom(z)
}

// ---- 瓦片加载器：LRU 缓存 + 并发上限 + 优先级队列 + 主备源降级 ----
export function createTileLoader(opts) {
  const o = opts || {}
  const max = o.max || 180
  const concurrency = o.concurrency || 6
  const cache = new Map()      // key -> { img, state, tries, srcIdx, pri }
  const queue = []
  let active = 0
  let onChange = null
  const listeners = []

  function keyOf(z, x, y) { return z + '/' + x + '/' + y }
  function notify() { for (let i = 0; i < listeners.length; i++) { try { listeners[i]() } catch (e) {} } }
  function touch(k) { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v) } return v }
  function evict() {
    while (cache.size > max) {
      const k = cache.keys().next().value
      const it = cache.get(k)
      if (it && it.state === 'loading') break // 正在下载的不淘汰，避免抖动
      if (it && it.img) { it.img.onload = null; it.img.onerror = null; try { it.img.src = '' } catch (e) {} }
      cache.delete(k)
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const it = queue.shift()
      if (!it || it.state !== 'queued') continue
      const z = it.z, x = it.x, y = it.y
      const idx = it.srcIdx || 0
      const src = SOURCES[idx](z, x, y)
      it.state = 'loading'
      it.tries++
      active++
      const img = it.img
      img.onload = () => {
        active--
        it.state = 'ok'
        notify(); pump()
      }
      img.onerror = () => {
        active--
        if (idx + 1 < SOURCES.length) {
          // 主源失败 → 切备用源重试（同一张瓦片最多换一次源）
          it.srcIdx = idx + 1
          it.state = 'queued'
          queue.push(it)
        } else if (it.tries < 2) {
          it.state = 'queued'
          queue.push(it)
        } else {
          it.state = 'error' // 连续失败：落占位色，不再重试
        }
        notify(); pump()
      }
      try { img.src = src } catch (e) { active--; it.state = 'error' }
    }
  }

  return {
    onUpdate(fn) { if (typeof fn === 'function') listeners.push(fn) },
    // 请求一张瓦片：pri 越小越优先（离视口中心近的传小值）
    request(z, x, y, pri) {
      const k = keyOf(z, x, y)
      let it = cache.get(k)
      if (it) {
        if (it.state === 'ok') { touch(k); return it }
        if (it.state === 'loading') return it
        if (it.state === 'error') return it
        // 排队中：只更新优先级
        it.pri = Math.min(it.pri, pri)
        return it
      }
      it = { img: new Image(), state: 'queued', tries: 0, srcIdx: 0, pri: pri, z: z, x: x, y: y }
      it.img.crossOrigin = 'anonymous'
      it.img.decoding = 'async'
      cache.set(k, it)
      queue.push(it)
      queue.sort((a, b) => a.pri - b.pri)
      evict()
      pump()
      return it
    },
    get(z, x, y) { return touch(keyOf(z, x, y)) },
    get size() { return cache.size },
    get pending() { return queue.length + active },
    clear() {
      queue.length = 0
      // 关键：先摘掉回调再清空 src，否则会触发 onerror → 误走备用源，产生无谓请求
      cache.forEach((it) => {
        if (!it || !it.img) return
        it.img.onload = null
        it.img.onerror = null
        try { it.img.src = '' } catch (e) {}
      })
      cache.clear()
    }
  }
}

// ---- 点位空间索引（网格分桶）：视口裁剪只遍历命中的格子 ----
export function createPointIndex(points, cell) {
  const c = cell || 2 // 经纬度 2° 一格
  const buckets = new Map()
  const list = points || []
  list.forEach((p) => {
    const k = Math.floor(p.lng / c) + ',' + Math.floor(p.lat / c)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(p)
  })
  return {
    query(minLng, minLat, maxLng, maxLat) {
      const out = []
      const x0 = Math.floor(minLng / c), x1 = Math.floor(maxLng / c)
      const y0 = Math.floor(minLat / c), y1 = Math.floor(maxLat / c)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const arr = buckets.get(x + ',' + y)
          if (!arr) continue
          for (let i = 0; i < arr.length; i++) {
            const p = arr[i]
            if (p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat) out.push(p)
          }
        }
      }
      return out
    }
  }
}
