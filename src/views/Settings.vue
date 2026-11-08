<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { APP_INFO, CHANGELOG, getLifeStats, todayStr, sanitizeState, } from '../lib/model.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { downloadBackup, parseBackup, buildBackup } from '../lib/backup.js'
import { encryptJson, decryptJson } from '../lib/canvasCrypto.js'
import { testConnection, pushBackup, pullBackup, mergeBackup, remoteIsNewer, DEFAULT_REMOTE_PATH, loadDavConfig } from '../lib/webdav.js'
import { loadCloudConfig, saveCloudConfig, cloudRegister, cloudSendCode, cloudVerifyEmail, cloudResetPassword, cloudLogin, cloudLogout, cloudSyncNow, cloudHealth } from '../lib/cloud.js'
import { importBillToLedger, importMarkdownToNotes } from '../services/DataImporter.js'
import Icon from '../components/Icon.vue'
import GlassUploader from '../components/GlassUploader.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import Modal from '../components/GlassBottomSheet.vue'
import { useDialogStore } from '../stores/dialog.js'

const store = useAppStore()
const dialog = useDialogStore()
const $routerPush = useRouter().push
const theme = ref(store.theme)
// 主题强调色预设（v 为空 = 恢复跟随主题的默认强调色）
// 预设统一为低饱和墨色：与白色文字对比度均 ≥5.7:1，深色主题下按钮文字依然可读。
const ACCENTS = [
  { n: '默认', v: '' },
  { n: '青碧', v: '#2F6F6B' },
  { n: '石墨', v: '#4A4A52' },
  { n: '墨绿', v: '#3F5D3F' }
]

// ---------- 模块一（v2.1.0 重构）：单页垂直流 + 顶部锚点导航 + 居中搜索 ----------
// 四大功能模块分组：通用（资料 / 外观 / 桌面级交互）、通知、数据、关于
const SECTIONS = [
  { key: 'general', label: '通用', icon: 'settings', subs: ['外观', '桌面级交互'] },
  { key: 'notify', label: '通知', icon: 'bell', subs: ['系统通知', '待关注提醒'] },
  { key: 'data', label: '数据', icon: 'database', subs: ['备份', 'WebDAV', '时光机'] },
  { key: 'about', label: '关于', icon: 'info', subs: ['版本', '更新日志'] }
]
const cur = ref('general')
// 滚动容器是外层 .page（overflow-y:auto），锚点条在其中 sticky 悬浮
const mainRef = ref(null)
// 锚点导航：点击平滑滚动至对应区块
function goSec(k) {
  cur.value = k
  const root = mainRef.value
  if (!root) return
  const target = document.getElementById('sec-' + k)
  if (!target) return
  // 用 rect 差值计算目标滚动位置（offsetTop 受 offsetParent 影响不可靠）
  // 减去顶部悬浮条高度（搜索 + 锚点 ≈ 116px），保证滚动后标题不被悬浮条遮住
  const NAV_OFFSET = 64
  const top = root.scrollTop + (target.getBoundingClientRect().top - root.getBoundingClientRect().top) - NAV_OFFSET
  if (typeof root.scrollTo === 'function') {
    try { root.scrollTo({ top, behavior: 'smooth' }) } catch (e) { root.scrollTop = top }
  } else {
    root.scrollTop = top
  }
}
// 滚动高亮：当前视口顶部所处的区块即为当前锚点
function onScroll() {
  const root = mainRef.value
  if (!root) return
  const base = root.getBoundingClientRect().top
  let hit = SECTIONS[0].key
  for (const s of SECTIONS) {
    const el = document.getElementById('sec-' + s.key)
    if (!el) continue
    if (el.getBoundingClientRect().top - base <= 100) hit = s.key
  }
  // 滚到底部时强制高亮最后一个
  if (root.scrollTop + root.clientHeight >= root.scrollHeight - 6) hit = SECTIONS[SECTIONS.length - 1].key
  cur.value = hit
}

// ---------- 顶部居中搜索（Haze 胶囊）：按模块 / 子项关键词过滤并直达 ----------
const setQuery = ref('')
const matchedSections = computed(() => {
  const q = setQuery.value.trim().toLowerCase()
  if (!q) return SECTIONS
  return SECTIONS.filter((s) => {
    if (s.label.toLowerCase().includes(q)) return true
    return (s.subs || []).some((t) => t.toLowerCase().includes(q))
  })
})
function onSetSearch() {
  const first = matchedSections.value[0]
  if (!first) { store.showToast('没有匹配的设置项'); return }
  goSec(first.key)
  closeSetFind()
}

// ---------- 右上角极简搜索：图标 → 展开悬浮输入 ----------
const setFindOpen = ref(false)
const setFindInput = ref(null)
async function toggleSetFind() {
  setFindOpen.value = !setFindOpen.value
  if (setFindOpen.value) { await nextTick(); if (setFindInput.value) setFindInput.value.focus() }
}
function closeSetFind() { setFindOpen.value = false; setQuery.value = '' }


// v2.0.0 P0：补齐 path / autoSync 配置项（对齐 Android WebDavConfig 四字段 + AUTO_SYNC）
// 凭据只落 localStorage，不进存档，避免被打包进备份文件外泄
// 统一走 lib/webdav.js 的 loadDavConfig（与全局右键「立即备份」读同一份配置）
const DAV_KEY = 'eo_webdav_cfg_v2'
function loadDav() { return loadDavConfig() }
const dav = ref(loadDav())
const davMsg = ref('')
const davBusy = ref(false)
function saveDav() { try { localStorage.setItem(DAV_KEY, JSON.stringify(dav.value)) } catch (e) {} }

// ---------- 自建云端账号 / 同步（账号可选，仅用于多端同步） ----------
const cloud = ref(loadCloudConfig())
const cloudEmail = ref('')
const cloudPass = ref('')
const cloudBusy = ref(false)
const cloudMsg = ref('')
// form=登录/注册；verify=输入邮箱验证码；reset=找回密码
const cloudStage = ref('form')
const cloudCode = ref('')
const cloudResetPass = ref('')
const cloudDebugCode = ref('')
function cloudPersist(next) { cloud.value = next; saveCloudConfig(next) }
function saveCloudBase() { cloudPersist(Object.assign({}, cloud.value)) }
function cloudErrText(r) { return r && r.error ? r.error : '操作失败' }
function resetCloudForm() {
  cloudStage.value = 'form'
  cloudCode.value = ''
  cloudResetPass.value = ''
  cloudDebugCode.value = ''
}
async function doCloudRegister() {
  if (!cloudEmail.value || !cloudPass.value) { cloudMsg.value = '请填写邮箱和密码（密码至少 8 位）'; return }
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudRegister(loadCloudConfig(), cloudEmail.value.trim(), cloudPass.value)
  cloudBusy.value = false
  if (!r.ok) { cloudMsg.value = cloudErrText(r); return }
  cloudStage.value = 'verify'
  cloudCode.value = ''
  cloudDebugCode.value = r.debugCode || ''
  cloudMsg.value = '验证码已发送到 ' + cloudEmail.value.trim() + '，10 分钟内有效'
}
async function doCloudVerify() {
  if (!/^\d{6}$/.test(String(cloudCode.value || ''))) { cloudMsg.value = '请输入 6 位数字验证码'; return }
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudVerifyEmail(loadCloudConfig(), cloudEmail.value.trim(), cloudCode.value.trim())
  cloudBusy.value = false
  if (!r.ok) { cloudMsg.value = cloudErrText(r); return }
  cloud.value = loadCloudConfig()
  resetCloudForm()
  cloudMsg.value = '邮箱已验证，已登录'
  await doCloudSync()
}
async function doCloudResend(purpose) {
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudSendCode(loadCloudConfig(), cloudEmail.value.trim(), purpose)
  cloudBusy.value = false
  if (!r.ok) { cloudMsg.value = cloudErrText(r); return }
  cloudDebugCode.value = r.debugCode || ''
  cloudMsg.value = '验证码已重新发送，请查看邮箱（含垃圾邮件）'
}
async function doCloudStartReset() {
  if (!cloudEmail.value) { cloudMsg.value = '请先填写注册邮箱'; return }
  cloudStage.value = 'reset'
  cloudResetPass.value = ''
  await doCloudResend('reset')
}
async function doCloudReset() {
  if (!/^\d{6}$/.test(String(cloudCode.value || ''))) { cloudMsg.value = '请输入 6 位数字验证码'; return }
  if (!cloudResetPass.value || cloudResetPass.value.length < 8) { cloudMsg.value = '新密码至少 8 位'; return }
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudResetPassword(loadCloudConfig(), cloudEmail.value.trim(), cloudCode.value.trim(), cloudResetPass.value)
  cloudBusy.value = false
  if (!r.ok) { cloudMsg.value = cloudErrText(r); return }
  resetCloudForm()
  cloudMsg.value = '密码已重置，请用新密码登录'
}
async function doCloudLogin() {
  if (!cloudEmail.value || !cloudPass.value) { cloudMsg.value = '请填写邮箱和密码'; return }
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudLogin(loadCloudConfig(), cloudEmail.value.trim(), cloudPass.value)
  cloudBusy.value = false
  if (!r.ok) {
    if (r.status === 403) { cloudStage.value = 'verify'; cloudMsg.value = '邮箱尚未验证，请完成验证后再登录' }
    else cloudMsg.value = cloudErrText(r)
    return
  }
  cloud.value = loadCloudConfig()
  cloudMsg.value = '已登录'
  await doCloudSync()
}
async function doCloudSync() {
  if (!cloud.value.token) { cloudMsg.value = '请先登录'; return }
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudSyncNow(store, cloud.value)
  cloudBusy.value = false
  if (!r.ok) { cloudMsg.value = r.error || '同步失败'; return }
  cloud.value = loadCloudConfig()
  cloudMsg.value = '已同步（rev ' + r.rev + '）'
}
async function doCloudLogout() {
  cloudBusy.value = true
  await cloudLogout(cloud.value)
  cloudBusy.value = false
  cloud.value = loadCloudConfig()
  resetCloudForm()
  cloudMsg.value = '已退出登录（本地数据不受影响）'
}
async function testCloud() {
  cloudBusy.value = true; cloudMsg.value = ''
  const r = await cloudHealth(cloud.value)
  cloudBusy.value = false
  cloudMsg.value = r.ok ? '服务在线' : (r.error || '无法连接')
}
const lastSyncText = computed(() => String(store.data.lastSyncAt || '').replace('T', ' ').slice(0, 19) || '从未同步')

// ---------- 个人资料（原「我的」页并入） ----------
const life = computed(() => getLifeStats(store.data.birthDate))
const showEdit = ref(false)
const form = ref({ name: '', signature: '', customTitle: '', gender: '', birthDate: '', country: '', province: '', avatarData: '', customFields: [] })
// 模块四：隐藏彩蛋「沃尔玛购物袋」—— 性别下拉中隐藏加入，需通过下方「隐藏选项」入口揭示
const showEgg = ref(false)
// 头像裁剪：滚轮缩放 + 拖动（AvatarCropper）
const cropSrc = ref('')

function openEdit() {
  const p = store.data.profile
  form.value = { name: p.name, signature: p.signature, customTitle: p.customTitle, gender: p.gender, birthDate: store.data.birthDate, country: p.country, province: p.province, avatarData: p.avatarData || '', customFields: (p.customFields || []).map((x) => ({ key: x.key, value: x.value })) }
  showEgg.value = (p.gender === '沃尔玛购物袋')
  showEdit.value = true
}
function saveProfile() {
  store.setProfile({
    name: form.value.name, signature: form.value.signature, customTitle: form.value.customTitle,
    gender: form.value.gender, country: form.value.country, province: form.value.province, avatarData: form.value.avatarData,
    customFields: form.value.customFields.filter((c) => c.key && c.key.trim()).map((c) => ({ key: c.key.trim(), value: c.value }))
  })
  store.setBirthDate(form.value.birthDate)
  store.showToast('资料已保存')
  showEdit.value = false
}
function onAvatarFile(f) {
  if (!f || !f.type.startsWith('image/')) { store.showToast('请选择图片文件'); return }
  const r = new FileReader()
  r.onload = () => { cropSrc.value = r.result }
  r.readAsDataURL(f)
}
function onCrop(dataUrl) {
  form.value.avatarData = dataUrl
  cropSrc.value = ''
  // 一步到位：裁剪确认即写入全局状态 + 本地持久化，不再需要「保存资料」这一步
  store.setProfile({ avatarData: dataUrl })
  store.showToast('头像已更新')
}
function clearAvatar() {
  form.value.avatarData = ''
  cropSrc.value = ''
  // 与裁剪确认保持一致：移除头像同样即时落库，无需再点保存
  store.setProfile({ avatarData: '' })
  store.showToast('头像已移除')
}
const avatarSrc = computed(() => store.data.profile.avatarData)
// 头像兜底：数据损坏（裂图）时自动降级为首字占位，绝不留白
const profAvatarBroken = ref(false)
watch(avatarSrc, () => { profAvatarBroken.value = false })

// ---------- 外观 ----------
function setTheme(t) { theme.value = t; store.setTheme(t); store.showToast('主题已切换') }
function onWallFile(f) {
  if (!f || !f.type.startsWith('image/')) { store.showToast('请选择图片文件'); return }
  const r = new FileReader()
  r.onload = () => {
    const img = new Image()
    img.onload = () => {
      // 压边到 1600px 内，控制体积
      const maxW = 1600
      const scale = Math.min(1, maxW / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      store.setWallpaper(canvas.toDataURL('image/jpeg', 0.85))
      store.showToast('壁纸已设置')
    }
    img.src = r.result
  }
  r.readAsDataURL(f)
}
function clearWall() { store.setWallpaper(''); store.showToast('已恢复默认背景') }
// 滑块展示的是「透明度」：0% = 完全不透明（实体），100% = 完全透明（看不见）
// 底层存的是 alpha 不透明度（0=全透明, 1=全实体），两者互补 → 写入时做 1 - x 翻转
const toAlpha = (transparencyPct) => 1 - transparencyPct / 100
const fromAlpha = (alpha, defAlpha = 1) => {
  const n = Number(alpha)
  return Math.round((1 - (isFinite(n) ? n : defAlpha)) * 100)
}
const wallPct = ref(fromAlpha(store.data.wallAlpha, 1))
const wallBlur = ref(Number(store.data.wallBlur) || 0)
const cardPct = ref(fromAlpha(store.data.cardAlpha, 0.8))
function pushAppearance() {
  store.setAppearance({
    wallAlpha: toAlpha(wallPct.value),
    wallBlur: wallBlur.value,
    cardAlpha: toAlpha(cardPct.value)
  })
  store.applyTheme()
}

// ---------- 通知（原「通知中心」整体并入设置，弹窗查看） ----------
const notifState = ref(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
const showNotif = ref(false)
const today = todayStr()
// 模块四：通知精简 —— 只保留高价值事件，避免消息轰炸。
// ① 任务临近死线（今日截止 / 已逾期，最多 6 条）② 最近解锁的成就（最多 4 条）
// ③ WebDAV 同步失败告警。
const dueItems = computed(() => {
  const out = []
  store.live.tasks.forEach((t) => {
    if (t.status === 'done' || !t.dueDate) return
    if (t.dueDate < today) out.push({ id: 'over-' + t.id, icon: 'bolt', tone: 'bad', rank: 0, title: '已逾期：' + t.title, sub: '截止 ' + t.dueDate + (t.dueTime ? ' ' + t.dueTime : ''), to: '/tasks' })
    else if (t.dueDate === today) out.push({ id: 'due-' + t.id, icon: 'clock', tone: 'warn', rank: 1, title: '今日截止：' + t.title, sub: (t.dueTime ? '今天 ' + t.dueTime : '今天'), to: '/tasks' })
  })
  return out.sort((a, b) => a.rank - b.rank).slice(0, 6)
})
// 最近解锁的成就动态（不再按等级筛选）
const achievementNews = computed(() => {
  return store.data.achievements.slice().reverse().slice(0, 4).map((a) => {
    const d = ACHIEVEMENTS.find((x) => x.key === a.key)
    return {
      id: 'ach-' + a.key,
      icon: d ? d.icon : 'trophy',
      tone: 'good',
      title: '成就解锁：' + (d ? d.title : a.key),
      sub: '解锁于 ' + a.unlockedAt,
      to: '/achievements'
    }
  })
})
// WebDAV 同步失败（高价值告警，来自 store 的内存态 syncError）
const syncFailures = computed(() => {
  if (!store.syncError) return []
  return [{ id: 'dav-err', icon: 'warning', tone: 'bad', title: 'WebDAV 同步失败', sub: store.syncError, to: '/settings' }]
})
const reminders = computed(() => syncFailures.value.concat(dueItems.value).concat(achievementNews.value))
async function askNotif() {
  if (typeof Notification === 'undefined') { store.showToast('当前浏览器不支持通知'); return }
  try {
    const p = await Notification.requestPermission()
    notifState.value = p
    if (p === 'granted') {
      new Notification('地球Online', { body: '通知已开启，任务截止时会提醒你。' })
      store.showToast('通知已开启')
    } else if (p === 'denied') store.showToast('通知已被拒绝，可在浏览器设置中恢复')
  } catch (e) { store.showToast('通知开启失败：' + e.message) }
}
function goReminder(to) { showNotif.value = false; $routerPush(to) }
const notifLabel = computed(() => ({ granted: '已开启', default: '未开启', denied: '已被拒绝', unsupported: '不支持' }[notifState.value] || notifState.value))

// ---------- 关于页：更新日志 / 赞助 弹窗化 ----------
const showLog = ref(false)
const showSponsor = ref(false)
const SPONSORS = ['海神唐三', 'Seastar', '清浅', '𝓛𝓾𝓬𝓲𝓯𝓮𝓻', 'Cyou2']

// ---------- 数据 · 备份与同步 ----------
function exportData() { downloadBackup(store.data); store.showToast('备份已下载') }

// v2.1.0 终极封板：AES-GCM 加密导出 / 导入（全量数据封装，密码不出本机）
const encPass = ref('')
const encBusy = ref(false)
function _downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportEncrypted() {
  if (!encPass.value) { store.showToast('请先设置导出密码'); return }
  encBusy.value = true
  try {
    const text = await encryptJson(buildBackup(store.data), encPass.value)
    _downloadText(text, '地球Online-加密备份-' + new Date().toISOString().slice(0, 10) + '.enc.json')
    store.showToast('加密备份已下载（请牢记密码）')
  } catch (err) { store.showToast('加密导出失败：' + err.message) }
  finally { encBusy.value = false }
}
async function onImportEncrypted(e) {
  const f = e.target.files[0]
  if (!f) return
  if (!encPass.value) { store.showToast('请先输入解密密码'); e.target.value = ''; return }
  const r = new FileReader()
  r.onload = async () => {
    try {
      const obj = await decryptJson(r.result, encPass.value)
      const st = sanitizeState(parseBackup(obj))
      const { patch } = mergeBackup(store.data, st)
      applyMerge(patch, '已按主键合并导入（加密备份）')
    } catch (err) { store.showToast('解密失败：密码错误或文件损坏') }
  }
  r.readAsText(f)
  e.target.value = ''
}

// ---------- 3.0 本机存储健康度（体积 / 配额 / 保存状态 / 持久化） ----------
const BUILD_TIME = typeof __EO_BUILDTIME__ !== 'undefined' ? __EO_BUILDTIME__ : ''
const buildTimeText = computed(() => {
  if (!BUILD_TIME) return '未知'
  try {
    const d = new Date(BUILD_TIME)
    const p = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  } catch (e) { return '未知' }
})
function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(2) + ' MB'
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
const storageUsedPct = computed(() => {
  const s = store.storageInfo
  if (!s.quota || !s.usage) return 0
  return Math.min(100, Math.round((s.usage / s.quota) * 1000) / 10)
})
onMounted(() => { store.refreshStorage() })
async function onRefreshStorage() {
  await store.flushSave()
  await store.refreshStorage()
  store.showToast('存储状态已刷新')
}
async function onPersistStorage() {
  const ok = await store.persistStorage()
  store.showToast(ok ? '已开启持久化存储，数据不易被系统清理' : '浏览器未授予持久化存储（安装为应用后再试）')
  store.refreshStorage()
}

// v2.1.0 终极封板：本地时光机
function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }) } catch (e) { return '' }
}
function onRestoreTm(i) {
  store.restoreTimeMachine(i)
}
// 本地 JSON 导入：与 Android @Insert(REPLACE) 同语义 —— 按主键 upsert，不整包覆盖
function applyMerge(patch, tip) {
  Object.keys(patch).forEach((k) => { store.data[k] = patch[k] })
  store.persist()
  store.showToast(tip)
}
function onImport(e) {
  const f = e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try {
      const st = sanitizeState(parseBackup(r.result))
      const { patch } = mergeBackup(store.data, st)
      applyMerge(patch, '已按主键合并导入')
    } catch (err) { store.showToast('导入失败：' + err.message) }
  }
  r.readAsText(f)
}
async function davTest() {
  if (!store.requireOnline('测试连接')) return
  saveDav()
  davBusy.value = true; const r = await testConnection(dav.value)
  davMsg.value = r.ok ? '连接成功，配置可用' : '连接失败：' + r.error
  if (!r.ok) store.setSyncError(r.error || '连接失败')
  davBusy.value = false
}
async function davPush() {
  if (!store.requireOnline('上传备份')) return
  saveDav()
  davBusy.value = true
  const r = await pushBackup(dav.value, store.data)
  davBusy.value = false
  if (r.ok) {
    store.data.lastSyncAt = r.syncedAt || new Date().toISOString()
    store.persist()
    store.setSyncError('')
    davMsg.value = '已上传到 ' + (dav.value.path || DEFAULT_REMOTE_PATH)
  } else {
    store.setSyncError(r.error || '上传失败')
    davMsg.value = '上传失败：' + r.error
  }
}
async function davPull() {
  if (!store.requireOnline('拉取备份')) return
  saveDav()
  davBusy.value = true
  const r = await pullBackup(dav.value)
  davBusy.value = false
  if (!r.ok) { store.setSyncError(r.error || '拉取失败'); davMsg.value = '拉取失败：' + r.error; return }
  const remote = r.payload
  if (!remoteIsNewer(remote.exportedAt, store.data.lastSyncAt)) {
    store.setSyncError('')
    davMsg.value = '云端不比本地新，未改动任何数据'
    store.showToast('云端无更新数据')
    return
  }
  const { patch, added } = mergeBackup(store.data, remote.state)
  applyMerge(patch, '已按主键合并，新增 ' + added + ' 条')
  store.data.lastSyncAt = remote.exportedAt || new Date().toISOString()
  store.persist()
  store.setSyncError('')
  davMsg.value = '已拉取并按主键合并（新增 ' + added + ' 条）'
}

// ---------- 第三方数据导入（需求 5） ----------
function onImportBill(e) {
  const f = e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    const res = importBillToLedger(r.result)
    store.showToast(res.ok ? ('已导入记账 ' + res.imported + ' 条') : ('导入失败：' + res.error))
  }
  r.readAsText(f)
  e.target.value = ''
}
function onImportMd(e) {
  const f = e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    const res = importMarkdownToNotes(r.result)
    store.showToast(res.ok ? ('已导入笔记 ' + res.imported + ' 篇') : '导入失败')
  }
  r.readAsText(f)
  e.target.value = ''
}

// ---------- 自动同步（对齐 Android AUTO_SYNC 默认开启） ----------
let autoTimer = null
store.onDataChanged(() => {
  if (!dav.value.autoSync || !dav.value.url) return
  clearTimeout(autoTimer)
  autoTimer = setTimeout(async () => {
    if (!store.online) return
    const r = await pushBackup(dav.value, store.data)
    if (r.ok) store.data.lastSyncAt = r.syncedAt || new Date().toISOString()
  }, 2500)
})
async function hardReset() {
  const ok = await dialog.confirm({
    title: '清空全部本地数据',
    message: '此操作将删除所有本地任务、背包、笔记、相册与足迹，且不可撤销。',
    confirmText: '确认清空',
    cancelText: '取消',
    danger: true
  })
  if (ok) store.hardReset()
}

</script>

<template>
  <div class="page set-page" ref="mainRef" @scroll="onScroll">
    <!-- v2.1.0 模块五：单页垂直流 + 顶部锚点导航（点击平滑滚动，滚动时自动高亮当前区块） -->
    <!-- 锚点条 Teleport 到 body：脱离路由转场 <transition> 的 transform 包含块，
         避免 position:fixed 在转场 transform 清除瞬间被重新定位导致的「先贴边后瞬移居中」偏移 -->
    <Teleport to="body">
      <!-- 模块锚点：居中悬浮（已不再被巨大搜索框占据垂直空间） -->
      <nav class="set-anchor glass">
        <button v-for="s in (setQuery.trim() ? matchedSections : SECTIONS)" :key="s.key" class="set-anchor-item" :class="{ on: cur === s.key }" @click="goSec(s.key)">
          <Icon :name="s.icon" :size="15" />
          <span>{{ s.label }}</span>
        </button>
      </nav>
      <!-- 右上角极简搜索：线性图标 → 点击展开悬浮输入（或全局 Ctrl/Cmd+K 唤起全局搜索） -->
      <div class="set-find-wrap">
        <transition name="fade">
          <div v-if="setFindOpen" class="set-find-pop glass">
            <div class="search-bar set-find-bar">
              <Icon name="search" :size="15" />
              <input ref="setFindInput" v-model="setQuery" placeholder="搜索设置项…" @keyup.enter="onSetSearch" @keyup.esc.stop="closeSetFind" />
              <button v-if="setQuery" class="clear" title="清空" @click="setQuery = ''"><Icon name="close" :size="13" /></button>
            </div>
            <div class="set-find-list">
              <button v-for="s in matchedSections" :key="s.key" class="set-find-item" @click="goSec(s.key); closeSetFind()">
                <Icon :name="s.icon" :size="14" />
                <span class="set-find-item__t">{{ s.label }}</span>
                <span class="set-find-item__d">{{ (s.subs || []).join(' · ') }}</span>
              </button>
              <div v-if="!matchedSections.length" class="set-find-empty">没有匹配的设置模块</div>
            </div>
          </div>
        </transition>
        <button class="set-find" :class="{ on: setFindOpen }" title="搜索设置（Ctrl / Cmd + K）" aria-label="搜索设置" @click="toggleSetFind">
          <Icon name="search" :size="16" />
        </button>
      </div>
    </Teleport>

    <div class="set-shell">
      <div class="set-main">
        <!-- ============ 通用（外观 / 桌面级交互） ============ -->
        <section id="sec-general" class="set-sec">
          <div class="sec-head">
            <h2>通用</h2>
            <p class="muted">外观与桌面级交互</p>
          </div>

          <div class="sec-sub"><span class="sec-sub__ico"><Icon name="palette" :size="15" /></span><b>外观</b><span class="sec-sub__d">主题 · 壁纸 · 玻璃质感</span></div>
<div class="glass card row" style="gap:8px">
            <button class="btn ghost" :style="theme === 'light' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setTheme('light')"><Icon name="palette" :size="16" /> 浅色</button>
            <button class="btn ghost" :style="theme === 'dark' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setTheme('dark')"><Icon name="palette" :size="16" /> 深色</button>
            <button class="btn ghost" :style="theme === 'auto' ? 'background:var(--eo-primary);color:#fff' : ''" @click="setTheme('auto')"><Icon name="palette" :size="16" /> 跟随系统</button>
          </div>
          <div class="glass card">
            <div class="field">
              <label>自定义壁纸</label>
              <GlassUploader label="点击或拖拽设置壁纸（自动压边，本地存储）" @file="onWallFile" />
              <div v-if="store.data.wallpaper" class="wall-preview" :style="{ backgroundImage: 'url(' + store.data.wallpaper + ')' }">
                <button class="btn ghost" style="position:absolute;right:10px;bottom:10px;padding:7px 12px;font-size:12px" @click="clearWall"><Icon name="trash" :size="14" /> 恢复默认</button>
              </div>
            </div>
            <div class="field">
              <label>壁纸透明度（{{ wallPct }}%）</label>
              <input type="range" min="0" max="100" step="1" v-model.number="wallPct" @input="pushAppearance" style="width:100%" />
              <div class="muted" style="font-size:12px;margin-top:4px">0% 为完全实体，100% 为彻底透明（看不见壁纸）。</div>
            </div>
            <div class="field">
              <label>壁纸模糊度（{{ wallBlur }} px）</label>
              <input type="range" min="0" max="30" step="1" v-model.number="wallBlur" @input="pushAppearance" style="width:100%" />
              <div class="muted" style="font-size:12px;margin-top:4px">数值越大背景越柔化，玻璃卡片上的文字更清晰。</div>
            </div>
            <div class="field">
              <label>卡片透明度（{{ cardPct }}%）</label>
              <input type="range" min="0" max="100" step="1" v-model.number="cardPct" @input="pushAppearance" style="width:100%" />
              <div class="muted" style="font-size:12px;margin-top:4px">默认 80%（与 Android 一致）：越往右越透底；卡片过透明时会自动为文字加浅色描边保证可读。</div>
            </div>
            <!-- v2.1.0 终极封板：自定义强调色（同步驱动 Haze 光晕） -->
            <div class="field">
              <label>主题强调色</label>
              <div class="accent-row">
                <button v-for="c in ACCENTS" :key="c.v" class="accent-dot" :class="{ on: (store.data.accent || '') === c.v }"
                  :style="{ background: c.v || 'linear-gradient(135deg,#3A3A38,#2C2C2C)' }" :title="c.n" @click="store.setAccent(c.v)">
                  <Icon v-if="(store.data.accent || '') === c.v" name="check" :size="14" />
                </button>
                <label class="accent-custom" title="自定义颜色"><Icon name="palette" :size="15" />
                  <input type="color" :value="store.data.accent || '#2C2C2C'" @input="store.setAccent($event.target.value)" />
                </label>
              </div>
              <div class="muted" style="font-size:12px;margin-top:4px">选择预设或自定义强调色，按钮、光晕与高亮会同步变化；选「默认」恢复跟随主题的默认强调色。</div>
            </div>
            <!-- 模块三：主页图片相框 -->
            <div class="field">
              <label>照片相框</label>
              <div class="row between">
                <div class="muted" style="font-size:12px;line-height:1.5;flex:1;min-width:0">给画布照片与相册缩略图加白色卡纸相框（默认开启）；关闭则为无边框直出。</div>
                <button class="switch" :class="{ on: store.data.photoFrame !== false }" aria-label="照片相框" @click="setPhotoFrame(store.data.photoFrame === false)"><i></i></button>
              </div>
            </div>
          </div>

          <div class="sec-sub"><span class="sec-sub__ico"><Icon name="sparkles" :size="15" /></span><b>桌面级交互</b><span class="sec-sub__d">右键菜单 · 剪贴板监听</span></div>
<div class="glass card row between" style="margin-bottom:10px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">自定义右键菜单</div>
              <div class="muted" style="font-size:12px">液态玻璃操作面板；关闭后放行浏览器原生右键菜单</div>
            </div>
            <button class="switch" :class="{ on: store.data.enableCustomContextMenu }" aria-label="自定义右键菜单" @click="store.data.enableCustomContextMenu = !store.data.enableCustomContextMenu; store.persist()"><i></i></button>
          </div>
          <div class="glass card row between" style="margin-bottom:10px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">剪贴板智能监听</div>
              <div class="muted" style="font-size:12px">切回网页时若剪贴板有新内容，右下角提示并孵化为笔记 / 相册 / 收藏节点</div>
            </div>
            <button class="switch" :class="{ on: store.data.enableClipboardWatch }" aria-label="剪贴板监听" @click="store.data.enableClipboardWatch = !store.data.enableClipboardWatch; store.persist()"><i></i></button>
          </div>
        </section>

        <!-- ============ 通知 ============ -->
        <section id="sec-notify" class="set-sec">
          <div class="sec-head">
            <h2>通知</h2>
            <p class="muted">系统通知与待关注提醒</p>
          </div>
          <div class="glass card row between" style="margin-bottom:10px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">系统通知</div>
              <div class="muted" style="font-size:12px">当前状态：{{ notifLabel }} · 开启后任务截止提醒更及时</div>
            </div>
            <button class="btn" :disabled="notifState === 'granted'" @click="askNotif"><Icon name="bell" :size="16" /> {{ notifState === 'granted' ? '已开启' : '开启通知' }}</button>
          </div>
          <div class="glass card row between" style="cursor:pointer" @click="showNotif = true">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">待关注提醒</div>
              <div class="muted" style="font-size:12px">仅推送高价值事件 · 任务死线 / 史诗成就 / 同步异常 · 共 {{ reminders.length }} 条</div>
            </div>
            <Icon name="chevron" :size="18" />
          </div>
        </section>

        <!-- ============ 桌面级交互 ============ -->
        

        <!-- ============ 数据 · 备份与同步 ============ -->
        <section id="sec-data" class="set-sec">
          <div class="sec-head">
            <h2>数据 · 备份与同步</h2>
            <p class="muted">本页任意数据变更后可自动推送云端</p>
          </div>
          <div class="glass card">
            <!-- 3.0 本机存储健康度：数据量 / 配额 / 持久化状态一眼可见 -->
            <div class="st-health">
              <div class="row between" style="margin-bottom:8px">
                <div style="font-weight:600;font-size:13px">本机存储</div>
                <button class="btn sm ghost" @click="onRefreshStorage"><Icon name="reset" :size="13" /> 刷新</button>
              </div>
              <div class="st-grid">
                <div class="st-cell">
                  <div class="st-k">主存档</div>
                  <div class="st-v">{{ fmtBytes(store.storageInfo.mainBytes) }}</div>
                </div>
                <div class="st-cell">
                  <div class="st-k">照片 / 附件</div>
                  <div class="st-v">{{ fmtBytes(store.storageInfo.mediaBytes) }}<span class="st-n">{{ store.storageInfo.mediaCount }} 个</span></div>
                </div>
                <div class="st-cell">
                  <div class="st-k">已用 / 配额</div>
                  <div class="st-v">{{ fmtBytes(store.storageInfo.usage) }}<span class="st-n">{{ store.storageInfo.quota ? fmtBytes(store.storageInfo.quota) : '未知' }}</span></div>
                </div>
              </div>
              <div class="st-bar"><i :style="{ width: storageUsedPct + '%' }" :class="{ warn: storageUsedPct >= 80 }"></i></div>
              <div class="st-foot">
                <span class="st-tag" :class="{ bad: !store.storageInfo.ok }">
                  {{ store.storageInfo.ok ? '保存正常' : '保存失败：' + (store.storageInfo.error || '未知') }}
                </span>
                <span class="st-tag">{{ store.storageInfo.fallback ? '降级 localStorage' : 'IndexedDB' }}</span>
                <span class="st-tag" :class="{ good: store.storageInfo.persisted }">{{ store.storageInfo.persisted ? '持久化已开启' : '持久化未开启' }}</span>
                <button v-if="!store.storageInfo.persisted" class="chip" @click="onPersistStorage">申请持久化</button>
              </div>
            </div>
            <div class="row" style="gap:8px;margin:12px 0">
              <button class="btn" @click="exportData"><Icon name="download" :size="16" /> 导出备份</button>
              <label class="btn ghost"><Icon name="upload" :size="16" /> 导入备份<input type="file" accept="application/json" style="display:none" @change="onImport" /></label>
            </div>
            <!-- v2.1.0 终极封板：AES-GCM 全量加密导出 / 导入 -->
            <div class="glass card" style="margin-bottom:12px;padding:12px">
              <div style="font-weight:600;margin-bottom:2px">🔒 加密备份</div>
              <div class="muted" style="font-size:12px;margin-bottom:10px">全量数据在本地用密码加密后再导出，密码不会上传，请务必牢记。</div>
              <div class="field" style="margin-bottom:10px"><label>加密密码</label><input v-model="encPass" type="password" placeholder="设置 / 输入密码" /></div>
              <div class="row" style="gap:8px;flex-wrap:wrap">
                <button class="btn" :disabled="encBusy" @click="exportEncrypted"><Icon name="lock" :size="15" /> {{ encBusy ? '加密中…' : '导出加密备份' }}</button>
                <label class="btn ghost"><Icon name="upload" :size="15" /> 导入加密备份<input type="file" accept=".json,.enc.json,application/json" style="display:none" @change="onImportEncrypted" /></label>
              </div>
            </div>
            <!-- v2.1.0 终极封板：本地时光机（会话内快照，重大操作前自动留底） -->
            <div class="glass card" style="margin-bottom:12px;padding:12px">
              <div style="font-weight:600;margin-bottom:2px">🕒 本地时光机</div>
              <div class="muted" style="font-size:12px;margin-bottom:10px">批量删除等重大操作前会自动留存快照，可一键回到当时的版本（本次会话内有效）。</div>
              <div v-if="!store.timeMachine.length" class="muted" style="font-size:12px">暂无快照。进行批量删除等操作后会自动出现在这里。</div>
              <div v-else class="tm-list">
                <div v-for="(s, i) in store.timeMachine" :key="i" class="tm-item">
                  <div style="min-width:0;flex:1">
                    <div style="font-weight:600;font-size:13px">{{ s.label }}</div>
                    <div class="muted" style="font-size:11px">{{ fmtTime(s.ts) }}</div>
                  </div>
                  <button class="btn sm ghost" @click="onRestoreTm(i)"><Icon name="reset" :size="13" /> 还原</button>
                </div>
              </div>
            </div>
            <div class="row" style="gap:8px;margin-bottom:12px">
              <label class="btn ghost"><Icon name="upload" :size="16" /> 导入账单 CSV<input type="file" accept=".csv,text/csv" style="display:none" @change="onImportBill" /></label>
              <label class="btn ghost"><Icon name="upload" :size="16" /> 导入 Markdown<input type="file" accept=".md,text/markdown" style="display:none" @change="onImportMd" /></label>
            </div>
            <!-- 自建云端：可选账号 + 双向同步（不登录也能正常使用本地全部功能） -->
            <div class="glass card" style="margin-bottom:12px;padding:12px">
              <div style="font-weight:600;margin-bottom:2px">云端账号（可选 · 仅用于多端同步）</div>
              <div class="muted" style="font-size:12px;margin-bottom:10px">不登录也能完整使用全部功能，数据存本地；登录后可在多台设备间同步。</div>
              <div class="field"><label>同步服务地址</label><input v-model="cloud.baseUrl" placeholder="http://localhost:8787" @change="saveCloudBase" /></div>
              <div v-if="!cloud.token">
                <div v-if="cloudStage === 'form'">
                  <div class="field"><label>邮箱</label><input v-model="cloudEmail" type="email" placeholder="you@example.com" autocomplete="username" /></div>
                  <div class="field"><label>密码</label><input v-model="cloudPass" type="password" placeholder="至少 8 位" autocomplete="current-password" /></div>
                  <div class="row" style="gap:8px;flex-wrap:wrap">
                    <button class="btn" :disabled="cloudBusy" @click="doCloudRegister">注册</button>
                    <button class="btn" :disabled="cloudBusy" @click="doCloudLogin">登录</button>
                    <button class="btn ghost" :disabled="cloudBusy" @click="testCloud">测试服务</button>
                  </div>
                  <div class="row" style="margin-top:6px">
                    <button class="btn ghost" style="font-size:12px;padding:2px 6px" :disabled="cloudBusy" @click="doCloudStartReset">忘记密码？</button>
                  </div>
                </div>
                <div v-else-if="cloudStage === 'verify'">
                  <div class="field"><label>邮箱验证码</label><input v-model="cloudCode" inputmode="numeric" maxlength="6" placeholder="6 位数字" /></div>
                  <div v-if="cloudDebugCode" class="muted" style="font-size:11px;margin-bottom:6px">调试验证码：{{ cloudDebugCode }}</div>
                  <div class="row" style="gap:8px;flex-wrap:wrap">
                    <button class="btn" :disabled="cloudBusy" @click="doCloudVerify">验证并登录</button>
                    <button class="btn ghost" :disabled="cloudBusy" @click="doCloudResend('register')">重发验证码</button>
                    <button class="btn ghost" :disabled="cloudBusy" @click="resetCloudForm">返回</button>
                  </div>
                </div>
                <div v-else>
                  <div class="field"><label>邮箱验证码</label><input v-model="cloudCode" inputmode="numeric" maxlength="6" placeholder="6 位数字" /></div>
                  <div v-if="cloudDebugCode" class="muted" style="font-size:11px;margin-bottom:6px">调试验证码：{{ cloudDebugCode }}</div>
                  <div class="field"><label>新密码</label><input v-model="cloudResetPass" type="password" placeholder="至少 8 位" autocomplete="new-password" /></div>
                  <div class="row" style="gap:8px;flex-wrap:wrap">
                    <button class="btn" :disabled="cloudBusy" @click="doCloudReset">重置密码</button>
                    <button class="btn ghost" :disabled="cloudBusy" @click="doCloudResend('reset')">重发验证码</button>
                    <button class="btn ghost" :disabled="cloudBusy" @click="resetCloudForm">返回</button>
                  </div>
                </div>
              </div>
              <div v-else>
                <div class="row between">
                  <div style="min-width:0">
                    <div style="font-weight:600">{{ (cloud.user && cloud.user.email) || '已登录' }}</div>
                    <div class="muted" style="font-size:12px">上次同步：{{ cloud.lastSyncAt ? String(cloud.lastSyncAt).replace('T', ' ').slice(0, 19) : '尚未同步' }}</div>
                  </div>
                </div>
                <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
                  <button class="btn" :disabled="cloudBusy" @click="doCloudSync">立即同步</button>
                  <button class="btn ghost" :disabled="cloudBusy" @click="doCloudLogout">退出登录</button>
                </div>
                <div class="muted" style="font-size:11px;margin-top:8px">账号仅用于多端同步；退出后本地数据完全保留。</div>
              </div>
              <div v-if="cloudMsg" class="muted" style="font-size:12px;margin-top:8px">{{ cloudMsg }}</div>
            </div>
            <div class="field"><label>WebDAV 地址</label><input v-model="dav.url" placeholder="https://dav.example.com/" @change="saveDav" /></div>
            <div class="row" style="gap:8px">
              <div class="field" style="flex:1"><label>账号</label><input v-model="dav.user" @change="saveDav" /></div>
              <div class="field" style="flex:1"><label>密码</label><input v-model="dav.pass" type="password" @change="saveDav" /></div>
            </div>
            <div class="field">
              <label>远端文件路径</label>
              <input v-model="dav.path" :placeholder="DEFAULT_REMOTE_PATH" @change="saveDav" />
              <div class="muted" style="font-size:12px;margin-top:4px">三端统一为 <b>/earth_online_backup.json</b>，改动仅在自建多端分流时需要。</div>
            </div>
            <div class="glass card row between" style="margin-bottom:10px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600">自动同步</div>
                <div class="muted" style="font-size:12px">本页任意数据变更后自动推送云端（对齐 Android AUTO_SYNC）</div>
              </div>
              <button class="switch" :class="{ on: dav.autoSync }" aria-label="自动同步" @click="dav.autoSync = !dav.autoSync; saveDav()"><i></i></button>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn ghost" :disabled="davBusy" @click="davTest"><Icon name="bolt" :size="16" /> 测试</button>
              <button class="btn ghost" :disabled="davBusy" @click="davPush"><Icon name="upload" :size="16" /> 上传</button>
              <button class="btn ghost" :disabled="davBusy" @click="davPull"><Icon name="download" :size="16" /> 拉取</button>
            </div>
            <div class="muted" style="font-size:12px;margin-top:8px">上次同步：{{ lastSyncText }} · 远端文件 {{ dav.path || DEFAULT_REMOTE_PATH }}</div>
            <div v-if="davMsg" class="muted" style="margin-top:8px">{{ davMsg }}</div>
          </div>
        </section>

        <!-- ============ 关于 ============ -->
        <section id="sec-about" class="set-sec">
          <div class="sec-head">
            <h2>关于</h2>
            <p class="muted">版本、团队与隐私</p>
          </div>
          <div class="glass card">
            <div class="row" style="gap:12px">
              <img src="/icons/icon.svg?v=4" alt="Logo" style="width:56px;height:56px;border-radius:16px;box-shadow:0 10px 24px -10px rgba(44, 44, 44, .14), inset 0 1px 0 rgba(255,255,255,.4)" />
              <div style="flex:1;min-width:0">
                <div class="row" style="gap:8px"><span style="font-size:18px;font-weight:800">地球Online</span><span class="chip">v{{ APP_INFO.version }}</span></div>
                <div class="muted" style="font-size:12px;margin-top:2px">把人生当成一场开放世界游戏</div>
              </div>
            </div>
            <div class="row wrap" style="gap:6px;margin-top:12px">
              <span class="chip">版本号 v{{ APP_INFO.version }}</span>
              <span class="chip">构建 {{ buildTimeText }}</span>
              <span class="chip">开源许可 MIT</span>
              <span class="chip" style="min-width:0">Earth icon by Studio Danro (Noun Project)</span>
              <span class="chip">数据存储 本机 IndexedDB</span>
            </div>
            <div class="row wrap" style="gap:6px;margin-top:8px">
              <span class="muted" style="font-size:12px">开发人员</span>
              <span class="chip">二十七 · 数据</span>
              <span class="chip">Cyou2 · 设计</span>
            </div>
            <div class="row wrap" style="gap:6px;margin-top:8px">
              <span class="muted" style="font-size:12px">赞助者</span>
              <span v-for="s in ['海神唐三', 'Seastar', '清浅', '𝓛𝓾𝓬𝓲𝓯𝓮𝓻', 'Cyou2']" :key="s" class="chip" style="background:var(--eo-primary);color:#fff">{{ s }}</span>
            </div>
            <div class="row" style="gap:8px;margin-top:12px">
              <button class="btn ghost" style="flex:1" @click="showSponsor = true"><Icon name="coins" :size="16" /> 赞助开发者</button>
              <button class="btn ghost" style="flex:1" @click="showLog = true"><Icon name="clock" :size="16" /> 更新日志</button>
            </div>
          </div>
          <div class="glass card" style="margin-top:12px">
            <div style="font-size:13px;line-height:1.8">地球Online 是一个完全离线运行的个人人生记录应用：没有服务器、没有账号、没有埋点，你的每一条数据都只存在这台设备上。<button class="chip" style="margin-left:4px" @click="$router.push('/privacy')">查看隐私政策</button><button class="chip" style="margin-left:4px" @click="$router.push('/terms')">用户协议与免责声明</button></div>
          </div>
          <button class="btn danger" style="width:100%;margin-top:12px" @click="hardReset"><Icon name="trash" :size="16" /> 清空全部数据</button>
        </section>
      </div>
    </div>

    <!-- 更新日志弹窗（独立 60vh 滚动容器：版本块紧凑排列，滚轮连续长滚动） -->
    <Modal title="更新日志" :show="showLog" @close="showLog = false">
      <div class="log-scroll">
        <div v-for="(c, i) in CHANGELOG" :key="c.version" class="log-item">
          <div class="row between">
            <div class="row" style="gap:8px">
              <span style="font-weight:800">v{{ c.version }}</span>
              <span v-if="i === 0" class="chip" style="background:var(--eo-primary);color:#fff">当前版本</span>
            </div>
            <span class="muted" style="font-size:12px">{{ c.date }}</span>
          </div>
          <ul class="log-list">
            <li v-for="(it, j) in c.items" :key="j">{{ it }}</li>
          </ul>
        </div>
      </div>
    </Modal>

    <!-- 赞助开发者弹窗 -->
    <Modal title="赞助开发者" :show="showSponsor" @close="showSponsor = false">
      <div style="text-align:center">
        <span class="empty-illu" style="margin:0 auto 10px"><Icon name="coffee" :size="32" /></span>
        <img src="/icons/sponsor-qr.webp" alt="赞助二维码" class="sponsor-qr-lg" />
        <div style="font-weight:700;margin-top:10px">如果这个项目帮到了你，欢迎请开发者喝一杯</div>
      </div>
      <div class="section-title" style="margin-top:14px">已赞助的伙伴</div>
      <div class="row wrap" style="gap:6px;justify-content:center">
        <span v-for="s in SPONSORS" :key="s" class="chip" style="background:var(--eo-primary);color:#fff">{{ s }}</span>
      </div>
    </Modal>

    <!-- 待关注提醒弹窗（原通知中心内容） -->
    <Modal title="待关注提醒" :show="showNotif" @close="showNotif = false">
      <div v-for="n in reminders" :key="n.id" class="glass list-item" style="cursor:pointer" @click="goReminder(n.to)">
        <span class="avatar" :style="n.tone === 'bad' ? 'background:var(--eo-chip);color:var(--eo-ink)' : n.tone === 'good' ? 'background:rgba(126, 154, 126, .16);color:var(--eo-good)' : 'background:var(--eo-chip);color:var(--eo-primary-deep)'">
          <Icon :name="n.icon" :size="20" />
        </span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">{{ n.title }}</div>
          <div class="muted" style="font-size:12px">{{ n.sub }}</div>
        </div>
        <Icon name="chevron" :size="16" />
      </div>
      <div v-if="!reminders.length" class="muted" style="text-align:center;padding:30px">
        暂无高价值提醒。<br />任务临近截止、成就解锁或同步异常时会在这里出现。
      </div>
    </Modal>

    <!-- 编辑资料弹窗（含滚轮缩放头像裁剪） -->
    <Modal title="编辑资料" :show="showEdit" @close="showEdit = false">
      <div class="field">
        <label>头像（滚轮缩放 · 拖动定位）</label>
        <GlassUploader label="点击或拖拽选择头像图片" @file="onAvatarFile" />
        <AvatarCropper v-if="cropSrc" :src="cropSrc" @crop="onCrop" @cancel="cropSrc = ''" style="margin-top:10px" />
        <div v-else-if="form.avatarData" class="row" style="gap:10px;margin-top:10px">
          <img :src="form.avatarData" style="width:64px;height:64px;border-radius:16px;object-fit:cover" />
          <button class="btn ghost" @click="clearAvatar"><Icon name="trash" :size="16" /> 移除头像</button>
        </div>
      </div>
      <div class="field"><label>昵称</label><input v-model="form.name" /></div>
      <div class="field"><label>称号</label><input v-model="form.customTitle" placeholder="自定义称号" /></div>
      <div class="field"><label>签名</label><input v-model="form.signature" /></div>
      <div class="field"><label>性别</label>
        <select v-model="form.gender">
          <option value="">保密</option><option value="male">男</option><option value="female">女</option>
          <option value="沃尔玛购物袋" :style="showEgg ? '' : 'display:none'">沃尔玛购物袋</option>
        </select>
        <a class="muted" style="font-size:12px;cursor:pointer;margin-top:4px;display:inline-block" @click="showEgg = !showEgg">{{ showEgg ? '收起隐藏选项' : '· 隐藏选项？' }}</a>
      </div>
      <div class="field"><label>生日</label><input type="date" v-model="form.birthDate" /></div>
      <div class="field"><label>自定义字段</label>
        <div v-for="(cf, i) in form.customFields" :key="i" class="row" style="gap:6px;margin-bottom:6px">
          <input v-model="cf.key" placeholder="字段名" style="flex:1" />
          <input v-model="cf.value" placeholder="内容" style="flex:1" />
          <button class="ghost-btn" @click="form.customFields.splice(i, 1)"><Icon name="x" :size="16" /></button>
        </div>
        <button class="chip" style="flex:none" @click="form.customFields.push({ key: '', value: '' })"><Icon name="plus" :size="12" /> 添加字段</button>
      </div>
      <div class="field"><label>国家 / 省份</label>
        <div class="row" style="gap:8px"><input v-model="form.country" placeholder="国家" /><input v-model="form.province" placeholder="省份" /></div>
      </div>
      <button class="btn" style="width:100%" @click="saveProfile"><Icon name="checklist" :size="16" /> 保存</button>
    </Modal>
  </div>
</template>

<style scoped>
.wall-preview {
  position: relative; margin-top: 10px; height: 120px; border-radius: 16px;
  background-size: cover; background-position: center;
  border: 1px solid var(--eo-glass-border); box-shadow: inset 0 1px 0 var(--eo-glass-hi);
}
/* 更新日志：固定高度滚动容器 + 细窄滚动条，版本块紧凑排列不被拉伸 */
.log-scroll {
  max-height: 60vh; overflow-y: auto; overscroll-behavior: contain;
  padding: 2px 6px 2px 2px;
  scrollbar-width: thin; scrollbar-color: rgba(44, 44, 44, 0.45) transparent;
}
.log-scroll::-webkit-scrollbar { width: 5px; }
.log-scroll::-webkit-scrollbar-track { background: transparent; }
.log-scroll::-webkit-scrollbar-thumb { background: rgba(44, 44, 44, 0.4); border-radius: 999px; }
.log-scroll::-webkit-scrollbar-thumb:hover { background: rgba(44, 44, 44, 0.65); }
.log-item { flex: none; min-height: 0; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px dashed var(--eo-glass-border); }
.log-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 2px; }
.log-list { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.85; }
.sponsor-qr-lg { width: 168px; height: 168px; border-radius: 18px; object-fit: cover; background: #fff; box-shadow: var(--eo-shadow-soft); }

/* ===== 模块五（v2.1.0 终极重构）：单页垂直流 + 悬浮锚点导航 ===== */
/* 顶部预留悬浮锚点条高度（锚点条已 fixed 脱离文档流） */
.set-page { padding: 60px 14px 26px; }
.set-shell { display: flex; flex-direction: column; gap: 12px; }

/* 顶部锚点条：模块一 —— 改为悬浮胶囊（fixed），满血 Haze 磨砂，随页面滚动始终可见 */
.set-anchor {
  position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 50%; transform: translateX(-50%);
  z-index: 62; display: flex; gap: 4px; padding: 6px; border-radius: 999px;
  max-width: min(780px, calc(100vw - var(--eo-sidebar-w) - 120px));
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  /* 体验修复：禁止任何过渡，确保从挂载第一帧起就稳定居中，杜绝偏移/瞬移 */
  transition: none;
}
.set-anchor::-webkit-scrollbar { display: none; }
.set-anchor-item {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  padding: 9px 13px; border-radius: 12px; border: none; cursor: pointer;
  background: transparent; color: var(--eo-ink-soft);
  font-size: 13px; font-weight: 700; white-space: nowrap;
  transition: background .18s ease, color .18s ease, transform .18s ease;
}
.set-anchor-item:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.set-anchor-item.on { background: rgba(44, 44, 44, 0.1); color: var(--eo-ink); box-shadow: var(--eo-shadow-soft); }
.set-anchor-item.on:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }

/* 单页垂直流：所有分区从上到下依次排列 */
.set-main { min-width: 0; display: flex; flex-direction: column; }
/* 悬浮锚点条不再占用文档流 ⇒ 顶部留出安全区，目标区块 scroll-margin-top 防止标题被悬浮条遮住 */
.set-sec { scroll-margin-top: 82px; padding-bottom: 22px; }
.set-sec + .set-sec { border-top: 1px dashed var(--eo-glass-border); padding-top: 22px; }
.sec-head { margin: 2px 2px 12px; }
.sec-head h2 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: .3px; }
.sec-head p { margin: 3px 0 0; font-size: 12px; }
/* 「通用」模块内的子分组标题（资料 / 外观 / 桌面级交互） */
.sec-sub {
  display: flex; align-items: center; gap: 8px;
  margin: 18px 2px 10px; padding-top: 14px;
  border-top: 1px dashed var(--eo-glass-border);
}
.sec-sub:first-of-type { border-top: none; margin-top: 4px; padding-top: 0; }
.sec-sub__ico {
  width: 26px; height: 26px; border-radius: 9px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
.sec-sub b { font-size: 14.5px; font-weight: 800; color: var(--eo-ink); }
.sec-sub__d { font-size: 11.5px; color: var(--eo-ink-faint); }

/* 顶部悬浮条：搜索框居中在上、模块锚点在下（共用一套 Haze 语言） */
/* 右上角极简搜索：线性图标按钮 → 展开悬浮输入面板 */
.set-find-wrap { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); right: 22px; z-index: 64; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.set-find {
  width: 36px; height: 36px; border-radius: 999px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
  color: var(--eo-ink-soft); box-shadow: inset 0 1px 0 var(--eo-glass-hi), var(--eo-shadow-soft);
  backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%);
  transition: background .16s ease, color .16s ease, opacity .16s ease;
}
.set-find:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.set-find.on { background: rgba(44, 44, 44, 0.1); color: var(--eo-ink); border-color: rgba(44, 44, 44, 0.2); }
.set-find-pop { width: min(360px, calc(100vw - 32px)); border-radius: 18px; padding: 10px; overflow: hidden; }
.set-find-bar { padding: 7px 11px; border-radius: 12px; background: var(--eo-bg-2); box-shadow: none; }
.set-find-list { margin-top: 6px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.set-find-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 9px; border-radius: 10px; text-align: left;
  color: var(--eo-ink); transition: background .14s ease, opacity .14s ease;
}
.set-find-item:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.set-find-item__t { font-size: 13px; font-weight: 700; flex: none; }
.set-find-item__d { font-size: 11px; color: var(--eo-ink-faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.set-find-empty { padding: 12px; text-align: center; font-size: 12px; color: var(--eo-ink-faint); }
.panel-row { padding: 9px 0; border-bottom: 1px solid var(--eo-glass-border); }
.panel-row:last-of-type { border-bottom: none; }
.pn-ico {
  width: 30px; height: 30px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}

/* 统一开关（Haze 质感，替代此前的文字按钮） */
.switch {
  position: relative; width: 46px; height: 26px; flex: none; padding: 0;
  border-radius: 999px; border: 1px solid rgba(44, 44, 44, 0.22);
  background: rgba(44, 44, 44, 0.18); cursor: pointer;
  transition: background .2s ease, border-color .2s ease;
}
.switch i {
  position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 50%; background: #FFFFFF;
  box-shadow: 0 1px 3px rgba(44, 44, 44, 0.28);
  transition: left .2s cubic-bezier(.22,1,.36,1), background .2s ease;
}
.switch.on { background: var(--eo-primary); border-color: transparent; }
.switch.on i { left: 22px; background: #fff; }

/* ≥900px：经典后台两栏布局，左导航固定宽度吸顶 */
@media (min-width: 900px) {
  .set-page { padding: 66px 28px 44px; }
  .set-anchor { left: calc(var(--eo-sidebar-w) + (100vw - var(--eo-sidebar-w)) / 2); }
  /* 单页垂直流：桌面端内容居中限宽，顶栏（搜索 + 锚点）仍横排居中 */
  .set-main { max-width: 780px; margin: 0 auto; width: 100%; }
  .set-anchor-item { padding: 10px 16px; font-size: 14px; }
}

/* v2.1.0 终极封板：主题强调色选择 */
.accent-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.accent-dot {
  width: 30px; height: 30px; border-radius: 50%; cursor: pointer; flex: none;
  border: 2px solid rgba(255,255,255,.75); box-shadow: 0 2px 8px rgba(44, 44, 44, .18), inset 0 1px 0 rgba(255,255,255,.4);
  display: flex; align-items: center; justify-content: center; color: #fff;
  transition: transform .16s ease, box-shadow .16s ease;
}
.accent-dot:hover { transform: translateY(var(--eo-lift)); box-shadow: var(--eo-shadow-lift); }
.accent-dot.on { box-shadow: 0 0 0 2px var(--eo-primary), 0 3px 10px rgba(44, 44, 44, .22); transform: scale(1.06); }
.accent-custom {
  position: relative; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--eo-ink);
  background: var(--eo-glass-strong); border: 1px dashed var(--eo-glass-border);
}
.accent-custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

/* 3.0 本机存储健康度 */
.st-health { padding: 2px 0 4px; }
.st-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.st-cell { min-width: 0; padding: 8px 10px; border-radius: 12px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border); }
.st-k { font-size: 11px; opacity: .58; }
.st-v { font-size: 13px; font-weight: 700; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-n { font-size: 10px; font-weight: 500; opacity: .55; margin-left: 4px; }
.st-bar { height: 5px; border-radius: 99px; background: var(--eo-glass-border); overflow: hidden; margin: 10px 0 8px; }
.st-bar i { display: block; height: 100%; border-radius: 99px; background: var(--eo-primary); transition: width .3s ease; }
.st-bar i.warn { background: #C4553B; }
.st-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.st-tag { font-size: 11px; padding: 3px 8px; border-radius: 99px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border); }
.st-tag.bad { color: #C4553B; border-color: rgba(196, 85, 59, .35); }
.st-tag.good { color: #2F6F6B; border-color: rgba(47, 111, 107, .35); }

/* v2.1.0 终极封板：本地时光机 */
.tm-list { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.tm-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 12px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
}

/* ===== v2.1.0 竖屏适配：锚点条变横滑 Tab + 内容单列 100% 满宽 ===== */
@media (orientation: portrait) and (max-width: 899px) {
  /* 顶部为搜索 + 横滑 Tab 让出安全区 + 底部避开悬浮导航 */
  .set-page { padding: 60px 12px calc(env(safe-area-inset-bottom, 0px) + 100px); }
  /* 顶栏：搜索居中在上，锚点条横向滑动（贴顶常驻、隐藏滚动条） */
  .set-topbar { top: calc(env(safe-area-inset-top, 0px) + 8px); width: calc(100vw - 18px); }
  .set-anchor { max-width: 100%; padding: 5px; gap: 2px; }
  .set-anchor-item { padding: 8px 11px; font-size: 12px; gap: 4px; border-radius: 10px; }
  /* 内容：单列、100% 宽度，不再受桌面限宽影响 */
  .set-shell, .set-main { width: 100%; max-width: 100%; }
  .set-sec { scroll-margin-top: 66px; padding-bottom: 18px; }
  .set-sec + .set-sec { padding-top: 18px; }
  .sec-head h2 { font-size: 18px; }
}
</style>
