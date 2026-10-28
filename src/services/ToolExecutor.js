// ===== Tool Calling 意图分发（需求 3）：全局单例，按 tool_name 路由本地 Service =====
// 红线 3：严禁在 UI 组件内直接写 Tool 调用逻辑；所有调用统一走这里。
import { useAppStore } from '../stores/app.js'
import { canvasEnsureNode } from './canvasBridge.js'

// 中台定义的 JSON Schema Tool 接口（前端消费契约，可扩展）
export const TOOL_SCHEMAS = {
  create_task: {
    description: '创建一条任务',
    parameters: { title: 'string', note: 'string', category: 'main|side|todo', dueDate: 'YYYY-MM-DD' }
  },
  create_note: {
    description: '创建一条笔记',
    parameters: { title: 'string', markdown: 'string' }
  },
  create_ledger: {
    description: '记一笔账',
    parameters: { type: 'income|expense', amount: 'number', category: 'string', note: 'string', date: 'YYYY-MM-DD' }
  },
  add_item: {
    description: '收入一件背包物品',
    parameters: { name: 'string', type: 'physical|virtual', category: 'string', count: 'number', description: 'string' }
  },
  add_location: {
    description: '添加一个足迹坐标',
    parameters: { name: 'string', lat: 'number', lng: 'number', note: 'string', date: 'YYYY-MM-DD' }
  }
}

let _instance = null
export function useToolExecutor() {
  if (_instance) return _instance
  const store = useAppStore()

  // 若画布打开，把创建的实体自动落为一个画布节点（需求 11）
  function dropNode(type, id, color) {
    try { canvasEnsureNode(type, id, { center: true, color }) } catch (e) { /* 画布未开：静默 */ }
  }

  function execute(toolCall) {
    const name = (toolCall && (toolCall.tool_name || toolCall.name)) || ''
    const p = (toolCall && (toolCall.parameters || toolCall.arguments || {})) || {}
    switch (name) {
      case 'create_task': {
        const r = store.addTask({
          title: p.title || p.note || '新任务',
          note: p.note || '',
          category: ['main', 'side', 'todo'].includes(p.category) ? p.category : 'side',
          dueDate: p.dueDate || null
        })
        if (r.ok) dropNode('task', r.task.id, 'green')
        return r.ok ? { ok: true, message: '已创建任务', entity: r.task } : { ok: false, error: r.error }
      }
      case 'create_note': {
        const r = store.addMemo({ title: p.title || '快捷笔记', markdown: p.markdown || p.title || '' })
        if (r.ok) dropNode('memo', r.memo.id, 'amber')
        return r.ok ? { ok: true, message: '已保存笔记', entity: r.memo } : { ok: false, error: r.error }
      }
      case 'create_ledger': {
        const r = store.addLedgerRecord({
          type: p.type === 'income' ? 'income' : 'expense',
          amount: Number(p.amount) || 0,
          category: p.category || '其他',
          note: p.note || '',
          date: p.date || ''
        })
        return r.ok ? { ok: true, message: '已记账', entity: r.record } : { ok: false, error: r.error }
      }
      case 'add_item': {
        const r = store.addItem({
          name: p.name || '新物品',
          type: p.type === 'virtual' ? 'virtual' : 'physical',
          category: p.category || '',
          count: Number(p.count) || 1,
          description: p.description || ''
        })
        if (r.ok) dropNode('item', r.item.id, 'purple')
        return r.ok ? { ok: true, message: '已收入物品', entity: r.item } : { ok: false, error: r.error }
      }
      case 'add_location': {
        const r = store.addLocation({
          name: p.name || p.title || '新足迹',
          lat: Number(p.lat) || 0, lng: Number(p.lng) || 0,
          note: p.note || '', date: p.date || ''
        })
        if (r.ok) dropNode('location', r.entry.id, 'blue')
        return r.ok ? { ok: true, message: '已添加足迹', entity: r.entry } : { ok: false, error: r.error }
      }
      default:
        return { ok: false, error: '未知工具：' + name }
    }
  }

  _instance = { TOOL_SCHEMAS, execute }
  return _instance
}
