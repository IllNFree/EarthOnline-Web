// ===== 桌面壳预加载：只向渲染层暴露白名单能力 =====
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('eoDesktop', {
  isDesktop: true,
  platform: process.platform,
  // 系统文件夹选择 → 绝对路径
  pickFolder: () => ipcRenderer.invoke('eo:pick-folder'),
  // 按绝对路径扫描（图片 / 视频 / 音频 / 文本）
  listDir: (dirPath, opts) => ipcRenderer.invoke('eo:list-dir', dirPath, opts || {}),
  // 读取文本文件内容
  readText: (dirPath, relPath) => ipcRenderer.invoke('eo:read-text', dirPath, relPath),
  // 用系统默认程序打开本地文件（docx / pdf 等）
  openExternal: (absPath) => ipcRenderer.invoke('eo:open-external', absPath)
})
