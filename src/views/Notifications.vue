<script setup>
// 通知中心：派生自真实数据（今日截止 / 已逾期 / 成就解锁），绝不伪造
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app.js'
import { todayStr } from '../lib/model.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import Icon from '../components/Icon.vue'

const store = useAppStore()
const today = todayStr()
const perm = ref(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')

const dueItems = computed(() => {
  const out = []
  store.data.tasks.forEach((t) => {
    if (t.status === 'done' || !t.dueDate) return
    if (t.dueDate < today) out.push({ id: 'over-' + t.id, icon: 'bolt', tone: 'bad', title: '已逾期：' + t.title, sub: '截止 ' + t.dueDate + (t.dueTime ? ' ' + t.dueTime : ''), to: '/tasks' })
    else if (t.dueDate === today) out.push({ id: 'due-' + t.id, icon: 'clock', tone: 'warn', title: '今日截止：' + t.title, sub: t.dueTime ? '今天 ' + t.dueTime : '今天', to: '/tasks' })
  })
  return out
})
const achievementNews = computed(() => {
  return store.data.achievements.slice(-3).reverse().map((a) => {
    const d = ACHIEVEMENTS.find((x) => x.key === a.key)
    return { id: 'ach-' + a.key, icon: d ? d.icon : 'trophy', tone: 'good', title: '成就解锁：' + (d ? d.title : a.key), sub: '解锁于 ' + a.unlockedAt, to: '/achievements' }
  })
})
const all = computed(() => dueItems.value.concat(achievementNews.value))

async function askPermission() {
  if (typeof Notification === 'undefined') { store.showToast('当前环境不支持系统通知'); return }
  try {
    const p = await Notification.requestPermission()
    perm.value = p
    if (p === 'granted') {
      new Notification('地球Online', { body: '系统通知已开启，任务截止将在前端运行时提醒。' })
      store.showToast('已开启系统通知')
    } else store.showToast('未授权系统通知')
  } catch (e) { store.showToast('开启失败：' + e.message) }
}
function go(to) { location.hash = '#' + to }
</script>

<template>
  <div class="page wide">
    <div class="glass card">
      <div class="row between">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">系统通知</div>
          <div class="muted" style="font-size:12px;margin-top:2px">授权后，浏览器前台运行时会对今日截止任务弹系统提醒（当前状态：{{ perm === 'granted' ? '已授权' : perm === 'denied' ? '已拒绝' : perm === 'unsupported' ? '不支持' : '未授权' }}）。</div>
        </div>
        <button class="btn" :disabled="perm === 'granted' || perm === 'unsupported'" @click="askPermission"><Icon name="bell" :size="16" /> {{ perm === 'granted' ? '已开启' : '开启' }}</button>
      </div>
    </div>

    <div class="section-title">待关注</div>
    <div v-for="n in all" :key="n.id" class="glass list-item" style="cursor:pointer" @click="go(n.to)">
      <span class="avatar" :style="n.tone === 'bad' ? 'background:rgba(196,99,76,.16);color:var(--eo-bad)' : n.tone === 'good' ? 'background:rgba(78,150,104,.16);color:var(--eo-good)' : 'background:var(--eo-chip);color:var(--eo-primary-deep)'">
        <Icon :name="n.icon" :size="20" />
      </span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">{{ n.title }}</div>
        <div class="muted" style="font-size:12px">{{ n.sub }}</div>
      </div>
      <Icon name="chevron" :size="16" />
    </div>
    <div v-if="!all.length" class="muted" style="text-align:center;padding:40px">
      暂无待办提醒与成就动态。<br />有任务临近截止时，这里会自动出现提醒。
    </div>
  </div>
</template>
