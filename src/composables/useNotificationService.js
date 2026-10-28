// ===== 系统级桌面通知（需求 9）：权限 / 调度 / 点击回调 =====
// 复用 store.live.tasks 派生今日截止 / 逾期提醒；页面隐藏时（visibilitychange hidden）触发检查。
import { useAppStore } from '../stores/app.js'
import { todayStr } from '../lib/model.js'

let registered = false

export function useNotificationService() {
  const store = useAppStore()

  function permission() {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  }

  async function request() {
    if (typeof Notification === 'undefined') return 'unsupported'
    try { return await Notification.requestPermission() } catch (e) { return 'denied' }
  }

  function notify(title, opts) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null
    try {
      const n = new Notification(title, opts)
      n.onclick = () => {
        try { window.focus() } catch (e) {}
        if (opts && typeof opts.onClick === 'function') opts.onClick()
        n.close()
      }
      return n
    } catch (e) { return null }
  }

  // 派生今日截止 / 逾期任务（与设置页 dueItems 同口径）
  function pendingTasks() {
    const today = todayStr()
    const out = []
    store.live.tasks.forEach((t) => {
      if (t.status === 'done' || !t.dueDate) return
      if (t.dueDate < today) out.push('已逾期：' + t.title + (t.dueTime ? '（' + t.dueTime + '）' : ''))
      else if (t.dueDate === today) out.push('今日截止：' + t.title + (t.dueTime ? '（' + t.dueTime + '）' : ''))
    })
    return out
  }

  // 调度检查：仅在后台（hidden）弹系统通知，避免前台打扰
  function scheduleCheck() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const list = pendingTasks()
    list.slice(0, 3).forEach((text) => {
      notify('地球Online · 任务提醒', {
        body: text,
        tag: 'eo-task-' + text,
        onClick: () => window.location.hash = '#/tasks'
      })
    })
  }

  function activate() {
    if (registered) return () => {}
    registered = true
    const onVis = () => { if (document.hidden) scheduleCheck() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); registered = false }
  }

  return { permission, request, notify, scheduleCheck, pendingTasks, activate }
}
