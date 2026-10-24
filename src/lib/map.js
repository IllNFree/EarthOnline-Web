// ===== 地图（高德 Web JS API：地点搜索 + 地图联动 + 足迹） =====
const AMAP_KEY = '07672883965ec7a6f0948813c0a90915'
const AMAP_SECURITY = 'd4e92781da1ca5996c246d315af66031'
let scriptPromise = null

export function loadAMap() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.AMap) return Promise.resolve(window.AMap)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    try { window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY } } catch (e) {}
    const s = document.createElement('script')
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + AMAP_KEY + '&plugin=AMap.PlaceSearch,AMap.Geocoder,AMap.AutoComplete'
    s.onload = () => {
      // 等待 AMap 全局就绪
      let n = 0
      const t = setInterval(() => {
        if (window.AMap) { clearInterval(t); resolve(window.AMap) }
        else if (++n > 50) { clearInterval(t); reject(new Error('AMap 初始化超时')) }
      }, 100)
    }
    s.onerror = () => reject(new Error('高德脚本加载失败'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

// 搜索地点，返回 [{id,name,address,location:{lng,lat},city}]
export async function searchPlaces(query, city) {
  const AMap = await loadAMap()
  return new Promise((resolve, reject) => {
    AMap.plugin('AMap.PlaceSearch', () => {
      const ps = new AMap.PlaceSearch({ city: city || '全国', pageSize: 20 })
      ps.search(query, (status, result) => {
        if (status === 'complete' && result.poiList) {
          const list = (result.poiList.pois || []).map((p) => ({
            id: p.id,
            name: p.name,
            address: p.address || '',
            city: (p.cityname) || '',
            location: p.location ? { lng: p.location.lng, lat: p.location.lat } : null
          }))
          resolve(list)
        } else if (status === 'no_data') resolve([])
        else reject(new Error('搜索失败：' + status))
      })
    })
  })
}

// 挂载地图到容器，返回 {map, onPick(cb)}；点击地图获取经纬度
export async function mountMap(el, center) {
  const AMap = await loadAMap()
  const c = center && center.lat ? [center.lng, center.lat] : [116.397, 39.909]
  const map = new AMap.Map(el, { zoom: 12, center: c, viewMode: '2D' })
  let pickCb = null
  map.on('click', (e) => { if (pickCb) pickCb({ lng: e.lnglat.getLng(), lat: e.lnglat.getLat() }) })
  return {
    map,
    onPick(cb) { pickCb = cb },
    setCenter(lng, lat) { map.setCenter([lng, lat]) },
    addMarker(lng, lat, name) {
      const m = new AMap.Marker({ position: [lng, lat], title: name || '' })
      map.add(m)
      return m
    },
    destroy() { map.destroy() }
  }
}
export function geocode(lng, lat) {
  return loadAMap().then((AMap) => new Promise((resolve) => {
    AMap.plugin('AMap.Geocoder', () => {
      const g = new AMap.Geocoder()
      g.getAddress([lng, lat], (st, res) => {
        if (st === 'complete' && res.regeocode) resolve(res.regeocode.formattedAddress || '')
        else resolve('')
      })
    })
  }))
}
