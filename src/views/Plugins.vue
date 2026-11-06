<script setup>
// ===== 模块六：平台化插件中心（管理页） =====
// 已安装 / 发现 / 开发者 三段式：启停、权限、详情、错误重试、社区清单导入导出。
// 沙箱隔离：本地 JS 走 Proxy 沙箱，远程插件走 iframe，崩溃不白屏。
import { ref, computed, reactive, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import Icon from '../components/Icon.vue'
import {
  pluginRegistry, PLUGIN_PERMISSIONS, runLocalPlugin, loadUrlPlugin,
  unloadPlugin, createPluginAPI, PLUGIN_CODE_PREFIX
} from '../services/PluginAPI.js'
import { mountBuiltinPlugin } from '../services/builtinPlugins.js'

const store = useAppStore()
const routerPush = useRouter().push
const installed = computed(() => store.data.plugins || [])
const enabledCount = computed(() => installed.value.filter((p) => p.enabled).length)
const errorCount = computed(() => installed.value.filter((p) => pluginRegistry.errors[p.id]).length)

// 视图状态
const tab = ref('installed') // 'installed' | 'discover' | 'dev'
const q = ref('')
const srcFilter = ref('all')
const statusFilter = ref('all')
const expandedId = ref(null)
const permMap = computed(() => Object.fromEntries(PLUGIN_PERMISSIONS.map((p) => [p.key, p.label])))

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return installed.value.filter((p) => {
    if (kw && !((p.name || '') + ' ' + (p.author || '')).toLowerCase().includes(kw)) return false
    if (srcFilter.value !== 'all' && p.source !== srcFilter.value) return false
    if (statusFilter.value === 'on' && !p.enabled) return false
    if (statusFilter.value === 'off' && p.enabled) return false
    if (statusFilter.value === 'err' && !pluginRegistry.errors[p.id]) return false
    return true
  })
})

function srcLabel(s) { return s === 'builtin' ? '内置' : (s === 'url' ? '远程' : '本地') }
function srcIcon(p) { return p.source === 'builtin' ? 'cloud' : 'puzzle' }
function toggleExpand(p) { expandedId.value = expandedId.value === p.id ? null : p.id }

// ---- 插件运行 ----
function mountPlugin(p) {
  if (p.source === 'builtin') {
    mountBuiltinPlugin(Object.assign({}, p, { __getData: () => store.data }), store.showToast)
  } else if (p.source === 'url') {
    loadUrlPlugin(p, store.showToast)
  } else {
    const code = localStorage.getItem(PLUGIN_CODE_PREFIX + p.id)
    if (code) runLocalPlugin(p, code, createPluginAPI({ getData: () => store.data, notify: store.showToast, owner: p.id }))
  }
}

function setEnabled(p, val) {
  p.enabled = val
  if (val) mountPlugin(p)
  else unloadPlugin(p)
  store.persist()
  // 内置插件关闭后，其画布数据面板与相关入口一并隐藏
  store.reconcileCanvasPanels()
  if (p.source === 'builtin') {
    store.showToast(val ? '已启用「' + p.name + '」' : '已停用「' + p.name + '」，相关入口与数据已隐藏')
    if (!val && window.location.hash.indexOf('#/steam') === 0) routerPush('/')
  }
}

function removePlugin(p) {
  if (p.source === 'builtin') { store.showToast('内置插件不可移除，可在插件中心停用'); return }
  unloadPlugin(p)
  if (p.source === 'local') localStorage.removeItem(PLUGIN_CODE_PREFIX + p.id)
  store.data.plugins = (store.data.plugins || []).filter((x) => x.id !== p.id)
  if (viewId.value === p.id) viewId.value = null
  if (expandedId.value === p.id) expandedId.value = null
  store.persist()
  store.reconcileCanvasPanels()
  store.showToast('已移除插件')
}

function retryPlugin(p) {
  try { delete pluginRegistry.errors[p.id] } catch (e) { /* ignore */ }
  unloadPlugin(p)
  p.enabled = true
  mountPlugin(p)
  store.persist()
  store.reconcileCanvasPanels()
  store.showToast('已重新加载「' + p.name + '」')
}

function togglePluginPerm(p, key) {
  p.permissions = p.permissions || []
  const i = p.permissions.indexOf(key)
  if (i >= 0) p.permissions.splice(i, 1)
  else p.permissions.push(key)
  store.persist()
}

function extensionsOf(p) {
  const out = []
  routesFor(p.id).forEach((r) => out.push({ icon: r.icon || 'link', label: '页面 · ' + (r.title || r.path) }))
  ;(pluginRegistry.contextMenus || []).filter((m) => m.owner === p.id).forEach((m) => out.push({ icon: m.icon || 'grid', label: '右键 · ' + m.label }))
  Object.values(pluginRegistry.canvasNodes || {}).filter((n) => n.owner === p.id).forEach((n) => out.push({ icon: 'grid', label: '节点 · ' + n.label }))
  Object.values(pluginRegistry.navItems || {}).filter((n) => n.owner === p.id).forEach((n) => out.push({ icon: n.icon || 'compass', label: '导航 · ' + (n.label || n.name) }))
  Object.values(pluginRegistry.panels || {}).filter((n) => n.owner === p.id).forEach((n) => out.push({ icon: 'chart', label: '面板 · ' + n.label }))
  return out
}

// ---- 插件页面预览 ----
const viewId = ref(null)
const routeKey = ref('')
function routesFor(id) { return Object.values(pluginRegistry.routes || {}).filter((r) => r.owner === id) }
const pluginRoutes = computed(() => (viewId.value ? routesFor(viewId.value) : []))
const viewedPlugin = computed(() => installed.value.find((p) => p.id === viewId.value) || null)

function renderRoute(route) {
  try {
    if (typeof route.render === 'function') {
      return route.render({ store: createPluginAPI({ getData: () => store.data, notify: store.showToast, owner: route.owner }).accessStore() }) || ''
    }
    if (route.renderHTML) return route.renderHTML
  } catch (e) { pluginRegistry.errors[route.owner] = String(e.message || e) }
  return '<div style="padding:12px;color:#999">该插件页面无可渲染内容。</div>'
}

function openPlugin(p) {
  if (p.source === 'builtin') { routerPush('/steam'); return }
  viewId.value = p.id
  const rs = routesFor(p.id)
  routeKey.value = rs[0] ? rs[0].path : ''
}

// ---- 安装（开发者） ----
const mode = ref('local')
const localName = ref('')
const localCode = ref('')
const urlInput = ref('')
const permSel = ref([])
const manifestFile = ref(null)

function togglePerm(key) {
  const i = permSel.value.indexOf(key)
  if (i >= 0) permSel.value.splice(i, 1)
  else permSel.value.push(key)
}

function ensurePlugins() { if (!store.data.plugins) store.data.plugins = [] }

function installLocal() {
  const code = localCode.value.trim()
  if (!code) { store.showToast('请粘贴插件代码'); return }
  const name = localName.value.trim() || '本地插件'
  const id = 'pl_' + Date.now().toString(36)
  const manifest = { id, name, version: '1.0', author: '本地', source: 'local', entry: '', permissions: [...permSel.value], enabled: true }
  ensurePlugins()
  localStorage.setItem(PLUGIN_CODE_PREFIX + id, code)
  store.data.plugins.push(manifest)
  store.persist()
  mountPlugin(manifest)
  store.showToast('已安装并启用本地插件')
  localCode.value = ''; localName.value = ''
}

function installUrl() {
  const url = urlInput.value.trim()
  if (!/^https?:\/\//.test(url)) { store.showToast('请输入合法的 http(s) 链接'); return }
  const id = 'pl_' + Date.now().toString(36)
  const name = (url.split('/').pop() || 'remote').replace(/\.\w+$/, '').slice(0, 40) || '远程插件'
  const manifest = { id, name, version: '', author: '远程', source: 'url', entry: url, permissions: [...permSel.value], enabled: false }
  ensurePlugins()
  store.data.plugins.push(manifest)
  store.persist()
  store.showToast('已添加，请在列表中启用')
  urlInput.value = ''
}

// ---- 社区示例插件（发现页，一键安装） ----
const DEMO = `eoPlugin(function (api) {
  api.registerRoute({
    path: '/p/demo-xp', title: '我的进度', icon: 'spark',
    render: function () {
      var s = api.accessStore();
      return '<div style="padding:14px;line-height:1.9">'
        + '姓名：' + ((s.profile && s.profile.name) || '旅行者') + '<br/>'
        + '已解锁成就：' + ((s.achievements && s.achievements.length) || 0) + ' 项'
        + '</div>';
    }
  });
  api.registerContextMenu({
    id: 'demo_hi', label: '插件问好', icon: 'spark',
    run: function () { api.toast('你好，来自示例插件的问候！'); }
  });
});`

// ---- 发现：远程清单订阅（多地址并存） ----
const SOURCE_MAX = 20
const sources = computed(() => store.data.pluginSources || [])
const sourceInput = ref('')
const catalog = reactive({})
const GUIDE_KEY = 'eo_hint_devguide'

function setCatalog(url, patch) {
  catalog[url] = Object.assign({ status: 'idle', error: '', plugins: [], at: 0 }, catalog[url] || {}, patch)
}
function normalizeCatalog(data) {
  const list = Array.isArray(data) ? data : (data && data.plugins)
  if (!Array.isArray(list)) return []
  return list
    .filter((it) => it && it.name && it.source !== 'builtin' && (it.code || it.entry))
    .map((it) => ({
      name: String(it.name).slice(0, 40),
      version: String(it.version || ''),
      author: String(it.author || '社区'),
      desc: String(it.desc || it.description || ''),
      icon: String(it.icon || 'puzzle'),
      tags: Array.isArray(it.tags) ? it.tags.slice(0, 4).map((t) => String(t).slice(0, 12)) : [],
      permissions: Array.isArray(it.permissions) ? it.permissions.filter((k) => !!permMap.value[k]) : [],
      code: it.code ? String(it.code) : '',
      entry: it.entry ? String(it.entry) : ''
    }))
}
function addSource() {
  const url = sourceInput.value.trim()
  if (!/^https?:\/\//i.test(url)) { store.showToast('请输入以 http(s) 开头的清单地址'); return }
  if (sources.value.includes(url)) { store.showToast('这个地址已经订阅了'); return }
  if (sources.value.length >= SOURCE_MAX) { store.showToast('订阅数量已达上限（' + SOURCE_MAX + ' 个）'); return }
  store.data.pluginSources = [...sources.value, url]
  store.persist()
  sourceInput.value = ''
  fetchSource(url)
}
async function fetchSource(url) {
  setCatalog(url, { status: 'loading', error: '' })
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const plugins = normalizeCatalog(data)
    if (!plugins.length) throw new Error('清单里没有可安装的插件（需要 name 与 code 或 entry）')
    setCatalog(url, { status: 'ok', plugins, at: Date.now() })
  } catch (e) {
    const msg = String((e && e.message) || e)
    const hint = /NetworkError|Failed to fetch|CORS|跨域/i.test(msg) ? '（可能是跨域限制或网络不可达，可改用本地导入清单）' : ''
    setCatalog(url, { status: 'error', plugins: [], error: msg + hint })
  }
}
function removeSource(url) {
  store.data.pluginSources = sources.value.filter((u) => u !== url)
  delete catalog[url]
  store.persist()
  store.showToast('已取消订阅')
}
function isInstalledName(name) { return installed.value.some((p) => p.name === name) }

// 安装单个清单条目：code → 本地沙箱，entry → iframe；forceEnable 用于「发现」一键安装
function installItem(item, forceEnable) {
  if (!item || !item.name) return false
  const code = item.code ? String(item.code) : ''
  const entry = item.entry ? String(item.entry) : ''
  if (!code && !entry) return false
  const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const manifest = {
    id, name: item.name, version: item.version || '', author: item.author || '社区',
    source: code ? 'local' : 'url', entry,
    permissions: (item.permissions || []).filter((k) => !!permMap.value[k]),
    enabled: forceEnable ? true : !!item.enabled
  }
  if (code) localStorage.setItem(PLUGIN_CODE_PREFIX + id, code)
  ensurePlugins()
  store.data.plugins.push(manifest)
  if (manifest.enabled) mountPlugin(manifest)
  return true
}
function installFromCatalog(item) {
  if (isInstalledName(item.name)) { store.showToast('「' + item.name + '」已安装'); return }
  if (!installItem(item, true)) { store.showToast('该条目缺少 code 或 entry，无法安装'); return }
  store.persist()
  store.reconcileCanvasPanels()
  store.showToast('已安装并启用「' + item.name + '」，可在「已安装」查看权限')
}

// ---- 开发者指南（首显展开，可收藏关闭状态） ----
const guideOpen = ref(true)
try { if (localStorage.getItem(GUIDE_KEY)) guideOpen.value = false } catch (e) { /* 隐私模式忽略 */ }
function toggleGuide() {
  guideOpen.value = !guideOpen.value
  try { localStorage.setItem(GUIDE_KEY, guideOpen.value ? '0' : '1') } catch (e) { /* ignore */ }
}
function goDevGuide() {
  tab.value = 'dev'
  guideOpen.value = true
  nextTick(() => {
    const el = document.getElementById('dev-guide')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// ---- 社区清单导入 / 导出 ----
function exportManifest() {
  const list = installed.value.filter((p) => p.source !== 'builtin').map((p) => {
    const item = {
      name: p.name, version: p.version || '', author: p.author || '', source: p.source,
      entry: p.entry || '', permissions: [...(p.permissions || [])], enabled: !!p.enabled
    }
    if (p.source === 'local') item.code = localStorage.getItem(PLUGIN_CODE_PREFIX + p.id) || ''
    return item
  })
  if (!list.length) { store.showToast('没有可导出的第三方插件'); return }
  const data = { type: 'eo-plugin-manifest', version: 1, exportedAt: new Date().toISOString(), plugins: list }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'eo-plugins.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  store.showToast('已导出 ' + list.length + ' 个插件清单')
}

function importManifestText(text) {
  let obj
  try { obj = JSON.parse(text) } catch (e) { store.showToast('清单解析失败：' + e.message); return }
  const list = Array.isArray(obj) ? obj : (obj.plugins || [])
  if (!list.length) { store.showToast('清单里没有插件'); return }
  ensurePlugins()
  let ok = 0; let skip = 0
  list.forEach((item) => { if (installItem(item)) ok++; else skip++ })
  store.persist()
  if (ok) store.reconcileCanvasPanels()
  store.showToast('已导入 ' + ok + ' 个插件' + (skip ? '，跳过 ' + skip + ' 条' : '') + (ok ? '；未启用的可在列表中启用' : ''))
}

function onManifestPick(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => importManifestText(String(rd.result || ''))
  rd.readAsText(f)
  e.target.value = ''
}

function goDev() { tab.value = 'dev'; nextTick(() => { if (manifestFile.value) manifestFile.value.value = '' }) }

function insertDemo() { mode.value = 'local'; localName.value = '示例进度插件'; localCode.value = DEMO; permSel.value = ['store:read', 'contextMenu'] }
</script>

<template>
  <div class="page wide">
    <div class="section-title">插件中心</div>
    <div class="muted" style="font-size:12px;margin:-4px 4px 12px">
      插件运行于沙箱隔离环境：本地 JS 走 Proxy 沙箱（禁止直操 window / document / 存储），远程插件走 iframe 隔离。崩溃只会影响该插件，不会白屏。
    </div>

    <!-- 概览 -->
    <div class="pm-stats">
      <div class="pm-stat"><b>{{ installed.length }}</b><span>已安装</span></div>
      <div class="pm-stat"><b>{{ enabledCount }}</b><span>已启用</span></div>
      <div class="pm-stat" :class="{ warn: errorCount }"><b>{{ errorCount }}</b><span>运行异常</span></div>
    </div>

    <!-- Tab -->
    <div class="pm-tabs">
      <button :class="{ on: tab === 'installed' }" @click="tab = 'installed'"><Icon name="puzzle" :size="14" /> 已安装 <b>{{ installed.length }}</b></button>
      <button :class="{ on: tab === 'discover' }" @click="tab = 'discover'"><Icon name="spark" :size="14" /> 发现</button>
      <button :class="{ on: tab === 'dev' }" @click="tab = 'dev'"><Icon name="grid" :size="14" /> 开发者</button>
    </div>

    <!-- ===== 已安装 ===== -->
    <template v-if="tab === 'installed'">
      <div class="glass card" style="padding:10px">
        <div class="pm-tools">
          <input class="pm-search" v-model="q" placeholder="搜索插件名称 / 作者" />
          <div class="pm-chips">
            <button v-for="f in [{ k: 'all', t: '全部' }, { k: 'builtin', t: '内置' }, { k: 'local', t: '本地' }, { k: 'url', t: '远程' }]"
              :key="f.k" class="pm-chip" :class="{ on: srcFilter === f.k }" @click="srcFilter = f.k">{{ f.t }}</button>
          </div>
          <div class="pm-chips">
            <button v-for="f in [{ k: 'all', t: '全部状态' }, { k: 'on', t: '已启用' }, { k: 'off', t: '已停用' }, { k: 'err', t: '异常' }]"
              :key="f.k" class="pm-chip" :class="{ on: statusFilter === f.k }" @click="statusFilter = f.k">{{ f.t }}</button>
          </div>
        </div>

        <div v-if="!filtered.length" class="muted" style="padding:14px 10px;text-align:center">
          {{ installed.length ? '没有符合筛选条件的插件。' : '还没有安装任何插件：去「发现」订阅社区清单，或到「开发者」安装本地插件。' }}
        </div>

        <div v-for="p in filtered" :key="p.id" class="plugin-row" :class="{ off: !p.enabled }">
          <span class="avatar" :style="p.source === 'builtin' ? 'background:var(--eo-primary);color:#fff' : 'background:var(--eo-chip);color:var(--eo-primary-deep)'">
            <Icon :name="srcIcon(p)" :size="20" />
          </span>
          <div style="flex:1;min-width:0">
            <div class="pm-name">
              <span class="pm-name-t">{{ p.name }}</span>
              <span v-if="p.version" class="muted" style="font-size:11px;font-weight:400">{{ p.version }}</span>
              <span class="src-badge" :class="p.source">{{ srcLabel(p.source) }}</span>
              <span class="pm-state" :class="{ on: p.enabled }">{{ p.enabled ? '运行中' : '已停用' }}</span>
            </div>
            <div class="muted" style="font-size:12px">
              <template v-if="p.source === 'builtin'">随应用内置 · 提供导航入口与画布数据面板</template>
              <template v-else>{{ p.author || '未知作者' }} · 权限 {{ (p.permissions || []).length }} 项 · 扩展 {{ extensionsOf(p).length }} 项</template>
            </div>
            <div v-if="pluginRegistry.errors[p.id]" class="err-chip">
              ⚠ {{ pluginRegistry.errors[p.id] }}
              <button class="err-retry" @click="retryPlugin(p)">重试</button>
            </div>
          </div>
          <div class="pm-acts">
            <button class="chip" :disabled="!p.enabled" @click="openPlugin(p)"><Icon name="external" :size="14" /> {{ p.source === 'builtin' ? '打开' : '页面' }}</button>
            <button class="chip" @click="setEnabled(p, !p.enabled)">{{ p.enabled ? '停用' : '启用' }}</button>
            <button class="ghost-btn" title="详情与权限" @click="toggleExpand(p)"><Icon :name="expandedId === p.id ? 'chevup' : 'chevdown'" :size="16" /></button>
            <button v-if="p.source !== 'builtin'" class="ghost-btn" title="卸载" @click="removePlugin(p)"><Icon name="trash" :size="16" /></button>
          </div>

          <!-- 详情：权限可编辑，扩展点与错误可见 -->
          <div v-if="expandedId === p.id" class="pm-detail">
            <div class="pm-detail-grid">
              <div><span>作者</span><b>{{ p.author || '未知' }}</b></div>
              <div><span>版本</span><b>{{ p.version || '—' }}</b></div>
              <div><span>来源</span><b>{{ srcLabel(p.source) }}</b></div>
              <div><span>状态</span><b>{{ p.enabled ? '运行中' : '已停用' }}</b></div>
            </div>
            <div v-if="p.source === 'url'" class="pm-entry">{{ p.entry }}</div>
            <div class="pm-sub-l">权限（停用后重新启用生效）</div>
            <div class="perm-list">
              <label v-for="pm in PLUGIN_PERMISSIONS" :key="pm.key" class="perm-item">
                <input type="checkbox" :checked="(p.permissions || []).includes(pm.key)" @change="togglePluginPerm(p, pm.key)" />
                <span>{{ pm.label }}</span>
              </label>
            </div>
            <div class="pm-sub-l">提供的扩展点</div>
            <div class="pm-exts">
              <span v-for="(x, i) in extensionsOf(p)" :key="i" class="pm-ext"><Icon :name="x.icon" :size="11" /> {{ x.label }}</span>
              <span v-if="!extensionsOf(p).length" class="muted" style="font-size:12px">暂无（启用后可能注册）</span>
            </div>
            <div v-if="p.source === 'url'" class="pm-detail-acts">
              <button class="chip" @click="retryPlugin(p)"><Icon name="reset" :size="13" /> 重新加载</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== 发现（远程清单订阅） ===== -->
    <template v-else-if="tab === 'discover'">
      <div class="muted" style="font-size:12px;margin:0 4px 10px">
        订阅一个或多个社区清单地址（JSON），即可浏览并安装其中的插件。地址只保存在本机；安装前请留意条目声明的权限。
      </div>

      <div class="glass card pm-subscribe">
        <div class="field" style="margin:0;flex:1">
          <label>清单地址</label>
          <input v-model="sourceInput" placeholder="https://example.com/eo-plugins.json" @keyup.enter="addSource" />
        </div>
        <button class="chip" style="flex:none" @click="addSource"><Icon name="plus" :size="13" /> 添加订阅</button>
      </div>

      <div v-if="!sources.length" class="glass card pm-empty">
        <div class="pm-empty-ico"><Icon name="spark" :size="22" /></div>
        <div class="pm-empty-t">还没有订阅任何清单</div>
        <div class="pm-empty-d">「发现」不内置示例插件。你可以订阅一份社区清单，或直接从本地导入清单 / 自己写一个插件。</div>
        <div class="pm-empty-acts">
          <button class="chip" @click="goDev"><Icon name="upload" :size="13" /> 导入本地清单</button>
          <button class="chip" @click="tab = 'dev'"><Icon name="grid" :size="13" /> 去开发者安装</button>
          <button class="chip" @click="goDevGuide"><Icon name="note" :size="13" /> 查看开发指南</button>
        </div>
      </div>

      <div v-for="url in sources" :key="url" class="glass card pm-source">
        <div class="pm-source-head">
          <span class="pm-source-url" :title="url">{{ url }}</span>
          <span v-if="catalog[url]" class="pm-source-state" :class="catalog[url].status">
            {{ catalog[url].status === 'loading' ? '加载中…'
              : (catalog[url].status === 'ok' ? catalog[url].plugins.length + ' 个插件'
              : (catalog[url].status === 'error' ? '加载失败' : '未加载')) }}
          </span>
          <button class="ghost-btn" title="刷新" @click="fetchSource(url)"><Icon name="reset" :size="15" /></button>
          <button class="ghost-btn" title="取消订阅" @click="removeSource(url)"><Icon name="trash" :size="15" /></button>
        </div>
        <div v-if="catalog[url] && catalog[url].status === 'error'" class="pm-source-err">
          <div>{{ catalog[url].error }}</div>
          <button class="chip" style="margin-top:8px" @click="goDev"><Icon name="upload" :size="13" /> 改用本地导入</button>
        </div>
        <div v-if="catalog[url] && catalog[url].status === 'ok' && !catalog[url].plugins.length" class="muted" style="font-size:12px;padding:6px 0">
          这个清单里没有可安装的插件。
        </div>
        <div v-if="catalog[url] && catalog[url].plugins.length" class="pm-showcase">
          <div v-for="(s, i) in catalog[url].plugins" :key="url + '-' + i" class="pm-sample">
            <div class="pm-sample-head">
              <span class="pm-sample-ico"><Icon :name="s.icon" :size="18" /></span>
              <div style="flex:1;min-width:0">
                <div class="pm-name-t">{{ s.name }}</div>
                <div class="muted" style="font-size:11px">{{ s.author }}{{ s.version ? ' · v' + s.version : '' }}</div>
              </div>
              <button v-if="!isInstalledName(s.name)" class="chip" @click="installFromCatalog(s)"><Icon name="download" :size="13" /> 安装</button>
              <span v-else class="pm-installed"><Icon name="check" :size="13" /> 已安装</span>
            </div>
            <div v-if="s.desc" class="pm-sample-desc">{{ s.desc }}</div>
            <div class="pm-tags">
              <span v-for="t in s.tags" :key="t" class="pm-tag">{{ t }}</span>
              <span class="pm-tag perm">权限 {{ s.permissions.length }}</span>
              <span class="pm-tag">{{ s.code ? '本地 JS' : '远程 iframe' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="glass card pm-share">
        <div style="flex:1">
          <div class="pm-sub-l" style="margin-top:0">没有现成清单？</div>
          <div class="muted" style="font-size:12px">可以把本机插件导出成清单分享给朋友，或按开发指南写一个自己的插件。</div>
        </div>
        <div class="pm-acts">
          <button class="chip" @click="exportManifest"><Icon name="download" :size="14" /> 导出清单</button>
          <button class="chip" @click="goDevGuide"><Icon name="note" :size="14" /> 开发指南</button>
        </div>
      </div>
    </template>

    <!-- ===== 开发者 ===== -->
    <template v-else>
      <div class="glass card">
        <div class="section-title" style="margin:0 0 10px">安装插件</div>
        <div class="capsule" style="display:inline-flex;padding:4px;gap:4px;margin-bottom:12px">
          <button class="btn ghost" :style="mode === 'local' ? 'background:var(--eo-primary);color:#fff' : ''" @click="mode = 'local'">本地 JS</button>
          <button class="btn ghost" :style="mode === 'url' ? 'background:var(--eo-primary);color:#fff' : ''" @click="mode = 'url'">远程 URL</button>
        </div>

        <template v-if="mode === 'local'">
          <div class="field"><label>插件名称</label><input v-model="localName" placeholder="如：示例进度插件" /></div>
          <div class="field"><label>插件代码（调用 eoPlugin(setup) 完成注册）</label>
            <textarea v-model="localCode" rows="7" placeholder="eoPlugin(function(api){ api.registerRoute({...}) })" style="font-family:ui-monospace,monospace;font-size:12px"></textarea>
          </div>
          <button class="chip" style="flex:none;margin-bottom:12px" @click="insertDemo"><Icon name="spark" :size="13" /> 插入示例插件</button>
        </template>
        <template v-else>
          <div class="field"><label>插件入口 URL</label><input v-model="urlInput" placeholder="https://example.com/plugin.js" /></div>
          <div class="muted" style="font-size:12px;margin-bottom:12px">远程插件将经 iframe 沙箱加载，其代码不会存入本地备份。</div>
        </template>

        <div class="field"><label>权限授权</label>
          <div class="perm-list">
            <label v-for="pm in PLUGIN_PERMISSIONS" :key="pm.key" class="perm-item">
              <input type="checkbox" :checked="permSel.includes(pm.key)" @change="togglePerm(pm.key)" />
              <span>{{ pm.label }}</span>
            </label>
          </div>
        </div>

        <button class="btn" style="width:100%" @click="mode === 'local' ? installLocal() : installUrl()">
          <Icon name="download" :size="16" /> {{ mode === 'local' ? '安装并启用' : '添加远程插件' }}
        </button>
      </div>

      <!-- 社区清单导入导出 -->
      <div class="glass card" style="margin-top:12px">
        <div class="section-title" style="margin:0 0 10px">社区清单</div>
        <div class="muted" style="font-size:12px;margin-bottom:10px">
          清单格式：<code>{ "type": "eo-plugin-manifest", "plugins": [ { "name", "version", "author", "permissions", "code" 或 "entry", "enabled" } ] }</code>。
          导入的本地插件代码会存进本机，远程插件需联网加载。
        </div>
        <div class="row wrap" style="gap:8px">
          <button class="chip" @click="exportManifest"><Icon name="download" :size="14" /> 导出插件清单</button>
          <label class="chip" style="cursor:pointer">
            <Icon name="upload" :size="14" /> 导入插件清单
            <input ref="manifestFile" type="file" accept=".json,application/json" style="display:none" @change="onManifestPick" />
          </label>
        </div>
      </div>

      <!-- 插件开发指南（首次展开，收起状态本地记忆） -->
      <div id="dev-guide" class="glass card" style="margin-top:12px">
        <div class="row between" style="align-items:center">
          <div class="section-title" style="margin:0">插件开发指南</div>
          <button class="chip" @click="toggleGuide">{{ guideOpen ? '收起' : '展开' }}</button>
        </div>
        <div v-if="guideOpen" class="pm-guide">
          <div class="pm-guide-t">1. 最小结构</div>
          <div class="pm-guide-d">插件就是一个调用 <code>eoPlugin(setup)</code> 的脚本，<code>setup</code> 里通过 <code>api</code> 注册能力。保存为本地 JS 安装，或托管成 .js 文件后用「远程 URL」安装。</div>
          <div class="pm-guide-t">2. 可用 API</div>
          <div class="pm-guide-api">
            <div><code>api.registerRoute({ path, title, icon, render })</code><span>注册插件页面，render 返回 HTML 字符串</span></div>
            <div><code>api.registerContextMenu({ id, label, icon, run })</code><span>在右键菜单添加动作</span></div>
            <div><code>api.registerNav({ ... })</code><span>添加导航入口</span></div>
            <div><code>api.registerPanel({ ... })</code><span>注册数据面板</span></div>
            <div><code>api.registerCanvasNode({ type, label, color })</code><span>在画布挂载自定义节点类型</span></div>
            <div><code>api.accessStore()</code><span>只读数据快照（任务 / 笔记 / 记账 / 成就等）</span></div>
            <div><code>api.toast(msg)</code><span>弹出轻提示</span></div>
          </div>
          <div class="pm-guide-t">3. 权限与沙箱</div>
          <div class="pm-guide-d">只勾选真正需要的权限：<code>store:read</code> 读数据、<code>route</code> 页面、<code>contextMenu</code> 右键、<code>canvasNode</code> 画布节点、<code>network</code> 联网。本地 JS 走 Proxy 沙箱（不能直接操作 window / document / localStorage），远程插件走 iframe 隔离。</div>
          <div class="pm-guide-t">4. 调试与排查</div>
          <div class="pm-guide-d">安装后在「已安装」展开详情可看权限与扩展点；运行报错会显示红色错误条并带「重试」按钮。清单格式见下方「社区清单」。</div>
          <div class="pm-guide-t">5. 示例代码</div>
          <pre class="pm-guide-code">{{ DEMO }}</pre>
          <div class="row wrap" style="gap:8px;margin-top:8px">
            <button class="chip" @click="insertDemo"><Icon name="spark" :size="13" /> 填入编辑器</button>
          </div>
        </div>
      </div>

      <!-- 权限说明 -->
      <div class="glass card" style="margin-top:12px">
        <div class="section-title" style="margin:0 0 10px">权限说明</div>
        <div class="pm-perm-doc">
          <div v-for="pm in PLUGIN_PERMISSIONS" :key="pm.key" class="pm-perm-doc-row">
            <b>{{ pm.key }}</b><span>{{ pm.label }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 插件页面预览 -->
    <div v-if="viewId && viewedPlugin" class="glass card" style="margin-top:16px">
      <div class="row between" style="margin-bottom:10px">
        <div style="font-weight:700">{{ viewedPlugin.name }} · 页面</div>
        <button class="ghost-btn" @click="viewId = null"><Icon name="x" :size="16" /></button>
      </div>
      <div v-if="!pluginRoutes.length" class="muted" style="font-size:13px">该插件暂未注册可渲染页面。</div>
      <template v-else>
        <div class="row wrap" style="gap:6px;margin-bottom:10px">
          <button v-for="r in pluginRoutes" :key="r.path" class="chip" :style="routeKey === r.path ? 'background:var(--eo-primary);color:#fff' : ''" @click="routeKey = r.path">
            <Icon :name="r.icon" :size="13" /> {{ r.title }}
          </button>
        </div>
        <div class="plugin-host" v-html="renderRoute(pluginRoutes.find((r) => r.path === routeKey) || {})"></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ---- 概览 ---- */
.pm-stats { display: flex; gap: 8px; margin-bottom: 12px; }
.pm-stat {
  flex: 1; display: flex; flex-direction: column; gap: 1px; padding: 10px 12px;
  border-radius: 14px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border);
}
.pm-stat b { font-size: 22px; line-height: 1.1; color: var(--eo-primary-deep); font-variant-numeric: tabular-nums; }
.pm-stat span { font-size: 11px; opacity: .55; }
.pm-stat.warn b { color: #B4796C; }

/* ---- Tab ---- */
.pm-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.pm-tabs button {
  display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; border-radius: 99px;
  border: 1px solid var(--eo-glass-border); background: var(--eo-glass); color: var(--eo-ink);
  font-size: 12px; font-weight: 700; cursor: pointer; transition: background .14s ease, color .14s ease;
}
.pm-tabs button b { font-size: 10px; opacity: .65; }
.pm-tabs button.on { background: var(--eo-primary); border-color: transparent; color: #fff; }
.pm-tabs button.on b { opacity: .9; }

/* ---- 已安装 ---- */
.pm-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.pm-search {
  flex: 1; min-width: 140px; height: 30px; border-radius: 9px; border: 1px solid var(--eo-glass-border);
  background: var(--eo-chip); padding: 0 10px; font-size: 12px; color: var(--eo-ink); box-sizing: border-box;
}
.pm-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.pm-chip {
  height: 26px; padding: 0 9px; border-radius: 99px; border: 1px solid var(--eo-glass-border);
  background: transparent; color: var(--eo-ink); font-size: 11px; cursor: pointer; opacity: .7;
}
.pm-chip.on { background: var(--eo-chip-strong, rgba(44,44,44,.08)); opacity: 1; font-weight: 700; }
.plugin-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--eo-glass-border); flex-wrap: wrap; }
.plugin-row:first-of-type { border-top: none; }
.plugin-row.off { opacity: .62; }
.src-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; }
.src-badge.local { background: rgba(209, 206, 200, .16); color: #9E9C97; }
.src-badge.url { background: rgba(255, 252, 244, .16); color: #E0DDD7; }
.src-badge.builtin { background: rgba(44, 44, 44, .20); color: var(--eo-primary-deep); }
.pm-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 700; }
.pm-name-t { font-weight: 700; }
.pm-state { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(44, 44, 44, .10); opacity: .7; }
.pm-state.on { background: rgba(126, 154, 126, .18); color: #6F8E6F; opacity: 1; }
.err-chip { margin-top: 6px; font-size: 11px; color: #C0BEB8; background: rgba(192, 190, 184, .10); border-radius: 8px; padding: 4px 8px; display: flex; align-items: center; gap: 8px; }
.err-retry { flex: none; border: none; border-radius: 99px; padding: 1px 8px; font-size: 10px; cursor: pointer; background: rgba(192, 190, 184, .22); color: inherit; }
.pm-acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pm-detail {
  flex-basis: 100%; margin-top: 8px; padding: 10px; border-radius: 12px;
  background: var(--eo-chip); display: flex; flex-direction: column; gap: 8px;
}
.pm-detail-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.pm-detail-grid div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pm-detail-grid span { font-size: 10px; opacity: .5; }
.pm-detail-grid b { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-entry { font-size: 11px; opacity: .6; word-break: break-all; }
.pm-sub-l { font-size: 11px; font-weight: 800; opacity: .55; }
.pm-exts { display: flex; flex-wrap: wrap; gap: 5px; }
.pm-ext { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; padding: 2px 7px; border-radius: 99px; background: rgba(255, 255, 255, .5); }
.pm-detail-acts { display: flex; gap: 6px; }
.perm-list { display: flex; flex-direction: column; gap: 6px; }
.perm-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.perm-item span { line-height: 1.2; }
.perm-item input[type='checkbox'] {
  flex: none; width: 16px; height: 16px; margin: 0;
  accent-color: var(--eo-primary); cursor: pointer;
}

/* ---- 发现 ---- */
.pm-showcase { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.pm-sample { padding: 12px; border-radius: 14px; background: var(--eo-glass); border: 1px solid var(--eo-glass-border); display: flex; flex-direction: column; gap: 8px; }
.pm-sample-head { display: flex; align-items: center; gap: 9px; }
.pm-sample-ico {
  flex: none; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
.pm-sample-desc { font-size: 12px; line-height: 1.5; opacity: .75; min-height: 36px; }
.pm-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pm-tag { font-size: 10px; padding: 1px 6px; border-radius: 99px; background: var(--eo-chip); opacity: .75; }
.pm-tag.perm { margin-left: auto; }
.pm-installed { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #6F8E6F; font-weight: 700; }
.pm-share { margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ---- 发现：订阅 / 空状态 ---- */
.pm-subscribe { margin-bottom: 10px; display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.pm-empty { text-align: center; padding: 26px 12px 28px; }
.pm-empty-ico {
  width: 46px; height: 46px; margin: 0 auto 12px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
  background: var(--eo-chip); color: var(--eo-primary-deep);
}
.pm-empty-t { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.pm-empty-d { font-size: 12px; line-height: 1.7; opacity: .7; max-width: 460px; margin: 0 auto 14px; }
.pm-empty-acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.pm-source { margin-bottom: 10px; }
.pm-source-head { display: flex; align-items: center; gap: 8px; }
.pm-source-url {
  flex: 1; min-width: 0; font-size: 12px; font-family: ui-monospace, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8;
}
.pm-source-state { flex: none; font-size: 11px; padding: 1px 8px; border-radius: 99px; background: var(--eo-chip); }
.pm-source-state.error { color: #A05A4C; background: rgba(160, 90, 76, 0.12); }
.pm-source-err { margin-top: 8px; font-size: 12px; line-height: 1.6; color: #A05A4C; }
.pm-source .pm-showcase { margin-top: 10px; }

/* ---- 开发者指南 ---- */
.pm-guide { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.pm-guide-t { font-size: 12px; font-weight: 700; margin-top: 6px; }
.pm-guide-d { font-size: 12px; line-height: 1.75; opacity: .78; }
.pm-guide-code {
  margin: 4px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--eo-chip);
  font-size: 11px; line-height: 1.6; overflow: auto; max-height: 260px; white-space: pre;
}
.pm-guide-api { display: flex; flex-direction: column; gap: 4px; }
.pm-guide-api > div { display: flex; gap: 10px; font-size: 11.5px; align-items: baseline; }
.pm-guide-api code { font-size: 11px; opacity: .9; white-space: nowrap; }
.pm-guide-api span { opacity: .65; font-size: 11.5px; }
.pm-subscribe input { max-width: none; width: 100%; }
@media (max-width: 640px) {
  .pm-subscribe { flex-direction: column; align-items: stretch; }
  .pm-subscribe .chip { width: 100%; justify-content: center; }
  .pm-share { flex-direction: column; align-items: stretch; }
  .pm-share > div { flex: none; width: 100%; }
  .pm-acts { width: 100%; }
  .pm-acts .chip { flex: 1; justify-content: center; }
  .pm-guide-api > div { flex-direction: column; gap: 1px; }
  .pm-guide-api code { white-space: normal; word-break: break-all; }
}

/* ---- 开发者 ---- */
.pm-perm-doc { display: flex; flex-direction: column; gap: 6px; }
.pm-perm-doc-row { display: flex; gap: 8px; font-size: 12px; }
.pm-perm-doc-row b { flex: none; width: 96px; font-family: ui-monospace, monospace; font-size: 11px; opacity: .8; }
.pm-perm-doc-row span { opacity: .7; }
.plugin-host { border: 1px solid var(--eo-glass-border); border-radius: 12px; background: var(--eo-chip); min-height: 60px; }

@media (max-width: 640px) {
  .pm-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pm-stats { gap: 6px; }
}
</style>
