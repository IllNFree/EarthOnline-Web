import { defineStore } from 'pinia'

// Global promise-based dialog — replaces native confirm()/alert() with a liquid-glass modal.
export const useDialogStore = defineStore('dialog', {
  state: () => ({
    open: false,
    kind: 'confirm', // 'confirm' | 'alert'
    title: '',
    message: '',
    detail: '',
    danger: false,
    confirmText: '确定',
    cancelText: '取消',
    _resolve: null
  }),
  actions: {
    confirm(opts = {}) {
      return new Promise((resolve) => {
        this.kind = 'confirm'
        this.title = opts.title || '请确认'
        this.message = opts.message || ''
        this.detail = opts.detail || ''
        this.danger = !!opts.danger
        this.confirmText = opts.confirmText || '确定'
        this.cancelText = opts.cancelText || '取消'
        this._resolve = resolve
        this.open = true
      })
    },
    alert(opts = {}) {
      return new Promise((resolve) => {
        this.kind = 'alert'
        this.title = opts.title || '提示'
        this.message = opts.message || ''
        this.detail = opts.detail || ''
        this.danger = false
        this.confirmText = opts.confirmText || '知道了'
        this.cancelText = ''
        this._resolve = resolve
        this.open = true
      })
    },
    close(result) {
      if (!this.open) return
      this.open = false
      const r = this._resolve
      this._resolve = null
      if (r) r(result)
    }
  }
})
