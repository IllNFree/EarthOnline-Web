<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { APP_INFO, CHANGELOG, getLifeStats, growthStageOf, todayStr, sanitizeState } from '../lib/model.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { downloadBackup, parseBackup } from '../lib/backup.js'
import { testConnection, pushBackup, pullBackup } from '../lib/webdav.js'
import Icon from '../components/Icon.vue'
import GlassUploader from '../components/GlassUploader.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import Modal from '../components/GlassBottomSheet.vue'
import { useDialogStore } from '../stores/dialog.js'

const store = useAppStore()
const dialog = useDialogStore()
const $routerPush = useRouter().push
const theme = ref(store.theme)
const dav = ref({ url: '', user: '', pass: '' })
const davMsg = ref('')
const davBusy = ref(false)

// ---------- 个人资料（原「我的」页并入） ----------
const life = computed(() => getLifeStats(store.data.birthDate))
const stage = computed(() => growthStageOf(store.xp))
const showEdit = ref(false)
const form = ref({ name: '', signature: '', customTitle: '', gender: '', birthDate: '', country: '', province: '', avatarData: '' })
// 头像裁剪：滚轮缩放 + 拖动（AvatarCropper）
const cropSrc = ref('')

function openEdit() {
  const p = store.data.profile
  form.value = { name: p.name, signature: p.signature, customTitle: p.customTitle, gender: p.gender, birthDate: store.data.birthDate, country: p.country, province: p.province, avatarData: p.avatarData || '' }
  showEdit.value = true
}
function saveProfile() {
  store.setProfile({ name: form.value.name, signature: form.value.signature, customTitle: form.value.customTitle, gender: form.value.gender, country: form.value.country, province: form.value.province, avatarData: form.value.avatarData })
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
  store.showToast('头像已裁剪，保存后生效')
}
function clearAvatar() { form.value.avatarData = ''; cropSrc.value = '' }
const avatarSrc = computed(() => store.data.profile.avatarData)

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
// 滑块用 0~100 整数百分比，落库存 0~1（数据层 clamp01）
const wallPct = ref(Math.round((Number(store.data.wallAlpha) ?? 1) * 100))
const cardPct = ref(Math.round((Number(store.data.cardAlpha) ?? 1) * 100))
function pushAppearance() {
  store.setAppearance({ wallAlpha: wallPct.value / 100, cardAlpha: cardPct.value / 100 })
  store.applyTheme()
}

// ---------- 通知（原「通知中心」整体并入设置，弹窗查看） ----------
const notifState = ref(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
const showNotif = ref(false)
const today = todayStr()
// 待关注提醒：今日截止 / 已逾期（派生自真实数据）
const dueItems = computed(() => {
  const out = []
  store.data.tasks.forEach((t) => {
    if (t.status === 'done' || !t.dueDate) return
    if (t.dueDate < today) out.push({ id: 'over-' + t.id, icon: 'bolt', tone: 'bad', title: '已逾期：' + t.title, sub: '截止 ' + t.dueDate + (t.dueTime ? ' ' + t.dueTime : ''), to: '/tasks' })
    else if (t.dueDate === today) out.push({ id: 'due-' + t.id, icon: 'clock', tone: 'warn', title: '今日截止：' + t.title, sub: t.dueTime ? '今天 ' + t.dueTime : '今天', to: '/tasks' })
  })
  return out
})
// 成就动态（最近 3 条）
const achievementNews = computed(() => {
  return store.data.achievements.slice(-3).reverse().map((a) => {
    const d = ACHIEVEMENTS.find((x) => x.key === a.key)
    return { id: 'ach-' + a.key, icon: d ? d.icon : 'trophy', tone: 'good', title: '成就解锁：' + (d ? d.title : a.key), sub: '解锁于 ' + a.unlockedAt, to: '/achievements' }
  })
})
const reminders = computed(() => dueItems.value.concat(achievementNews.value))
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
function onImport(e) {
  const f = e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try { const st = sanitizeState(parseBackup(r.result)); Object.assign(store.data, st); store.persist(); store.recomputeXp(); store.showToast('导入成功') }
    catch (err) { store.showToast('导入失败：' + err.message) }
  }
  r.readAsText(f)
}
async function davTest() { davBusy.value = true; const r = await testConnection(dav.value); davMsg.value = r.ok ? '✓ 连接成功' : '✗ ' + r.error; davBusy.value = false }
async function davPush() { davBusy.value = true; const r = await pushBackup(dav.value, store.data); davMsg.value = r.ok ? '✓ 已上传' : '✗ ' + r.error; davBusy.value = false }
async function davPull() {
  davBusy.value = true; const r = await pullBackup(dav.value)
  davBusy.value = false
  if (r.ok && r.state) { Object.assign(store.data, r.state); store.persist(); store.recomputeXp(); davMsg.value = '✓ 已拉取'; store.showToast('已从 WebDAV 还原') }
  else davMsg.value = '✗ ' + r.error
}
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
  <div class="page wide">
    <!-- 个人资料（原「我的」页并入设置） -->
    <div class="section-title">个人资料</div>
    <div class="glass card" style="text-align:center">
      <img v-if="avatarSrc" :src="avatarSrc" alt="头像" style="width:72px;height:72px;margin:0 auto;border-radius:20px;object-fit:cover;display:block;box-shadow:var(--eo-shadow-soft)" />
      <div v-else class="avatar" style="width:72px;height:72px;margin:0 auto;font-size:30px;border-radius:20px">
        {{ store.data.profile.name ? store.data.profile.name[0] : '旅' }}
      </div>
      <div style="font-size:20px;font-weight:800;margin-top:10px">{{ store.data.profile.name || '旅行者' }}<span v-if="store.data.profile.customTitle" class="muted" style="font-size:14px"> · {{ store.data.profile.customTitle }}</span></div>
      <div class="muted" style="font-size:13px">{{ store.data.profile.signature || '这个人很神秘' }}</div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:10px">
        <span class="chip">{{ stage.icon }} {{ stage.label }}</span>
        <span class="chip">{{ store.xp }} XP</span>
        <span class="chip">已活 {{ life.daysLived }} 天</span>
      </div>
      <button class="btn" style="margin-top:14px;width:100%" @click="openEdit"><Icon name="edit" :size="16" /> 编辑资料</button>
    </div>

    <!-- 外观 -->
    <div class="section-title">外观</div>
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
        <label>壁纸不透明度（{{ wallPct }}%）</label>
        <input type="range" min="0" max="100" step="1" v-model.number="wallPct" @input="pushAppearance" style="width:100%" />
      </div>
      <div class="field">
        <label>卡片不透明度（{{ cardPct }}%）</label>
        <input type="range" min="0" max="100" step="1" v-model.number="cardPct" @input="pushAppearance" style="width:100%" />
      </div>
    </div>

    <!-- 通知（原独立「通知中心」并入设置：开关 + 弹窗查看） -->
    <div class="section-title">通知</div>
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
        <div class="muted" style="font-size:12px">今日截止 / 已逾期 / 成就动态 · 共 {{ reminders.length }} 条</div>
      </div>
      <Icon name="chevron" :size="18" />
    </div>

    <!-- 数据 · 备份与同步 -->
    <div class="section-title">数据 · 备份与同步</div>
    <div class="glass card">
      <div class="row" style="gap:8px;margin-bottom:12px">
        <button class="btn" @click="exportData"><Icon name="download" :size="16" /> 导出备份</button>
        <label class="btn ghost"><Icon name="upload" :size="16" /> 导入备份<input type="file" accept="application/json" style="display:none" @change="onImport" /></label>
      </div>
      <div class="field"><label>WebDAV 地址</label><input v-model="dav.url" placeholder="https://dav.example.com/" /></div>
      <div class="row" style="gap:8px">
        <div class="field" style="flex:1"><label>账号</label><input v-model="dav.user" /></div>
        <div class="field" style="flex:1"><label>密码</label><input v-model="dav.pass" type="password" /></div>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn ghost" :disabled="davBusy" @click="davTest"><Icon name="bolt" :size="16" /> 测试</button>
        <button class="btn ghost" :disabled="davBusy" @click="davPush"><Icon name="upload" :size="16" /> 上传</button>
        <button class="btn ghost" :disabled="davBusy" @click="davPull"><Icon name="download" :size="16" /> 拉取</button>
      </div>
      <div v-if="davMsg" class="muted" style="margin-top:8px">{{ davMsg }}</div>
    </div>

    <!-- 关于 -->
    <div class="section-title">关于</div>
    <div class="glass card">
      <div class="row" style="gap:12px">
        <img src="/icons/icon.svg" alt="Logo" style="width:56px;height:56px;border-radius:16px;box-shadow:0 10px 24px -10px rgba(154,124,88,.55), inset 0 1px 0 rgba(255,255,255,.4)" />
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:8px"><span style="font-size:18px;font-weight:800">地球Online</span><span class="chip">v{{ APP_INFO.version }}</span></div>
          <div class="muted" style="font-size:12px;margin-top:2px">把人生当成一场开放世界游戏</div>
        </div>
      </div>
      <div class="row wrap" style="gap:6px;margin-top:12px">
        <span class="chip">版本号 v{{ APP_INFO.version }}</span>
        <span class="chip">开源许可 MIT</span>
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
      <!-- 赞助 / 更新日志：弹窗化二级入口 -->
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn ghost" style="flex:1" @click="showSponsor = true"><Icon name="coins" :size="16" /> 赞助开发者</button>
        <button class="btn ghost" style="flex:1" @click="showLog = true"><Icon name="clock" :size="16" /> 更新日志</button>
      </div>
    </div>

    <!-- 更新日志弹窗（不再作为独立页面区块） -->
    <Modal title="更新日志" :show="showLog" @close="showLog = false">
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
    </Modal>

    <!-- 赞助开发者弹窗 -->
    <Modal title="赞助开发者 ☕" :show="showSponsor" @close="showSponsor = false">
      <div style="text-align:center">
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
        <span class="avatar" :style="n.tone === 'bad' ? 'background:rgba(196,99,76,.16);color:var(--eo-bad)' : n.tone === 'good' ? 'background:rgba(78,150,104,.16);color:var(--eo-good)' : 'background:var(--eo-chip);color:var(--eo-primary-deep)'">
          <Icon :name="n.icon" :size="20" />
        </span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">{{ n.title }}</div>
          <div class="muted" style="font-size:12px">{{ n.sub }}</div>
        </div>
        <Icon name="chevron" :size="16" />
      </div>
      <div v-if="!reminders.length" class="muted" style="text-align:center;padding:30px">
        暂无待办提醒与成就动态。<br />有任务临近截止时，这里会自动出现提醒。
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
        <select v-model="form.gender"><option value="">保密</option><option value="male">男</option><option value="female">女</option></select>
      </div>
      <div class="field"><label>生日</label><input type="date" v-model="form.birthDate" /></div>
      <div class="field"><label>国家 / 省份</label>
        <div class="row" style="gap:8px"><input v-model="form.country" placeholder="国家" /><input v-model="form.province" placeholder="省份" /></div>
      </div>
      <button class="btn" style="width:100%" @click="saveProfile"><Icon name="checklist" :size="16" /> 保存</button>
    </Modal>

    <div class="glass card" style="margin-top:16px">
      <div style="font-size:13px;line-height:1.8">地球Online 是一个完全离线运行的个人人生记录应用：没有服务器、没有账号、没有埋点，你的每一条数据都只存在这台设备上。<button class="chip" style="margin-left:4px" @click="$router.push('/privacy')">查看隐私政策</button></div>
    </div>

    <button class="btn danger" style="width:100%;margin-top:16px" @click="hardReset"><Icon name="trash" :size="16" /> 清空全部数据</button>
  </div>
</template>

<style scoped>
.wall-preview {
  position: relative; margin-top: 10px; height: 120px; border-radius: 16px;
  background-size: cover; background-position: center;
  border: 1px solid var(--eo-glass-border); box-shadow: inset 0 1px 0 var(--eo-glass-hi);
}
.log-item { padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--eo-glass-border); }
.log-item:last-child { border-bottom: none; margin-bottom: 0; }
.log-list { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.9; }
.sponsor-qr-lg { width: 168px; height: 168px; border-radius: 18px; object-fit: cover; background: #fff; box-shadow: var(--eo-shadow-soft); }
</style>
