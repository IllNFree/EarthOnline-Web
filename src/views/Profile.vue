<script setup>
// 个人主页：个人博客式布局（Hero + 分段 Tab + 文章流 + 资料侧栏）
// 数据来自 store：profile / blog（posts + links）/ collections / activities / achievements
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useDialogStore } from '../stores/dialog.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { parseTagsInput } from '../lib/model.js'
import { fetchLinkCover, coverFallback } from '../lib/cover.js'
import Icon from '../components/Icon.vue'
import GlassUploader from '../components/GlassUploader.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import BearEgg from '../components/BearEgg.vue'
import Modal from '../components/GlassBottomSheet.vue'
import MarkdownView from '../components/MarkdownView.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useAppStore()
const dialog = useDialogStore()
const router = useRouter()

const profile = computed(() => store.data.profile || {})
const displayName = computed(() => profile.value.name || '旅行者')
const initial = computed(() => (displayName.value || '旅').slice(0, 1))
const signature = computed(() => profile.value.signature || '这个人很神秘，还没有写下简介。')

// 头像：支持 dataURL；加载失败时回落到昵称首字
const avatarBroken = ref(false)
watch(() => profile.value.avatarData, () => { avatarBroken.value = false })
const avatarSrc = computed(() => (profile.value.avatarData && !avatarBroken.value ? profile.value.avatarData : ''))

const joinedText = computed(() => {
  const v = String(profile.value.joinedAt || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '.') : ''
})
const joinedLabel = computed(() => (joinedText.value ? joinedText.value + ' 加入' : '加入日期未知'))

// ---- 博客数据 ----
const blogPosts = computed(() => ((store.data.blog && store.data.blog.posts) || []).filter((p) => p && !p.deletedAt))
const blogLinks = computed(() => ((store.data.blog && store.data.blog.links) || []).filter((l) => l && !l.deletedAt))
const postsSorted = computed(() => blogPosts.value.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))))
const linksSorted = computed(() => blogLinks.value.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))))
const publishedCount = computed(() => blogPosts.value.filter((p) => p.status === 'published').length)

const stats = computed(() => [
  { key: 'posts', label: '文章', icon: 'note', value: publishedCount.value },
  { key: 'collections', label: '收藏', icon: 'star', value: store.live.collections.length },
  { key: 'locations', label: '足迹', icon: 'map-pin', value: store.live.locations.length },
  { key: 'memos', label: '笔记', icon: 'book', value: store.live.memos.length },
  { key: 'achievements', label: '成就解锁', icon: 'trophy', value: (store.data.achievements || []).length }
])

const collectionsTab = computed(() => store.live.collections.slice(0, 40))

// 动态按日期倒序（同一天保留原有顺序），最多 10 条
const activities = computed(() => {
  const list = (store.data.activities || []).slice()
  list.sort((a, b) => String(b && b.time || '').localeCompare(String(a && a.time || '')))
  return list.slice(0, 10)
})

const total = ACHIEVEMENTS.length
const unlockedCount = computed(() => (store.data.achievements || []).length)
const unlockedMap = computed(() => {
  const map = {}
  ;(store.data.achievements || []).forEach((a) => { if (a && a.key) map[a.key] = a.unlockedAt || '' })
  return map
})
const badgeList = computed(() => ACHIEVEMENTS.map((a) => {
  const unlocked = !!unlockedMap.value[a.key]
  return {
    ...a,
    unlocked,
    unlockedAt: unlockedMap.value[a.key] || '',
    // 隐藏成就未解锁时同样遮蔽标题与条件，避免在博客徽章墙泄露彩蛋
    title: unlocked || !a.secret ? a.title : '???',
    desc: unlocked || !a.secret ? a.desc : '达成方式未知'
  }
}))
// 成就精选 6 枚：优先已解锁（按解锁时间倒序），不足补未解锁
const featuredBadges = computed(() => {
  const on = badgeList.value.filter((b) => b.unlocked).sort((a, b) => String(b.unlockedAt || '').localeCompare(String(a.unlockedAt || '')))
  const off = badgeList.value.filter((b) => !b.unlocked)
  return on.concat(off).slice(0, 6)
})

// ---- Tab / 筛选 ----
const TABS = [
  { key: 'posts', label: '文章', icon: 'note' },
  { key: 'collections', label: '收藏', icon: 'star' },
  { key: 'timeline', label: '动态', icon: 'spark' },
  { key: 'achievements', label: '成就', icon: 'trophy' }
]
const tab = ref('posts')
const tabCounts = computed(() => ({
  posts: blogPosts.value.length,
  collections: store.live.collections.length,
  timeline: activities.value.length,
  achievements: unlockedCount.value
}))

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'posts', label: '文章' },
  { key: 'share', label: '分享' },
  { key: 'draft', label: '草稿' }
]
const feedFilter = ref('all')
const activeTag = ref('')
const activeMonth = ref('')

function monthKeyOf(p) { return String(p.createdAt || '').slice(0, 7) }

const filteredPosts = computed(() => {
  let list = postsSorted.value
  if (feedFilter.value === 'posts') list = list.filter((p) => p.status === 'published')
  else if (feedFilter.value === 'draft') list = list.filter((p) => p.status === 'draft')
  if (activeTag.value) list = list.filter((p) => (p.tags || []).includes(activeTag.value))
  if (activeMonth.value) list = list.filter((p) => monthKeyOf(p) === activeMonth.value)
  return list
})
// 置顶精选：仅「全部 / 文章」且未叠加标签 / 归档筛选时出现
const featured = computed(() => {
  if (feedFilter.value !== 'all' && feedFilter.value !== 'posts') return null
  if (activeTag.value || activeMonth.value) return null
  return filteredPosts.value.find((p) => p.pinned && p.status === 'published') || null
})
const feedPosts = computed(() => filteredPosts.value.filter((p) => (featured.value ? p.id !== featured.value.id : true)))

const showPostSection = computed(() => feedFilter.value !== 'share')
const showShareSection = computed(() => feedFilter.value === 'all' || feedFilter.value === 'share')

// 收藏分享：收藏中包含外链的条目，按时间倒序，最多 10 条
const collectionShares = computed(() => store.live.collections
  .filter((c) => safeUrl(c.url))
  .slice()
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  .slice(0, 10))

const tagCloud = computed(() => {
  const m = new Map()
  blogPosts.value.forEach((p) => (p.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)))
  return Array.from(m, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 18)
})
const archives = computed(() => {
  const m = new Map()
  blogPosts.value.forEach((p) => {
    const k = monthKeyOf(p)
    if (!k) return
    m.set(k, (m.get(k) || 0) + 1)
  })
  return Array.from(m, ([key, count]) => ({
    key,
    label: key.slice(0, 4) + ' 年 ' + key.slice(5, 7) + ' 月',
    count
  })).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12)
})
const emptyFeed = computed(() => (blogPosts.value.length
  ? { title: '没有匹配的内容', subtitle: '换一个筛选条件，或清除标签 / 归档筛选试试。' }
  : { title: '还没有文章', subtitle: '写下第一篇博客，或从笔记导入、分享一条外链。' }))

function toggleTag(name) {
  activeTag.value = activeTag.value === name ? '' : name
  if (activeTag.value) feedFilter.value = 'all'
  tab.value = 'posts'
}
function toggleMonth(key) {
  activeMonth.value = activeMonth.value === key ? '' : key
  if (activeMonth.value) feedFilter.value = 'all'
  tab.value = 'posts'
}
function clearFilters() {
  activeTag.value = ''
  activeMonth.value = ''
}

// ---- 链接与封面安全 ----
function normalizeUrl(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s
}
// 只接受 http(s)，避免把 javascript: 之类的地址渲染成可点击链接
function safeUrl(v) {
  const s = normalizeUrl(v)
  if (!s) return ''
  try {
    const u = new URL(s)
    return /^https?:$/.test(u.protocol) ? u.href : ''
  } catch (e) {
    return ''
  }
}
function imageSrc(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  if (/^data:image\//i.test(s)) return s
  try {
    const u = new URL(s, 'https://earth.online')
    return /^https?:$/.test(u.protocol) ? s : ''
  } catch (e) {
    return ''
  }
}
function cssUrl(v) { return 'url("' + v.replace(/["\\]/g, '') + '")' }
function coverStyle(o) {
  const s = imageSrc(o && o.cover)
  return s ? { backgroundImage: cssUrl(s) } : {}
}
function linkCoverStyle(l) {
  const s = imageSrc(l && l.cover)
  if (s) return { backgroundImage: cssUrl(s) }
  return { background: coverFallback(l && l.url).gradient }
}
function collectionCoverStyle(c) {
  const s = imageSrc(c && c.cover)
  if (s) return { backgroundImage: cssUrl(s) }
  return { background: coverFallback(c && c.url).gradient }
}
function domainOf(v) {
  try { return new URL(normalizeUrl(v)).hostname.replace(/^www\./, '') } catch (e) { return '' }
}
function firstLetter(title) {
  const s = String(title || '').trim()
  return s ? s.slice(0, 1) : '文'
}
// 无链接的收藏也给出首字占位（coverFallback 对空 URL 只会给「·」）
function urlInitial(url, title) {
  return url ? coverFallback(url).initial : firstLetter(title)
}
function openStat(key) {
  if (key === 'collections') tab.value = 'collections'
  else if (key === 'achievements') tab.value = 'achievements'
}
function fmtDate(v) {
  const s = String(v || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '.') : s
}
function plainText(v) {
  return String(v || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
function summaryOf(p) {
  return p.summary || plainText(p.body).slice(0, 120) || '暂无摘要'
}
function looksHtml(v) {
  return /<\/?[a-z][^>]*>/i.test(String(v || ''))
}
function openExternal(url) {
  const u = safeUrl(url)
  if (!u) return store.showToast('链接地址无效')
  window.open(u, '_blank', 'noopener,noreferrer')
}
function goCollections() { router.push('/backpack?sub=collection') }
function goNotes() { router.push('/notes') }

// ---- 社交链接（仅展示已填写的外链） ----
const SOCIALS = [
  { key: 'qq', label: 'QQ', icon: 'globe', placeholder: 'QQ 号或 QQ 空间链接' },
  { key: 'wechat', label: '微信', icon: 'globe', placeholder: '微信号或公众号' },
  { key: 'bilibili', label: '哔哩哔哩', icon: 'play', placeholder: 'https://space.bilibili.com/…' },
  { key: 'xiaohongshu', label: '小红书', icon: 'globe', placeholder: '小红书主页链接' },
  { key: 'zhihu', label: '知乎', icon: 'globe', placeholder: 'https://www.zhihu.com/people/…' },
  { key: 'tieba', label: '贴吧', icon: 'globe', placeholder: '百度贴吧主页' },
  { key: 'xiaoheihe', label: '小黑盒', icon: 'globe', placeholder: '小黑盒主页链接' },
  { key: 'coolapk', label: '酷安', icon: 'globe', placeholder: '酷安主页链接' },
  { key: 'github', label: 'GitHub', icon: 'branch', placeholder: 'https://github.com/yourname' },
  { key: 'steam', label: 'Steam', icon: 'steam', placeholder: 'https://steamcommunity.com/id/…' },
  { key: 'weibo', label: '微博', icon: 'globe', placeholder: 'https://weibo.com/u/…' },
  { key: 'x', label: 'X', icon: 'globe', placeholder: 'https://x.com/yourname' }
]
const socialRows = computed(() => {
  const links = profile.value.links || {}
  return SOCIALS.map((s) => ({ ...s, href: safeUrl(links[s.key]) }))
})
const boundSocials = computed(() => socialRows.value.filter((s) => s.href))

// ---- 写文章 ----
const showEditor = ref(false)
const editForm = ref({ id: '', title: '', summary: '', cover: '', tags: '', body: '', status: 'draft', pinned: false, source: 'self', noteId: '' })
function resetForm(seed) {
  editForm.value = Object.assign({
    id: '', title: '', summary: '', cover: '', tags: '', body: '',
    status: 'draft', pinned: false, source: 'self', noteId: ''
  }, seed || {})
}
function openNewPost() {
  resetForm({})
  showEditor.value = true
}
function openEditPost(p) {
  resetForm({
    id: p.id,
    title: p.title || '',
    summary: p.summary || '',
    cover: p.cover || '',
    tags: (p.tags || []).join(', '),
    body: p.body || '',
    status: p.status === 'published' ? 'published' : 'draft',
    pinned: !!p.pinned,
    source: p.source === 'note' ? 'note' : 'self',
    noteId: p.noteId || ''
  })
  showEditor.value = true
}
function savePost() {
  const title = editForm.value.title.trim()
  if (!title) return store.showToast('请填写文章标题')
  const body = editForm.value.body || ''
  const payload = {
    title,
    summary: editForm.value.summary.trim() || plainText(body).slice(0, 120),
    cover: imageSrc(editForm.value.cover),
    tags: parseTagsInput(editForm.value.tags),
    body,
    status: editForm.value.status === 'published' ? 'published' : 'draft',
    pinned: !!editForm.value.pinned,
    source: editForm.value.source === 'note' ? 'note' : 'self',
    noteId: editForm.value.noteId || null
  }
  if (editForm.value.id) {
    store.updateBlogPost(editForm.value.id, payload)
    store.showToast('文章已保存')
  } else {
    const r = store.addBlogPost(payload)
    if (!r || !r.ok) return store.showToast((r && r.error) || '保存失败')
    store.showToast(payload.status === 'published' ? '文章已发布' : '草稿已保存')
  }
  showEditor.value = false
}
async function removePost(p) {
  const ok = await dialog.confirm({
    title: '删除文章',
    message: '「' + (p.title || '未命名文章') + '」将从个人主页移除。',
    danger: true,
    confirmText: '删除'
  })
  if (!ok) return
  store.deleteBlogPost(p.id)
  showEditor.value = false
  showRead.value = false
  store.showToast('文章已删除')
}

// ---- 从笔记导入 ----
const showImport = ref(false)
const noteList = computed(() => store.live.memos.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))))
function openImport() { showImport.value = true }
function importNote(m) {
  resetForm({
    title: m.title || '无标题笔记',
    summary: plainText(m.markdown).slice(0, 120),
    body: m.markdown || '',
    tags: (m.tags || []).join(', '),
    status: 'draft',
    source: 'note',
    noteId: m.id
  })
  showImport.value = false
  showEditor.value = true
}

// ---- 阅读 ----
const showRead = ref(false)
const reading = ref(null)
function openRead(p) {
  reading.value = p
  showRead.value = true
}
function editFromRead() {
  showRead.value = false
  if (reading.value) openEditPost(reading.value)
}

// ---- 分享链接 ----
const showLinkBox = ref(false)
const linkForm = ref({ id: '', title: '', url: '', cover: '', note: '' })
const linkBusy = ref(false)
function openNewLink() {
  linkForm.value = { id: '', title: '', url: '', cover: '', note: '' }
  showLinkBox.value = true
}
function openEditLink(l) {
  linkForm.value = { id: l.id, title: l.title || '', url: l.url || '', cover: l.cover || '', note: l.note || '' }
  showLinkBox.value = true
}
// 自动取封面：失败静默回退（渲染层用域名首字渐变占位），绝不打断保存
async function autoCover() {
  const url = safeUrl(linkForm.value.url)
  if (!url || linkForm.value.cover) return
  linkBusy.value = true
  let image = null
  try { image = await fetchLinkCover(url) } catch (e) { image = null }
  linkBusy.value = false
  if (image && !linkForm.value.cover) linkForm.value.cover = image
}
function saveLink() {
  const url = safeUrl(linkForm.value.url)
  if (!url) return store.showToast('请填写合法的 http(s) 链接')
  const payload = {
    title: linkForm.value.title.trim() || domainOf(url) || url,
    url,
    cover: imageSrc(linkForm.value.cover),
    note: linkForm.value.note.trim()
  }
  if (linkForm.value.id) {
    store.updateBlogLink(linkForm.value.id, payload)
    store.showToast('链接已更新')
  } else {
    const r = store.addBlogLink(payload)
    if (!r || !r.ok) return store.showToast((r && r.error) || '保存失败')
    store.showToast('链接已添加')
  }
  showLinkBox.value = false
}
async function removeLink(l) {
  const ok = await dialog.confirm({
    title: '删除链接',
    message: '「' + (l.title || domainOf(l.url) || '该链接') + '」将从分享列表中移除。',
    danger: true,
    confirmText: '删除'
  })
  if (!ok) return
  store.deleteBlogLink(l.id)
  showLinkBox.value = false
  store.showToast('链接已删除')
}

// 「关于我」面板：展示称号之外的资料项（性别 / 地区 / 自定义字段）
const GENDER_LABEL = { male: '男', female: '女', 沃尔玛购物袋: '沃尔玛购物袋' }
const aboutMeta = computed(() => {
  const p = profile.value
  const out = []
  if (p.gender) out.push({ label: '性别', value: GENDER_LABEL[p.gender] || p.gender })
  if (p.country || p.province) out.push({ label: '地区', value: [p.country, p.province].filter(Boolean).join(' · ') })
  ;(p.customFields || []).forEach((f) => { if (f && f.key) out.push({ label: f.key, value: f.value || '' }) })
  return out
})

// ---- 编辑资料 ----
const showEdit = ref(false)
const form = ref({
  name: '', signature: '', customTitle: '', gender: '', birthDate: '',
  country: '', province: '', avatarData: '', customFields: [], links: {}
})
const formInitial = computed(() => (form.value.name || displayName.value || '旅').slice(0, 1))
// 头像裁剪：滚轮缩放 + 拖动定位（与设置页同一套交互）
const cropSrc = ref('')
// 性别里的隐藏彩蛋「沃尔玛购物袋」：需要通过「隐藏选项」入口才展示
const showEgg = ref(false)

function openEdit() {
  const p = profile.value
  form.value = {
    name: p.name || '',
    signature: p.signature || '',
    customTitle: p.customTitle || '',
    gender: p.gender || '',
    birthDate: String(store.data.birthDate || '').slice(0, 10),
    country: p.country || '',
    province: p.province || '',
    avatarData: p.avatarData || '',
    customFields: (p.customFields || []).map((x) => ({ key: x.key || '', value: x.value || '' })),
    links: Object.assign({ github: '', bilibili: '', steam: '', weibo: '', x: '' }, p.links || {})
  }
  showEgg.value = p.gender === '沃尔玛购物袋'
  cropSrc.value = ''
  showEdit.value = true
}
function closeEdit() {
  showEdit.value = false
  cropSrc.value = ''
}

// 选择图片后进入裁剪器（不再强制居中裁方，由用户拖动 / 缩放决定构图）
function onAvatarFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    store.showToast('请选择图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => { cropSrc.value = String(reader.result || '') }
  reader.onerror = () => store.showToast('图片读取失败')
  reader.readAsDataURL(file)
}
function onCrop(dataUrl) {
  form.value.avatarData = dataUrl
  cropSrc.value = ''
}
function clearAvatar() {
  form.value.avatarData = ''
  cropSrc.value = ''
}
function addCustomField() {
  form.value.customFields.push({ key: '', value: '' })
}
function removeCustomField(i) {
  form.value.customFields.splice(i, 1)
}

function normalizeLink(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s
}
function saveEdit() {
  const links = {}
  SOCIALS.forEach((s) => {
    const v = normalizeLink(form.value.links[s.key])
    if (v) links[s.key] = v.slice(0, 600)
  })
  store.setProfile({
    name: String(form.value.name || '').trim().slice(0, 24),
    signature: String(form.value.signature || '').trim().slice(0, 120),
    customTitle: String(form.value.customTitle || '').trim().slice(0, 24),
    gender: form.value.gender || '',
    country: String(form.value.country || '').trim().slice(0, 40),
    province: String(form.value.province || '').trim().slice(0, 40),
    avatarData: form.value.avatarData || '',
    customFields: form.value.customFields
      .filter((c) => c && c.key && c.key.trim())
      .map((c) => ({ key: c.key.trim().slice(0, 24), value: String(c.value || '').trim().slice(0, 60) })),
    links
  })
  store.setBirthDate(String(form.value.birthDate || '').slice(0, 10))
  showEdit.value = false
  cropSrc.value = ''
  store.showToast('资料已保存')
}
</script>

<template>
  <div class="page profile-page">
    <!-- 顶部 Hero：横幅 + 头像 + 资料 + 统计 + 社交外链 -->
    <header class="pf-hero glass">
      <div class="pf-banner" aria-hidden="true"></div>
      <div class="pf-hero-body">
        <div class="pf-avatar-slot">
          <div class="pf-avatar">
            <img v-if="avatarSrc" :src="avatarSrc" alt="头像" @error="avatarBroken = true" />
            <span v-else class="pf-avatar-letter">{{ initial }}</span>
          </div>
          <BearEgg />
        </div>
        <div class="pf-hero-meta">
          <h1 class="pf-name">{{ displayName }}<span v-if="profile.customTitle" class="pf-title">{{ profile.customTitle }}</span></h1>
          <p class="pf-sign">{{ signature }}</p>
          <div class="pf-chips">
            <span class="pf-chip"><Icon name="calendar" :size="13" /> {{ joinedLabel }}</span>
            <span class="pf-chip"><Icon name="trophy" :size="13" /> 成就 {{ unlockedCount }} / {{ total }}</span>
          </div>
          <div v-if="boundSocials.length" class="pf-hero-socials">
            <a
              v-for="s in boundSocials"
              :key="s.key"
              class="pf-social-icon"
              :href="s.href"
              target="_blank"
              rel="noopener noreferrer"
              :title="s.label"
            >
              <Icon :name="s.icon" :size="16" />
            </a>
          </div>
        </div>
        <div class="pf-hero-actions">
          <button class="btn" @click="openEdit">
            <Icon name="edit" :size="16" /> 编辑资料
          </button>
        </div>
      </div>
      <div class="pf-stats" aria-label="个人统计">
        <button
          v-for="s in stats"
          :key="s.key"
          type="button"
          class="pf-stat"
          :class="{ 'is-link': s.key === 'collections' || s.key === 'achievements' }"
          @click="openStat(s.key)"
        >
          <span class="pf-stat-icon"><Icon :name="s.icon" :size="16" /></span>
          <span class="pf-stat-num">{{ Number(s.value) || 0 }}</span>
          <span class="pf-stat-label">{{ s.label }}</span>
        </button>
      </div>
    </header>

    <!-- Tab 栏 + 文章工具栏 -->
    <div class="pf-tabbar glass">
      <div class="pf-tabs" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          :class="{ 'is-on': tab === t.key }"
          @click="tab = t.key"
        >
          <Icon :name="t.icon" :size="15" />
          {{ t.label }}
          <span class="pf-tab-count">{{ tabCounts[t.key] }}</span>
        </button>
      </div>
      <div v-if="tab === 'posts'" class="pf-tabbar-actions">
        <button class="chip" type="button" @click="openImport"><Icon name="note" :size="14" /> 从笔记导入</button>
        <button class="chip" type="button" @click="openNewLink"><Icon name="link" :size="14" /> 分享链接</button>
        <button class="btn" type="button" @click="openNewPost"><Icon name="plus" :size="16" /> 写文章</button>
      </div>
    </div>

    <!-- 文章 Tab：左文章流 + 右资料栏 -->
    <div v-if="tab === 'posts'" class="pf-grid">
      <main class="pf-main">
        <div class="pf-filters">
          <button
            v-for="f in FILTERS"
            :key="f.key"
            type="button"
            class="chip"
            :class="{ 'is-on': feedFilter === f.key }"
            @click="feedFilter = f.key"
          >
            {{ f.label }}
          </button>
          <button v-if="activeTag || activeMonth" type="button" class="pf-filter-reset" @click="clearFilters">
            <Icon name="x" :size="12" /> 清除筛选
          </button>
        </div>

        <template v-if="showPostSection">
          <!-- 置顶精选 -->
          <article v-if="featured" class="pf-feature glass" @click="openRead(featured)">
            <div class="pf-feature-cover" :class="{ 'is-placeholder': !imageSrc(featured.cover) }" :style="coverStyle(featured)">
              <span v-if="!imageSrc(featured.cover)" class="pf-cover-letter">{{ firstLetter(featured.title) }}</span>
              <span class="pf-pin-badge"><Icon name="star" :size="12" /> 置顶精选</span>
            </div>
            <div class="pf-feature-body">
              <div class="pf-meta-line">
                <span>{{ fmtDate(featured.createdAt) }}</span>
                <span v-if="featured.status === 'draft'" class="pf-status is-draft">草稿</span>
              </div>
              <h2 class="pf-feature-title">{{ featured.title }}</h2>
              <p class="pf-feature-summary">{{ summaryOf(featured) }}</p>
              <div v-if="(featured.tags || []).length" class="pf-tags">
                <span v-for="t in featured.tags.slice(0, 5)" :key="t" class="pf-tag">#{{ t }}</span>
              </div>
            </div>
          </article>

          <!-- 文章卡列表 -->
          <div v-if="feedPosts.length" class="pf-posts">
            <article v-for="p in feedPosts" :key="p.id" class="pf-post glass" @click="openRead(p)">
              <span class="pf-post-cover" :class="{ 'is-placeholder': !imageSrc(p.cover) }" :style="coverStyle(p)">
                <span v-if="!imageSrc(p.cover)" class="pf-cover-letter">{{ firstLetter(p.title) }}</span>
              </span>
              <div class="pf-post-body">
                <div class="pf-meta-line">
                  <span>{{ fmtDate(p.createdAt) }}</span>
                  <span v-if="p.status === 'draft'" class="pf-status is-draft">草稿</span>
                  <span v-if="p.pinned" class="pf-status is-pin"><Icon name="star" :size="11" /> 置顶</span>
                  <span v-if="p.source === 'note'" class="pf-status">来自笔记</span>
                </div>
                <h3 class="pf-post-title">{{ p.title }}</h3>
                <p class="pf-post-summary">{{ summaryOf(p) }}</p>
                <div v-if="(p.tags || []).length" class="pf-tags">
                  <span v-for="t in p.tags.slice(0, 4)" :key="t" class="pf-tag">#{{ t }}</span>
                </div>
              </div>
              <button class="pf-icon-btn" type="button" title="编辑文章" @click.stop="openEditPost(p)">
                <Icon name="edit" :size="15" />
              </button>
            </article>
          </div>

          <EmptyState v-else-if="!featured" icon="note" :title="emptyFeed.title" :subtitle="emptyFeed.subtitle">
            <button class="btn" @click="openNewPost"><Icon name="plus" :size="16" /> 写第一篇文章</button>
            <button class="btn ghost" @click="openImport"><Icon name="note" :size="16" /> 从笔记导入</button>
            <button v-if="!blogLinks.length" class="btn ghost" @click="openNewLink"><Icon name="link" :size="16" /> 添加分享链接</button>
          </EmptyState>
        </template>

        <!-- 分享链接（外链聚合） -->
        <section v-if="showShareSection" class="pf-share-section">
          <div class="pf-section-head">
            <div class="pf-section-title"><Icon name="link" :size="15" /> 分享链接 <span class="pf-count">{{ linksSorted.length }}</span></div>
            <button class="pf-link-btn" type="button" @click="openNewLink"><Icon name="plus" :size="13" /> 添加</button>
          </div>
          <div v-if="linksSorted.length" class="pf-link-grid">
            <article
              v-for="l in linksSorted"
              :key="l.id"
              class="pf-link-card glass"
              role="link"
              tabindex="0"
              :title="l.note || l.title || domainOf(l.url)"
              @click="openExternal(l.url)"
              @keydown.enter="openExternal(l.url)"
            >
              <span class="pf-link-cover" :style="linkCoverStyle(l)">
                <span v-if="!imageSrc(l.cover)" class="pf-cover-letter">{{ coverFallback(l.url).initial }}</span>
              </span>
              <div class="pf-link-body">
                <div class="pf-link-title">{{ l.title || domainOf(l.url) }}</div>
                <div class="pf-link-host">{{ domainOf(l.url) }}</div>
              </div>
              <div class="pf-link-tools">
                <button type="button" title="编辑链接" @click.stop="openEditLink(l)"><Icon name="edit" :size="13" /></button>
                <button type="button" title="删除链接" @click.stop="removeLink(l)"><Icon name="trash" :size="13" /></button>
              </div>
            </article>
          </div>
          <div v-else class="pf-share-empty">
            <p>还没有分享链接，把常逛的站点挂上来吧。</p>
            <button class="btn ghost" type="button" @click="openNewLink"><Icon name="plus" :size="14" /> 添加第一条链接</button>
          </div>
        </section>

        <!-- 收藏分享流（与「收藏」Tab 的收藏墙区分） -->
        <section v-if="showShareSection" class="pf-share-section">
          <div class="pf-section-head">
            <div class="pf-section-title"><Icon name="star" :size="15" /> 收藏分享 <span class="pf-count">最近 {{ collectionShares.length }} 条</span></div>
            <button class="pf-link-btn" type="button" @click="goCollections">全部收藏 <Icon name="chevron-right" :size="13" /></button>
          </div>
          <div v-if="collectionShares.length" class="pf-share-list">
            <a
              v-for="c in collectionShares"
              :key="c.id"
              class="pf-share-card glass"
              :href="safeUrl(c.url)"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="pf-share-cover" :style="collectionCoverStyle(c)">
                <span v-if="!imageSrc(c.cover)" class="pf-cover-letter">{{ urlInitial(c.url, c.title) }}</span>
              </span>
              <div class="pf-share-body">
                <div class="pf-share-title">{{ c.title || domainOf(c.url) }}</div>
                <div class="pf-share-host">{{ domainOf(c.url) }}</div>
                <div v-if="(c.tags || []).length" class="pf-tags">
                  <span v-for="t in c.tags.slice(0, 3)" :key="t" class="pf-tag">#{{ t }}</span>
                </div>
              </div>
              <Icon class="pf-share-arrow" name="external" :size="14" />
            </a>
          </div>
          <p v-else class="pf-empty">
            背包里带上链接的收藏会自动出现在这里。
            <button class="pf-inline-btn" type="button" @click="goCollections">去收藏 →</button>
          </p>
        </section>
      </main>

      <!-- 右侧资料栏 -->
      <aside class="pf-side">
        <section class="pf-panel glass">
          <div class="pf-panel-head">
            <h2>关于我</h2>
          </div>
          <div class="pf-about">
            <span class="pf-about-avatar">
              <img v-if="avatarSrc" :src="avatarSrc" alt="头像" @error="avatarBroken = true" />
              <span v-else>{{ initial }}</span>
            </span>
            <div class="pf-about-name">
              <strong>{{ displayName }}</strong>
              <span>{{ joinedLabel }}</span>
            </div>
          </div>
          <p class="pf-about-sign">{{ signature }}</p>
          <div v-if="aboutMeta.length" class="pf-about-meta">
            <span v-for="m in aboutMeta" :key="m.label"><b>{{ m.label }}</b>{{ m.value }}</span>
          </div>
          <div class="pf-about-stats">
            <div><strong>{{ publishedCount }}</strong><span>文章</span></div>
            <div><strong>{{ store.live.collections.length }}</strong><span>收藏</span></div>
            <div><strong>{{ store.live.locations.length }}</strong><span>足迹</span></div>
          </div>
          <div v-if="boundSocials.length" class="pf-about-socials">
            <a
              v-for="s in boundSocials"
              :key="s.key"
              :href="s.href"
              target="_blank"
              rel="noopener noreferrer"
              :title="s.label"
            >
              <Icon :name="s.icon" :size="14" /><span>{{ s.label }}</span>
            </a>
          </div>
        </section>

        <section class="pf-panel glass">
          <div class="pf-panel-head">
            <h2>标签云</h2>
            <span class="pf-count">{{ tagCloud.length }} 个</span>
          </div>
          <div v-if="tagCloud.length" class="pf-tagcloud">
            <button
              v-for="t in tagCloud"
              :key="t.name"
              type="button"
              class="pf-tagcloud-item"
              :class="{ 'is-on': activeTag === t.name }"
              :style="{ fontSize: (11.5 + Math.min(3.5, t.count)) + 'px' }"
              @click="toggleTag(t.name)"
            >
              #{{ t.name }} <span>{{ t.count }}</span>
            </button>
          </div>
          <p v-else class="pf-empty">给文章加上标签，这里会自动聚合成标签云。</p>
        </section>

        <section class="pf-panel glass">
          <div class="pf-panel-head">
            <h2>归档</h2>
            <span class="pf-count">{{ archives.length }} 个月</span>
          </div>
          <div v-if="archives.length" class="pf-archive">
            <button
              v-for="a in archives"
              :key="a.key"
              type="button"
              class="pf-archive-row"
              :class="{ 'is-on': activeMonth === a.key }"
              @click="toggleMonth(a.key)"
            >
              <span>{{ a.label }}</span>
              <span class="pf-count">{{ a.count }}</span>
            </button>
          </div>
          <p v-else class="pf-empty">发布文章后，这里会按年月归档。</p>
        </section>

        <section class="pf-panel glass">
          <div class="pf-panel-head">
            <h2>成就精选</h2>
            <button class="pf-link-btn" type="button" @click="tab = 'achievements'">
              {{ unlockedCount }} / {{ total }}
            </button>
          </div>
          <div class="pf-badges">
            <span
              v-for="a in featuredBadges"
              :key="a.key"
              class="pf-badge"
              :class="{ 'is-off': !a.unlocked }"
              :title="a.unlocked ? a.title + ' · 已解锁' : a.title + ' · 未解锁'"
            >
              <span class="pf-badge-icon"><Icon :name="a.icon || 'trophy'" :size="16" /></span>
              <span class="pf-badge-name">{{ a.title }}</span>
            </span>
          </div>
        </section>
      </aside>
    </div>

    <!-- 收藏 Tab：收藏墙 -->
    <div v-else-if="tab === 'collections'" class="pf-panel glass">
      <div class="pf-panel-head">
        <h2>收藏墙</h2>
        <button class="pf-link-btn" type="button" @click="goCollections">
          全部收藏 <Icon name="chevron-right" :size="14" />
        </button>
      </div>
      <div v-if="store.live.collections.length" class="pf-wall pf-wall-lg">
        <button v-for="c in collectionsTab" :key="c.id" class="pf-wall-cell" type="button" @click="goCollections">
          <span class="pf-wall-cover" :style="collectionCoverStyle(c)">
            <span v-if="!imageSrc(c.cover)" class="pf-wall-letter">{{ urlInitial(c.url, c.title) }}</span>
          </span>
          <span class="pf-wall-title">{{ c.title || domainOf(c.url) || '未命名收藏' }}</span>
        </button>
      </div>
      <EmptyState v-else icon="star" title="还没有收藏" subtitle="链接、文件或灵感，都先收在这里。">
        <button class="btn" @click="goCollections"><Icon name="plus" :size="16" /> 去添加收藏</button>
      </EmptyState>
    </div>

    <!-- 动态 Tab：时间线 -->
    <div v-else-if="tab === 'timeline'" class="pf-panel glass">
      <div class="pf-panel-head">
        <h2>最近动态</h2>
        <span class="pf-count">{{ activities.length }} 条</span>
      </div>
      <ul v-if="activities.length" class="pf-timeline">
        <li v-for="(a, i) in activities" :key="a.id || i" class="pf-timeline-item">
          <span class="pf-timeline-dot"><Icon :name="a.icon || 'spark'" :size="14" /></span>
          <div class="pf-timeline-body">
            <div class="pf-timeline-text">{{ a.text }}</div>
            <div class="pf-timeline-time">{{ a.time }}</div>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="spark" title="暂无动态" subtitle="完成任务、写下笔记或收藏一段记忆后，会自动出现在这里。">
        <button class="btn" @click="goNotes"><Icon name="note" :size="16" /> 去写笔记</button>
      </EmptyState>
    </div>

    <!-- 成就 Tab：完整徽章墙 -->
    <div v-else class="pf-panel glass">
      <div class="pf-panel-head">
        <h2>成就徽章</h2>
        <span class="pf-count">{{ unlockedCount }} / {{ total }} 已解锁</span>
      </div>
      <div class="pf-badges pf-badges-lg">
        <span
          v-for="a in badgeList"
          :key="a.key"
          class="pf-badge"
          :class="{ 'is-off': !a.unlocked }"
          :title="a.unlocked ? a.title + ' · 已解锁' : a.title + ' · 未解锁'"
        >
          <span class="pf-badge-icon"><Icon :name="a.icon || 'trophy'" :size="16" /></span>
          <span class="pf-badge-name">{{ a.title }}</span>
        </span>
      </div>
    </div>

    <!-- 写文章 / 编辑文章 -->
    <Modal :title="editForm.id ? '编辑文章' : '写文章'" :show="showEditor" @close="showEditor = false">
      <div class="field">
        <label>标题</label>
        <input v-model="editForm.title" maxlength="200" placeholder="给这篇文章起个标题" />
      </div>
      <div class="field">
        <label>摘要</label>
        <textarea v-model="editForm.summary" rows="2" maxlength="400" placeholder="一两句话概括（留空自动取正文开头）"></textarea>
      </div>
      <div class="field">
        <label>封面 URL</label>
        <input v-model="editForm.cover" placeholder="https://… 或留空使用渐变封面" inputmode="url" />
        <div v-if="imageSrc(editForm.cover)" class="pf-cover-preview" :style="coverStyle(editForm)"></div>
      </div>
      <div class="field">
        <label>标签（逗号分隔）</label>
        <input v-model="editForm.tags" placeholder="如：复盘, 旅行, 随笔" />
      </div>
      <div class="field">
        <label>正文（Markdown）</label>
        <textarea v-model="editForm.body" rows="10" placeholder="支持 Markdown：## 小标题、- 列表、**加粗**"></textarea>
      </div>
      <div class="pf-form-row">
        <div class="field">
          <label>状态</label>
          <div class="seg pf-seg-sm">
            <button type="button" :class="{ 'is-on': editForm.status === 'draft' }" @click="editForm.status = 'draft'">草稿</button>
            <button type="button" :class="{ 'is-on': editForm.status === 'published' }" @click="editForm.status = 'published'">发布</button>
          </div>
        </div>
        <div class="field">
          <label>置顶</label>
          <button type="button" class="pf-toggle" :class="{ 'is-on': editForm.pinned }" @click="editForm.pinned = !editForm.pinned">
            <Icon name="star" :size="14" /> {{ editForm.pinned ? '已置顶' : '置顶' }}
          </button>
        </div>
      </div>
      <div class="pf-form-actions">
        <button v-if="editForm.id" class="btn danger" type="button" @click="removePost(editForm)">
          <Icon name="trash" :size="15" /> 删除文章
        </button>
        <button class="btn" type="button" @click="savePost">
          <Icon name="check" :size="16" /> 保存文章
        </button>
      </div>
    </Modal>

    <!-- 从笔记导入 -->
    <Modal title="从笔记导入" :show="showImport" @close="showImport = false">
      <p class="pf-hint">选择一篇笔记，正文会预填为草稿文章，确认后可继续编辑。</p>
      <div v-if="noteList.length" class="pf-note-list">
        <button v-for="m in noteList" :key="m.id" type="button" class="pf-note-row" @click="importNote(m)">
          <Icon name="note" :size="16" />
          <span class="pf-note-title">{{ m.title || '无标题笔记' }}</span>
          <span class="pf-note-date">{{ fmtDate(m.createdAt) }}</span>
        </button>
      </div>
      <EmptyState v-else icon="note" title="还没有笔记" subtitle="先去写一篇笔记，再导入成博客文章。">
        <button class="btn" @click="goNotes"><Icon name="plus" :size="16" /> 去写笔记</button>
      </EmptyState>
    </Modal>

    <!-- 分享链接编辑 -->
    <Modal :title="linkForm.id ? '编辑链接' : '分享链接'" :show="showLinkBox" @close="showLinkBox = false">
      <div class="field">
        <label>标题</label>
        <input v-model="linkForm.title" maxlength="200" placeholder="链接标题（留空取域名）" />
      </div>
      <div class="field">
        <label>链接</label>
        <input v-model="linkForm.url" placeholder="https://…" inputmode="url" @blur="autoCover" />
        <div v-if="linkBusy" class="pf-hint">封面获取中…</div>
      </div>
      <div class="field">
        <label>封面 URL（可选）</label>
        <input v-model="linkForm.cover" placeholder="留空自动取封面，失败显示域名渐变占位" inputmode="url" />
        <div v-if="imageSrc(linkForm.cover)" class="pf-cover-preview" :style="{ backgroundImage: cssUrl(imageSrc(linkForm.cover)) }"></div>
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <textarea v-model="linkForm.note" rows="2" maxlength="2000" placeholder="为什么分享它"></textarea>
      </div>
      <div class="pf-form-actions">
        <button v-if="linkForm.id" class="btn danger" type="button" @click="removeLink(linkForm)">
          <Icon name="trash" :size="15" /> 删除
        </button>
        <button class="btn" type="button" @click="saveLink">
          <Icon name="check" :size="16" /> 保存链接
        </button>
      </div>
    </Modal>

    <!-- 阅读文章 -->
    <Modal :title="reading ? (reading.title || '未命名文章') : ''" :show="showRead" @close="showRead = false">
      <div v-if="reading" class="pf-read">
        <div v-if="imageSrc(reading.cover)" class="pf-read-cover" :style="coverStyle(reading)"></div>
        <div class="pf-meta-line">
          <span>{{ fmtDate(reading.createdAt) }}</span>
          <span v-if="reading.updatedAt && reading.updatedAt !== reading.createdAt" class="pf-count">更新于 {{ fmtDate(reading.updatedAt) }}</span>
          <span v-if="reading.status === 'draft'" class="pf-status is-draft">草稿</span>
          <span v-if="reading.pinned" class="pf-status is-pin"><Icon name="star" :size="11" /> 置顶</span>
        </div>
        <div v-if="(reading.tags || []).length" class="pf-tags">
          <span v-for="t in reading.tags" :key="t" class="pf-tag">#{{ t }}</span>
        </div>
        <div class="pf-read-summary" v-if="reading.summary">{{ reading.summary }}</div>
        <MarkdownView :text="reading.body" :is-html="looksHtml(reading.body)" />
        <div class="pf-form-actions">
          <button class="btn" type="button" @click="editFromRead"><Icon name="edit" :size="15" /> 编辑文章</button>
        </div>
      </div>
    </Modal>

    <!-- 编辑资料 -->
    <Modal title="编辑资料" :show="showEdit" @close="closeEdit">
      <div class="field">
        <label>头像</label>
        <AvatarCropper v-if="cropSrc" :src="cropSrc" @crop="onCrop" @cancel="cropSrc = ''" />
        <div v-else class="pf-avatar-edit">
          <span class="pf-avatar-preview">
            <img v-if="form.avatarData" :src="form.avatarData" alt="头像预览" />
            <span v-else>{{ formInitial }}</span>
          </span>
          <div class="pf-avatar-tools">
            <GlassUploader label="上传头像（可拖动 / 滚轮缩放裁剪）" @file="onAvatarFile" />
            <button v-if="form.avatarData" class="pf-mini-btn" type="button" @click="clearAvatar">
              <Icon name="trash" :size="13" /> 移除头像
            </button>
          </div>
        </div>
      </div>

      <div class="field">
        <label>昵称</label>
        <input v-model="form.name" maxlength="24" placeholder="旅行者" />
      </div>

      <div class="field">
        <label>称号</label>
        <input v-model="form.customTitle" maxlength="24" placeholder="例如：地球旅人" />
      </div>

      <div class="field">
        <label>简介</label>
        <textarea v-model="form.signature" rows="3" maxlength="120" placeholder="写一句介绍自己"></textarea>
      </div>

      <div class="field">
        <label>性别</label>
        <select v-model="form.gender">
          <option value="">保密</option>
          <option value="male">男</option>
          <option value="female">女</option>
          <option v-show="showEgg" value="沃尔玛购物袋">沃尔玛购物袋</option>
        </select>
        <button class="pf-mini-btn" type="button" @click="showEgg = !showEgg">{{ showEgg ? '收起隐藏选项' : '隐藏选项？' }}</button>
      </div>

      <div class="field">
        <label>生日</label>
        <input v-model="form.birthDate" type="date" />
      </div>

      <div class="field">
        <label>国家 / 省份</label>
        <div class="pf-field-row">
          <input v-model="form.country" maxlength="40" placeholder="国家" />
          <input v-model="form.province" maxlength="40" placeholder="省份" />
        </div>
      </div>

      <div class="field">
        <label>自定义字段</label>
        <div v-for="(cf, i) in form.customFields" :key="i" class="pf-field-row">
          <input v-model="cf.key" maxlength="24" placeholder="字段名" />
          <input v-model="cf.value" maxlength="60" placeholder="内容" />
          <button class="pf-mini-btn" type="button" @click="removeCustomField(i)"><Icon name="x" :size="13" /></button>
        </div>
        <button class="pf-mini-btn" type="button" @click="addCustomField"><Icon name="plus" :size="13" /> 添加字段</button>
      </div>

      <div class="field">
        <label>第三方主页</label>
        <div v-for="s in SOCIALS" :key="s.key" class="pf-link-field">
          <span class="pf-link-name">{{ s.label }}</span>
          <input v-model="form.links[s.key]" :placeholder="s.placeholder" inputmode="url" />
        </div>
      </div>

      <button class="btn pf-save" type="button" @click="saveEdit">
        <Icon name="check" :size="16" /> 保存资料
      </button>
    </Modal>
  </div>
</template>

<style scoped>
.profile-page { max-width: 1180px; margin: 0 auto; padding-top: 18px; overflow-x: hidden; }

/* ---- 顶部 Hero：横幅 + 头像 ---- */
.pf-hero {
  position: relative;
  margin-bottom: 14px;
  overflow: hidden;
  border-radius: var(--eo-radius);
  border: 1px solid var(--eo-glass-border);
  background: linear-gradient(150deg, var(--eo-surface) 0%, var(--eo-bg-2) 100%);
}
.pf-banner {
  position: relative;
  height: 118px;
  background:
    repeating-linear-gradient(115deg, var(--eo-glass-border) 0 1px, transparent 1px 46px),
    linear-gradient(135deg, var(--eo-bg-2) 0%, var(--eo-surface) 62%, var(--eo-bg-2) 100%);
}
.pf-banner::after {
  content: "";
  position: absolute;
  top: -110px;
  right: -60px;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  background: var(--eo-chip);
}
.pf-hero-body {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  flex-wrap: wrap;
  padding: 0 24px 16px;
  margin-top: -46px;
}
.pf-avatar-slot { position: relative; flex: 0 0 auto; }
.pf-avatar {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  border: 4px solid var(--eo-surface);
  background: var(--eo-primary);
  box-shadow: var(--eo-shadow-soft);
}
.pf-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pf-avatar-letter { color: #fff; font-size: 34px; font-weight: 800; letter-spacing: 1px; }
.pf-hero-meta { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.pf-name {
  margin: 0;
  font-size: clamp(22px, 3vw, 32px);
  font-weight: 800;
  line-height: 1.15;
  color: var(--eo-ink);
  overflow-wrap: anywhere;
}
.pf-title {
  display: inline-block;
  margin-left: 8px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--eo-primary-soft);
  color: var(--eo-primary-deep);
  font-size: 12px;
  font-weight: 600;
  vertical-align: middle;
}
.pf-sign { margin: 0; font-size: 14px; line-height: 1.7; color: var(--eo-ink-soft); overflow-wrap: anywhere; }
.pf-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.pf-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  font-size: 12px;
}
.pf-hero-socials { display: flex; flex-wrap: wrap; gap: 8px; }
.pf-social-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
  color: var(--eo-primary-deep);
  transition: transform .18s ease, box-shadow .18s ease;
}
.pf-social-icon:hover { transform: translateY(-1px); box-shadow: var(--eo-shadow-soft); }
.pf-hero-actions { margin-left: auto; flex: 0 0 auto; }
.pf-hero-actions .btn { display: inline-flex; align-items: center; gap: 6px; }

/* ---- Hero 内统计条 ---- */
.pf-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  border-top: 1px dashed var(--eo-glass-border);
  background: color-mix(in srgb, var(--eo-bg-2) 62%, transparent);
}
.pf-stat {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 12px 16px;
  text-align: left;
}
.pf-stat.is-link { cursor: pointer; }
.pf-stat.is-link:hover .pf-stat-num { color: var(--eo-primary); }
.pf-stat-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: var(--eo-chip);
  color: var(--eo-primary);
}
.pf-stat-num { font-size: 19px; font-weight: 800; line-height: 1; color: var(--eo-ink); transition: color .2s ease; }
.pf-stat-label { margin-left: auto; font-size: 12px; color: var(--eo-ink-soft); white-space: nowrap; }

/* ---- Tab 栏 ---- */
.pf-tabbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 9px 12px;
  border-radius: var(--eo-radius);
}
.pf-tabs { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
.pf-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--eo-ink-soft);
  transition: background .18s ease, color .18s ease, box-shadow .18s ease;
}
.pf-tabs button:hover { color: var(--eo-ink); }
.pf-tabs button.is-on {
  color: var(--eo-primary-deep);
  background: color-mix(in srgb, var(--eo-primary) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--eo-primary) 18%, transparent);
}
.pf-tab-count { font-size: 11.5px; opacity: .72; }
.pf-tabbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pf-tabbar-actions .btn { display: inline-flex; align-items: center; gap: 5px; padding: 8px 16px; }
.pf-tabbar-actions .chip { display: inline-flex; align-items: center; gap: 5px; }

/* ---- 两栏布局 ---- */
.pf-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.pf-main { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.pf-side { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.pf-panel { padding: 18px; border-radius: var(--eo-radius); }
.pf-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.pf-panel-head h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--eo-ink); }
.pf-count { flex: 0 0 auto; font-size: 12px; color: var(--eo-ink-faint); }
.pf-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--eo-ink-soft);
  transition: color .2s ease;
}
.pf-link-btn:hover { color: var(--eo-primary); }
.pf-empty { margin: 4px 0; font-size: 13px; line-height: 1.7; color: var(--eo-ink-faint); }
.pf-inline-btn { color: var(--eo-primary-deep); font-weight: 600; font-size: 13px; }

/* ---- 筛选 chips ---- */
.pf-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pf-filter-reset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--eo-ink-faint);
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px dashed var(--eo-glass-border);
}
.pf-filter-reset:hover { color: var(--eo-primary); border-color: var(--eo-primary); }

/* ---- 置顶精选 ---- */
.pf-feature {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--eo-radius);
  cursor: pointer;
}
.pf-feature-cover {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 7;
  background-color: var(--eo-chip);
  background-position: center;
  background-size: cover;
}
.pf-feature-cover.is-placeholder { background-image: linear-gradient(135deg, var(--eo-primary) 0%, var(--eo-primary-soft) 100%); }
.pf-pin-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--eo-surface) 82%, transparent);
  color: var(--eo-primary-deep);
  font-size: 11.5px;
  font-weight: 700;
  backdrop-filter: blur(8px);
}
.pf-feature-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 8px; }
.pf-feature-title { margin: 0; font-size: 21px; font-weight: 800; line-height: 1.35; color: var(--eo-ink); }
.pf-feature-summary { margin: 0; font-size: 13.5px; line-height: 1.75; color: var(--eo-ink-soft); }
.pf-cover-letter { color: #fff; font-size: 30px; font-weight: 800; letter-spacing: 1px; }

/* ---- 文章卡 ---- */
.pf-posts { display: flex; flex-direction: column; gap: 12px; }
.pf-post {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px;
  border-radius: var(--eo-radius-sm);
  cursor: pointer;
  transition: transform .18s ease, box-shadow .18s ease;
}
.pf-post:hover { transform: translateY(-1px); box-shadow: var(--eo-shadow-soft); }
.pf-post-cover {
  display: grid;
  place-items: center;
  width: 116px;
  flex: 0 0 auto;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--eo-glass-border);
  background-color: var(--eo-chip);
  background-position: center;
  background-size: cover;
}
.pf-post-cover.is-placeholder { background-image: linear-gradient(135deg, var(--eo-primary) 0%, var(--eo-primary-soft) 100%); border-color: transparent; }
.pf-post-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pf-post-title { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.4; color: var(--eo-ink); overflow-wrap: anywhere; }
.pf-post-summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--eo-ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pf-meta-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--eo-ink-faint);
}
.pf-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--eo-glass-border);
  color: var(--eo-ink-faint);
  font-size: 10.5px;
  font-weight: 600;
}
.pf-status.is-draft { color: #A8703C; border-color: rgba(168, 112, 60, .34); background: rgba(168, 112, 60, .10); }
.pf-status.is-pin { color: var(--eo-primary-deep); border-color: color-mix(in srgb, var(--eo-primary) 30%, transparent); background: color-mix(in srgb, var(--eo-primary) 9%, transparent); }
.pf-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pf-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  font-size: 11.5px;
  white-space: nowrap;
}
.pf-icon-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--eo-ink-soft);
  background: color-mix(in srgb, var(--eo-surface) 78%, transparent);
  border: 1px solid var(--eo-glass-border);
  opacity: 0;
  transition: opacity .18s ease, color .18s ease;
}
.pf-post:hover .pf-icon-btn, .pf-icon-btn:focus-visible { opacity: 1; }
.pf-icon-btn:hover { color: var(--eo-primary); }

/* ---- 分享链接 ---- */
.pf-share-section { display: flex; flex-direction: column; gap: 10px; }
.pf-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pf-section-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; color: var(--eo-ink); }
.pf-link-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 10px; }
.pf-link-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--eo-radius-sm);
  cursor: pointer;
  transition: transform .18s ease, box-shadow .18s ease;
}
.pf-link-card:hover { transform: translateY(-1px); box-shadow: var(--eo-shadow-soft); }
.pf-link-cover {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  background-color: var(--eo-chip);
  background-position: center;
  background-size: cover;
}
.pf-link-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pf-link-title { font-size: 13px; font-weight: 600; color: var(--eo-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-link-host { font-size: 11.5px; color: var(--eo-ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-link-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity .18s ease;
}
.pf-link-card:hover .pf-link-tools, .pf-link-card:focus-within .pf-link-tools { opacity: 1; }
.pf-link-tools button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--eo-ink);
  background: color-mix(in srgb, var(--eo-surface) 86%, transparent);
  border: 1px solid var(--eo-glass-border);
}
.pf-link-tools button:hover { color: var(--eo-primary); }
.pf-share-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border-radius: var(--eo-radius-sm);
  border: 1px dashed var(--eo-glass-border);
  background: color-mix(in srgb, var(--eo-bg-2) 45%, transparent);
}
.pf-share-empty p { margin: 0; font-size: 13px; color: var(--eo-ink-faint); }
.pf-share-empty .btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; }

/* ---- 收藏分享流 ---- */
.pf-share-list { display: flex; flex-direction: column; gap: 8px; }
.pf-share-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--eo-radius-sm);
  text-decoration: none;
  color: inherit;
  transition: transform .18s ease, box-shadow .18s ease;
}
.pf-share-card:hover { transform: translateY(-1px); box-shadow: var(--eo-shadow-soft); }
.pf-share-cover {
  display: grid;
  place-items: center;
  width: 64px;
  height: 46px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 10px;
  background-color: var(--eo-chip);
  background-position: center;
  background-size: cover;
}
.pf-share-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pf-share-title { font-size: 13.5px; font-weight: 600; color: var(--eo-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-share-host { font-size: 11.5px; color: var(--eo-ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-share-arrow { flex: 0 0 auto; color: var(--eo-ink-faint); }

/* ---- 关于我 ---- */
.pf-about { display: flex; align-items: center; gap: 10px; }
.pf-about-avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: var(--eo-primary);
  color: #fff;
  font-weight: 800;
  font-size: 16px;
}
.pf-about-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pf-about-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pf-about-name strong { font-size: 14px; color: var(--eo-ink); overflow-wrap: anywhere; }
.pf-about-name span { font-size: 11.5px; color: var(--eo-ink-faint); }
.pf-about-sign { margin: 10px 0 12px; font-size: 12.5px; line-height: 1.7; color: var(--eo-ink-soft); }
.pf-about-stats { display: flex; gap: 1px; border-radius: 12px; overflow: hidden; background: var(--eo-glass-border); }
.pf-about-stats > div { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 9px 4px; background: var(--eo-surface); }
.pf-about-stats strong { font-size: 16px; font-weight: 800; color: var(--eo-ink); }
.pf-about-stats span { font-size: 11px; color: var(--eo-ink-faint); }
.pf-about-socials { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pf-about-socials a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  font-size: 11.5px;
  text-decoration: none;
}
.pf-about-socials a:hover { color: var(--eo-primary); }

/* ---- 标签云 / 归档 ---- */
.pf-tagcloud { display: flex; flex-wrap: wrap; gap: 7px; }
.pf-tagcloud-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  transition: color .18s ease, background .18s ease, border-color .18s ease;
}
.pf-tagcloud-item:hover { color: var(--eo-primary); border-color: var(--eo-primary); }
.pf-tagcloud-item.is-on {
  color: var(--eo-primary-deep);
  border-color: color-mix(in srgb, var(--eo-primary) 40%, transparent);
  background: color-mix(in srgb, var(--eo-primary) 12%, transparent);
}
.pf-tagcloud-item span { font-size: 10.5px; opacity: .7; }
.pf-archive { display: flex; flex-direction: column; }
.pf-archive-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--eo-ink-soft);
  transition: background .18s ease, color .18s ease;
}
.pf-archive-row:hover { background: var(--eo-chip); color: var(--eo-ink); }
.pf-archive-row.is-on { color: var(--eo-primary-deep); background: color-mix(in srgb, var(--eo-primary) 10%, transparent); }

/* ---- 收藏墙 ---- */
.pf-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(94px, 1fr)); gap: 10px; }
.pf-wall-lg { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); }
.pf-wall-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  text-align: left;
  border-radius: 14px;
}
.pf-wall-cover {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid var(--eo-glass-border);
  background-color: var(--eo-chip);
  background-position: center;
  background-size: cover;
}
.pf-wall-letter { color: #fff; font-size: 22px; font-weight: 800; }
.pf-wall-title {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--eo-ink-soft);
}

/* ---- 动态时间线 ---- */
.pf-timeline { list-style: none; margin: 0; padding: 0; position: relative; }
.pf-timeline-item { position: relative; display: flex; gap: 12px; padding-bottom: 16px; }
.pf-timeline-item:last-child { padding-bottom: 0; }
.pf-timeline-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 28px;
  bottom: 0;
  width: 1px;
  background: var(--eo-glass-border);
}
.pf-timeline-dot {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
  color: var(--eo-primary);
}
.pf-timeline-body { min-width: 0; padding-top: 2px; }
.pf-timeline-text { font-size: 13.5px; line-height: 1.65; color: var(--eo-ink); overflow-wrap: anywhere; }
.pf-timeline-time { margin-top: 2px; font-size: 11.5px; color: var(--eo-ink-faint); }

/* ---- 成就徽章 ---- */
.pf-badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
.pf-badges-lg { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
.pf-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 9px 6px;
  border-radius: 12px;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
}
.pf-badge.is-off { opacity: .38; }
.pf-badge-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--eo-primary) 10%, var(--eo-surface));
  color: var(--eo-primary);
}
.pf-badge.is-off .pf-badge-icon { background: transparent; color: var(--eo-ink-faint); }
.pf-badge-name {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--eo-ink-soft);
}

/* ---- 弹窗表单 ---- */
.pf-form-row { display: flex; gap: 16px; flex-wrap: wrap; }
.pf-form-row .field { flex: 1 1 140px; }
.pf-form-actions { display: flex; gap: 10px; margin-top: 14px; }
.pf-form-actions .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 1; }
.pf-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 14px;
  border-radius: var(--eo-radius-sm);
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  font-size: 13px;
  font-weight: 600;
}
.pf-toggle.is-on {
  color: var(--eo-primary-deep);
  border-color: color-mix(in srgb, var(--eo-primary) 38%, transparent);
  background: color-mix(in srgb, var(--eo-primary) 12%, transparent);
}
.pf-seg-sm button { padding: 6px 12px; font-size: 12.5px; }
.pf-cover-preview { margin-top: 8px; height: 84px; border-radius: 12px; background-position: center; background-size: cover; border: 1px solid var(--eo-glass-border); }
.pf-hint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--eo-ink-faint); }
.pf-note-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; }
.pf-note-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--eo-glass-border);
  background: var(--eo-glass);
  text-align: left;
  transition: border-color .18s ease, background .18s ease;
}
.pf-note-row:hover { border-color: var(--eo-primary); background: var(--eo-chip); }
.pf-note-row > :first-child { flex: 0 0 auto; color: var(--eo-primary); }
.pf-note-title { flex: 1; min-width: 0; font-size: 13px; color: var(--eo-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-note-date { flex: 0 0 auto; font-size: 11.5px; color: var(--eo-ink-faint); }

/* ---- 编辑资料 ---- */
.pf-avatar-edit { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.pf-avatar-preview {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: var(--eo-primary);
  color: #fff;
  font-size: 26px;
  font-weight: 800;
}
.pf-avatar-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pf-avatar-tools { flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.pf-mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 5px 8px;
  border-radius: 8px;
  background: var(--eo-chip);
  color: var(--eo-ink-soft);
  font-size: 12px;
}
.pf-about-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--eo-ink-soft); }
.pf-about-meta span { display: inline-flex; align-items: baseline; gap: 5px; }
.pf-about-meta b { font-weight: 600; color: var(--eo-ink); }
.pf-field-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pf-field-row:last-child { margin-bottom: 0; }
.pf-field-row input { flex: 1 1 0; width: auto; min-width: 0; }
.pf-link-field { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pf-link-field:last-child { margin-bottom: 0; }
.pf-link-name { flex: 0 0 52px; font-size: 12px; color: var(--eo-ink-soft); }
.pf-link-field input { flex: 1; min-width: 0; }
.pf-save { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; }

/* ---- 阅读 ---- */
.pf-read { display: flex; flex-direction: column; gap: 10px; }
.pf-read-cover { height: 150px; border-radius: 14px; background-position: center; background-size: cover; }
.pf-read-summary { font-size: 13px; line-height: 1.7; color: var(--eo-ink-soft); padding-left: 10px; border-left: 3px solid var(--eo-primary-soft); }

/* ---- 响应式：≤900px 单栏，侧栏下沉 ---- */
@media (max-width: 900px) {
  .pf-grid { grid-template-columns: minmax(0, 1fr); }
  .pf-side { order: 2; }
  .pf-stat-label { margin-left: 0; }
  .pf-stat { flex-wrap: wrap; }
  /* 触屏没有 hover，编辑入口常驻可点 */
  .pf-icon-btn, .pf-link-tools { opacity: 1; }
}
@media (max-width: 560px) {
  .profile-page { padding-top: 12px; }
  .pf-banner { height: 88px; }
  .pf-hero-body { align-items: flex-start; gap: 14px; padding: 0 16px 14px; margin-top: -38px; }
  .pf-avatar { width: 76px; height: 76px; }
  .pf-avatar-letter { font-size: 28px; }
  .pf-hero-actions { width: 100%; margin-left: 0; }
  .pf-hero-actions .btn { width: 100%; justify-content: center; }
  .pf-stat { padding: 10px 12px; }
  .pf-panel { padding: 14px; }
  .pf-tabbar { padding: 8px 10px; }
  .pf-tabbar-actions { width: 100%; }
  .pf-tabbar-actions .btn { flex: 1; justify-content: center; }
  .pf-post { gap: 10px; padding: 12px; }
  .pf-post-cover { width: 84px; }
  .pf-post-title { font-size: 15px; }
  .pf-feature-title { font-size: 18px; }
  .pf-wall { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
  .pf-icon-btn { opacity: 1; }
  .pf-link-grid { grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); }
  .pf-link-tools { opacity: 1; }
  .pf-form-actions { flex-direction: column-reverse; }
}
</style>
