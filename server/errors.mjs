// 统一的 HTTP 错误类型：只携带状态码与可安全下发的文案，不泄漏堆栈。
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
